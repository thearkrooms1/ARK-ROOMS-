-- ==============================================================================
-- PHASE 3 — GATE #6.3: DATE-SPECIFIC BOOKING CREATION + 30-MINUTE HOLD
--
-- Authoritative Business Model Alignment:
-- 1. Date-specific availability: rooms.total_rooms + active overlapping bookings + pending hold expiration.
-- 2. Concurrency Safety: Atomic row lock (SELECT ... FOR UPDATE) on public.rooms.
-- 3. 30-Minute Hold: expires_at = now() + INTERVAL '30 minutes' generated authoritatively.
-- 4. available_rooms column is NEVER decremented, incremented, or relied upon for booking decisions.
-- 5. Full financial conservation alignment with Phase 3 Gate #5.3 (zero commission exposed to guest).
-- 6. Payment settlement compatibility: expired pending bookings cannot be settled.
-- ==============================================================================

-- 1. CANONICAL 15-PARAMETER RPC: public.create_pending_booking_transaction
CREATE OR REPLACE FUNCTION public.create_pending_booking_transaction(
  p_property_id UUID,
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE,
  p_guests INTEGER,
  p_guest_first_name TEXT,
  p_guest_last_name TEXT,
  p_guest_email TEXT,
  p_guest_phone TEXT,
  p_country TEXT DEFAULT 'Nigeria',
  p_passport_name TEXT DEFAULT '',
  p_special_requests TEXT DEFAULT '',
  p_booking_reference TEXT DEFAULT NULL,
  p_logistics_services JSONB DEFAULT '[]'::jsonb,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_user_id UUID;
  v_room RECORD;
  v_property RECORD;
  v_nights INTEGER;
  v_active_bookings INTEGER := 0;
  v_expires_at TIMESTAMPTZ;
  v_guest_name TEXT;
  v_room_total_ngn NUMERIC(14,2) := 0;
  v_logistics_total_ngn NUMERIC(14,2) := 0;
  v_damage_deposit_ngn NUMERIC(14,2) := 0;
  v_total_amount_ngn NUMERIC(14,2) := 0;
  v_booking_ref TEXT;
  v_booking_id UUID;
  v_service RECORD;
BEGIN
  -- 1. Authenticate caller (allow explicit p_user_id when called via trusted service/delegation)
  v_user_id := COALESCE(auth.uid(), p_user_id);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: You must be logged in to create a reservation.' USING ERRCODE = '42501';
  END IF;

  -- 2. Validate dates (non-null, check_out strictly after check_in)
  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Check-in and check-out dates are required.' USING ERRCODE = '22023';
  END IF;

  IF p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'Invalid reservation dates: Check-out must be strictly after check-in.' USING ERRCODE = '22023';
  END IF;

  v_nights := (p_check_out - p_check_in);
  IF v_nights <= 0 THEN
    v_nights := 1;
  END IF;

  -- 3. Validate guest count
  IF p_guests IS NULL OR p_guests <= 0 THEN
    RAISE EXCEPTION 'Number of guests must be at least 1.' USING ERRCODE = '22023';
  END IF;

  -- 4. Validate guest contact information
  v_guest_name := TRIM(COALESCE(p_guest_first_name, '') || ' ' || COALESCE(p_guest_last_name, ''));
  IF v_guest_name = '' THEN
    RAISE EXCEPTION 'Guest name is required.' USING ERRCODE = '22023';
  END IF;

  IF p_guest_email IS NULL OR TRIM(p_guest_email) = '' THEN
    RAISE EXCEPTION 'Guest email is required.' USING ERRCODE = '22023';
  END IF;

  IF p_guest_phone IS NULL OR TRIM(p_guest_phone) = '' THEN
    RAISE EXCEPTION 'Guest phone is required.' USING ERRCODE = '22023';
  END IF;

  -- 5. CRITICAL: Atomic row lock on public.rooms BEFORE calculating date-specific availability
  -- Serializes all concurrent hold attempts on this specific room inventory
  SELECT
    r.id,
    r.property_id,
    r.name,
    r.price_per_night_ngn,
    r.total_rooms,
    r.available_rooms,
    r.max_guests,
    COALESCE(r.is_active, TRUE) AS is_active,
    COALESCE(r.status, 'active') AS status
  INTO v_room
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected room not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Validate property/room foreign key relationship
  IF p_property_id IS NOT NULL AND v_room.property_id <> p_property_id THEN
    RAISE EXCEPTION 'Selected room does not belong to the specified property.' USING ERRCODE = '22023';
  END IF;

  -- Validate room operational status (inactive or under maintenance cannot be booked)
  IF v_room.is_active = FALSE OR LOWER(v_room.status) IN ('inactive', 'maintenance', 'out_of_service', 'sold_out') THEN
    RAISE EXCEPTION 'This room is currently inactive or under maintenance and not available for booking.' USING ERRCODE = '22023';
  END IF;

  -- Validate room guest capacity against physical room max_guests
  IF p_guests > COALESCE(v_room.max_guests, 10) THEN
    RAISE EXCEPTION 'Guest count exceeds maximum room capacity (% max).', v_room.max_guests USING ERRCODE = '22023';
  END IF;

  -- Fetch property details for authoritative damage deposit calculation
  SELECT
    p.id,
    COALESCE(p.requires_damage_deposit, FALSE) AS requires_damage_deposit,
    COALESCE(p.damage_deposit_amount_ngn, p.damage_deposit_ngn, 0) AS damage_deposit_amount_ngn
  INTO v_property
  FROM public.properties p
  WHERE p.id = v_room.property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected property not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Authoritative Date-Specific Occupancy Calculation (Half-Open Interval [check_in, check_out))
  -- Active occupancy counts:
  --   a. Confirmed / ongoing reservations: ('confirmed', 'checked_in', 'checked_out', 'completed')
  --   b. Unexpired pending holds: ('pending' WITH payment_status IN ('unpaid', 'pending') AND (expires_at IS NULL OR expires_at > now()))
  -- Cancelled, rejected, refunded, and expired pending holds (expires_at <= now()) NEVER consume capacity.
  SELECT COUNT(*)::INTEGER
  INTO v_active_bookings
  FROM public.bookings b
  WHERE b.room_id = p_room_id
    AND b.check_in < p_check_out
    AND b.check_out > p_check_in
    AND (
      b.booking_status IN ('confirmed', 'checked_in', 'checked_out', 'completed')
      OR (
        b.booking_status = 'pending'
        AND COALESCE(b.payment_status, 'unpaid') IN ('unpaid', 'pending')
        AND (b.expires_at IS NULL OR b.expires_at > now())
      )
    );

  -- Reject overlapping capacity exhaustion against total_rooms
  IF v_active_bookings >= v_room.total_rooms THEN
    RAISE EXCEPTION 'This room is sold out and no longer available for the selected dates.' USING ERRCODE = '22023';
  END IF;

  -- 7. Authoritative Server-Side Pricing Calculation
  -- Accommodation subtotal
  v_room_total_ngn := v_nights * COALESCE(v_room.price_per_night_ngn, 0);

  -- Logistics subtotal
  IF p_logistics_services IS NOT NULL AND jsonb_typeof(p_logistics_services) = 'array' THEN
    FOR v_service IN
      SELECT
        COALESCE((elem->>'price_ngn')::numeric, (elem->>'priceNGN')::numeric, (elem->>'amount')::numeric, 0) AS price
      FROM jsonb_array_elements(p_logistics_services) AS elem
    LOOP
      v_logistics_total_ngn := v_logistics_total_ngn + COALESCE(v_service.price, 0);
    END LOOP;
  END IF;

  -- Damage deposit
  IF v_property.requires_damage_deposit THEN
    v_damage_deposit_ngn := COALESCE(v_property.damage_deposit_amount_ngn, 0);
  ELSE
    v_damage_deposit_ngn := 0;
  END IF;

  -- Authoritative grand total
  v_total_amount_ngn := v_room_total_ngn + v_logistics_total_ngn + v_damage_deposit_ngn;

  -- 8. Establish 30-minute pending hold timestamp
  v_expires_at := now() + INTERVAL '30 minutes';

  -- Generate authoritative booking reference if not provided
  IF p_booking_reference IS NULL OR TRIM(p_booking_reference) = '' THEN
    v_booking_ref := 'ARK-' || to_char(now(), 'YYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text FROM 1 FOR 6));
  ELSE
    v_booking_ref := TRIM(p_booking_reference);
  END IF;

  -- 9. Insert Authoritative Pending Booking with 30-minute hold
  -- NOTE: rooms.available_rooms is deliberately NOT decremented or mutated.
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
    expires_at,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    v_room.property_id,
    p_room_id,
    v_booking_ref,
    p_check_in,
    p_check_out,
    p_guests,
    v_guest_name,
    LOWER(TRIM(p_guest_email)),
    TRIM(COALESCE(p_guest_phone, '')),
    p_special_requests,
    'pending',
    'unpaid',
    v_room_total_ngn,
    v_logistics_total_ngn,
    v_damage_deposit_ngn,
    v_total_amount_ngn,
    v_expires_at,
    now(),
    now()
  )
  RETURNING id INTO v_booking_id;

  -- 10. Insert associated logistics requests if present
  IF p_logistics_services IS NOT NULL AND jsonb_typeof(p_logistics_services) = 'array' AND jsonb_array_length(p_logistics_services) > 0 THEN
    INSERT INTO public.logistics_requests (
      booking_id,
      user_id,
      service_type,
      service_name,
      price_ngn,
      amount,
      vehicle_preference,
      flight_number,
      pickup_date,
      pickup_time,
      pickup_location,
      dropoff_location,
      passengers,
      status,
      notes
    )
    SELECT
      v_booking_id,
      v_user_id,
      COALESCE(elem->>'service_type', elem->>'serviceType', elem->>'type', 'airport_pickup'),
      COALESCE(elem->>'service_name', elem->>'serviceName', elem->>'title', 'Executive Logistics Service'),
      COALESCE((elem->>'price_ngn')::numeric, (elem->>'priceNGN')::numeric, (elem->>'amount')::numeric, 0),
      COALESCE((elem->>'amount')::numeric, (elem->>'price_ngn')::numeric, (elem->>'priceNGN')::numeric, 0),
      COALESCE(elem->>'vehicle_preference', elem->>'vehiclePreference', 'Executive Sedan'),
      elem->>'flight_number',
      COALESCE((elem->>'pickup_date')::date, (elem->>'arrival_date')::date, p_check_in),
      COALESCE(elem->>'pickup_time', elem->>'arrival_time', '12:00'),
      COALESCE(elem->>'pickup_location', elem->>'airport', 'Nnamdi Azikiwe International Airport (ABV)'),
      COALESCE(elem->>'dropoff_location', 'Event Venue Stay'),
      COALESCE((elem->>'passengers')::integer, p_guests),
      'pending',
      elem->>'notes'
    FROM jsonb_array_elements(p_logistics_services) AS elem;
  END IF;

  -- 11. Return authoritative booking confirmation payload
  -- CRITICAL: Zero commission fields exposed to guest (maintains Gate #5.3 privacy)
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'booking_reference', v_booking_ref,
    'property_id', v_room.property_id,
    'room_id', p_room_id,
    'user_id', v_user_id,
    'check_in', p_check_in,
    'check_out', p_check_out,
    'nights', v_nights,
    'room_total_ngn', v_room_total_ngn,
    'logistics_total_ngn', v_logistics_total_ngn,
    'damage_deposit_ngn', v_damage_deposit_ngn,
    'total_amount_ngn', v_total_amount_ngn,
    'available_rooms_remaining', GREATEST(0, v_room.total_rooms - v_active_bookings - 1),
    'expires_at', v_expires_at,
    'booking', jsonb_build_object(
      'id', v_booking_id,
      'booking_reference', v_booking_ref,
      'property_id', v_room.property_id,
      'room_id', p_room_id,
      'user_id', v_user_id,
      'check_in', p_check_in,
      'check_out', p_check_out,
      'booking_status', 'pending',
      'payment_status', 'unpaid',
      'room_total_ngn', v_room_total_ngn,
      'logistics_total_ngn', v_logistics_total_ngn,
      'damage_deposit_ngn', v_damage_deposit_ngn,
      'total_amount_ngn', v_total_amount_ngn,
      'expires_at', v_expires_at,
      'created_at', now()
    )
  );
END;
$$;

-- Grant execution privileges on the canonical 15-parameter RPC
GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction(
  UUID, UUID, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID
) TO authenticated, anon;


-- ==============================================================================
-- 2. BACKWARD COMPATIBLE OVERLOAD: public.create_pending_booking_transaction
-- (12 parameters matching older caller interfaces)
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
  v_first_name TEXT;
  v_last_name TEXT;
BEGIN
  v_first_name := split_part(COALESCE(p_guest_name, ''), ' ', 1);
  v_last_name := NULLIF(TRIM(SUBSTRING(COALESCE(p_guest_name, '') FROM LENGTH(v_first_name) + 1)), '');
  IF v_last_name IS NULL OR v_last_name = '' THEN
    v_last_name := v_first_name;
  END IF;

  RETURN public.create_pending_booking_transaction(
    p_property_id := p_property_id,
    p_room_id := p_room_id,
    p_check_in := p_check_in,
    p_check_out := p_check_out,
    p_guests := p_guests,
    p_guest_first_name := v_first_name,
    p_guest_last_name := v_last_name,
    p_guest_email := p_guest_email,
    p_guest_phone := p_guest_phone,
    p_country := 'Nigeria',
    p_passport_name := '',
    p_special_requests := COALESCE(p_special_requests, ''),
    p_booking_reference := p_booking_reference,
    p_logistics_services := p_logistics_services,
    p_user_id := p_user_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction(
  UUID, UUID, UUID, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT
) TO authenticated, anon;


-- ==============================================================================
-- 3. PAYMENT SETTLEMENT COMPATIBILITY GUARD: public.settle_successful_booking_payment
-- Enforces that expired pending holds and cancelled bookings cannot be settled.
-- Preserves Gate #5.3 Three-Party Settlement and Commission Model.
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
  v_booking RECORD;
  v_room RECORD;
  v_property RECORD;
  v_nights INTEGER;
  v_auth_room_total NUMERIC(14,2);
  v_auth_logistics_total NUMERIC(14,2) := 0;
  v_auth_damage_deposit NUMERIC(14,2) := 0;
  v_auth_total NUMERIC(14,2);
  v_host_commission_rate NUMERIC(5,2);
  v_host_profile_id UUID;
  v_host_user_id UUID;
  v_ark_accommodation_commission NUMERIC(14,2);
  v_host_net_settlement NUMERIC(14,2);
  v_logistics_commission_rate NUMERIC(5,2) := 10.00;
  v_ark_logistics_commission NUMERIC(14,2) := 0;
  v_provider_net_settlement NUMERIC(14,2) := 0;
  v_logistics_provider_id UUID;
  v_total_allocated NUMERIC(14,2);
  v_clean_ref TEXT;
  v_now TIMESTAMPTZ := now();
  v_payment_id UUID;
  v_accommodation_payout_id UUID;
  v_logistics_payout_id UUID;
  v_deposit_id UUID;
  v_ledger_group_id UUID := gen_random_uuid();
BEGIN
  -- 1. Input Validation
  IF p_booking_id IS NULL THEN
    RAISE EXCEPTION 'p_booking_id is required' USING ERRCODE = '22023';
  END IF;

  v_clean_ref := TRIM(p_transaction_reference);
  IF v_clean_ref IS NULL OR v_clean_ref = '' THEN
    RAISE EXCEPTION 'p_transaction_reference is required' USING ERRCODE = '22023';
  END IF;

  IF p_paid_amount_ngn IS NULL OR p_paid_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'p_paid_amount_ngn must be strictly greater than zero' USING ERRCODE = '22023';
  END IF;

  IF UPPER(COALESCE(TRIM(p_currency), 'NGN')) != 'NGN' THEN
    RAISE EXCEPTION 'Only NGN currency is supported (received: %)', p_currency USING ERRCODE = '22023';
  END IF;

  -- 2. Lock and retrieve authoritative booking
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking with id % does not exist', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. Retrieve and lock Room record
  SELECT * INTO v_room
  FROM public.rooms
  WHERE id = v_booking.room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated room % does not exist', v_booking.room_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. Retrieve Property record (with Host Profile and negotiated commission)
  SELECT prop.*, hp.id AS host_profile_id, hp.user_id AS host_profile_user_id,
         COALESCE(hp.commission_rate_percentage, 10.00) AS host_comm_rate
  INTO v_property
  FROM public.properties prop
  LEFT JOIN public.host_profiles hp ON prop.host_id = hp.id
  WHERE prop.id = v_booking.property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Associated property % does not exist', v_booking.property_id USING ERRCODE = 'P0002';
  END IF;

  v_host_profile_id := v_property.host_profile_id;
  v_host_user_id := v_property.host_profile_user_id;
  v_host_commission_rate := GREATEST(10.00, LEAST(15.00, COALESCE(v_property.host_comm_rate, 10.00)));

  -- 5. Calculate authoritative pricing
  v_nights := GREATEST(1, (v_booking.check_out::date - v_booking.check_in::date));
  v_auth_room_total := ROUND(v_room.price_per_night_ngn * v_nights, 2);

  -- Authoritative logistics total
  SELECT COALESCE(SUM(lr.amount), 0) INTO v_auth_logistics_total
  FROM public.logistics_requests lr
  WHERE lr.booking_id = v_booking.id AND lr.status != 'cancelled';

  IF v_auth_logistics_total = 0 AND COALESCE(v_booking.logistics_total_ngn, 0) > 0 THEN
    v_auth_logistics_total := ROUND(v_booking.logistics_total_ngn, 2);
  END IF;

  -- Authoritative damage deposit
  v_auth_damage_deposit := ROUND(COALESCE(v_property.damage_deposit_ngn, v_booking.damage_deposit_ngn, 0), 2);

  -- Guest Total = Accommodation Gross + Car Service Gross + Damage Deposit
  -- The guest does NOT pay a separate visible platform commission
  v_auth_total := v_auth_room_total + v_auth_logistics_total + v_auth_damage_deposit;

  -- 6. Reject Underpayment
  IF ROUND(p_paid_amount_ngn, 2) < v_auth_total THEN
    RAISE EXCEPTION 'Underpayment detected: paid % NGN, authoritative total is % NGN',
      ROUND(p_paid_amount_ngn, 2), v_auth_total USING ERRCODE = '22023';
  END IF;

  -- 7. Idempotency Check: Booking already settled
  IF v_booking.payment_status = 'paid' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_settled', true,
      'booking_id', v_booking.id,
      'booking_reference', v_booking.booking_reference,
      'payment_status', 'paid',
      'booking_status', v_booking.booking_status,
      'total_amount_ngn', v_booking.total_amount_ngn,
      'message', 'Booking has already been settled and allocated.'
    );
  END IF;

  -- GATE #6.3 COMPATIBILITY GUARD:
  -- Reject settlement of cancelled, rejected, or expired pending holds
  IF v_booking.booking_status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot settle booking with status %', v_booking.booking_status USING ERRCODE = '22023';
  END IF;

  IF v_booking.booking_status = 'pending' AND v_booking.expires_at IS NOT NULL AND v_booking.expires_at <= v_now THEN
    RAISE EXCEPTION 'Cannot settle expired pending booking (hold expired at %)', v_booking.expires_at USING ERRCODE = '22023';
  END IF;

  -- 8. AUTHORITATIVE THREE-PARTY COMMISSION DEDUCTIONS:
  -- Accommodation: TheArk Rooms deducts negotiated rate (10.00% - 15.00%) from gross
  v_ark_accommodation_commission := TRUNC(v_auth_room_total * (v_host_commission_rate / 100.0), 2);
  v_host_net_settlement := v_auth_room_total - v_ark_accommodation_commission;

  -- Logistics: TheArk Rooms deducts exactly 10.00% from car-service gross
  IF v_auth_logistics_total > 0 THEN
    v_ark_logistics_commission := TRUNC(v_auth_logistics_total * 0.10, 2);
    v_provider_net_settlement := v_auth_logistics_total - v_ark_logistics_commission;

    -- Lookup active logistics provider
    SELECT id INTO v_logistics_provider_id
    FROM public.logistics_providers
    WHERE provider_status = 'active'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_logistics_provider_id IS NULL THEN
      v_logistics_provider_id := '70000000-0000-4000-8000-000000000001'::UUID;
    END IF;
  END IF;

  -- 9. Conservation of Funds Verification
  v_total_allocated := v_host_net_settlement + v_ark_accommodation_commission +
                       v_provider_net_settlement + v_ark_logistics_commission +
                       v_auth_damage_deposit;

  IF v_total_allocated != v_auth_total THEN
    RAISE EXCEPTION 'Internal accounting drift: sum of allocations (%) != authoritative total (%)',
      v_total_allocated, v_auth_total USING ERRCODE = 'P0001';
  END IF;

  -- 10. Update Booking record
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

  -- 11. Insert or update public.payments record
  INSERT INTO public.payments (
    booking_id,
    user_id,
    amount_ngn,
    amount,
    currency,
    payment_method,
    payment_status,
    status,
    transaction_reference,
    payment_reference,
    paystack_reference,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_booking.user_id,
    v_auth_total,
    v_auth_total,
    'NGN',
    p_provider,
    'completed',
    'completed',
    v_clean_ref,
    v_clean_ref,
    v_clean_ref,
    v_now,
    v_now
  )
  ON CONFLICT (transaction_reference) DO UPDATE
  SET
    payment_status = 'completed',
    status = 'completed',
    updated_at = v_now
  RETURNING id INTO v_payment_id;

  -- 12. Create Host Payout record (partner_payouts) for accommodation
  INSERT INTO public.partner_payouts (
    booking_id,
    host_id,
    partner_type,
    partner_id,
    gross_amount_ngn,
    commission_rate_percentage,
    commission_amount_ngn,
    partner_amount_ngn,
    amount_ngn,
    currency,
    status,
    payout_status,
    scheduled_eligibility_at,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_property.host_id,
    'host',
    COALESCE(v_host_profile_id, v_property.host_id),
    v_auth_room_total,
    v_host_commission_rate,
    v_ark_accommodation_commission,
    v_host_net_settlement,
    v_host_net_settlement,
    'NGN',
    'allocated',
    'allocated',
    v_booking.check_in::timestamptz + INTERVAL '18 hours',
    v_now,
    v_now
  )
  ON CONFLICT (booking_id, partner_type) DO UPDATE
  SET
    gross_amount_ngn = v_auth_room_total,
    commission_rate_percentage = v_host_commission_rate,
    commission_amount_ngn = v_ark_accommodation_commission,
    partner_amount_ngn = v_host_net_settlement,
    amount_ngn = v_host_net_settlement,
    updated_at = v_now
  RETURNING id INTO v_accommodation_payout_id;

  -- 13. Create Logistics Provider Payout record if logistics service included
  IF v_auth_logistics_total > 0 THEN
    INSERT INTO public.partner_payouts (
      booking_id,
      host_id,
      partner_type,
      partner_id,
      gross_amount_ngn,
      commission_rate_percentage,
      commission_amount_ngn,
      partner_amount_ngn,
      amount_ngn,
      currency,
      status,
      payout_status,
      scheduled_eligibility_at,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      NULL,
      'logistics_provider',
      v_logistics_provider_id,
      v_auth_logistics_total,
      v_logistics_commission_rate,
      v_ark_logistics_commission,
      v_provider_net_settlement,
      v_provider_net_settlement,
      'NGN',
      'allocated',
      'allocated',
      v_booking.check_in::timestamptz + INTERVAL '6 hours',
      v_now,
      v_now
    )
    ON CONFLICT (booking_id, partner_type) DO UPDATE
    SET
      gross_amount_ngn = v_auth_logistics_total,
      commission_rate_percentage = v_logistics_commission_rate,
      commission_amount_ngn = v_ark_logistics_commission,
      partner_amount_ngn = v_provider_net_settlement,
      amount_ngn = v_provider_net_settlement,
      updated_at = v_now
    RETURNING id INTO v_logistics_payout_id;
  END IF;

  -- 14. Create Damage Deposit record if applicable
  IF v_auth_damage_deposit > 0 THEN
    INSERT INTO public.damage_deposits (
      booking_id,
      user_id,
      property_id,
      amount_ngn,
      deposit_status,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_booking.user_id,
      v_booking.property_id,
      v_auth_damage_deposit,
      'held',
      v_now,
      v_now
    )
    ON CONFLICT (booking_id) DO UPDATE
    SET
      amount_ngn = v_auth_damage_deposit,
      deposit_status = 'held',
      updated_at = v_now
    RETURNING id INTO v_deposit_id;
  END IF;

  -- 15. POST DOUBLE-ENTRY BALANCED LEDGER ENTRIES
  -- Entry 1: Payment Clearing (Total paid debited to Gateway Clearing 1010, credited to Guest Inbound Clearing 2010)
  INSERT INTO public.financial_ledger (
    transaction_group_id,
    booking_id,
    transaction_type,
    debit_account,
    credit_account,
    amount_ngn,
    currency,
    reference,
    notes,
    created_at
  ) VALUES (
    v_ledger_group_id,
    v_booking.id,
    'GUEST_PAYMENT_CLEARING',
    '1010', -- Gateway Clearing Asset
    '2010', -- Guest Inbound Clearing Liability
    v_auth_total,
    'NGN',
    v_clean_ref,
    'Guest gross payment clearing for booking ' || v_booking.booking_reference,
    v_now
  );

  -- Entry 2: Accommodation Split Allocation
  INSERT INTO public.financial_ledger (
    transaction_group_id,
    booking_id,
    transaction_type,
    debit_account,
    credit_account,
    amount_ngn,
    currency,
    reference,
    notes,
    created_at
  ) VALUES
  (
    v_ledger_group_id,
    v_booking.id,
    'HOST_PAYOUT_ALLOCATION',
    '2010', -- Guest Inbound Clearing
    '2100', -- Host Payout Payable Liability
    v_host_net_settlement,
    'NGN',
    v_clean_ref || '-HOST-NET',
    'Host net accommodation settlement allocation',
    v_now
  ),
  (
    v_ledger_group_id,
    v_booking.id,
    'ACCOMMODATION_COMMISSION',
    '2010', -- Guest Inbound Clearing
    '4010', -- Accommodation Commission Revenue
    v_ark_accommodation_commission,
    'NGN',
    v_clean_ref || '-ARK-COMM',
    'TheArk Rooms accommodation commission deduction (' || v_host_commission_rate || '%)',
    v_now
  );

  -- Entry 3: Logistics Split Allocation (if applicable)
  IF v_auth_logistics_total > 0 THEN
    INSERT INTO public.financial_ledger (
      transaction_group_id,
      booking_id,
      transaction_type,
      debit_account,
      credit_account,
      amount_ngn,
      currency,
      reference,
      notes,
      created_at
    ) VALUES
    (
      v_ledger_group_id,
      v_booking.id,
      'LOGISTICS_PAYOUT_ALLOCATION',
      '2010', -- Guest Inbound Clearing
      '2110', -- Logistics Provider Payout Payable Liability
      v_provider_net_settlement,
      'NGN',
      v_clean_ref || '-LOG-NET',
      'Logistics provider net settlement allocation',
      v_now
    ),
    (
      v_ledger_group_id,
      v_booking.id,
      'LOGISTICS_COMMISSION',
      '2010', -- Guest Inbound Clearing
      '4020', -- Logistics Commission Revenue
      v_ark_logistics_commission,
      'NGN',
      v_clean_ref || '-ARK-LOG-COMM',
      'TheArk Rooms logistics commission deduction (10.00%)',
      v_now
    );
  END IF;

  -- Entry 4: Damage Deposit Allocation (if applicable)
  IF v_auth_damage_deposit > 0 THEN
    INSERT INTO public.financial_ledger (
      transaction_group_id,
      booking_id,
      transaction_type,
      debit_account,
      credit_account,
      amount_ngn,
      currency,
      reference,
      notes,
      created_at
    ) VALUES (
      v_ledger_group_id,
      v_booking.id,
      'DAMAGE_DEPOSIT_HELD',
      '2010', -- Guest Inbound Clearing
      '2300', -- Damage Deposit Held Liability
      v_auth_damage_deposit,
      'NGN',
      v_clean_ref || '-DEP',
      'Damage deposit hold for booking ' || v_booking.booking_reference,
      v_now
    );
  END IF;

  -- 16. Return authoritative settlement confirmation payload
  -- CRITICAL: Partner commissions and net settlements are NOT exposed in guest receipt
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'payment_status', 'paid',
    'booking_status', 'confirmed',
    'room_total_ngn', v_auth_room_total,
    'logistics_total_ngn', v_auth_logistics_total,
    'damage_deposit_ngn', v_auth_damage_deposit,
    'total_amount_ngn', v_auth_total,
    'settled_at', v_now
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_successful_booking_payment(
  UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB
) TO service_role, authenticated;
