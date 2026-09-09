-- ==============================================================================
-- Migration: 20260904_phase3_gate7_2b_part2_financial_execution.sql
-- Phase 3 — Gate #7.2B Part 2: External Financial Execution Foundation
--
-- Authoritative Schema & Security Invariants:
-- 1. Table: public.refund_operations (authoritative execution entity with state machine)
-- 2. Table: public.financial_audit_logs (immutable audit trail)
-- 3. Permanent Refund References: ARK-RFD-{refund_operation_id}
-- 4. 8-Step Concurrency Pattern: Canonical locks -> Validate & Authorize -> Commit -> Paystack Outbound -> Settle/Reconcile
-- 5. Double-Entry Accounting:
--    - Damage Deposit Refund: Dr 2300 (Damage Deposit Liability), Cr 1010 (Gateway Clearing)
--    - Issue Refund: Dr 2010 (Guest Unearned Revenue / Refund Clearing), Cr 1010 (Gateway Clearing)
--    - No commission revenue (never 4010/4020)
-- 6. Webhook Idempotency: refund.processed, refund.failed, refund.pending
-- 7. Reconciliation & Uncertain Outcome Handling
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. Create public.refund_operations
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.refund_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  payment_id UUID REFERENCES public.payments(id) ON DELETE RESTRICT,
  issue_id UUID REFERENCES public.booking_issues(id) ON DELETE RESTRICT,
  deposit_id UUID REFERENCES public.damage_deposits(id) ON DELETE RESTRICT,
  refund_category TEXT NOT NULL CHECK (
    refund_category IN ('damage_deposit', 'guest_assurance_issue', 'booking_cancellation', 'administrative')
  ),
  refund_reason TEXT NOT NULL,
  amount_ngn NUMERIC(14,2) NOT NULL CHECK (amount_ngn > 0),
  currency TEXT NOT NULL DEFAULT 'NGN',
  paystack_reference TEXT NOT NULL UNIQUE,
  paystack_refund_id TEXT,
  status TEXT NOT NULL DEFAULT 'requested' CHECK (
    status IN ('requested', 'authorized', 'processing', 'completed', 'failed', 'reconciliation_required')
  ),
  requested_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processing_started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  failed_at TIMESTAMPTZ,
  failure_code TEXT,
  failure_message TEXT,
  reconciliation_required_at TIMESTAMPTZ,
  reconciliation_attempts INTEGER NOT NULL DEFAULT 0,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for booking and payment lookup
CREATE INDEX IF NOT EXISTS idx_refund_ops_booking_id ON public.refund_operations(booking_id);
CREATE INDEX IF NOT EXISTS idx_refund_ops_payment_id ON public.refund_operations(payment_id);
CREATE INDEX IF NOT EXISTS idx_refund_ops_status ON public.refund_operations(status);
CREATE INDEX IF NOT EXISTS idx_refund_ops_ref ON public.refund_operations(paystack_reference);

-- Enforce zero duplicate active/completed refunds for the same damage deposit
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_ops_active_deposit 
  ON public.refund_operations(deposit_id) 
  WHERE deposit_id IS NOT NULL AND status NOT IN ('failed');

-- Enforce zero duplicate active/completed refunds for the same booking issue
CREATE UNIQUE INDEX IF NOT EXISTS uq_refund_ops_active_issue 
  ON public.refund_operations(issue_id) 
  WHERE issue_id IS NOT NULL AND status NOT IN ('failed');

-- ------------------------------------------------------------------------------
-- 2. Create public.financial_audit_logs
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.financial_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES auth.users(id),
  actor_role TEXT NOT NULL DEFAULT 'service_role',
  operation_type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  previous_state TEXT,
  new_state TEXT NOT NULL,
  amount_ngn NUMERIC(14,2),
  booking_id UUID REFERENCES public.bookings(id),
  payment_id UUID REFERENCES public.payments(id),
  reference TEXT,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_fin_audit_entity ON public.financial_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_fin_audit_booking ON public.financial_audit_logs(booking_id);
CREATE INDEX IF NOT EXISTS idx_fin_audit_created ON public.financial_audit_logs(created_at DESC);

-- ------------------------------------------------------------------------------
-- 3. Enable RLS on new financial tables
-- ------------------------------------------------------------------------------
ALTER TABLE public.refund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

-- Guests can only view refund operations for their own reservations
DROP POLICY IF EXISTS "Guest read own refund operations" ON public.refund_operations;
CREATE POLICY "Guest read own refund operations"
  ON public.refund_operations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = refund_operations.booking_id
        AND b.user_id = auth.uid()
    )
  );

-- Hosts cannot view or mutate refund operations
DROP POLICY IF EXISTS "Host denied refund mutations" ON public.refund_operations;

-- Platform Admin full SELECT
DROP POLICY IF EXISTS "Admin view refund operations" ON public.refund_operations;
CREATE POLICY "Admin view refund operations"
  ON public.refund_operations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Service Role has full access
DROP POLICY IF EXISTS "Service role full refund operations" ON public.refund_operations;
CREATE POLICY "Service role full refund operations"
  ON public.refund_operations
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- Audit logs: readable only by admins and service_role
DROP POLICY IF EXISTS "Admin view audit logs" ON public.financial_audit_logs;
CREATE POLICY "Admin view audit logs"
  ON public.financial_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Service role full audit logs" ON public.financial_audit_logs;
CREATE POLICY "Service role full audit logs"
  ON public.financial_audit_logs
  FOR ALL
  TO service_role
  USING (TRUE)
  WITH CHECK (TRUE);

-- Revoke direct DML from public, anon, authenticated
REVOKE INSERT, UPDATE, DELETE ON public.refund_operations FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.financial_audit_logs FROM PUBLIC, anon, authenticated;

-- ------------------------------------------------------------------------------
-- 4. RPC: public.initialize_refund_operation
-- Server-Side Phase 1 of Refund: Validates state, locks rows, creates authorized record
-- CANONICAL LOCK ORDER: bookings -> partner_payouts -> guest_assurance_reserves -> damage_deposits -> booking_issues
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.initialize_refund_operation(
  p_booking_id UUID,
  p_refund_category TEXT,
  p_deposit_id UUID DEFAULT NULL,
  p_issue_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
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
  v_now TIMESTAMPTZ := now();
  v_booking RECORD;
  v_payout RECORD;
  v_reserve RECORD;
  v_deposit RECORD;
  v_issue RECORD;
  v_payment RECORD;
  v_authorized_amount NUMERIC(14,2) := 0;
  v_refund_id UUID := gen_random_uuid();
  v_refund_ref TEXT;
  v_existing_op RECORD;
BEGIN
  -- 1. Authorization: service_role or admin ONLY
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
    RAISE EXCEPTION 'Unauthorized: refund initialization is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Validate category
  IF p_refund_category NOT IN ('damage_deposit', 'guest_assurance_issue', 'booking_cancellation', 'administrative') THEN
    RAISE EXCEPTION 'Invalid refund category: %. Allowed: damage_deposit, guest_assurance_issue, booking_cancellation, administrative.',
      p_refund_category USING ERRCODE = '22023';
  END IF;

  -- 3. CANONICAL LOCK ORDER:
  -- (1) bookings
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- (2) partner_payouts
  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  -- (3) guest_assurance_reserves
  SELECT * INTO v_reserve
  FROM public.guest_assurance_reserves
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  -- (4) damage_deposits (if applicable)
  IF p_deposit_id IS NOT NULL THEN
    SELECT * INTO v_deposit
    FROM public.damage_deposits
    WHERE id = p_deposit_id AND booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Damage deposit % not found for booking %.', p_deposit_id, p_booking_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- (5) booking_issues (if applicable)
  IF p_issue_id IS NOT NULL THEN
    SELECT * INTO v_issue
    FROM public.booking_issues
    WHERE id = p_issue_id AND booking_id = p_booking_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking issue % not found for booking %.', p_issue_id, p_booking_id
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 4. Locate authoritative successful payment for transaction reference
  SELECT * INTO v_payment
  FROM public.payments
  WHERE booking_id = p_booking_id AND status IN ('paid', 'successful')
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cannot initialize refund: No successful payment found for booking %.', p_booking_id
      USING ERRCODE = '22023';
  END IF;

  IF v_payment.transaction_reference IS NULL OR TRIM(v_payment.transaction_reference) = '' THEN
    RAISE EXCEPTION 'Cannot initialize refund: Payment % missing transaction reference.', v_payment.id
      USING ERRCODE = '22023';
  END IF;

  -- 5. Category-Specific Validation & Trusted Amount Derivation
  IF p_refund_category = 'damage_deposit' THEN
    IF p_deposit_id IS NULL THEN
      RAISE EXCEPTION 'deposit_id is required for damage_deposit refund category.' USING ERRCODE = '22023';
    END IF;

    -- Check status: Must be eligible_for_refund OR partially_retained
    IF v_deposit.status NOT IN ('eligible_for_refund', 'partially_retained', 'clean_refund') THEN
      RAISE EXCEPTION 'Damage deposit % in status "%" is not eligible for refund execution.',
        p_deposit_id, v_deposit.status USING ERRCODE = '22023';
    END IF;

    -- Derive authoritative amount from database record (NEVER client-supplied!)
    v_authorized_amount := COALESCE(v_deposit.refunded_amount_ngn, 0);

    -- Fallback for eligible_for_refund where clean inspection occurred
    IF v_authorized_amount <= 0 AND v_deposit.status IN ('eligible_for_refund', 'clean_refund') THEN
      v_authorized_amount := v_deposit.deposit_amount_ngn - COALESCE(v_deposit.retained_amount_ngn, 0);
    END IF;

    IF v_authorized_amount <= 0 THEN
      RAISE EXCEPTION 'Authoritative refund amount for damage deposit % is ₦0; refund execution cannot proceed.',
        p_deposit_id USING ERRCODE = '22023';
    END IF;

    -- Invariant check
    IF v_authorized_amount + COALESCE(v_deposit.retained_amount_ngn, 0) > v_deposit.deposit_amount_ngn THEN
      RAISE EXCEPTION 'Balance invariant violation: Refund (₦%) + Retained (₦%) exceeds Deposit (₦%).',
        v_authorized_amount, v_deposit.retained_amount_ngn, v_deposit.deposit_amount_ngn USING ERRCODE = '22023';
    END IF;

    -- Check for duplicate active/completed refund on this deposit
    SELECT * INTO v_existing_op
    FROM public.refund_operations
    WHERE deposit_id = p_deposit_id AND status NOT IN ('failed')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_exists', true,
        'refund_operation_id', v_existing_op.id,
        'status', v_existing_op.status,
        'paystack_reference', v_existing_op.paystack_reference,
        'amount_ngn', v_existing_op.amount_ngn,
        'message', format('Active or completed refund operation already exists for damage deposit %s (status: %s)', p_deposit_id, v_existing_op.status)
      );
    END IF;

  ELSIF p_refund_category = 'guest_assurance_issue' THEN
    IF p_issue_id IS NULL THEN
      RAISE EXCEPTION 'issue_id is required for guest_assurance_issue refund category.' USING ERRCODE = '22023';
    END IF;

    -- Strict Tier 1 guard: Tier 1 issues strictly have zero financial refund
    IF v_issue.issue_tier = 'tier_1' THEN
      RAISE EXCEPTION 'Tier 1 issues do not authorize financial compensation or refunds.' USING ERRCODE = '22023';
    END IF;

    -- Strict Tier 2 / 3 guard: Must have explicit authorized compensation
    v_authorized_amount := COALESCE(v_issue.refund_awarded_ngn, 0);
    IF v_authorized_amount <= 0 THEN
      RAISE EXCEPTION 'Issue % has no authorized refund amount (refund_awarded_ngn is ₦0). Cannot execute refund.',
        p_issue_id USING ERRCODE = '22023';
    END IF;

    -- Check for duplicate active/completed refund on this issue
    SELECT * INTO v_existing_op
    FROM public.refund_operations
    WHERE issue_id = p_issue_id AND status NOT IN ('failed')
    LIMIT 1;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_exists', true,
        'refund_operation_id', v_existing_op.id,
        'status', v_existing_op.status,
        'paystack_reference', v_existing_op.paystack_reference,
        'amount_ngn', v_existing_op.amount_ngn,
        'message', format('Active or completed refund operation already exists for issue %s (status: %s)', p_issue_id, v_existing_op.status)
      );
    END IF;

  ELSIF p_refund_category = 'booking_cancellation' THEN
    -- Cancelled booking refund: derives amount from payment minus non-refundable items
    IF v_booking.booking_status != 'cancelled' THEN
      RAISE EXCEPTION 'Booking % is not cancelled (current status: %). Cannot initialize cancellation refund.',
        p_booking_id, v_booking.booking_status USING ERRCODE = '22023';
    END IF;
    v_authorized_amount := COALESCE(v_payment.amount, 0);
    IF v_authorized_amount <= 0 THEN
      RAISE EXCEPTION 'Booking % has zero payment amount to refund.', p_booking_id USING ERRCODE = '22023';
    END IF;

  ELSE -- administrative
    v_authorized_amount := COALESCE((p_metadata->>'amount_ngn')::NUMERIC, 0);
    IF v_authorized_amount <= 0 THEN
      RAISE EXCEPTION 'Administrative refund requires a positive amount_ngn in metadata.' USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 6. Construct permanent refund reference: ARK-RFD-{refund_id}
  v_refund_ref := 'ARK-RFD-' || v_refund_id::TEXT;

  -- 7. Persist refund operation in 'authorized' status
  INSERT INTO public.refund_operations (
    id,
    booking_id,
    payment_id,
    issue_id,
    deposit_id,
    refund_category,
    refund_reason,
    amount_ngn,
    currency,
    paystack_reference,
    status,
    requested_by,
    created_at,
    metadata
  ) VALUES (
    v_refund_id,
    p_booking_id,
    v_payment.id,
    p_issue_id,
    p_deposit_id,
    p_refund_category,
    COALESCE(p_reason, 'Authoritative financial refund execution'),
    v_authorized_amount,
    'NGN',
    v_refund_ref,
    'authorized',
    v_caller_id,
    v_now,
    p_metadata
  );

  -- 8. Write immutable audit log
  INSERT INTO public.financial_audit_logs (
    actor_id,
    actor_role,
    operation_type,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    amount_ngn,
    booking_id,
    payment_id,
    reference,
    reason,
    metadata,
    created_at
  ) VALUES (
    v_caller_id,
    CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END,
    'REFUND_INITIALIZATION',
    'refund_operations',
    v_refund_id,
    NULL,
    'authorized',
    v_authorized_amount,
    p_booking_id,
    v_payment.id,
    v_refund_ref,
    p_reason,
    jsonb_build_object(
      'category', p_refund_category,
      'deposit_id', p_deposit_id,
      'issue_id', p_issue_id
    ),
    v_now
  );

  -- Return payload for service layer
  RETURN jsonb_build_object(
    'success', true,
    'refund_operation_id', v_refund_id,
    'booking_id', p_booking_id,
    'payment_id', v_payment.id,
    'transaction_reference', v_payment.transaction_reference,
    'paystack_reference', v_refund_ref,
    'amount_ngn', v_authorized_amount,
    'currency', 'NGN',
    'status', 'authorized',
    'created_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. RPC: public.mark_refund_processing
-- Transitions refund operation to 'processing' before external Paystack API call
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.mark_refund_processing(
  p_refund_id UUID
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
  v_now TIMESTAMPTZ := now();
  v_refund RECORD;
BEGIN
  -- Security check
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
    RAISE EXCEPTION 'Unauthorized: mark_refund_processing is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_refund
  FROM public.refund_operations
  WHERE id = p_refund_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund operation % not found.', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot mark completed refund % as processing: Completed refunds are terminal.', p_refund_id
      USING ERRCODE = '22023';
  END IF;

  IF v_refund.status NOT IN ('authorized', 'reconciliation_required', 'requested') THEN
    RAISE EXCEPTION 'Cannot transition refund % from "%" to "processing".', p_refund_id, v_refund.status
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.refund_operations
  SET
    status = 'processing',
    processing_started_at = v_now,
    updated_at = v_now
  WHERE id = p_refund_id;

  -- Audit log
  INSERT INTO public.financial_audit_logs (
    actor_id,
    actor_role,
    operation_type,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    amount_ngn,
    booking_id,
    payment_id,
    reference,
    created_at
  ) VALUES (
    v_caller_id,
    CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END,
    'REFUND_MARK_PROCESSING',
    'refund_operations',
    p_refund_id,
    v_refund.status,
    'processing',
    v_refund.amount_ngn,
    v_refund.booking_id,
    v_refund.payment_id,
    v_refund.paystack_reference,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'refund_operation_id', p_refund_id,
    'status', 'processing',
    'processing_started_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC: public.settle_refund_success
-- Transitions refund operation to 'completed' and posts balanced ledger entries
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.settle_refund_success(
  p_refund_id UUID,
  p_paystack_refund_id TEXT DEFAULT NULL,
  p_gateway_response JSONB DEFAULT '{}'::jsonb
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
  v_now TIMESTAMPTZ := now();
  v_refund RECORD;
  v_ledger_result JSONB;
  v_debit_account TEXT;
  v_credit_account TEXT := '1010'; -- Gateway Clearing (Paystack Asset account reduced)
BEGIN
  -- Security check
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
    RAISE EXCEPTION 'Unauthorized: settle_refund_success is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_refund
  FROM public.refund_operations
  WHERE id = p_refund_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund operation % not found.', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  -- Idempotency Check
  IF v_refund.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'refund_operation_id', p_refund_id,
      'status', 'completed',
      'completed_at', v_refund.completed_at,
      'message', 'Refund operation is already completed.'
    );
  END IF;

  IF v_refund.status NOT IN ('processing', 'reconciliation_required', 'authorized') THEN
    RAISE EXCEPTION 'Cannot settle refund % in status "%" to completed.', p_refund_id, v_refund.status
      USING ERRCODE = '22023';
  END IF;

  -- Select double-entry debit account based on refund category:
  -- Damage deposit: Debit 2300 (Damage Deposit Liability)
  -- Issue compensation: Debit 2010 (Guest Unearned Revenue / Refund Clearing)
  -- Booking cancellation: Debit 2010 (Guest Unearned Revenue)
  -- Administrative: Debit 2010
  IF v_refund.refund_category = 'damage_deposit' THEN
    v_debit_account := '2300';
  ELSE
    v_debit_account := '2010';
  END IF;

  -- Post balanced double-entry ledger mutation:
  -- Debit liability (2300 or 2010)
  -- Credit asset 1010 (Gateway Clearing)
  v_ledger_result := public.record_balanced_ledger_transaction(
    gen_random_uuid(),
    v_refund.booking_id,
    'GUEST_REFUND_DISBURSEMENT',
    'REFUND-DISBURSE-' || p_refund_id::TEXT,
    format('Guest refund disbursement of ₦%s via Paystack ref %s', v_refund.amount_ngn, v_refund.paystack_reference),
    v_debit_account,
    v_credit_account,
    v_refund.amount_ngn
  );

  -- Update refund operation record
  UPDATE public.refund_operations
  SET
    status = 'completed',
    completed_at = v_now,
    paystack_refund_id = COALESCE(p_paystack_refund_id, paystack_refund_id),
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('gateway_settlement', p_gateway_response),
    updated_at = v_now
  WHERE id = p_refund_id;

  -- Update deposit status if applicable
  IF v_refund.deposit_id IS NOT NULL THEN
    UPDATE public.damage_deposits
    SET
      status = CASE
        WHEN retained_amount_ngn > 0 THEN 'partially_retained'
        ELSE 'refunded_to_guest'
      END,
      updated_at = v_now
    WHERE id = v_refund.deposit_id;
  END IF;

  -- Update issue status if applicable
  IF v_refund.issue_id IS NOT NULL THEN
    UPDATE public.booking_issues
    SET
      status = 'resolved_compensated',
      updated_at = v_now
    WHERE id = v_refund.issue_id;
  END IF;

  -- Audit log
  INSERT INTO public.financial_audit_logs (
    actor_id,
    actor_role,
    operation_type,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    amount_ngn,
    booking_id,
    payment_id,
    reference,
    metadata,
    created_at
  ) VALUES (
    v_caller_id,
    CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END,
    'REFUND_SETTLE_SUCCESS',
    'refund_operations',
    p_refund_id,
    v_refund.status,
    'completed',
    v_refund.amount_ngn,
    v_refund.booking_id,
    v_refund.payment_id,
    v_refund.paystack_reference,
    jsonb_build_object('paystack_refund_id', p_paystack_refund_id, 'ledger_result', v_ledger_result),
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'refund_operation_id', p_refund_id,
    'status', 'completed',
    'completed_at', v_now,
    'amount_ngn', v_refund.amount_ngn,
    'ledger_posted', true
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. RPC: public.record_refund_failure
-- Records definitive failure (e.g. 4xx from Paystack)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.record_refund_failure(
  p_refund_id UUID,
  p_failure_code TEXT DEFAULT NULL,
  p_failure_message TEXT DEFAULT NULL,
  p_gateway_response JSONB DEFAULT '{}'::jsonb
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
  v_now TIMESTAMPTZ := now();
  v_refund RECORD;
BEGIN
  -- Security check
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
    RAISE EXCEPTION 'Unauthorized: record_refund_failure is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_refund
  FROM public.refund_operations
  WHERE id = p_refund_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund operation % not found.', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status = 'completed' THEN
    RAISE EXCEPTION 'Cannot mark completed refund % as failed: Completed refunds are permanent and terminal.', p_refund_id
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.refund_operations
  SET
    status = 'failed',
    failed_at = v_now,
    failure_code = p_failure_code,
    failure_message = p_failure_message,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('failure_response', p_gateway_response),
    updated_at = v_now
  WHERE id = p_refund_id;

  -- Audit log
  INSERT INTO public.financial_audit_logs (
    actor_id,
    actor_role,
    operation_type,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    amount_ngn,
    booking_id,
    payment_id,
    reference,
    reason,
    created_at
  ) VALUES (
    v_caller_id,
    CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END,
    'REFUND_RECORD_FAILURE',
    'refund_operations',
    p_refund_id,
    v_refund.status,
    'failed',
    v_refund.amount_ngn,
    v_refund.booking_id,
    v_refund.payment_id,
    v_refund.paystack_reference,
    p_failure_message,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'refund_operation_id', p_refund_id,
    'status', 'failed',
    'failed_at', v_now,
    'failure_code', p_failure_code,
    'failure_message', p_failure_message
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPC: public.flag_refund_reconciliation
-- Transitions refund operation to 'reconciliation_required' on uncertain outcomes (timeout, 5xx)
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.flag_refund_reconciliation(
  p_refund_id UUID,
  p_reason TEXT DEFAULT NULL,
  p_gateway_response JSONB DEFAULT '{}'::jsonb
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
  v_now TIMESTAMPTZ := now();
  v_refund RECORD;
BEGIN
  -- Security check
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
    RAISE EXCEPTION 'Unauthorized: flag_refund_reconciliation is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_refund
  FROM public.refund_operations
  WHERE id = p_refund_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund operation % not found.', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'refund_operation_id', p_refund_id,
      'status', 'completed',
      'message', 'Refund is already in terminal completed state; cannot flag for reconciliation.'
    );
  END IF;

  UPDATE public.refund_operations
  SET
    status = 'reconciliation_required',
    reconciliation_required_at = v_now,
    reconciliation_attempts = reconciliation_attempts + 1,
    failure_message = p_reason,
    metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('uncertain_response', p_gateway_response),
    updated_at = v_now
  WHERE id = p_refund_id;

  -- Audit log
  INSERT INTO public.financial_audit_logs (
    actor_id,
    actor_role,
    operation_type,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    amount_ngn,
    booking_id,
    payment_id,
    reference,
    reason,
    created_at
  ) VALUES (
    v_caller_id,
    CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END,
    'REFUND_FLAG_RECONCILIATION',
    'refund_operations',
    p_refund_id,
    v_refund.status,
    'reconciliation_required',
    v_refund.amount_ngn,
    v_refund.booking_id,
    v_refund.payment_id,
    v_refund.paystack_reference,
    p_reason,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'refund_operation_id', p_refund_id,
    'status', 'reconciliation_required',
    'reconciliation_required_at', v_now,
    'reconciliation_attempts', v_refund.reconciliation_attempts + 1,
    'reason', p_reason
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. RPC: public.admin_reconcile_refund
-- Prepares an uncertain refund for authoritative reconciliation query
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_reconcile_refund(
  p_refund_id UUID,
  p_reason TEXT
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
  v_now TIMESTAMPTZ := now();
  v_refund RECORD;
BEGIN
  -- Security check
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
    RAISE EXCEPTION 'Unauthorized: admin_reconcile_refund is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'A non-empty reason is mandatory for administrative refund reconciliation.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_refund
  FROM public.refund_operations
  WHERE id = p_refund_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Refund operation % not found.', p_refund_id USING ERRCODE = 'P0002';
  END IF;

  IF v_refund.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'refund_operation_id', p_refund_id,
      'status', 'completed',
      'paystack_reference', v_refund.paystack_reference,
      'message', 'Refund operation is already completed.'
    );
  END IF;

  -- Audit log
  INSERT INTO public.financial_audit_logs (
    actor_id,
    actor_role,
    operation_type,
    entity_type,
    entity_id,
    previous_state,
    new_state,
    amount_ngn,
    booking_id,
    payment_id,
    reference,
    reason,
    created_at
  ) VALUES (
    v_caller_id,
    CASE WHEN v_is_service THEN 'service_role' ELSE 'admin' END,
    'ADMIN_RECONCILE_REFUND',
    'refund_operations',
    p_refund_id,
    v_refund.status,
    v_refund.status,
    v_refund.amount_ngn,
    v_refund.booking_id,
    v_refund.payment_id,
    v_refund.paystack_reference,
    p_reason,
    v_now
  );

  RETURN jsonb_build_object(
    'success', true,
    'refund_operation_id', p_refund_id,
    'status', v_refund.status,
    'paystack_reference', v_refund.paystack_reference,
    'amount_ngn', v_refund.amount_ngn,
    'reconciliation_attempts', v_refund.reconciliation_attempts,
    'can_reconcile', true
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 10. RPC Security Privileges: Revoke from PUBLIC, anon, authenticated
-- ------------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.initialize_refund_operation(UUID, TEXT, UUID, UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.mark_refund_processing(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.settle_refund_success(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.record_refund_failure(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.flag_refund_reconciliation(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_reconcile_refund(UUID, TEXT) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.initialize_refund_operation(UUID, TEXT, UUID, UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.mark_refund_processing(UUID) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_refund_success(UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_refund_failure(UUID, TEXT, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.flag_refund_reconciliation(UUID, TEXT, JSONB) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_reconcile_refund(UUID, TEXT) TO authenticated, service_role;
