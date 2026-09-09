-- ==============================================================================
-- Migration: Phase 3 Gate #5.2 Part 2 — Paystack Transfer Execution, Webhooks & Reconciliation
-- Description:
-- 1. Creates public.admin_payout_audits table for immutable administrative audit trails
-- 2. Implements public.settle_partner_payout_transfer() with canonical locking, idempotency & ledger
-- 3. Implements public.record_partner_payout_failure() for safe failure handling
-- 4. Implements public.flag_partner_payout_reconciliation() for timeouts/uncertain states
-- 5. Implements public.reconcile_partner_payout_status() for authoritative state application
-- 6. Implements public.admin_reconcile_partner_payout() for verified admin audit controls
-- 7. Enforces strict RLS and security permissions (service_role / admin only)
-- ==============================================================================

-- ==============================================================================
-- 1. IMMUTABLE ADMIN PAYOUT AUDITS TABLE
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.admin_payout_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  payout_id UUID NOT NULL REFERENCES public.partner_payouts(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL,
  reason TEXT NOT NULL,
  prior_status TEXT NOT NULL,
  resulting_status TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_payout_audits_payout_id ON public.admin_payout_audits(payout_id);
CREATE INDEX IF NOT EXISTS idx_admin_payout_audits_booking_id ON public.admin_payout_audits(booking_id);
CREATE INDEX IF NOT EXISTS idx_admin_payout_audits_admin_id ON public.admin_payout_audits(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_payout_audits_created_at ON public.admin_payout_audits(created_at);

ALTER TABLE public.admin_payout_audits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.admin_payout_audits FROM anon, authenticated;

CREATE POLICY admin_payout_audits_select_admin ON public.admin_payout_audits
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- ==============================================================================
-- 2. SETTLE PARTNER PAYOUT TRANSFER RPC
-- Executed strictly when Paystack confirms transfer success (via API or transfer.success webhook)
-- Canonical Lock Order: bookings -> partner_payouts
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.settle_partner_payout_transfer(
  p_payout_id UUID,
  p_transfer_reference TEXT,
  p_paystack_transfer_code TEXT DEFAULT NULL,
  p_paystack_response JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service BOOLEAN;
  v_is_admin BOOLEAN;
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_now TIMESTAMPTZ := now();
  v_prior_status TEXT;
  v_ledger_result JSONB;
BEGIN
  -- 1. Security Authorization: service_role or admin
  v_is_service := (
    v_jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR session_user IN ('postgres', 'service_role', 'supabase_admin')
  );
  v_is_admin := (
    v_caller_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: partner payout settlement is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF p_payout_id IS NULL THEN
    RAISE EXCEPTION 'p_payout_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_transfer_reference IS NULL OR TRIM(p_transfer_reference) = '' THEN
    RAISE EXCEPTION 'p_transfer_reference is required' USING ERRCODE = '22023';
  END IF;

  -- 3. Lookup booking ID associated with payout
  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. CANONICAL LOCK ORDER:
  -- Lock booking row first, then lock partner_payout row
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated booking % not found for payout %', v_booking_id, p_payout_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  v_prior_status := v_payout.status;

  -- 5. Reference Verification: Must match the permanent payout reference
  IF v_payout.paystack_transfer_reference IS DISTINCT FROM TRIM(p_transfer_reference) THEN
    RAISE EXCEPTION 'Transfer reference mismatch: expected "%", received "%"',
      v_payout.paystack_transfer_reference, p_transfer_reference USING ERRCODE = '22023';
  END IF;

  -- 6. Idempotency Check: If already completed, return gracefully with zero duplicate ledger movements
  IF v_payout.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'payout_id', v_payout.id,
      'booking_id', v_booking.id,
      'status', 'completed',
      'partner_amount_ngn', v_payout.partner_amount_ngn,
      'paystack_transfer_reference', v_payout.paystack_transfer_reference,
      'paystack_transfer_code', v_payout.paystack_transfer_code,
      'disbursed_at', v_payout.disbursed_at,
      'message', 'Partner payout transfer has already been completed.'
    );
  END IF;

  -- 7. Validate Payout Status: Must be processing or reconciliation_required
  IF v_payout.status NOT IN ('processing', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Invalid payout status "%" for transfer settlement (must be "processing" or "reconciliation_required")',
      v_payout.status USING ERRCODE = '22023';
  END IF;

  -- 8. Verify Amount Invariant: Amount must be strictly greater than zero and equal to partner_amount_ngn
  IF v_payout.partner_amount_ngn IS NULL OR v_payout.partner_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'Invalid partner payout amount: %', v_payout.partner_amount_ngn USING ERRCODE = '22023';
  END IF;

  -- 9. Update Partner Payout: Transition to completed, record disbursement time & transfer code
  UPDATE public.partner_payouts
  SET
    status = 'completed',
    disbursed_at = COALESCE(v_payout.disbursed_at, v_now),
    paystack_transfer_code = COALESCE(TRIM(p_paystack_transfer_code), v_payout.paystack_transfer_code),
    reconciled_at = CASE WHEN v_prior_status = 'reconciliation_required' THEN v_now ELSE v_payout.reconciled_at END,
    reconciliation_notes = CASE
      WHEN v_prior_status = 'reconciliation_required' THEN
        COALESCE(v_payout.reconciliation_notes, '') || ' [Settled and reconciled via Paystack confirmation at ' || v_now::TEXT || ']'
      ELSE v_payout.reconciliation_notes
    END,
    updated_at = v_now
  WHERE id = v_payout.id;

  -- 10. POST EXACTLY ONE PARTNER_PAYOUT_DISBURSED DOUBLE-ENTRY BALANCED LEDGER ENTRY
  -- Account Movement:
  --   DEBIT:  2100 Partner Payout Payable (reduces platform liability to host)
  --   CREDIT: 1010 Gateway Clearing       (reflects funds disbursed out of gateway balance)
  -- Reference: v_payout.paystack_transfer_reference
  IF NOT EXISTS (
    SELECT 1 FROM public.financial_ledger
    WHERE reference = v_payout.paystack_transfer_reference
      AND transaction_type = 'PARTNER_PAYOUT_DISBURSED'
  ) THEN
    v_ledger_result := public.record_balanced_ledger_transaction(
      p_transaction_group_id => gen_random_uuid(),
      p_booking_id => v_booking.id,
      p_transaction_type => 'PARTNER_PAYOUT_DISBURSED',
      p_reference => v_payout.paystack_transfer_reference,
      p_description => 'Partner payout disbursement for booking ' || v_booking.booking_reference || ' via Paystack transfer ref: ' || v_payout.paystack_transfer_reference,
      p_debit_account => '2100 Partner Payout Payable',
      p_credit_account => '1010 Gateway Clearing',
      p_amount_ngn => v_payout.partner_amount_ngn
    );
  END IF;

  -- 11. Return authoritative settlement receipt
  RETURN jsonb_build_object(
    'success', true,
    'already_completed', false,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'status', 'completed',
    'prior_status', v_prior_status,
    'partner_amount_ngn', v_payout.partner_amount_ngn,
    'paystack_transfer_reference', v_payout.paystack_transfer_reference,
    'paystack_transfer_code', COALESCE(TRIM(p_paystack_transfer_code), v_payout.paystack_transfer_code),
    'disbursed_at', v_now,
    'ledger_posted', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_partner_payout_transfer(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_partner_payout_transfer(UUID, TEXT, TEXT, JSONB) TO service_role;

-- ==============================================================================
-- 3. RECORD PARTNER PAYOUT FAILURE RPC
-- Handles definitive Paystack rejections (e.g. invalid recipient, bank failure)
-- Does NOT create ledger transactions; preserves transfer reference permanently
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.record_partner_payout_failure(
  p_payout_id UUID,
  p_transfer_reference TEXT,
  p_failure_reason TEXT,
  p_paystack_response JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service BOOLEAN;
  v_is_admin BOOLEAN;
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT;
BEGIN
  v_is_service := (
    v_jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR session_user IN ('postgres', 'service_role', 'supabase_admin')
  );
  v_is_admin := (
    v_caller_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: partner payout failure recording is restricted to service role or administrators.'
      USING ERRCODE = '42501';
  END IF;

  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- Canonical lock order: bookings -> partner_payouts
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF v_payout.status = 'completed' THEN
    RAISE EXCEPTION 'Terminal state conflict: completed payout cannot be marked as failed.' USING ERRCODE = '22023';
  END IF;

  IF v_payout.status = 'failed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_failed', true,
      'payout_id', v_payout.id,
      'status', 'failed',
      'failure_reason', v_payout.failure_reason
    );
  END IF;

  IF v_payout.paystack_transfer_reference IS DISTINCT FROM TRIM(p_transfer_reference) THEN
    RAISE EXCEPTION 'Transfer reference mismatch: expected "%", received "%"',
      v_payout.paystack_transfer_reference, p_transfer_reference USING ERRCODE = '22023';
  END IF;

  v_clean_reason := COALESCE(TRIM(p_failure_reason), 'Paystack transfer rejected');

  UPDATE public.partner_payouts
  SET
    status = 'failed',
    failure_reason = v_clean_reason,
    reconciliation_notes = COALESCE(reconciliation_notes, '') || ' [Definitive transfer failure: ' || v_clean_reason || ' at ' || v_now::TEXT || ']',
    updated_at = v_now
  WHERE id = v_payout.id;

  RETURN jsonb_build_object(
    'success', true,
    'already_failed', false,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'status', 'failed',
    'failure_reason', v_clean_reason,
    'updated_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.record_partner_payout_failure(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_payout_failure(UUID, TEXT, TEXT, JSONB) TO service_role;

-- ==============================================================================
-- 4. FLAG PARTNER PAYOUT RECONCILIATION RPC
-- Triggered on timeout, 5xx, or network failure where outcome is uncertain.
-- Safe: preserves reference, prevents duplicate transfers, prompts verification
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.flag_partner_payout_reconciliation(
  p_payout_id UUID,
  p_reason TEXT,
  p_paystack_response JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service BOOLEAN;
  v_is_admin BOOLEAN;
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_reason TEXT;
BEGIN
  v_is_service := (
    v_jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR session_user IN ('postgres', 'service_role', 'supabase_admin')
  );
  v_is_admin := (
    v_caller_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: partner payout reconciliation flagging is restricted to service role or administrators.'
      USING ERRCODE = '42501';
  END IF;

  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF v_payout.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'payout_id', v_payout.id,
      'status', 'completed',
      'message', 'Payout is already completed.'
    );
  END IF;

  v_clean_reason := COALESCE(TRIM(p_reason), 'Uncertain transfer outcome / timeout');

  UPDATE public.partner_payouts
  SET
    status = 'reconciliation_required',
    reconciliation_required_at = COALESCE(reconciliation_required_at, v_now),
    reconciliation_notes = COALESCE(reconciliation_notes, '') || ' [Flagged reconciliation: ' || v_clean_reason || ' at ' || v_now::TEXT || ']',
    updated_at = v_now
  WHERE id = v_payout.id;

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'status', 'reconciliation_required',
    'reconciliation_required_at', v_now,
    'reason', v_clean_reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.flag_partner_payout_reconciliation(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_partner_payout_reconciliation(UUID, TEXT, JSONB) TO service_role;

-- ==============================================================================
-- 5. RECONCILE PARTNER PAYOUT STATUS RPC
-- Applies authoritative Paystack verification result to a payout in processing or reconciliation_required
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.reconcile_partner_payout_status(
  p_payout_id UUID,
  p_authoritative_status TEXT,
  p_notes TEXT,
  p_paystack_transfer_code TEXT DEFAULT NULL,
  p_paystack_response JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_payout RECORD;
  v_settle_result JSONB;
  v_fail_result JSONB;
  v_flag_result JSONB;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Read current payout reference
  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  CASE p_authoritative_status
    WHEN 'success' THEN
      v_settle_result := public.settle_partner_payout_transfer(
        p_payout_id => p_payout_id,
        p_transfer_reference => v_payout.paystack_transfer_reference,
        p_paystack_transfer_code => p_paystack_transfer_code,
        p_paystack_response => p_paystack_response
      );
      RETURN v_settle_result;

    WHEN 'failed' THEN
      v_fail_result := public.record_partner_payout_failure(
        p_payout_id => p_payout_id,
        p_transfer_reference => v_payout.paystack_transfer_reference,
        p_failure_reason => p_notes,
        p_paystack_response => p_paystack_response
      );
      RETURN v_fail_result;

    WHEN 'pending' THEN
      -- Payout remains in processing or reconciliation_required; update notes and transfer code if available
      UPDATE public.partner_payouts
      SET
        paystack_transfer_code = COALESCE(TRIM(p_paystack_transfer_code), paystack_transfer_code),
        reconciliation_notes = COALESCE(reconciliation_notes, '') || ' [Verification pending: ' || COALESCE(p_notes, 'transfer is in transit') || ' at ' || v_now::TEXT || ']',
        updated_at = v_now
      WHERE id = p_payout_id;

      RETURN jsonb_build_object(
        'success', true,
        'payout_id', p_payout_id,
        'status', v_payout.status,
        'resolution', 'pending_unresolved',
        'message', 'Transfer is currently pending with Paystack.'
      );

    WHEN 'reversed' THEN
      -- Reversals: Put in reconciliation_required for administrative review. Never mark completed!
      UPDATE public.partner_payouts
      SET
        status = 'reconciliation_required',
        reconciliation_required_at = COALESCE(reconciliation_required_at, v_now),
        reconciliation_notes = COALESCE(reconciliation_notes, '') || ' [CRITICAL: Paystack reported transfer reversed - ' || COALESCE(p_notes, 'reversed by processor') || ' at ' || v_now::TEXT || ']',
        updated_at = v_now
      WHERE id = p_payout_id;

      RETURN jsonb_build_object(
        'success', true,
        'payout_id', p_payout_id,
        'status', 'reconciliation_required',
        'resolution', 'reversed_flagged',
        'message', 'Transfer was reversed by processor; flagged for administrative review.'
      );

    ELSE
      -- Unknown or not found: remain in reconciliation_required
      v_flag_result := public.flag_partner_payout_reconciliation(
        p_payout_id => p_payout_id,
        p_reason => 'Reconciliation resolution inconclusive: ' || COALESCE(p_notes, p_authoritative_status),
        p_paystack_response => p_paystack_response
      );
      RETURN v_flag_result;
  END CASE;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_partner_payout_status(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_partner_payout_status(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ==============================================================================
-- 6. ADMIN RECONCILE PARTNER PAYOUT RPC
-- Initiates verified administrative reconciliation with audit logging
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_reconcile_partner_payout(
  p_payout_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_is_admin BOOLEAN;
  v_payout RECORD;
  v_booking RECORD;
  v_audit_id UUID;
  v_clean_reason TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Security Check: Authenticated administrator
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: administrator credentials mandatory.' USING ERRCODE = '42501';
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = v_admin_id AND role = 'admin'
  ) INTO v_is_admin;

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: partner payout reconciliation is strictly restricted to platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate reason is non-empty
  v_clean_reason := TRIM(COALESCE(p_reason, ''));
  IF length(v_clean_reason) = 0 THEN
    RAISE EXCEPTION 'A non-empty reason is mandatory for administrative payout reconciliation.' USING ERRCODE = '22023';
  END IF;

  -- 3. Lock booking and payout
  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_payout.booking_id
  FOR UPDATE;

  -- 4. Invariant: Admin cannot directly fabricate 'completed' status
  -- Must operate on processing or reconciliation_required
  IF v_payout.status = 'completed' THEN
    RAISE EXCEPTION 'Payout % is already completed; no reconciliation required.', p_payout_id USING ERRCODE = '22023';
  END IF;

  IF v_payout.status = 'cancelled' THEN
    RAISE EXCEPTION 'Payout % is cancelled; cannot reconcile a cancelled payout.', p_payout_id USING ERRCODE = '22023';
  END IF;

  -- 5. Record immutable audit entry
  INSERT INTO public.admin_payout_audits (
    payout_id,
    booking_id,
    admin_id,
    action,
    reason,
    prior_status,
    resulting_status,
    metadata,
    created_at
  ) VALUES (
    v_payout.id,
    v_booking.id,
    v_admin_id,
    'admin_reconcile_requested',
    v_clean_reason,
    v_payout.status,
    v_payout.status,
    jsonb_build_object(
      'paystack_transfer_reference', v_payout.paystack_transfer_reference,
      'partner_amount_ngn', v_payout.partner_amount_ngn,
      'attempt_count', v_payout.attempt_count
    ),
    v_now
  )
  RETURNING id INTO v_audit_id;

  RETURN jsonb_build_object(
    'success', true,
    'audit_id', v_audit_id,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'current_status', v_payout.status,
    'paystack_transfer_reference', v_payout.paystack_transfer_reference,
    'message', 'Administrative reconciliation audit logged. Payout is ready for authoritative verification query.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_reconcile_partner_payout(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_partner_payout(UUID, TEXT) TO authenticated, service_role;
