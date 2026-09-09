-- ==============================================================================
-- Migration: Phase 3 Gate #4.2 — Payment Foundation & Atomic Settlement
-- Description:
-- 1. Formalizes public.payments schema (additive, canonical fields, constraints, indexes, RLS)
-- 2. Creates webhook claim & finalize RPCs for 4-state idempotency
-- 3. Creates server-authoritative public.settle_successful_booking_payment(...)
-- 4. Updates public.create_pending_booking_transaction(...) to calculate damage_deposit_ngn
-- 5. Enforces FIN-DEC-01 (80/20 accommodation split pre-fees) & FIN-DEC-02 (damage deposit separate)
-- ==============================================================================

-- ==============================================================================
-- 1. FORMALIZE public.payments SCHEMA
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  amount_ngn NUMERIC(14,2) NOT NULL CHECK (amount_ngn >= 0),
  currency TEXT NOT NULL DEFAULT 'NGN' CHECK (currency = 'NGN'),
  provider TEXT NOT NULL DEFAULT 'paystack',
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'successful')),
  transaction_reference TEXT NOT NULL,
  paid_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Add updated_at if table pre-existed without it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'payments' AND column_name = 'updated_at'
  ) THEN
    ALTER TABLE public.payments ADD COLUMN updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
  END IF;

  -- Ensure currency check constraint if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public' AND table_name = 'payments' AND constraint_name = 'chk_payments_currency'
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT chk_payments_currency CHECK (currency = 'NGN');
  END IF;

  -- Ensure status check constraint if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_schema = 'public' AND table_name = 'payments' AND constraint_name = 'chk_payments_status'
  ) THEN
    ALTER TABLE public.payments ADD CONSTRAINT chk_payments_status CHECK (status IN ('pending', 'paid', 'failed', 'refunded', 'successful'));
  END IF;
END $$;

-- Indexes for performant lookup and uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_transaction_reference_unique ON public.payments(transaction_reference);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_status ON public.payments(status);
CREATE INDEX IF NOT EXISTS idx_payments_created_at ON public.payments(created_at);

-- Row Level Security (RLS)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view payments for their bookings" ON public.payments;
CREATE POLICY "Users can view payments for their bookings"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all payments" ON public.payments;
CREATE POLICY "Admins can view all payments"
  ON public.payments FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Direct client modifications strictly revoked: Mutations are performed via server functions or service role
REVOKE INSERT, UPDATE, DELETE ON public.payments FROM anon, authenticated;

-- ==============================================================================
-- 2. WEBHOOK IDEMPOTENCY ENGINE RPCs
-- ==============================================================================

-- Claim webhook event atomically with 4-state lifecycle (received -> processing -> completed / failed)
CREATE OR REPLACE FUNCTION public.claim_webhook_event(
  p_event_source TEXT,
  p_event_type TEXT,
  p_event_reference TEXT,
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_jwt_role TEXT;
  v_is_service BOOLEAN;
  v_is_admin BOOLEAN;
  v_event RECORD;
  v_event_id UUID;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Security: service role or admin only
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service := (
    v_jwt_role = 'service_role'
    OR current_user = 'service_role'
    OR current_user = 'postgres'
    OR session_user = 'postgres'
  );
  v_is_admin := (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Webhook event lifecycle management is restricted to service role or administrators.'
      USING ERRCODE = '42501';
  END IF;

  IF p_event_reference IS NULL OR TRIM(p_event_reference) = '' THEN
    RAISE EXCEPTION 'Event reference is required.' USING ERRCODE = '22023';
  END IF;

  -- 1. Insert record in 'received' state if not exists
  INSERT INTO public.webhook_events (
    event_source,
    event_type,
    event_reference,
    payload,
    status,
    retry_count,
    created_at
  ) VALUES (
    COALESCE(TRIM(p_event_source), 'paystack'),
    TRIM(p_event_type),
    TRIM(p_event_reference),
    COALESCE(p_payload, '{}'::jsonb),
    'received',
    0,
    v_now
  )
  ON CONFLICT (event_source, event_reference) DO NOTHING;

  -- 2. Lock and inspect current state
  SELECT id, status, retry_count, processing_started_at
  INTO v_event
  FROM public.webhook_events
  WHERE event_source = COALESCE(TRIM(p_event_source), 'paystack')
    AND event_reference = TRIM(p_event_reference)
  FOR UPDATE;

  -- If already completed: replay safely skipped
  IF v_event.status = 'completed' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'completed',
      'event_id', v_event.id,
      'message', 'Event has already been processed successfully.'
    );
  END IF;

  -- If currently processing and active (< 5 mins), do not allow concurrent collision
  IF v_event.status = 'processing' AND v_event.processing_started_at > v_now - INTERVAL '5 minutes' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'processing',
      'event_id', v_event.id,
      'message', 'Event is currently being processed by another worker.'
    );
  END IF;

  -- If failed and exceeded maximum retry count (5 attempts)
  IF v_event.status = 'failed' AND v_event.retry_count >= 5 THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'failed_exhausted',
      'event_id', v_event.id,
      'message', 'Event has failed maximum retry attempts.'
    );
  END IF;

  -- Transition to 'processing'
  UPDATE public.webhook_events
  SET
    status = 'processing',
    processing_started_at = v_now,
    retry_count = retry_count + 1
  WHERE id = v_event.id;

  RETURN jsonb_build_object(
    'claimed', true,
    'status', 'processing',
    'event_id', v_event.id,
    'retry_count', v_event.retry_count + 1
  );
END;
$$;

-- Finalize webhook event state
CREATE OR REPLACE FUNCTION public.finalize_webhook_event(
  p_event_id UUID,
  p_success BOOLEAN,
  p_error_message TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_jwt_role TEXT;
  v_is_service BOOLEAN;
  v_is_admin BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- Security: service role or admin only
  v_jwt_role := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service := (
    v_jwt_role = 'service_role'
    OR current_user = 'service_role'
    OR current_user = 'postgres'
    OR session_user = 'postgres'
  );
  v_is_admin := (
    auth.uid() IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Webhook event lifecycle management is restricted to service role or administrators.'
      USING ERRCODE = '42501';
  END IF;

  IF p_success THEN
    UPDATE public.webhook_events
    SET
      status = 'completed',
      processed_at = v_now,
      last_error = NULL
    WHERE id = p_event_id;
  ELSE
    UPDATE public.webhook_events
    SET
      status = 'failed',
      last_error = p_error_message
    WHERE id = p_event_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'event_id', p_event_id,
    'final_status', CASE WHEN p_success THEN 'completed' ELSE 'failed' END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.finalize_webhook_event(UUID, BOOLEAN, TEXT) FROM PUBLIC, anon;

-- ==============================================================================
-- 3. SERVER-AUTHORITATIVE ATOMIC SETTLEMENT FUNCTION
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.settle_successful_booking_payment(
  p_booking_id UUID,
  p_transaction_reference TEXT,
  p_paid_amount_ngn NUMERIC,
  p_currency TEXT DEFAULT 'NGN',
  p_provider TEXT DEFAULT 'paystack',
  p_gateway_response JSONB DEFAULT '{}'::jsonb
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

  v_booking RECORD;
  v_room_rate NUMERIC(14,2);
  v_req_deposit BOOLEAN;
  v_prop_deposit_amount NUMERIC(14,2);
  v_host_user_id UUID;

  v_nights INTEGER;
  v_auth_room_total NUMERIC(14,2);
  v_auth_logistics_total NUMERIC(14,2);
  v_auth_damage_deposit NUMERIC(14,2);
  v_auth_total NUMERIC(14,2);

  v_partner_amount NUMERIC(14,2);
  v_reserve_amount NUMERIC(14,2);

  v_payment_id UUID;
  v_payout_id UUID;
  v_reserve_id UUID;
  v_deposit_id UUID;

  v_ledger_group_id UUID := gen_random_uuid();
  v_clean_ref TEXT;
  v_now TIMESTAMPTZ := now();

  v_existing_payout_id UUID;
  v_existing_reserve_id UUID;
BEGIN
  -- 1. Security Authorization: Service role or admin only (Ordinary browser callers strictly blocked)
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
      SELECT 1 FROM public.profiles WHERE id = v_caller_id AND role = 'admin'
    )
  );

  IF NOT v_is_service AND NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: Payment settlement is strictly restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input Validations
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'Booking ID is required.' USING ERRCODE = '22023';
  END IF;

  v_clean_ref := TRIM(p_transaction_reference);
  IF v_clean_ref IS NULL OR v_clean_ref = '' THEN
    RAISE EXCEPTION 'Transaction reference is required.' USING ERRCODE = '22023';
  END IF;

  IF p_paid_amount_ngn IS NULL OR p_paid_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'Paid amount must be strictly greater than zero.' USING ERRCODE = '22023';
  END IF;

  IF UPPER(TRIM(COALESCE(p_currency, 'NGN'))) != 'NGN' THEN
    RAISE EXCEPTION 'Invalid currency: Only NGN is supported (received "%").', p_currency
      USING ERRCODE = '22023';
  END IF;

  -- 3. Row-level Lock on Booking (FOR UPDATE - Canonical Lock Order)
  SELECT *
  INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id USING ERRCODE = '22023';
  END IF;

  -- 4. Cancellation check: A cancelled booking must NEVER be resurrected by late payment settlement
  IF v_booking.booking_status = 'cancelled' OR v_booking.booking_status = 'rejected' THEN
    RAISE EXCEPTION 'Cannot settle payment: Booking % is already cancelled or rejected.', p_booking_id
      USING ERRCODE = '22023';
  END IF;

  -- 5. Authoritative recalculation of expected pricing components from trusted records
  SELECT
    COALESCE(r.price_per_night_ngn, 0),
    COALESCE(p.requires_damage_deposit, false),
    COALESCE(p.damage_deposit_amount_ngn, 0),
    p.host_user_id
  INTO v_room_rate, v_req_deposit, v_prop_deposit_amount, v_host_user_id
  FROM public.rooms r
  JOIN public.properties p ON p.id = r.property_id
  WHERE r.id = v_booking.room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room or Property not found for booking %.', p_booking_id USING ERRCODE = '22023';
  END IF;

  -- Calculate nights
  v_nights := (v_booking.check_out::date - v_booking.check_in::date);
  IF v_nights <= 0 THEN
    v_nights := 1;
  END IF;

  v_auth_room_total := ROUND(v_nights * v_room_rate, 2);

  -- Authoritative logistics calculation
  SELECT COALESCE(SUM(price_ngn), 0)
  INTO v_auth_logistics_total
  FROM public.logistics_requests
  WHERE booking_id = v_booking.id AND status != 'cancelled';

  -- Authoritative damage deposit calculation
  IF v_req_deposit THEN
    v_auth_damage_deposit := ROUND(v_prop_deposit_amount, 2);
  ELSE
    v_auth_damage_deposit := 0;
  END IF;

  v_auth_total := v_auth_room_total + v_auth_logistics_total + v_auth_damage_deposit;

  -- 6. Verification of paid amount against authoritative total
  IF p_paid_amount_ngn < v_auth_total THEN
    RAISE EXCEPTION 'Payment amount insufficient: Received ₦%, expected authoritative total ₦%.',
      p_paid_amount_ngn, v_auth_total USING ERRCODE = '22023';
  END IF;

  -- 7. Idempotency Check: Check if booking is already settled and allocations exist
  IF v_booking.payment_status = 'paid' THEN
    SELECT id INTO v_existing_payout_id FROM public.partner_payouts WHERE booking_id = v_booking.id LIMIT 1;
    SELECT id INTO v_existing_reserve_id FROM public.guest_assurance_reserves WHERE booking_id = v_booking.id LIMIT 1;

    IF v_existing_payout_id IS NOT NULL AND v_existing_reserve_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', true,
        'already_settled', true,
        'booking_id', v_booking.id,
        'booking_reference', v_booking.booking_reference,
        'payment_status', 'paid',
        'booking_status', v_booking.booking_status,
        'total_amount_ngn', v_booking.total_amount_ngn,
        'partner_payout_id', v_existing_payout_id,
        'guest_reserve_id', v_existing_reserve_id,
        'message', 'Booking has already been settled and allocated.'
      );
    END IF;
  END IF;

  -- 8. FIN-DEC-01: 80% Partner / 20% Reserve Split calculated strictly on Accommodation Gross (pre-fees)
  -- Deterministic rounding rule: Truncate partner to 2 decimals; reserve takes the exact remainder.
  -- Guarantees: partner + reserve = v_auth_room_total with zero allocation drift.
  v_partner_amount := TRUNC(v_auth_room_total * 0.80, 2);
  v_reserve_amount := v_auth_room_total - v_partner_amount;

  -- 9. Update Booking status to confirmed and paid
  UPDATE public.bookings
  SET
    payment_status = 'paid',
    booking_status = CASE WHEN booking_status = 'pending' THEN 'confirmed' ELSE booking_status END,
    room_total_ngn = v_auth_room_total,
    logistics_total_ngn = v_auth_logistics_total,
    damage_deposit_ngn = v_auth_damage_deposit,
    total_amount_ngn = v_auth_total,
    updated_at = v_now
  WHERE id = v_booking.id;

  -- 10. Record / Update canonical Payments row
  INSERT INTO public.payments (
    booking_id,
    amount_ngn,
    currency,
    provider,
    status,
    transaction_reference,
    paid_at,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    p_paid_amount_ngn,
    'NGN',
    COALESCE(TRIM(p_provider), 'paystack'),
    'paid',
    v_clean_ref,
    v_now,
    v_now,
    v_now
  )
  ON CONFLICT (transaction_reference) DO UPDATE
  SET
    status = 'paid',
    paid_at = v_now,
    amount_ngn = EXCLUDED.amount_ngn,
    updated_at = v_now
  RETURNING id INTO v_payment_id;

  -- 11. Create Partner Payout record in 'allocated' status
  INSERT INTO public.partner_payouts (
    booking_id,
    host_user_id,
    partner_amount_ngn,
    status,
    scheduled_eligibility_at,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_host_user_id,
    v_partner_amount,
    'allocated',
    NULL,
    v_now,
    v_now
  )
  RETURNING id INTO v_payout_id;

  -- 12. Create Guest Assurance Reserve record in 'held' status
  INSERT INTO public.guest_assurance_reserves (
    booking_id,
    original_reserve_ngn,
    remaining_reserve_ngn,
    consumed_reserve_ngn,
    released_reserve_ngn,
    status,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_reserve_amount,
    v_reserve_amount,
    0,
    0,
    'held',
    v_now,
    v_now
  )
  RETURNING id INTO v_reserve_id;

  -- 13. FIN-DEC-02: Damage Deposit separate from 80/20 split
  IF v_auth_damage_deposit > 0 THEN
    INSERT INTO public.damage_deposits (
      booking_id,
      property_id,
      deposit_amount_ngn,
      retained_amount_ngn,
      refunded_amount_ngn,
      status,
      inspection_deadline,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_booking.property_id,
      v_auth_damage_deposit,
      0,
      0,
      'held',
      (v_booking.check_out::timestamp + INTERVAL '48 hours'),
      v_now,
      v_now
    )
    RETURNING id INTO v_deposit_id;
  END IF;

  -- 14. Establish Authoritative Double-Entry Financial Ledger Transactions
  -- A. Payment Received (Total inflow into gateway clearing)
  PERFORM public.record_balanced_ledger_transaction(
    v_ledger_group_id,
    v_booking.id,
    'PAYMENT_RECEIVED',
    v_clean_ref,
    'Payment received via ' || COALESCE(p_provider, 'paystack'),
    '1010 - Gateway Clearing (Paystack)',
    '2010 - Guest Unearned Revenue',
    v_auth_total
  );

  -- B. Accommodation Partner Allocation (80%)
  IF v_partner_amount > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'ACCOMMODATION_ALLOCATION',
      v_clean_ref || '-ALLOC-PARTNER',
      '80% Host partner accommodation allocation',
      '2010 - Guest Unearned Revenue',
      '2100 - Partner Payout Payable',
      v_partner_amount
    );
  END IF;

  -- C. Guest Assurance Reserve Allocation (20%)
  IF v_reserve_amount > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'RESERVE_ALLOCATION',
      v_clean_ref || '-ALLOC-RESERVE',
      '20% Platform guest assurance reserve allocation',
      '2010 - Guest Unearned Revenue',
      '2200 - Guest Assurance Reserve Held',
      v_reserve_amount
    );
  END IF;

  -- D. Logistics Service Revenue (if logistics attached)
  IF v_auth_logistics_total > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'LOGISTICS_REVENUE',
      v_clean_ref || '-LOG-REV',
      'Logistics transportation service revenue',
      '2010 - Guest Unearned Revenue',
      '4100 - Logistics Service Revenue',
      v_auth_logistics_total
    );
  END IF;

  -- E. Damage Deposit Liability (if damage deposit collected)
  IF v_auth_damage_deposit > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'DAMAGE_DEPOSIT_COLLECTED',
      v_clean_ref || '-DEP-HOLD',
      'Damage deposit escrow liability collected',
      '2010 - Guest Unearned Revenue',
      '2300 - Damage Deposit Liability',
      v_auth_damage_deposit
    );
  END IF;

  -- 15. Return authoritative settlement payload
  RETURN jsonb_build_object(
    'success', true,
    'already_settled', false,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'payment_id', v_payment_id,
    'partner_payout_id', v_payout_id,
    'guest_reserve_id', v_reserve_id,
    'damage_deposit_id', v_deposit_id,
    'payment_status', 'paid',
    'booking_status', 'confirmed',
    'room_total_ngn', v_auth_room_total,
    'partner_amount_ngn', v_partner_amount,
    'reserve_amount_ngn', v_reserve_amount,
    'logistics_total_ngn', v_auth_logistics_total,
    'damage_deposit_ngn', v_auth_damage_deposit,
    'total_amount_ngn', v_auth_total,
    'settled_at', v_now
  );
END;
$$;

-- Privileges on settlement function
REVOKE ALL ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon;

-- ==============================================================================
-- 4. UPDATE public.create_pending_booking_transaction WITH DAMAGE DEPOSIT
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_pending_booking_transaction(
  p_user_id UUID,
  p_property_id UUID,
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE,
  p_guests INTEGER,
  p_guest_name TEXT,
  p_guest_email TEXT,
  p_guest_phone TEXT,
  p_special_requests TEXT DEFAULT NULL,
  p_logistics_services JSONB DEFAULT '[]'::jsonb,
  p_booking_reference TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_property RECORD;
  v_nights INTEGER;
  v_room_total_ngn NUMERIC(14,2) := 0;
  v_logistics_total_ngn NUMERIC(14,2) := 0;
  v_damage_deposit_ngn NUMERIC(14,2) := 0;
  v_total_amount_ngn NUMERIC(14,2) := 0;
  v_booking_ref TEXT;
  v_booking_id UUID;
  v_service RECORD;
BEGIN
  -- Validate dates
  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Check-in and check-out dates are required.';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'Check-out date must be strictly after check-in date.';
  END IF;

  v_nights := (p_check_out - p_check_in);
  IF v_nights <= 0 THEN
    v_nights := 1;
  END IF;

  -- Validate guest count
  IF p_guests IS NULL OR p_guests <= 0 THEN
    RAISE EXCEPTION 'Number of guests must be at least 1.';
  END IF;

  -- Validate guest contact info
  IF p_guest_name IS NULL OR TRIM(p_guest_name) = '' THEN
    RAISE EXCEPTION 'Guest name is required.';
  END IF;

  IF p_guest_email IS NULL OR TRIM(p_guest_email) = '' THEN
    RAISE EXCEPTION 'Guest email is required.';
  END IF;

  -- Fetch and lock property
  SELECT id, requires_damage_deposit, damage_deposit_amount_ngn
  INTO v_property
  FROM public.properties
  WHERE id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected property not found.';
  END IF;

  -- Lock room row FOR UPDATE to prevent race condition over-booking
  SELECT *
  INTO v_room
  FROM public.rooms
  WHERE id = p_room_id AND property_id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected room not found.';
  END IF;

  IF v_room.available_rooms <= 0 THEN
    RAISE EXCEPTION 'This room is sold out and no longer available.';
  END IF;

  IF p_guests > COALESCE(v_room.max_guests, 10) THEN
    RAISE EXCEPTION 'Guest count exceeds maximum room capacity (% max).', v_room.max_guests;
  END IF;

  -- Authoritative accommodation total calculation
  v_room_total_ngn := v_nights * COALESCE(v_room.price_per_night_ngn, 0);

  -- Calculate logistics subtotal from trusted service items
  IF p_logistics_services IS NOT NULL AND jsonb_typeof(p_logistics_services) = 'array' THEN
    FOR v_service IN
      SELECT
        COALESCE((elem->>'price_ngn')::numeric, (elem->>'amount')::numeric, 0) AS price
      FROM jsonb_array_elements(p_logistics_services) AS elem
    LOOP
      v_logistics_total_ngn := v_logistics_total_ngn + COALESCE(v_service.price, 0);
    END LOOP;
  END IF;

  -- Authoritative damage deposit calculation
  IF v_property.requires_damage_deposit THEN
    v_damage_deposit_ngn := COALESCE(v_property.damage_deposit_amount_ngn, 0);
  ELSE
    v_damage_deposit_ngn := 0;
  END IF;

  v_total_amount_ngn := v_room_total_ngn + v_logistics_total_ngn + v_damage_deposit_ngn;

  -- Generate authoritative booking reference if empty
  IF p_booking_reference IS NULL OR TRIM(p_booking_reference) = '' THEN
    v_booking_ref := 'ARK-' || to_char(now(), 'YYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 6));
  ELSE
    v_booking_ref := TRIM(p_booking_reference);
  END IF;

  -- Decrement room inventory atomically
  UPDATE public.rooms
  SET available_rooms = available_rooms - 1,
      updated_at = now()
  WHERE id = p_room_id;

  -- Insert authoritative pending booking
  INSERT INTO public.bookings (
    user_id,
    property_id,
    room_id,
    booking_reference,
    check_in,
    check_out,
    number_of_guests,
    guest_name,
    guest_email,
    guest_phone,
    special_requests,
    booking_status,
    payment_status,
    room_total_ngn,
    logistics_total_ngn,
    damage_deposit_ngn,
    total_amount_ngn,
    created_at,
    updated_at
  ) VALUES (
    p_user_id,
    p_property_id,
    p_room_id,
    v_booking_ref,
    p_check_in,
    p_check_out,
    p_guests,
    TRIM(p_guest_name),
    LOWER(TRIM(p_guest_email)),
    TRIM(COALESCE(p_guest_phone, '')),
    p_special_requests,
    'pending',
    'unpaid',
    v_room_total_ngn,
    v_logistics_total_ngn,
    v_damage_deposit_ngn,
    v_total_amount_ngn,
    now(),
    now()
  )
  RETURNING id INTO v_booking_id;

  -- Insert associated logistics requests if any
  IF p_logistics_services IS NOT NULL AND jsonb_typeof(p_logistics_services) = 'array' THEN
    INSERT INTO public.logistics_requests (
      booking_id,
      service_type,
      price_ngn,
      status,
      created_at
    )
    SELECT
      v_booking_id,
      COALESCE(elem->>'service_type', elem->>'type', 'airport_pickup'),
      COALESCE((elem->>'price_ngn')::numeric, (elem->>'amount')::numeric, 0),
      'pending',
      now()
    FROM jsonb_array_elements(p_logistics_services) AS elem;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'booking_reference', v_booking_ref,
    'room_total_ngn', v_room_total_ngn,
    'logistics_total_ngn', v_logistics_total_ngn,
    'damage_deposit_ngn', v_damage_deposit_ngn,
    'total_amount_ngn', v_total_amount_ngn,
    'nights', v_nights,
    'available_rooms_remaining', v_room.available_rooms - 1
  );
END;
$$;
