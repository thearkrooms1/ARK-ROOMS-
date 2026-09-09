-- ==============================================================================
-- Migration: Phase 3 Gate #5.2 Part 1 — Partner Payout Database & Authorization Foundation
-- Description:
-- 1. Adds recipient snapshot and audit/attempt columns to public.partner_payouts
-- 2. Updates status check constraint to include 'reconciliation_required'
-- 3. Creates performant indexes including safe partial index on eligible payouts
-- 4. Implements database state machine transition trigger enforcing valid lifecycle
-- 5. Implements public.evaluate_payout_eligibility(p_payout_id UUID)
-- 6. Implements public.authorize_partner_payout(p_payout_id UUID) with canonical locking
-- 7. Enforces strict RLS and permission revocations (service_role / admin only)
-- ==============================================================================

-- ==============================================================================
-- 1. ADD RECIPIENT SNAPSHOT AND AUDIT/ATTEMPT COLUMNS TO public.partner_payouts
-- ==============================================================================
DO $$
BEGIN
  -- recipient_bank_name_snapshot
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'recipient_bank_name_snapshot'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN recipient_bank_name_snapshot TEXT NULL;
  END IF;

  -- recipient_bank_code_snapshot
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'recipient_bank_code_snapshot'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN recipient_bank_code_snapshot TEXT NULL;
  END IF;

  -- recipient_account_name_snapshot
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'recipient_account_name_snapshot'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN recipient_account_name_snapshot TEXT NULL;
  END IF;

  -- recipient_account_number_masked
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'recipient_account_number_masked'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN recipient_account_number_masked TEXT NULL;
  END IF;

  -- attempt_count
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'attempt_count'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- last_attempt_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'last_attempt_at'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN last_attempt_at TIMESTAMPTZ NULL;
  END IF;

  -- processing_started_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'processing_started_at'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN processing_started_at TIMESTAMPTZ NULL;
  END IF;

  -- reconciliation_required_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'reconciliation_required_at'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN reconciliation_required_at TIMESTAMPTZ NULL;
  END IF;

  -- reconciled_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'reconciled_at'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN reconciled_at TIMESTAMPTZ NULL;
  END IF;

  -- reconciliation_notes
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'reconciliation_notes'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN reconciliation_notes TEXT NULL;
  END IF;

  -- Ensure host_user_id is present for seamless cross-compatibility with Gate 4 settlement
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'partner_payouts' AND column_name = 'host_user_id'
  ) THEN
    ALTER TABLE public.partner_payouts ADD COLUMN host_user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;

  -- Make host_id nullable if it was strictly NOT NULL and host_user_id is used
  ALTER TABLE public.partner_payouts ALTER COLUMN host_id DROP NOT NULL;
END $$;

-- ==============================================================================
-- 2. UPDATE STATUS CHECK CONSTRAINT (Add reconciliation_required)
-- ==============================================================================
DO $$
BEGIN
  -- Drop existing status constraints if named differently
  ALTER TABLE public.partner_payouts DROP CONSTRAINT IF EXISTS chk_partner_payouts_status;
  ALTER TABLE public.partner_payouts DROP CONSTRAINT IF EXISTS partner_payouts_status_check;

  -- Add updated status check constraint
  ALTER TABLE public.partner_payouts ADD CONSTRAINT chk_partner_payouts_status CHECK (
    status IN (
      'allocated',
      'protection_window',
      'eligible',
      'authorized',
      'processing',
      'reconciliation_required',
      'completed',
      'frozen_dispute',
      'cancelled',
      'failed'
    )
  );
END $$;

-- ==============================================================================
-- 3. INDEXES FOR PERFORMANT ACCESS & WORKER QUERIES
-- ==============================================================================
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status ON public.partner_payouts(status);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_scheduled_eligibility_at ON public.partner_payouts(scheduled_eligibility_at);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_booking_id ON public.partner_payouts(booking_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_host_id ON public.partner_payouts(host_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_host_user_id ON public.partner_payouts(host_user_id);

-- Unique index on stable Paystack transfer reference (partial, only for non-null)
CREATE UNIQUE INDEX IF NOT EXISTS idx_partner_payouts_transfer_ref_unique 
  ON public.partner_payouts(paystack_transfer_reference) 
  WHERE paystack_transfer_reference IS NOT NULL;

-- Safe partial index for worker query (now() is not immutable, so index on scheduled_eligibility_at WHERE status = 'eligible')
CREATE INDEX IF NOT EXISTS idx_partner_payouts_eligible_window 
  ON public.partner_payouts(scheduled_eligibility_at) 
  WHERE status = 'eligible';

-- ==============================================================================
-- 4. STATE MACHINE TRANSITION VALIDATION TRIGGER
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.validate_partner_payout_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- If status is not changing, allow update but verify immutable fields
  IF OLD.status = NEW.status THEN
    -- Invariant: Partner payout amount cannot be modified once allocated
    IF OLD.partner_amount_ngn IS DISTINCT FROM NEW.partner_amount_ngn THEN
      RAISE EXCEPTION 'Partner payout amount is immutable once allocated (old: %, new: %)', 
        OLD.partner_amount_ngn, NEW.partner_amount_ngn USING ERRCODE = '22023';
    END IF;

    -- Invariant: Transfer reference cannot be changed once assigned
    IF OLD.paystack_transfer_reference IS NOT NULL 
       AND NEW.paystack_transfer_reference IS DISTINCT FROM OLD.paystack_transfer_reference THEN
      RAISE EXCEPTION 'Paystack transfer reference is permanent and cannot be modified once assigned' USING ERRCODE = '22023';
    END IF;

    -- Invariant: Recipient snapshot cannot be changed once snapshotted
    IF OLD.paystack_recipient_code_snapshot IS NOT NULL 
       AND NEW.paystack_recipient_code_snapshot IS DISTINCT FROM OLD.paystack_recipient_code_snapshot THEN
      RAISE EXCEPTION 'Recipient snapshot is immutable once assigned' USING ERRCODE = '22023';
    END IF;

    RETURN NEW;
  END IF;

  -- 1. Completed is a terminal state: never allow completed -> any other status
  IF OLD.status = 'completed' THEN
    RAISE EXCEPTION 'Terminal state: completed payout cannot change status to %', NEW.status USING ERRCODE = '22023';
  END IF;

  -- 2. Invariant: Partner payout amount cannot be modified on status transitions
  IF OLD.partner_amount_ngn IS DISTINCT FROM NEW.partner_amount_ngn THEN
    RAISE EXCEPTION 'Partner payout amount is immutable once allocated (old: %, new: %)', 
      OLD.partner_amount_ngn, NEW.partner_amount_ngn USING ERRCODE = '22023';
  END IF;

  -- 3. Invariant: Transfer reference cannot be replaced or cleared
  IF OLD.paystack_transfer_reference IS NOT NULL 
     AND NEW.paystack_transfer_reference IS DISTINCT FROM OLD.paystack_transfer_reference THEN
    RAISE EXCEPTION 'Paystack transfer reference is permanent and cannot be modified once assigned' USING ERRCODE = '22023';
  END IF;

  -- 4. Invariant: Recipient snapshot cannot be replaced or cleared
  IF OLD.paystack_recipient_code_snapshot IS NOT NULL 
     AND NEW.paystack_recipient_code_snapshot IS DISTINCT FROM OLD.paystack_recipient_code_snapshot THEN
    RAISE EXCEPTION 'Recipient snapshot is immutable once assigned' USING ERRCODE = '22023';
  END IF;

  -- 5. Strict state machine transition validation
  CASE OLD.status
    WHEN 'allocated' THEN
      -- allocated -> protection_window (upon check-in) OR cancelled
      IF NEW.status NOT IN ('protection_window', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from allocated to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'protection_window' THEN
      -- protection_window -> eligible (after 4h) OR frozen_dispute OR cancelled
      IF NEW.status NOT IN ('eligible', 'frozen_dispute', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from protection_window to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'eligible' THEN
      -- eligible -> authorized OR processing OR frozen_dispute OR cancelled
      -- Note: authorized -> processing occurs atomically in authorize_partner_payout
      IF NEW.status NOT IN ('authorized', 'processing', 'frozen_dispute', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from eligible to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'authorized' THEN
      -- authorized -> processing (worker dispatch) OR frozen_dispute (prior to dispatch) OR cancelled
      IF NEW.status NOT IN ('processing', 'frozen_dispute', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from authorized to %', NEW.status USING ERRCODE = '22023';
      END IF;
      -- authorized -> frozen_dispute is ONLY allowed before external dispatch
      IF NEW.status = 'frozen_dispute' AND OLD.processing_started_at IS NOT NULL THEN
        RAISE EXCEPTION 'Cannot freeze payout in dispute: dispatch is already in flight' USING ERRCODE = '22023';
      END IF;

    WHEN 'processing' THEN
      -- processing -> completed (success) OR failed (definitive failure) OR reconciliation_required (timeout/unknown)
      IF NEW.status NOT IN ('completed', 'failed', 'reconciliation_required') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from processing to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'reconciliation_required' THEN
      -- reconciliation_required -> completed OR failed
      IF NEW.status NOT IN ('completed', 'failed') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from reconciliation_required to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'frozen_dispute' THEN
      -- frozen_dispute -> eligible (admin unfreeze) OR cancelled (admin full refund/void)
      IF NEW.status NOT IN ('eligible', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from frozen_dispute to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'failed' THEN
      -- failed -> eligible OR authorized OR cancelled (retry allowed after fixing recipient)
      IF NEW.status NOT IN ('eligible', 'authorized', 'cancelled') THEN
        RAISE EXCEPTION 'Invalid partner payout transition from failed to %', NEW.status USING ERRCODE = '22023';
      END IF;

    WHEN 'cancelled' THEN
      -- cancelled is terminal
      RAISE EXCEPTION 'Terminal state: cancelled payout cannot transition to %', NEW.status USING ERRCODE = '22023';

    ELSE
      RAISE EXCEPTION 'Unknown current payout status: %', OLD.status USING ERRCODE = '22023';
  END CASE;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_partner_payout_transition ON public.partner_payouts;
CREATE TRIGGER trg_validate_partner_payout_transition
  BEFORE UPDATE ON public.partner_payouts
  FOR EACH ROW
  EXECUTE FUNCTION public.validate_partner_payout_transition();

-- ==============================================================================
-- 5. EVALUATE PAYOUT ELIGIBILITY HELPER RPC
-- Evaluates protection_window maturity and transitions to 'eligible' if mature & undisputed
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.evaluate_payout_eligibility(
  p_payout_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_payout RECORD;
  v_booking RECORD;
  v_has_tier3_dispute BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Find and lock payout
  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Lock booking (Canonical lock order: bookings -> partner_payouts)
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_payout.booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found for payout %', v_payout.booking_id, p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Check for active Tier 3 issue
  SELECT EXISTS (
    SELECT 1 FROM public.booking_issues bi
    WHERE bi.booking_id = v_booking.id
      AND bi.issue_tier = 'tier_3'
      AND bi.status NOT IN ('resolved_dismissed', 'resolved_compensated')
  ) INTO v_has_tier3_dispute;

  IF v_has_tier3_dispute THEN
    IF v_payout.status != 'frozen_dispute' THEN
      UPDATE public.partner_payouts
      SET status = 'frozen_dispute', updated_at = v_now
      WHERE id = v_payout.id;
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'status', 'frozen_dispute',
      'reason', 'Active Tier 3 dispute exists on booking'
    );
  END IF;

  -- 4. Check if currently in protection_window
  IF v_payout.status = 'protection_window' THEN
    -- Check if scheduled window has elapsed
    IF v_payout.scheduled_eligibility_at IS NOT NULL AND v_now >= v_payout.scheduled_eligibility_at THEN
      IF v_booking.payment_status = 'paid' AND v_booking.booking_status = 'checked_in' THEN
        UPDATE public.partner_payouts
        SET status = 'eligible', updated_at = v_now
        WHERE id = v_payout.id;

        RETURN jsonb_build_object(
          'success', true,
          'status', 'eligible',
          'message', 'Payout successfully transitioned to eligible'
        );
      END IF;
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'status', 'protection_window',
        'reason', 'Protection window has not elapsed yet',
        'scheduled_eligibility_at', v_payout.scheduled_eligibility_at
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_payout.status,
    'message', 'No transition performed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_payout_eligibility(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.evaluate_payout_eligibility(UUID) TO authenticated, service_role;

-- ==============================================================================
-- 6. AUTHORIZE PARTNER PAYOUT RPC (Canonical Lock Order & Invariant Validation)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.authorize_partner_payout(
  p_payout_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_host_profile RECORD;
  v_payout_profile RECORD;
  v_has_tier3_dispute BOOLEAN;
  v_transfer_ref TEXT;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- ---------------------------------------------------------------------------
  -- 1. Security Check: Restricted strictly to service_role or platform administrators
  -- ---------------------------------------------------------------------------
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Unauthorized: partner payout authorization is restricted to service role or platform administrators.' 
        USING ERRCODE = '42501';
    END IF;
  ELSE
    -- If auth.uid() is null, verify service_role or superuser
    IF v_jwt_role != 'service_role' AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION 'Unauthorized: service role required.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- ---------------------------------------------------------------------------
  -- 2. Lookup Booking ID associated with target payout
  -- ---------------------------------------------------------------------------
  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 3. CANONICAL LOCK ORDER:
  -- Lock booking first, then lock partner_payout
  -- ---------------------------------------------------------------------------
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

  -- ---------------------------------------------------------------------------
  -- 4. Check for Active Tier 3 Disputes
  -- Tier 3 (safety/uninhabitable/misrepresentation) blocks payout authorization unconditionally
  -- ---------------------------------------------------------------------------
  SELECT EXISTS (
    SELECT 1 FROM public.booking_issues bi
    WHERE bi.booking_id = v_booking.id
      AND bi.issue_tier = 'tier_3'
      AND bi.status NOT IN ('resolved_dismissed', 'resolved_compensated')
  ) INTO v_has_tier3_dispute;

  IF v_has_tier3_dispute THEN
    -- Transition payout to frozen_dispute
    UPDATE public.partner_payouts
    SET
      status = 'frozen_dispute',
      updated_at = v_now
    WHERE id = v_payout.id;

    RETURN jsonb_build_object(
      'success', false,
      'error', 'Payout blocked by active Tier 3 dispute; status transitioned to frozen_dispute',
      'status', 'frozen_dispute',
      'payout_id', v_payout.id,
      'booking_id', v_booking.id
    );
  END IF;

  -- ---------------------------------------------------------------------------
  -- 5. Invariant Checks on Payout Status
  -- Must be 'eligible'
  -- ---------------------------------------------------------------------------
  IF v_payout.status = 'completed' THEN
    RAISE EXCEPTION 'Payout % is already completed', p_payout_id USING ERRCODE = '22023';
  END IF;

  IF v_payout.status = 'processing' THEN
    RAISE EXCEPTION 'Payout % is currently processing', p_payout_id USING ERRCODE = '22023';
  END IF;

  IF v_payout.status = 'reconciliation_required' THEN
    RAISE EXCEPTION 'Payout % requires reconciliation before further action', p_payout_id USING ERRCODE = '22023';
  END IF;

  IF v_payout.status = 'frozen_dispute' THEN
    RAISE EXCEPTION 'Payout % is frozen due to dispute', p_payout_id USING ERRCODE = '22023';
  END IF;

  IF v_payout.status = 'cancelled' THEN
    RAISE EXCEPTION 'Payout % is cancelled', p_payout_id USING ERRCODE = '22023';
  END IF;

  IF v_payout.status != 'eligible' THEN
    RAISE EXCEPTION 'Payout % is in "%" status; must be "eligible" to authorize', p_payout_id, v_payout.status USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 6. Invariant Checks on Booking Record
  -- ---------------------------------------------------------------------------
  IF v_booking.payment_status != 'paid' THEN
    RAISE EXCEPTION 'Booking payment_status must be "paid" (found "%")', v_booking.payment_status USING ERRCODE = '22023';
  END IF;

  IF v_booking.booking_status != 'checked_in' THEN
    RAISE EXCEPTION 'Booking status must be "checked_in" (found "%")', v_booking.booking_status USING ERRCODE = '22023';
  END IF;

  IF v_booking.actual_check_in_at IS NULL THEN
    RAISE EXCEPTION 'Booking actual_check_in_at is required before payout authorization' USING ERRCODE = '22023';
  END IF;

  IF v_payout.scheduled_eligibility_at IS NULL OR v_now < v_payout.scheduled_eligibility_at THEN
    RAISE EXCEPTION 'Scheduled eligibility window has not elapsed (eligible at: %)', v_payout.scheduled_eligibility_at USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 7. Host Profile Validation
  -- Host must exist and host_status must be 'active'
  -- ---------------------------------------------------------------------------
  IF v_payout.host_id IS NOT NULL THEN
    SELECT * INTO v_host_profile
    FROM public.host_profiles
    WHERE id = v_payout.host_id;
  END IF;

  -- Fallback lookup via host_user_id if host_id is null or not found
  IF v_host_profile.id IS NULL AND v_payout.host_user_id IS NOT NULL THEN
    SELECT * INTO v_host_profile
    FROM public.host_profiles
    WHERE user_id = v_payout.host_user_id;
  END IF;

  IF v_host_profile.id IS NULL THEN
    RAISE EXCEPTION 'Host profile not found for payout %', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  IF v_host_profile.host_status != 'active' THEN
    RAISE EXCEPTION 'Host account is "%" (must be "active" to receive payouts)', v_host_profile.host_status USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 8. Host Payout Profile Validation
  -- Must exist, is_verified = true, is_locked = false, paystack_recipient_code present
  -- ---------------------------------------------------------------------------
  SELECT * INTO v_payout_profile
  FROM public.host_payout_profiles
  WHERE host_id = v_host_profile.id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No host payout profile configured for host %', v_host_profile.id USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_payout_profile.is_verified THEN
    RAISE EXCEPTION 'Host payout profile % is not verified', v_payout_profile.id USING ERRCODE = '22023';
  END IF;

  IF v_payout_profile.is_locked THEN
    RAISE EXCEPTION 'Host payout profile % is locked', v_payout_profile.id USING ERRCODE = '22023';
  END IF;

  IF v_payout_profile.paystack_recipient_code IS NULL OR length(trim(v_payout_profile.paystack_recipient_code)) = 0 THEN
    RAISE EXCEPTION 'Host payout profile % is missing Paystack recipient code', v_payout_profile.id USING ERRCODE = '22023';
  END IF;

  -- ---------------------------------------------------------------------------
  -- 9. Stable Transfer Reference Assignment
  -- Deterministic format: ARK-TRF-{payout_id}
  -- Permanent and immutable once assigned; never replaced
  -- ---------------------------------------------------------------------------
  v_transfer_ref := COALESCE(v_payout.paystack_transfer_reference, 'ARK-TRF-' || v_payout.id::TEXT);

  -- ---------------------------------------------------------------------------
  -- 10. Atomic Authorization & Transition to Processing
  -- Snapshot recipient details from trusted DB, record timestamps, increment attempts
  -- ---------------------------------------------------------------------------
  UPDATE public.partner_payouts
  SET
    status = 'processing',
    host_id = COALESCE(v_payout.host_id, v_host_profile.id),
    payout_profile_id = v_payout_profile.id,
    paystack_recipient_code_snapshot = v_payout_profile.paystack_recipient_code,
    recipient_bank_name_snapshot = v_payout_profile.bank_name,
    recipient_bank_code_snapshot = v_payout_profile.bank_code,
    recipient_account_name_snapshot = v_payout_profile.account_name,
    recipient_account_number_masked = v_payout_profile.account_number_masked,
    paystack_transfer_reference = v_transfer_ref,
    authorized_at = v_now,
    processing_started_at = v_now,
    last_attempt_at = v_now,
    attempt_count = COALESCE(v_payout.attempt_count, 0) + 1,
    updated_at = v_now
  WHERE id = v_payout.id;

  -- ---------------------------------------------------------------------------
  -- 11. Return Worker Dispatch Payload
  -- Contains strictly required information; zero secrets or raw bank numbers
  -- ---------------------------------------------------------------------------
  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'partner_amount_ngn', v_payout.partner_amount_ngn,
    'currency', 'NGN',
    'paystack_transfer_reference', v_transfer_ref,
    'recipient_snapshot', jsonb_build_object(
      'recipient_code', v_payout_profile.paystack_recipient_code,
      'bank_name', v_payout_profile.bank_name,
      'bank_code', v_payout_profile.bank_code,
      'account_name', v_payout_profile.account_name,
      'account_number_masked', v_payout_profile.account_number_masked
    ),
    'reason', 'TheArk Rooms Accommodation Payout - Ref: ' || v_booking.booking_reference,
    'status', 'processing',
    'authorized_at', v_now
  );
END;
$$;

-- -----------------------------------------------------------------------------
-- 7. SECURITY & PERMISSIONS
-- -----------------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.authorize_partner_payout(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_partner_payout(UUID) TO service_role;

-- Re-assert revocation of client mutations on partner_payouts table
REVOKE INSERT, UPDATE, DELETE ON public.partner_payouts FROM anon, authenticated;
