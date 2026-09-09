-- ==============================================================================
-- PHASE 3 — GATE #7.2B PART 1 MIGRATION:
-- ISSUE ADJUDICATION + RESERVE/DEPOSIT LIFECYCLE FOUNDATION
--
-- STRICT INVARIANTS:
-- 1. Canonical Lock Order:
--    bookings -> partner_payouts -> guest_assurance_reserves -> damage_deposits -> booking_issues -> damage_claims
-- 2. No external network calls under database transactions/locks.
-- 3. No invented reserve percentage or formulas (original_reserve_ngn is authoritative).
-- 4. Preserve Gate #5.3 commission model (Host 10-15%, Car 10%, Guest 0%).
-- 5. Preserve Gate #6.3 booking & availability logic.
-- 6. All ledger entries balance: Debits = Credits.
-- 7. Account 2040 is Liability (Credit normal); Account 2300 is Liability (Credit normal).
-- 8. Neither reserve nor damage deposit is platform commission revenue (no 4010/4020).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. SCHEMA RECONCILIATION: booking_issues & damage_deposits status constraints
-- ------------------------------------------------------------------------------

-- Ensure booking_issues status check permits canonical state machine transitions:
-- submitted -> under_review -> remedy_in_progress -> resolved / resolved_dismissed / resolved_compensated / escalated_relocation / rejected
ALTER TABLE public.booking_issues DROP CONSTRAINT IF EXISTS booking_issues_status_check;
ALTER TABLE public.booking_issues ADD CONSTRAINT booking_issues_status_check CHECK (
  status IN (
    'submitted',
    'under_review',
    'remedy_in_progress',
    'resolved',
    'resolved_dismissed',
    'resolved_compensated',
    'escalated_relocation',
    'rejected'
  )
);

-- Ensure damage_deposits status check permits eligible_for_refund
ALTER TABLE public.damage_deposits DROP CONSTRAINT IF EXISTS damage_deposits_status_check;
ALTER TABLE public.damage_deposits ADD CONSTRAINT damage_deposits_status_check CHECK (
  status IN (
    'held',
    'claim_pending',
    'partially_retained',
    'fully_retained',
    'eligible_for_refund',
    'refunded_to_guest'
  )
);

-- Ensure guest_assurance_reserves status check is intact
ALTER TABLE public.guest_assurance_reserves DROP CONSTRAINT IF EXISTS guest_assurance_reserves_status_check;
ALTER TABLE public.guest_assurance_reserves ADD CONSTRAINT guest_assurance_reserves_status_check CHECK (
  status IN (
    'held',
    'locked_dispute',
    'eligible_for_release',
    'disbursed_to_host',
    'partially_consumed',
    'fully_consumed',
    'cancelled_void'
  )
);

-- ------------------------------------------------------------------------------
-- 2. CREATE TABLE: public.damage_claims (Host damage inspection claims)
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.damage_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  deposit_id UUID NOT NULL REFERENCES public.damage_deposits(id) ON DELETE RESTRICT,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE RESTRICT,
  claimed_amount_ngn NUMERIC(14,2) NOT NULL CHECK (claimed_amount_ngn > 0),
  description TEXT NOT NULL,
  evidence_urls TEXT[] DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (
    status IN ('submitted', 'under_review', 'approved_full', 'approved_partial', 'rejected', 'dismissed')
  ),
  adjudicated_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (adjudicated_amount_ngn >= 0),
  adjudication_notes TEXT NULL,
  adjudicated_by UUID REFERENCES auth.users(id),
  adjudicated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_damage_claims_deposit_id ON public.damage_claims(deposit_id);
CREATE INDEX IF NOT EXISTS idx_damage_claims_booking_id ON public.damage_claims(booking_id);
CREATE INDEX IF NOT EXISTS idx_damage_claims_property_id ON public.damage_claims(property_id);
CREATE INDEX IF NOT EXISTS idx_damage_claims_host_id ON public.damage_claims(host_id);
CREATE INDEX IF NOT EXISTS idx_damage_claims_status ON public.damage_claims(status);

-- Enable RLS on damage_claims
ALTER TABLE public.damage_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admin full access to damage_claims" ON public.damage_claims;
CREATE POLICY "Admin full access to damage_claims"
  ON public.damage_claims
  FOR ALL
  TO authenticated
  USING (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'));

DROP POLICY IF EXISTS "Host view own damage_claims" ON public.damage_claims;
CREATE POLICY "Host view own damage_claims"
  ON public.damage_claims
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = damage_claims.host_id AND hp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Guest view damage_claims on own booking" ON public.damage_claims;
CREATE POLICY "Guest view damage_claims on own booking"
  ON public.damage_claims
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = damage_claims.booking_id AND b.user_id = auth.uid()
    )
  );

-- Revoke direct mutations from public, anon, authenticated (all must use authoritative RPCs)
REVOKE INSERT, UPDATE, DELETE ON public.damage_claims FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.damage_claims TO authenticated;

-- ------------------------------------------------------------------------------
-- 3. RPC: public.adjudicate_booking_issue
-- Authoritative Issue Adjudication
-- Canonical Lock Order: bookings -> partner_payouts -> guest_assurance_reserves -> damage_deposits -> booking_issues
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjudicate_booking_issue(
  p_issue_id UUID,
  p_tier TEXT,
  p_resolution_status TEXT,
  p_resolution_notes TEXT DEFAULT NULL,
  p_compensation_amount_ngn NUMERIC DEFAULT 0,
  p_reserve_draw_ngn NUMERIC DEFAULT 0
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
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_reserve RECORD;
  v_deposit RECORD;
  v_issue RECORD;
  v_adjudicator_id UUID;
  v_comp_amount NUMERIC(14,2) := COALESCE(p_compensation_amount_ngn, 0);
  v_draw_amount NUMERIC(14,2) := COALESCE(p_reserve_draw_ngn, 0);
  v_ledger_result JSONB;
BEGIN
  -- 1. Security Authorization: Admin or service_role ONLY
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
    RAISE EXCEPTION 'Unauthorized: issue adjudication is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  v_adjudicator_id := COALESCE(v_caller_id, (SELECT id FROM public.profiles WHERE role = 'admin' LIMIT 1));

  -- 2. Input validation
  IF p_issue_id IS NULL THEN
    RAISE EXCEPTION 'p_issue_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_tier NOT IN ('tier_1', 'tier_2', 'tier_3') THEN
    RAISE EXCEPTION 'Invalid issue tier: %. Allowed: tier_1, tier_2, tier_3.', p_tier
      USING ERRCODE = '22023';
  END IF;

  IF p_resolution_status NOT IN (
    'submitted',
    'under_review',
    'remedy_in_progress',
    'resolved',
    'resolved_dismissed',
    'resolved_compensated',
    'escalated_relocation',
    'rejected'
  ) THEN
    RAISE EXCEPTION 'Invalid resolution status: %.', p_resolution_status USING ERRCODE = '22023';
  END IF;

  IF v_comp_amount < 0 THEN
    RAISE EXCEPTION 'Compensation amount cannot be negative.' USING ERRCODE = '22023';
  END IF;

  IF v_draw_amount < 0 THEN
    RAISE EXCEPTION 'Reserve draw amount cannot be negative.' USING ERRCODE = '22023';
  END IF;

  -- 3. Lookup parent booking ID from issue without acquiring lock
  SELECT booking_id INTO v_booking_id
  FROM public.booking_issues
  WHERE id = p_issue_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking issue % not found.', p_issue_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. CANONICAL LOCK ORDER:
  -- (1) bookings -> (2) partner_payouts -> (3) guest_assurance_reserves -> (4) damage_deposits -> (5) booking_issues
  
  -- Step 4.1: Lock booking FIRST
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', v_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- Step 4.2: Lock relevant partner payout SECOND (if exists)
  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE booking_id = v_booking_id
  FOR UPDATE;

  -- Step 4.3: Lock relevant reserve THIRD (if exists)
  SELECT * INTO v_reserve
  FROM public.guest_assurance_reserves
  WHERE booking_id = v_booking_id
  FOR UPDATE;

  -- Step 4.4: Lock relevant damage deposit FOURTH (if exists)
  SELECT * INTO v_deposit
  FROM public.damage_deposits
  WHERE booking_id = v_booking_id
  FOR UPDATE;

  -- Step 4.5: Lock issue row FIFTH
  SELECT * INTO v_issue
  FROM public.booking_issues
  WHERE id = p_issue_id
  FOR UPDATE;

  -- 5. Idempotency Check on Issue State
  IF v_issue.status IN ('resolved', 'resolved_dismissed', 'resolved_compensated', 'rejected') THEN
    IF v_issue.status = p_resolution_status AND v_issue.issue_tier = p_tier THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_adjudicated', true,
        'issue_id', v_issue.id,
        'booking_id', v_booking_id,
        'tier', v_issue.issue_tier,
        'status', v_issue.status,
        'message', 'Issue has already been adjudicated with identical resolution.'
      );
    ELSE
      RAISE EXCEPTION 'Issue % has already been resolved with status "%" and cannot be re-adjudicated.',
        p_issue_id, v_issue.status USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 6. TIER-SPECIFIC INVARIANTS & POLICIES

  -- --- TIER 1: Operational / Minor issue ---
  IF p_tier = 'tier_1' THEN
    -- Tier 1 does NOT support financial compensation or reserve draw
    IF v_comp_amount > 0 OR v_draw_amount > 0 THEN
      RAISE EXCEPTION 'Tier 1 issues do not support financial compensation or reserve draw.'
        USING ERRCODE = '22023';
    END IF;
    IF p_resolution_status = 'resolved_compensated' THEN
      RAISE EXCEPTION 'Tier 1 issues cannot be resolved with compensation.' USING ERRCODE = '22023';
    END IF;

  -- --- TIER 2: Moderate issue ---
  ELSIF p_tier = 'tier_2' THEN
    IF p_resolution_status = 'resolved_compensated' THEN
      -- If no compensation amount is provided or policy is unconfigured, fail safely
      IF v_comp_amount <= 0 THEN
        RAISE EXCEPTION 'Tier 2 compensation policy not configured: Valid server-side approved compensation amount required.'
          USING ERRCODE = '22023';
      END IF;

      -- Reserve must exist and have sufficient remaining balance
      IF v_reserve.id IS NULL THEN
        RAISE EXCEPTION 'Cannot award compensation: No funded guest assurance reserve exists for booking %.',
          v_booking_id USING ERRCODE = '22023';
      END IF;

      IF v_reserve.remaining_reserve_ngn < v_comp_amount THEN
        RAISE EXCEPTION 'Compensation amount (₦%) exceeds remaining reserve balance (₦%).',
          v_comp_amount, v_reserve.remaining_reserve_ngn USING ERRCODE = '22023';
      END IF;

      -- Update reserve atomically
      UPDATE public.guest_assurance_reserves
      SET
        consumed_reserve_ngn = consumed_reserve_ngn + v_comp_amount,
        status = CASE
          WHEN (consumed_reserve_ngn + v_comp_amount + released_reserve_ngn) >= original_reserve_ngn THEN 'fully_consumed'
          ELSE 'partially_consumed'
        END,
        updated_at = v_now
      WHERE id = v_reserve.id;

      -- Post balanced double-entry ledger mutation:
      -- Debit 2040 (Guest Assurance Reserve Liability)
      -- Credit 2010 (Unearned Guest Revenue / Refund Clearing)
      v_ledger_result := public.record_balanced_ledger_transaction(
        gen_random_uuid(),
        v_booking_id,
        'RESERVE_DRAW_COMPENSATION',
        'RESERVE-DRAW-' || p_issue_id::TEXT,
        format('Guest Assurance Reserve draw of ₦%s for Issue %s', v_comp_amount, p_issue_id),
        '2040',
        '2010',
        v_comp_amount
      );

      v_draw_amount := v_comp_amount;
    END IF;

  -- --- TIER 3: Severe qualifying issue ---
  ELSIF p_tier = 'tier_3' THEN
    -- Protect partner payout: transition to frozen_dispute
    IF v_payout.id IS NOT NULL THEN
      IF v_payout.status IN ('allocated', 'protection_window', 'eligible', 'authorized') THEN
        UPDATE public.partner_payouts
        SET
          status = 'frozen_dispute',
          updated_at = v_now
        WHERE id = v_payout.id;
      ELSIF v_payout.status = 'processing' THEN
        -- Payout in-flight: record dispute note without breaking in-flight state machine
        UPDATE public.partner_payouts
        SET
          reconciliation_notes = COALESCE(reconciliation_notes || '; ', '') || 'Tier 3 dispute emerged while processing',
          updated_at = v_now
        WHERE id = v_payout.id;
      ELSIF v_payout.status = 'completed' THEN
        -- Payout already disbursed to host bank; completed status is permanent and immutable
        NULL;
      END IF;
    END IF;

    -- Protect reserve: transition to locked_dispute
    IF v_reserve.id IS NOT NULL AND v_reserve.status IN ('held', 'eligible_for_release') THEN
      UPDATE public.guest_assurance_reserves
      SET
        status = 'locked_dispute',
        updated_at = v_now
      WHERE id = v_reserve.id;
    END IF;
  END IF;

  -- 7. Update Booking Issue Record
  UPDATE public.booking_issues
  SET
    issue_tier = p_tier,
    status = p_resolution_status,
    resolution_notes = p_resolution_notes,
    resolved_by = v_adjudicator_id,
    resolved_at = CASE
      WHEN p_resolution_status IN ('resolved', 'resolved_dismissed', 'resolved_compensated', 'rejected') THEN v_now
      ELSE NULL
    END,
    refund_awarded_ngn = v_comp_amount,
    reserve_draw_ngn = v_draw_amount,
    updated_at = v_now
  WHERE id = p_issue_id;

  -- 8. Return authoritative adjudication outcome
  RETURN jsonb_build_object(
    'success', true,
    'issue_id', p_issue_id,
    'booking_id', v_booking_id,
    'tier', p_tier,
    'status', p_resolution_status,
    'compensation_amount_ngn', v_comp_amount,
    'reserve_draw_ngn', v_draw_amount,
    'adjudicated_by', v_adjudicator_id,
    'adjudicated_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 4. RPC: public.consume_guest_assurance_reserve
-- Authoritative Server-Side Reserve Consumption
-- Canonical Lock Order: bookings -> partner_payouts -> guest_assurance_reserves -> booking_issues
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.consume_guest_assurance_reserve(
  p_reserve_id UUID,
  p_issue_id UUID,
  p_amount_ngn NUMERIC,
  p_reason TEXT DEFAULT NULL
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
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_reserve RECORD;
  v_issue RECORD;
  v_ledger_result JSONB;
BEGIN
  -- 1. Security Authorization: Service role or admin ONLY
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
    RAISE EXCEPTION 'Unauthorized: reserve consumption is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF p_reserve_id IS NULL THEN
    RAISE EXCEPTION 'p_reserve_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_amount_ngn IS NULL OR p_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'Reserve consumption amount must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  -- 3. Lookup booking ID associated with reserve
  SELECT booking_id INTO v_booking_id
  FROM public.guest_assurance_reserves
  WHERE id = p_reserve_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest assurance reserve % not found.', p_reserve_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. CANONICAL LOCK ORDER:
  -- (1) bookings -> (2) partner_payouts -> (3) guest_assurance_reserves -> (4) booking_issues
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE booking_id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_reserve
  FROM public.guest_assurance_reserves
  WHERE id = p_reserve_id
  FOR UPDATE;

  -- Check reserve status permits consumption
  IF v_reserve.status NOT IN ('held', 'locked_dispute', 'eligible_for_release', 'partially_consumed') THEN
    RAISE EXCEPTION 'Reserve % in status "%" cannot be consumed.', p_reserve_id, v_reserve.status
      USING ERRCODE = '22023';
  END IF;

  IF v_reserve.original_reserve_ngn <= 0 THEN
    RAISE EXCEPTION 'Reserve % has zero balance and cannot be consumed.', p_reserve_id
      USING ERRCODE = '22023';
  END IF;

  IF p_amount_ngn > v_reserve.remaining_reserve_ngn THEN
    RAISE EXCEPTION 'Requested consumption ₦% exceeds remaining reserve ₦%.',
      p_amount_ngn, v_reserve.remaining_reserve_ngn USING ERRCODE = '22023';
  END IF;

  -- 5. Lock and validate issue if specified
  IF p_issue_id IS NOT NULL THEN
    SELECT * INTO v_issue
    FROM public.booking_issues
    WHERE id = p_issue_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Booking issue % not found.', p_issue_id USING ERRCODE = 'P0002';
    END IF;

    -- Prevent duplicate consumption for same issue resolution
    IF v_issue.reserve_draw_ngn >= p_amount_ngn AND v_issue.status = 'resolved_compensated' THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_consumed', true,
        'reserve_id', p_reserve_id,
        'issue_id', p_issue_id,
        'amount_ngn', p_amount_ngn,
        'message', 'Reserve has already been consumed for this issue resolution.'
      );
    END IF;
  END IF;

  -- 6. Atomically update reserve balance & status
  UPDATE public.guest_assurance_reserves
  SET
    consumed_reserve_ngn = consumed_reserve_ngn + p_amount_ngn,
    status = CASE
      WHEN (consumed_reserve_ngn + p_amount_ngn + released_reserve_ngn) >= original_reserve_ngn THEN 'fully_consumed'
      ELSE 'partially_consumed'
    END,
    updated_at = v_now
  WHERE id = p_reserve_id;

  -- Link issue if specified
  IF p_issue_id IS NOT NULL THEN
    UPDATE public.booking_issues
    SET
      reserve_draw_ngn = reserve_draw_ngn + p_amount_ngn,
      updated_at = v_now
    WHERE id = p_issue_id;
  END IF;

  -- 7. Post balanced double-entry ledger mutation
  -- Account 2040: Guest Assurance Reserve Liability
  -- Account 2010: Unearned Guest Revenue / Refund Clearing
  v_ledger_result := public.record_balanced_ledger_transaction(
    gen_random_uuid(),
    v_booking_id,
    'RESERVE_CONSUMPTION',
    'RESERVE-CONSUME-' || COALESCE(p_issue_id::TEXT, p_reserve_id::TEXT),
    format('Guest Assurance Reserve consumption of ₦%s: %s', p_amount_ngn, COALESCE(p_reason, 'Adjudicated issue resolution')),
    '2040',
    '2010',
    p_amount_ngn
  );

  RETURN jsonb_build_object(
    'success', true,
    'reserve_id', p_reserve_id,
    'consumed_amount_ngn', p_amount_ngn,
    'remaining_reserve_ngn', (v_reserve.remaining_reserve_ngn - p_amount_ngn),
    'status', CASE
      WHEN (v_reserve.consumed_reserve_ngn + p_amount_ngn + v_reserve.released_reserve_ngn) >= v_reserve.original_reserve_ngn THEN 'fully_consumed'
      ELSE 'partially_consumed'
    END,
    'ledger_transaction_id', v_ledger_result->>'transaction_id'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 5. RPC: public.release_guest_assurance_reserve
-- Authoritative Server-Side Reserve Release State Transition
-- Canonical Lock Order: bookings -> partner_payouts -> guest_assurance_reserves
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.release_guest_assurance_reserve(
  p_reserve_id UUID
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
  v_booking_id UUID;
  v_booking RECORD;
  v_property RECORD;
  v_payout RECORD;
  v_reserve RECORD;
  v_checkout_time_str TEXT;
  v_checkout_time TIME;
  v_stay_end TIMESTAMPTZ;
  v_matures_at TIMESTAMPTZ;
  v_has_active_issue BOOLEAN;
BEGIN
  -- 1. Security Authorization: Service role or admin ONLY
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
    RAISE EXCEPTION 'Unauthorized: reserve release is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lookup booking ID associated with reserve
  SELECT booking_id INTO v_booking_id
  FROM public.guest_assurance_reserves
  WHERE id = p_reserve_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Guest assurance reserve % not found.', p_reserve_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. CANONICAL LOCK ORDER:
  -- (1) bookings -> (2) partner_payouts -> (3) guest_assurance_reserves
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE booking_id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_reserve
  FROM public.guest_assurance_reserves
  WHERE id = p_reserve_id
  FOR UPDATE;

  -- 4. Idempotency Check
  IF v_reserve.status = 'eligible_for_release' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_eligible', true,
      'reserve_id', p_reserve_id,
      'booking_id', v_booking_id,
      'status', 'eligible_for_release',
      'remaining_reserve_ngn', v_reserve.remaining_reserve_ngn,
      'message', 'Reserve is already eligible for release.'
    );
  END IF;

  IF v_reserve.status = 'disbursed_to_host' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_disbursed', true,
      'reserve_id', p_reserve_id,
      'booking_id', v_booking_id,
      'status', 'disbursed_to_host',
      'message', 'Reserve has already been disbursed to host.'
    );
  END IF;

  IF v_reserve.status IN ('fully_consumed', 'cancelled_void') THEN
    RAISE EXCEPTION 'Reserve % in status "%" cannot be released.', p_reserve_id, v_reserve.status
      USING ERRCODE = '22023';
  END IF;

  IF v_reserve.remaining_reserve_ngn <= 0 THEN
    RAISE EXCEPTION 'Reserve % has ₦0 remaining balance and cannot be released.', p_reserve_id
      USING ERRCODE = '22023';
  END IF;

  -- 5. TIMING CHECK: Authoritative checkout timestamp + 24 hours
  SELECT check_out_time INTO v_checkout_time_str
  FROM public.properties
  WHERE id = v_booking.property_id;

  v_checkout_time_str := COALESCE(NULLIF(TRIM(v_checkout_time_str), ''), '12:00');
  BEGIN
    v_checkout_time := v_checkout_time_str::TIME;
  EXCEPTION WHEN OTHERS THEN
    v_checkout_time := '12:00'::TIME;
  END;

  v_stay_end := (v_booking.check_out + v_checkout_time) AT TIME ZONE 'Africa/Lagos';
  v_matures_at := v_stay_end + INTERVAL '24 hours';

  IF v_now < v_matures_at THEN
    RAISE EXCEPTION 'Cannot release reserve: Reserve has not matured. Maturity is scheduled for % (checkout + 24 hours).',
      v_matures_at USING ERRCODE = '22023';
  END IF;

  -- 6. DISPUTE CHECK: No active qualifying issue may exist
  SELECT EXISTS (
    SELECT 1 FROM public.booking_issues bi
    WHERE bi.booking_id = v_booking_id
      AND bi.issue_tier IN ('tier_2', 'tier_3')
      AND bi.status NOT IN ('resolved', 'resolved_dismissed', 'resolved_compensated', 'rejected')
  ) INTO v_has_active_issue;

  IF v_has_active_issue THEN
    -- Transition reserve to locked_dispute if not already locked
    IF v_reserve.status != 'locked_dispute' THEN
      UPDATE public.guest_assurance_reserves
      SET status = 'locked_dispute', updated_at = v_now
      WHERE id = p_reserve_id;
    END IF;

    RAISE EXCEPTION 'Cannot release reserve: Active qualifying dispute exists on booking %.', v_booking_id
      USING ERRCODE = '22023';
  END IF;

  -- 7. Transition reserve to eligible_for_release
  UPDATE public.guest_assurance_reserves
  SET
    status = 'eligible_for_release',
    updated_at = v_now
  WHERE id = p_reserve_id;

  -- In Part 1: DO NOT perform external Paystack transfer or automatic bank disbursement
  RETURN jsonb_build_object(
    'success', true,
    'reserve_id', p_reserve_id,
    'booking_id', v_booking_id,
    'status', 'eligible_for_release',
    'remaining_reserve_ngn', v_reserve.remaining_reserve_ngn,
    'matures_at', v_matures_at,
    'released_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 6. RPC: public.submit_damage_claim
-- Authoritative Host Damage Claim Submission
-- Canonical Lock Order: bookings -> damage_deposits
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_damage_claim(
  p_deposit_id UUID,
  p_claimed_amount_ngn NUMERIC,
  p_description TEXT,
  p_evidence_urls TEXT[] DEFAULT '{}'
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
  v_host_profile RECORD;
  v_now TIMESTAMPTZ := now();
  v_deposit RECORD;
  v_booking RECORD;
  v_property RECORD;
  v_checkout_time_str TEXT;
  v_checkout_time TIME;
  v_stay_end TIMESTAMPTZ;
  v_claim_id UUID;
  v_available_deposit NUMERIC(14,2);
BEGIN
  -- 1. Security Authorization: Host who owns property or Admin/Service
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

  -- 2. Input validation
  IF p_deposit_id IS NULL THEN
    RAISE EXCEPTION 'p_deposit_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_claimed_amount_ngn IS NULL OR p_claimed_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'Claimed amount must be greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF p_description IS NULL OR TRIM(p_description) = '' THEN
    RAISE EXCEPTION 'Claim description cannot be empty.' USING ERRCODE = '22023';
  END IF;

  -- 3. Lookup damage deposit and booking
  SELECT * INTO v_deposit
  FROM public.damage_deposits
  WHERE id = p_deposit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Damage deposit % not found.', p_deposit_id USING ERRCODE = 'P0002';
  END IF;

  -- Verify host ownership if not admin/service
  IF NOT v_is_service AND NOT v_is_admin THEN
    IF v_caller_id IS NULL THEN
      RAISE EXCEPTION 'Authentication required to submit damage claim.' USING ERRCODE = '42501';
    END IF;

    SELECT hp.* INTO v_host_profile
    FROM public.host_profiles hp
    JOIN public.properties prop ON prop.host_id = hp.id
    WHERE hp.user_id = v_caller_id AND prop.id = v_deposit.property_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Unauthorized: only the host of this property can submit a damage claim.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    SELECT hp.* INTO v_host_profile
    FROM public.host_profiles hp
    JOIN public.properties prop ON prop.host_id = hp.id
    WHERE prop.id = v_deposit.property_id
    LIMIT 1;
  END IF;

  -- 4. CANONICAL LOCK ORDER:
  -- (1) bookings -> (2) damage_deposits
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_deposit.booking_id
  FOR UPDATE;

  SELECT * INTO v_deposit
  FROM public.damage_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  -- 5. Status check on deposit
  IF v_deposit.status != 'held' THEN
    RAISE EXCEPTION 'Cannot submit damage claim: Damage deposit is in "%" status, not held.', v_deposit.status
      USING ERRCODE = '22023';
  END IF;

  -- 6. Stay completion check: Guest must have checked out
  SELECT check_out_time INTO v_checkout_time_str
  FROM public.properties
  WHERE id = v_booking.property_id;

  v_checkout_time_str := COALESCE(NULLIF(TRIM(v_checkout_time_str), ''), '12:00');
  BEGIN
    v_checkout_time := v_checkout_time_str::TIME;
  EXCEPTION WHEN OTHERS THEN
    v_checkout_time := '12:00'::TIME;
  END;

  v_stay_end := (v_booking.check_out + v_checkout_time) AT TIME ZONE 'Africa/Lagos';

  IF v_now < v_stay_end THEN
    RAISE EXCEPTION 'Cannot submit damage claim: Guest stay has not concluded (scheduled checkout %)',
      v_stay_end USING ERRCODE = '22023';
  END IF;

  -- 7. TIMING CHECK: Must be within authoritative 48-hour inspection deadline
  IF v_now > v_deposit.inspection_deadline THEN
    RAISE EXCEPTION 'Cannot submit damage claim: 48-hour inspection deadline has expired (%).',
      v_deposit.inspection_deadline USING ERRCODE = '22023';
  END IF;

  -- 8. Amount check: Cannot exceed available deposit balance
  v_available_deposit := v_deposit.deposit_amount_ngn - v_deposit.retained_amount_ngn;
  IF p_claimed_amount_ngn > v_available_deposit THEN
    RAISE EXCEPTION 'Claim amount (₦%) exceeds available damage deposit balance (₦%).',
      p_claimed_amount_ngn, v_available_deposit USING ERRCODE = '22023';
  END IF;

  -- 9. Duplicate claim check: Prevent multiple pending claims on same deposit
  IF EXISTS (
    SELECT 1 FROM public.damage_claims
    WHERE deposit_id = p_deposit_id
      AND status IN ('submitted', 'under_review')
  ) THEN
    RAISE EXCEPTION 'An active damage claim is already pending for this deposit.'
      USING ERRCODE = '23505';
  END IF;

  -- 10. Insert damage claim record
  INSERT INTO public.damage_claims (
    deposit_id,
    booking_id,
    property_id,
    host_id,
    claimed_amount_ngn,
    description,
    evidence_urls,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_deposit.id,
    v_booking.id,
    v_deposit.property_id,
    v_host_profile.id,
    p_claimed_amount_ngn,
    TRIM(p_description),
    COALESCE(p_evidence_urls, '{}'),
    'submitted',
    v_now,
    v_now
  )
  RETURNING id INTO v_claim_id;

  -- 11. Transition damage deposit status to claim_pending (Host cannot directly retain funds)
  UPDATE public.damage_deposits
  SET
    status = 'claim_pending',
    updated_at = v_now
  WHERE id = v_deposit.id;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'deposit_id', v_deposit.id,
    'booking_id', v_booking.id,
    'claimed_amount_ngn', p_claimed_amount_ngn,
    'status', 'submitted',
    'inspection_deadline', v_deposit.inspection_deadline,
    'message', 'Damage claim submitted successfully for administrative adjudication.'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 7. RPC: public.adjudicate_damage_deposit
-- Authoritative Admin Damage Deposit Adjudication
-- Canonical Lock Order: bookings -> damage_deposits -> damage_claims
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.adjudicate_damage_deposit(
  p_deposit_id UUID,
  p_adjudication_type TEXT,
  p_retained_amount_ngn NUMERIC DEFAULT 0,
  p_notes TEXT DEFAULT NULL
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
  v_booking_id UUID;
  v_booking RECORD;
  v_deposit RECORD;
  v_claim RECORD;
  v_retained NUMERIC(14,2) := COALESCE(p_retained_amount_ngn, 0);
  v_refunded NUMERIC(14,2);
  v_new_status TEXT;
  v_ledger_result JSONB;
BEGIN
  -- 1. Security Authorization: Service role or admin ONLY
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
    RAISE EXCEPTION 'Unauthorized: damage deposit adjudication is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF p_deposit_id IS NULL THEN
    RAISE EXCEPTION 'p_deposit_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_adjudication_type NOT IN ('clean_refund', 'partial_retention', 'full_retention') THEN
    RAISE EXCEPTION 'Invalid adjudication type: %. Allowed: clean_refund, partial_retention, full_retention.',
      p_adjudication_type USING ERRCODE = '22023';
  END IF;

  -- 3. Lookup parent booking
  SELECT booking_id INTO v_booking_id
  FROM public.damage_deposits
  WHERE id = p_deposit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Damage deposit % not found.', p_deposit_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. CANONICAL LOCK ORDER:
  -- (1) bookings -> (2) damage_deposits -> (3) damage_claims
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_deposit
  FROM public.damage_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  -- 5. Idempotency Check: Cannot re-adjudicate finalized deposits
  IF v_deposit.status IN ('partially_retained', 'fully_retained', 'refunded_to_guest') THEN
    RAISE EXCEPTION 'Damage deposit % has already been adjudicated with status "%".',
      p_deposit_id, v_deposit.status USING ERRCODE = '22023';
  END IF;

  -- 6. Adjudication type handling & balance validation
  IF p_adjudication_type = 'clean_refund' THEN
    v_retained := 0;
    v_refunded := v_deposit.deposit_amount_ngn;
    v_new_status := 'refunded_to_guest';

    -- Dismiss / reject any pending claims
    UPDATE public.damage_claims
    SET
      status = 'rejected',
      adjudicated_amount_ngn = 0,
      adjudication_notes = COALESCE(p_notes, 'Claim rejected: Clean inspection confirmed.'),
      adjudicated_by = v_caller_id,
      adjudicated_at = v_now,
      updated_at = v_now
    WHERE deposit_id = p_deposit_id AND status IN ('submitted', 'under_review');

  ELSIF p_adjudication_type = 'partial_retention' THEN
    IF v_retained <= 0 THEN
      RAISE EXCEPTION 'Retained amount must be greater than zero for partial retention.'
        USING ERRCODE = '22023';
    END IF;

    IF v_retained >= v_deposit.deposit_amount_ngn THEN
      RAISE EXCEPTION 'Retained amount (₦%) must be less than total deposit (₦%) for partial retention. Use full_retention instead.',
        v_retained, v_deposit.deposit_amount_ngn USING ERRCODE = '22023';
    END IF;

    v_refunded := v_deposit.deposit_amount_ngn - v_retained;
    v_new_status := 'partially_retained';

    -- Update pending claims
    UPDATE public.damage_claims
    SET
      status = 'approved_partial',
      adjudicated_amount_ngn = v_retained,
      adjudication_notes = p_notes,
      adjudicated_by = v_caller_id,
      adjudicated_at = v_now,
      updated_at = v_now
    WHERE deposit_id = p_deposit_id AND status IN ('submitted', 'under_review');

    -- Post balanced ledger transaction for retained damage deposit:
    -- Debit 2300 (Damage Deposit Liability)
    -- Credit 2100 (Partner Payout Payable - Host damage restitution)
    -- Note: Deposit is NOT platform commission revenue (no 4010/4020)
    v_ledger_result := public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking_id,
      'DAMAGE_DEPOSIT_PARTIAL_RETENTION',
      'DAMAGE-DEP-RETAIN-' || p_deposit_id::TEXT,
      format('Damage deposit partial retention of ₦%s for booking %s', v_retained, v_booking_id),
      '2300',
      '2100',
      v_retained
    );

  ELSIF p_adjudication_type = 'full_retention' THEN
    v_retained := v_deposit.deposit_amount_ngn;
    v_refunded := 0;
    v_new_status := 'fully_retained';

    -- Update pending claims
    UPDATE public.damage_claims
    SET
      status = 'approved_full',
      adjudicated_amount_ngn = v_retained,
      adjudication_notes = p_notes,
      adjudicated_by = v_caller_id,
      adjudicated_at = v_now,
      updated_at = v_now
    WHERE deposit_id = p_deposit_id AND status IN ('submitted', 'under_review');

    -- Post balanced ledger transaction for full retention:
    -- Debit 2300 (Damage Deposit Liability)
    -- Credit 2100 (Partner Payout Payable - Host damage restitution)
    v_ledger_result := public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking_id,
      'DAMAGE_DEPOSIT_FULL_RETENTION',
      'DAMAGE-DEP-RETAIN-' || p_deposit_id::TEXT,
      format('Damage deposit full retention of ₦%s for booking %s', v_retained, v_booking_id),
      '2300',
      '2100',
      v_retained
    );
  END IF;

  -- 7. Update damage deposit authoritative record
  UPDATE public.damage_deposits
  SET
    retained_amount_ngn = v_retained,
    refunded_amount_ngn = v_refunded,
    status = v_new_status,
    adjudicated_at = v_now,
    updated_at = v_now
  WHERE id = p_deposit_id;

  -- In Part 1: NO external Paystack refund HTTP call
  RETURN jsonb_build_object(
    'success', true,
    'deposit_id', p_deposit_id,
    'booking_id', v_booking_id,
    'adjudication_type', p_adjudication_type,
    'status', v_new_status,
    'retained_amount_ngn', v_retained,
    'refunded_amount_ngn', v_refunded,
    'adjudicated_at', v_now
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 8. RPC: public.evaluate_damage_deposit_refund_eligibility
-- Evaluates Clean Refund Eligibility After 48-Hour Inspection Deadline
-- Canonical Lock Order: bookings -> damage_deposits
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.evaluate_damage_deposit_refund_eligibility(
  p_deposit_id UUID
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
  v_booking_id UUID;
  v_booking RECORD;
  v_deposit RECORD;
  v_has_pending_claim BOOLEAN;
BEGIN
  -- 1. Security Authorization: Service role or admin ONLY
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
    RAISE EXCEPTION 'Unauthorized: evaluating deposit refund eligibility is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Lookup parent booking
  SELECT booking_id INTO v_booking_id
  FROM public.damage_deposits
  WHERE id = p_deposit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Damage deposit % not found.', p_deposit_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. CANONICAL LOCK ORDER: (1) bookings -> (2) damage_deposits
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  SELECT * INTO v_deposit
  FROM public.damage_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  -- 4. Idempotency Check
  IF v_deposit.status IN ('eligible_for_refund', 'refunded_to_guest') THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_eligible', true,
      'deposit_id', p_deposit_id,
      'booking_id', v_booking_id,
      'status', v_deposit.status,
      'message', 'Damage deposit is already eligible for or has completed refund.'
    );
  END IF;

  IF v_deposit.status IN ('partially_retained', 'fully_retained') THEN
    RETURN jsonb_build_object(
      'success', false,
      'already_adjudicated', true,
      'deposit_id', p_deposit_id,
      'booking_id', v_booking_id,
      'status', v_deposit.status,
      'message', 'Damage deposit has already been adjudicated with retention.'
    );
  END IF;

  -- 5. Inspection deadline check: Must have passed checkout + 48 hours
  IF v_now <= v_deposit.inspection_deadline THEN
    RAISE EXCEPTION 'Cannot evaluate clean refund: Inspection deadline (%) has not passed.',
      v_deposit.inspection_deadline USING ERRCODE = '22023';
  END IF;

  -- 6. Claim check: Cannot have pending or active claims
  SELECT EXISTS (
    SELECT 1 FROM public.damage_claims
    WHERE deposit_id = p_deposit_id
      AND status IN ('submitted', 'under_review')
  ) INTO v_has_pending_claim;

  IF v_has_pending_claim OR v_deposit.status = 'claim_pending' THEN
    RAISE EXCEPTION 'Cannot evaluate clean refund: Active damage claim exists for deposit %.',
      p_deposit_id USING ERRCODE = '22023';
  END IF;

  -- 7. Transition deposit status to eligible_for_refund
  UPDATE public.damage_deposits
  SET
    status = 'eligible_for_refund',
    updated_at = v_now
  WHERE id = p_deposit_id;

  RETURN jsonb_build_object(
    'success', true,
    'deposit_id', p_deposit_id,
    'booking_id', v_booking_id,
    'status', 'eligible_for_refund',
    'inspection_deadline', v_deposit.inspection_deadline,
    'message', 'Damage deposit transitioned to eligible_for_refund after expiration of 48-hour inspection deadline with zero claims.'
  );
END;
$$;

-- ------------------------------------------------------------------------------
-- 9. STRICT PERMISSIONS & GRANTS
-- ------------------------------------------------------------------------------
-- Revoke execution of financial state management RPCs from public, anon, and regular users
REVOKE EXECUTE ON FUNCTION public.adjudicate_booking_issue FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_guest_assurance_reserve FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_guest_assurance_reserve FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.adjudicate_damage_deposit FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.evaluate_damage_deposit_refund_eligibility FROM PUBLIC, anon, authenticated;

-- Grant execution to authenticated (which checks role = 'admin' inside) and service_role
GRANT EXECUTE ON FUNCTION public.adjudicate_booking_issue TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.consume_guest_assurance_reserve TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_guest_assurance_reserve TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.adjudicate_damage_deposit TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_damage_deposit_refund_eligibility TO authenticated, service_role;

-- Grant submit_damage_claim to authenticated (which checks host property ownership inside)
GRANT EXECUTE ON FUNCTION public.submit_damage_claim TO authenticated, service_role;
