-- ==============================================================================
-- Migration: Phase 3 Gate #3 — Core Server-Authoritative Functions
-- Description:
-- 1. Creates audit table public.admin_check_in_audits
-- 2. Creates server-authoritative RPC public.confirm_booking_check_in(p_booking_id UUID)
-- 3. Creates server-authoritative RPC public.report_booking_issue(...)
-- 4. Creates server-authoritative RPC public.admin_force_check_in(...)
-- 5. Creates server-authoritative RPC public.record_balanced_ledger_transaction(...)
-- 6. Creates security helper public.can_access_issue_evidence(p_issue_id UUID)
-- 7. Establishes strict execution privileges (REVOKE anon, restrict mutations)
-- ==============================================================================

-- ==============================================================================
-- 1. AUDIT TABLE: public.admin_check_in_audits
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.admin_check_in_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  prior_guest_confirmed_at TIMESTAMPTZ NULL,
  prior_host_confirmed_at TIMESTAMPTZ NULL,
  actual_check_in_at TIMESTAMPTZ NOT NULL,
  partner_payout_eligible_at TIMESTAMPTZ NOT NULL,
  forced_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_admin_check_in_audits_booking_id ON public.admin_check_in_audits(booking_id);
CREATE INDEX IF NOT EXISTS idx_admin_check_in_audits_admin_id ON public.admin_check_in_audits(admin_id);
CREATE INDEX IF NOT EXISTS idx_admin_check_in_audits_forced_at ON public.admin_check_in_audits(forced_at);

ALTER TABLE public.admin_check_in_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view admin check in audits" ON public.admin_check_in_audits;
CREATE POLICY "Admins can view admin check in audits"
  ON public.admin_check_in_audits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.admin_check_in_audits FROM anon, authenticated;

-- ==============================================================================
-- 2. FUNCTION A: confirm_booking_check_in
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.confirm_booking_check_in(
  p_booking_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_booking RECORD;
  v_is_guest BOOLEAN := FALSE;
  v_is_host BOOLEAN := FALSE;
  v_now TIMESTAMPTZ := now();
  v_guest_confirmed_at TIMESTAMPTZ;
  v_host_confirmed_at TIMESTAMPTZ;
  v_actual_check_in_at TIMESTAMPTZ;
  v_partner_payout_eligible_at TIMESTAMPTZ;
  v_new_booking_status TEXT;
  v_payout_rec RECORD;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: You must be logged in to confirm check-in.'
      USING ERRCODE = '42501';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking ID is required.'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Lock root booking row first (Canonical Lock Order: bookings -> payouts -> reserves -> deposits -> issues)
  SELECT
    b.id,
    b.user_id,
    b.property_id,
    b.booking_status,
    b.payment_status,
    b.guest_check_in_confirmed_at,
    b.host_check_in_confirmed_at,
    b.actual_check_in_at,
    b.partner_payout_eligible_at,
    p.host_id,
    hp.user_id AS host_user_id
  INTO v_booking
  FROM public.bookings b
  JOIN public.properties p ON p.id = b.property_id
  LEFT JOIN public.host_profiles hp ON hp.id = p.host_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Authoritative role identification
  v_is_guest := (v_booking.user_id = v_caller_id);
  v_is_host := (
    (v_booking.host_user_id IS NOT NULL AND v_booking.host_user_id = v_caller_id)
    OR (v_booking.host_id IS NOT NULL AND v_booking.host_id = v_caller_id)
  );

  IF NOT v_is_guest AND NOT v_is_host THEN
    RAISE EXCEPTION 'Unauthorized: You are neither the registered guest nor the verified host for this reservation.'
      USING ERRCODE = '42501';
  END IF;

  -- 4. Check that booking is in valid paid/confirmed state
  IF v_booking.booking_status IN ('cancelled', 'rejected')
     OR v_booking.payment_status IN ('refunded', 'partially_refunded', 'failed') THEN
    RAISE EXCEPTION 'Cannot confirm check-in: Reservation has been cancelled, rejected, or refunded (status: %, payment: %).',
      v_booking.booking_status, v_booking.payment_status
      USING ERRCODE = '22023';
  END IF;

  IF v_booking.payment_status != 'paid' THEN
    RAISE EXCEPTION 'Cannot confirm check-in: Reservation payment has not been verified (payment_status: %).',
      v_booking.payment_status
      USING ERRCODE = '22023';
  END IF;

  IF v_booking.booking_status NOT IN ('confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'Cannot confirm check-in: Reservation is in "%" status; must be confirmed.',
      v_booking.booking_status
      USING ERRCODE = '22023';
  END IF;

  -- 5. Establish timestamps idempotently
  v_guest_confirmed_at := v_booking.guest_check_in_confirmed_at;
  v_host_confirmed_at := v_booking.host_check_in_confirmed_at;
  v_actual_check_in_at := v_booking.actual_check_in_at;
  v_partner_payout_eligible_at := v_booking.partner_payout_eligible_at;

  IF v_is_guest AND v_guest_confirmed_at IS NULL THEN
    v_guest_confirmed_at := v_now;
  END IF;

  IF v_is_host AND v_host_confirmed_at IS NULL THEN
    v_host_confirmed_at := v_now;
  END IF;

  -- 6. Dual-confirmation threshold evaluation
  IF v_guest_confirmed_at IS NOT NULL AND v_host_confirmed_at IS NOT NULL THEN
    IF v_actual_check_in_at IS NULL THEN
      -- Authoritative database clock assignment
      v_actual_check_in_at := v_now;
      v_partner_payout_eligible_at := v_actual_check_in_at + INTERVAL '4 hours';
    END IF;
    v_new_booking_status := 'checked_in';
  ELSE
    -- Only one party has confirmed: do NOT set actual_check_in_at or payout eligibility
    v_new_booking_status := v_booking.booking_status;
  END IF;

  -- 7. Persist authoritative updates to bookings
  UPDATE public.bookings
  SET
    guest_check_in_confirmed_at = v_guest_confirmed_at,
    host_check_in_confirmed_at = v_host_confirmed_at,
    actual_check_in_at = v_actual_check_in_at,
    partner_payout_eligible_at = v_partner_payout_eligible_at,
    booking_status = v_new_booking_status,
    updated_at = v_now
  WHERE id = v_booking.id;

  -- 8. Lock downstream financial rows according to Canonical Order (only if existing)
  IF v_actual_check_in_at IS NOT NULL THEN
    -- Lock partner_payouts row if exists
    SELECT id, status INTO v_payout_rec
    FROM public.partner_payouts
    WHERE booking_id = v_booking.id
    FOR UPDATE;

    IF FOUND AND v_payout_rec.status = 'allocated' THEN
      UPDATE public.partner_payouts
      SET
        status = 'protection_window',
        scheduled_eligibility_at = v_partner_payout_eligible_at,
        updated_at = v_now
      WHERE id = v_payout_rec.id;
    END IF;

    -- Lock guest_assurance_reserves row if exists
    PERFORM id
    FROM public.guest_assurance_reserves
    WHERE booking_id = v_booking.id
    FOR UPDATE;
  END IF;

  -- 9. Return structured outcome
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'confirmed_by', CASE WHEN v_is_guest AND v_is_host THEN 'both' WHEN v_is_guest THEN 'guest' ELSE 'host' END,
    'guest_check_in_confirmed_at', v_guest_confirmed_at,
    'host_check_in_confirmed_at', v_host_confirmed_at,
    'actual_check_in_at', v_actual_check_in_at,
    'partner_payout_eligible_at', v_partner_payout_eligible_at,
    'is_fully_confirmed', (v_actual_check_in_at IS NOT NULL),
    'booking_status', v_new_booking_status
  );
END;
$$;

-- ==============================================================================
-- 3. FUNCTION B: report_booking_issue
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.report_booking_issue(
  p_booking_id UUID,
  p_category TEXT,
  p_description TEXT,
  p_requested_resolution TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_booking RECORD;
  v_now TIMESTAMPTZ := now();
  v_checkout_time_str TEXT;
  v_checkout_time TIME;
  v_stay_start TIMESTAMPTZ;
  v_stay_end TIMESTAMPTZ;
  v_issue_tier TEXT;
  v_issue_id UUID;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: You must be logged in to report an issue.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation against database constraints
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking ID is required.' USING ERRCODE = '22023';
  END IF;

  IF p_category IS NULL OR p_category NOT IN (
    'cleanliness', 'amenities', 'access', 'safety', 'hvac_plumbing', 'host_conduct', 'other'
  ) THEN
    RAISE EXCEPTION 'Invalid issue category: %. Allowed: cleanliness, amenities, access, safety, hvac_plumbing, host_conduct, other.',
      p_category USING ERRCODE = '22023';
  END IF;

  IF p_requested_resolution IS NOT NULL AND p_requested_resolution NOT IN (
    'remediation', 'partial_refund', 'full_refund', 'emergency_relocation'
  ) THEN
    RAISE EXCEPTION 'Invalid requested resolution: %. Allowed: remediation, partial_refund, full_refund, emergency_relocation.',
      p_requested_resolution USING ERRCODE = '22023';
  END IF;

  IF p_description IS NULL OR TRIM(p_description) = '' THEN
    RAISE EXCEPTION 'Issue description cannot be empty.' USING ERRCODE = '22023';
  END IF;

  IF LENGTH(p_description) > 3000 THEN
    RAISE EXCEPTION 'Issue description exceeds maximum allowed length of 3000 characters.' USING ERRCODE = '22023';
  END IF;

  -- 3. Lock booking row (Canonical Order: bookings -> issues)
  SELECT
    b.id,
    b.user_id,
    b.property_id,
    b.check_in,
    b.check_out,
    b.actual_check_in_at,
    b.booking_status,
    b.payment_status,
    p.check_in_time,
    p.check_out_time
  INTO v_booking
  FROM public.bookings b
  JOIN public.properties p ON p.id = b.property_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. Verify caller owns the reservation
  IF v_booking.user_id != v_caller_id THEN
    RAISE EXCEPTION 'Unauthorized: You can only report an issue for your own reservation.'
      USING ERRCODE = '42501';
  END IF;

  -- 5. Verify booking state
  IF v_booking.booking_status IN ('cancelled', 'rejected')
     OR v_booking.payment_status IN ('refunded', 'partially_refunded', 'failed') THEN
    RAISE EXCEPTION 'Cannot report issue: Reservation has been cancelled, rejected, or refunded.'
      USING ERRCODE = '22023';
  END IF;

  IF v_booking.payment_status != 'paid' THEN
    RAISE EXCEPTION 'Cannot report issue: Reservation payment has not been verified.'
      USING ERRCODE = '22023';
  END IF;

  IF v_booking.booking_status NOT IN ('confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'Cannot report issue: Reservation is in "%" status, not active.', v_booking.booking_status
      USING ERRCODE = '22023';
  END IF;

  -- 6. CRITICAL BUSINESS RULE: Verify stay window (STRICT ACTUAL STAY ONLY)
  -- 1. The booking MUST have completed actual check-in (actual_check_in_at IS NOT NULL)
  -- Calendar date alone is NOT proof of stay.
  IF v_booking.actual_check_in_at IS NULL THEN
    RAISE EXCEPTION 'Cannot report issue: Check-in has not been completed for this reservation. Issues may only be reported during an active stay after confirmed check-in.'
      USING ERRCODE = '22023';
  END IF;

  -- Parse property check_out_time safely (defaults to 12:00 WAT if unspecified)
  v_checkout_time_str := COALESCE(NULLIF(TRIM(v_booking.check_out_time), ''), '12:00');
  BEGIN
    v_checkout_time := v_checkout_time_str::TIME;
  EXCEPTION WHEN OTHERS THEN
    v_checkout_time := '12:00'::TIME;
  END;

  -- Calculate authoritative checkout timestamp in Nigerian local time (Africa/Lagos)
  v_stay_end := (v_booking.check_out + v_checkout_time) AT TIME ZONE 'Africa/Lagos';

  -- 2. Current database timestamp must satisfy: NOW() >= actual_check_in_at AND NOW() < checkout timestamp
  IF v_now < v_booking.actual_check_in_at THEN
    RAISE EXCEPTION 'Cannot report issue: Current timestamp is prior to the recorded check-in time.'
      USING ERRCODE = '22023';
  END IF;

  IF v_now >= v_stay_end THEN
    RAISE EXCEPTION 'Cannot report issue: Stay has concluded. Issues must be reported during the stay prior to scheduled checkout (% %).',
      v_booking.check_out, v_checkout_time_str USING ERRCODE = '22023';
  END IF;

  -- 7. Prevent duplicate spam submissions for same booking and category within 15 minutes
  IF EXISTS (
    SELECT 1 FROM public.booking_issues
    WHERE booking_id = v_booking.id
      AND category = p_category
      AND created_at > (v_now - INTERVAL '15 minutes')
  ) THEN
    RAISE EXCEPTION 'A similar issue for category "%" has already been submitted recently. Please wait before submitting another report.',
      p_category USING ERRCODE = '23505';
  END IF;

  -- 8. Neutral/Least-Privileged Initial Classification (Awaiting Platform Review)
  -- The initial guest report is NEVER treated as the platform's final adjudication.
  -- The existing schema requires issue_tier NOT NULL (tier_1, tier_2, tier_3).
  -- We assign 'tier_1' as the least-privileged baseline holding classification.
  -- This represents an unadjudicated submission awaiting administrative triage/review.
  -- The guest cannot choose a tier, determine final severity, or specify resolutions.
  v_issue_tier := 'tier_1';

  -- 9. Insert issue record strictly without moving money or altering payout amounts
  INSERT INTO public.booking_issues (
    booking_id,
    guest_id,
    property_id,
    issue_tier,
    category,
    title,
    description,
    status,
    requested_resolution,
    refund_awarded_ngn,
    reserve_draw_ngn,
    contingency_draw_ngn,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_caller_id,
    v_booking.property_id,
    v_issue_tier,
    p_category,
    INITCAP(REPLACE(p_category, '_', ' ')) || ' Issue',
    TRIM(p_description),
    'submitted',
    p_requested_resolution,
    0,
    0,
    0,
    v_now,
    v_now
  )
  RETURNING id INTO v_issue_id;

  -- 10. Return authoritative issue creation confirmation
  RETURN jsonb_build_object(
    'success', true,
    'issue_id', v_issue_id,
    'booking_id', v_booking.id,
    'status', 'submitted',
    'issue_tier', v_issue_tier,
    'category', p_category,
    'requested_resolution', p_requested_resolution,
    'created_at', v_now
  );
END;
$$;

-- ==============================================================================
-- 4. FUNCTION C: admin_force_check_in
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.admin_force_check_in(
  p_booking_id UUID,
  p_reason TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_booking RECORD;
  v_now TIMESTAMPTZ := now();
  v_actual_check_in_at TIMESTAMPTZ;
  v_partner_payout_eligible_at TIMESTAMPTZ;
  v_audit_id UUID;
  v_payout_rec RECORD;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- 2. Check administrator authorization
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = v_caller_id AND profiles.role = 'admin'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Administrator privileges required.' USING ERRCODE = '42501';
  END IF;

  -- 3. Require non-empty operational reason
  IF p_reason IS NULL OR TRIM(p_reason) = '' THEN
    RAISE EXCEPTION 'Admin force check-in requires a valid operational reason.' USING ERRCODE = '22023';
  END IF;

  IF LENGTH(p_reason) > 1000 THEN
    RAISE EXCEPTION 'Reason exceeds maximum length of 1000 characters.' USING ERRCODE = '22023';
  END IF;

  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking ID is required.' USING ERRCODE = '22023';
  END IF;

  -- 4. Lock booking row first (Canonical Lock Order)
  SELECT
    b.id,
    b.user_id,
    b.property_id,
    b.booking_status,
    b.payment_status,
    b.guest_check_in_confirmed_at,
    b.host_check_in_confirmed_at,
    b.actual_check_in_at,
    b.partner_payout_eligible_at
  INTO v_booking
  FROM public.bookings b
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- 5. Validate booking eligibility
  IF v_booking.booking_status IN ('cancelled', 'rejected')
     OR v_booking.payment_status IN ('refunded', 'partially_refunded', 'failed') THEN
    RAISE EXCEPTION 'Cannot force check-in: Booking is cancelled, rejected, or refunded.' USING ERRCODE = '22023';
  END IF;

  IF v_booking.payment_status != 'paid' THEN
    RAISE EXCEPTION 'Cannot force check-in: Booking payment has not been verified.' USING ERRCODE = '22023';
  END IF;

  IF v_booking.booking_status NOT IN ('confirmed', 'checked_in') THEN
    RAISE EXCEPTION 'Cannot force check-in: Booking status is "%", must be confirmed.', v_booking.booking_status
      USING ERRCODE = '22023';
  END IF;

  -- 6. Authoritative timestamp establishment
  -- Preserve existing actual_check_in_at if already set; otherwise set to current database clock
  v_actual_check_in_at := COALESCE(v_booking.actual_check_in_at, v_now);
  -- Preserve existing partner_payout_eligible_at if already set; otherwise set to actual_check_in_at + 4 hours
  v_partner_payout_eligible_at := COALESCE(v_booking.partner_payout_eligible_at, v_actual_check_in_at + INTERVAL '4 hours');

  -- 7. Persist booking updates without overwriting/impersonating individual guest or host confirmations
  UPDATE public.bookings
  SET
    actual_check_in_at = v_actual_check_in_at,
    partner_payout_eligible_at = v_partner_payout_eligible_at,
    booking_status = 'checked_in',
    updated_at = v_now
  WHERE id = v_booking.id;

  -- 8. Immutable audit trail entry
  INSERT INTO public.admin_check_in_audits (
    booking_id,
    admin_id,
    reason,
    prior_guest_confirmed_at,
    prior_host_confirmed_at,
    actual_check_in_at,
    partner_payout_eligible_at,
    forced_at
  ) VALUES (
    v_booking.id,
    v_caller_id,
    TRIM(p_reason),
    v_booking.guest_check_in_confirmed_at,
    v_booking.host_check_in_confirmed_at,
    v_actual_check_in_at,
    v_partner_payout_eligible_at,
    v_now
  )
  RETURNING id INTO v_audit_id;

  -- 9. Lock and update downstream partner_payouts row if exists (Canonical Lock Order)
  SELECT id, status INTO v_payout_rec
  FROM public.partner_payouts
  WHERE booking_id = v_booking.id
  FOR UPDATE;

  IF FOUND AND v_payout_rec.status = 'allocated' THEN
    UPDATE public.partner_payouts
    SET
      status = 'protection_window',
      scheduled_eligibility_at = v_partner_payout_eligible_at,
      updated_at = v_now
    WHERE id = v_payout_rec.id;
  END IF;

  -- 10. Return authoritative execution result
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'admin_id', v_caller_id,
    'audit_id', v_audit_id,
    'reason', TRIM(p_reason),
    'prior_guest_confirmed_at', v_booking.guest_check_in_confirmed_at,
    'prior_host_confirmed_at', v_booking.host_check_in_confirmed_at,
    'actual_check_in_at', v_actual_check_in_at,
    'partner_payout_eligible_at', v_partner_payout_eligible_at,
    'booking_status', 'checked_in',
    'forced_at', v_now
  );
END;
$$;

-- ==============================================================================
-- 5. FUNCTION D: record_balanced_ledger_transaction
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.record_balanced_ledger_transaction(
  p_transaction_group_id UUID,
  p_booking_id UUID,
  p_transaction_type TEXT,
  p_reference TEXT,
  p_description TEXT,
  p_debit_account TEXT,
  p_credit_account TEXT,
  p_amount_ngn NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_jwt_role TEXT;
  v_is_service BOOLEAN;
  v_is_admin BOOLEAN;
  v_group_id UUID;
  v_rounded_amount NUMERIC(14,2);
  v_now TIMESTAMPTZ := now();
  v_debit_id UUID;
  v_credit_id UUID;
  v_total_debits NUMERIC(14,2);
  v_total_credits NUMERIC(14,2);
BEGIN
  -- 1. Authentication and authorization check
  v_caller_id := auth.uid();
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service := (
    v_jwt_role = 'service_role'
    OR current_user = 'service_role'
    OR current_user = 'postgres'
    OR session_user = 'postgres'
  );
  v_is_admin := (
    v_caller_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = v_caller_id AND profiles.role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Financial ledger mutations are strictly restricted to service role or administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF p_amount_ngn IS NULL OR p_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'Ledger transaction amount must be strictly greater than zero (received %).', p_amount_ngn
      USING ERRCODE = '22023';
  END IF;

  v_rounded_amount := ROUND(p_amount_ngn, 2);

  IF p_debit_account IS NULL OR TRIM(p_debit_account) = ''
     OR p_credit_account IS NULL OR TRIM(p_credit_account) = '' THEN
    RAISE EXCEPTION 'Both debit and credit accounts are required.' USING ERRCODE = '22023';
  END IF;

  IF TRIM(p_debit_account) = TRIM(p_credit_account) THEN
    RAISE EXCEPTION 'Debit and credit accounts must be different (% = %).', p_debit_account, p_credit_account
      USING ERRCODE = '22023';
  END IF;

  IF p_reference IS NULL OR TRIM(p_reference) = '' THEN
    RAISE EXCEPTION 'Transaction reference is required.' USING ERRCODE = '22023';
  END IF;

  IF p_transaction_type IS NULL OR TRIM(p_transaction_type) = '' THEN
    RAISE EXCEPTION 'Transaction type is required.' USING ERRCODE = '22023';
  END IF;

  v_group_id := COALESCE(p_transaction_group_id, gen_random_uuid());

  -- 3. Idempotency mechanism based on transaction group and reference
  IF EXISTS (
    SELECT 1 FROM public.financial_ledger
    WHERE transaction_group_id = v_group_id
  ) THEN
    RAISE EXCEPTION 'Duplicate transaction group: % has already been recorded.', v_group_id
      USING ERRCODE = '23505';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.financial_ledger
    WHERE reference = TRIM(p_reference) AND transaction_type = TRIM(p_transaction_type)
  ) THEN
    RAISE EXCEPTION 'Duplicate financial transaction: Reference "%" for type "%" has already been recorded.',
      p_reference, p_transaction_type USING ERRCODE = '23505';
  END IF;

  -- 4. Verify booking reference if provided
  IF p_booking_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.bookings WHERE id = p_booking_id
  ) THEN
    RAISE EXCEPTION 'Referenced booking % does not exist.', p_booking_id USING ERRCODE = '22023';
  END IF;

  -- 5. Insert balanced double-entry rows (DEBIT)
  INSERT INTO public.financial_ledger (
    transaction_group_id,
    booking_id,
    transaction_type,
    account_code,
    account_name,
    entry_type,
    amount_ngn,
    description,
    reference,
    created_at
  ) VALUES (
    v_group_id,
    p_booking_id,
    TRIM(p_transaction_type),
    TRIM(p_debit_account),
    TRIM(p_debit_account),
    'debit',
    v_rounded_amount,
    COALESCE(TRIM(p_description), 'Balanced ledger debit'),
    TRIM(p_reference),
    v_now
  )
  RETURNING id INTO v_debit_id;

  -- 6. Insert balanced double-entry rows (CREDIT)
  INSERT INTO public.financial_ledger (
    transaction_group_id,
    booking_id,
    transaction_type,
    account_code,
    account_name,
    entry_type,
    amount_ngn,
    description,
    reference,
    created_at
  ) VALUES (
    v_group_id,
    p_booking_id,
    TRIM(p_transaction_type),
    TRIM(p_credit_account),
    TRIM(p_credit_account),
    'credit',
    v_rounded_amount,
    COALESCE(TRIM(p_description), 'Balanced ledger credit'),
    TRIM(p_reference),
    v_now
  )
  RETURNING id INTO v_credit_id;

  -- 7. Mathematical verification: Total Debits == Total Credits in transaction group
  SELECT
    COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount_ngn ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount_ngn ELSE 0 END), 0)
  INTO v_total_debits, v_total_credits
  FROM public.financial_ledger
  WHERE transaction_group_id = v_group_id;

  IF v_total_debits != v_total_credits OR v_total_debits != v_rounded_amount THEN
    RAISE EXCEPTION 'Ledger transaction imbalance detected: Total Debit = %, Total Credit = %',
      v_total_debits, v_total_credits USING ERRCODE = 'P0001';
  END IF;

  -- 8. Return balanced transaction receipt
  RETURN jsonb_build_object(
    'success', true,
    'transaction_group_id', v_group_id,
    'booking_id', p_booking_id,
    'transaction_type', TRIM(p_transaction_type),
    'reference', TRIM(p_reference),
    'amount_ngn', v_rounded_amount,
    'debit_account', TRIM(p_debit_account),
    'credit_account', TRIM(p_credit_account),
    'debit_entry_id', v_debit_id,
    'credit_entry_id', v_credit_id,
    'created_at', v_now
  );
END;
$$;

-- ==============================================================================
-- 6. FUNCTION E: can_access_issue_evidence
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.can_access_issue_evidence(
  p_issue_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID;
  v_is_admin BOOLEAN := FALSE;
  v_is_owner BOOLEAN := FALSE;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN FALSE;
  END IF;

  -- Check admin privilege
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE profiles.id = v_caller_id AND profiles.role = 'admin'
  ) INTO v_is_admin;

  IF v_is_admin THEN
    RETURN TRUE;
  END IF;

  -- Check if caller is the guest who submitted the issue
  SELECT EXISTS (
    SELECT 1 FROM public.booking_issues bi
    WHERE bi.id = p_issue_id AND bi.guest_id = v_caller_id
  ) INTO v_is_owner;

  RETURN v_is_owner;
END;
$$;

-- ==============================================================================
-- 7. EXECUTION PRIVILEGES (REVOKE anon, enforce authenticated checks)
-- ==============================================================================
REVOKE ALL ON FUNCTION public.confirm_booking_check_in(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_check_in(UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.report_booking_issue(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_booking_issue(UUID, TEXT, TEXT, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.admin_force_check_in(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_check_in(UUID, TEXT) TO authenticated;

REVOKE ALL ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO authenticated;

REVOKE ALL ON FUNCTION public.can_access_issue_evidence(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_issue_evidence(UUID) TO authenticated;
