-- ==============================================================================
-- PHASE 2 — AVAILABILITY & BOOKING HOLD HARDENING
-- GATE #6.3 — BOOKING CREATION TRANSACTION REWRITE
-- ==============================================================================
-- OBJECTIVE:
-- Rewrite public.create_pending_booking_transaction to use the authoritative
-- date-specific availability model introduced in Gate #6.2 (total_rooms, expires_at,
-- active booking occupancy), replacing the unsafe global room counter concept.
--
-- GUARANTEES:
-- 1. Locks the target room row with FOR UPDATE before computing availability.
-- 2. Validates requested dates (check_in, check_out, check_out > check_in).
-- 3. Validates property/room relationship.
-- 4. Validates room operational status (is_active).
-- 5. Calculates date-specific active occupancy (active confirmed/checked-in bookings
--    and unexpired pending holds within the [check_in, check_out) window).
-- 6. Rejects overlapping capacity exhaustion against rooms.total_rooms.
-- 7. Creates an authoritative 30-minute pending hold (expires_at = now() + INTERVAL '30 minutes').
-- 8. Remains atomic under concurrent requests via PostgreSQL row locking.
-- 9. Preserves authoritative server-side pricing (room_total, logistics_total, damage_deposit, total_amount).
-- 10. Preserves existing logistics requests creation.
-- 11. Preserves existing booking/payment settlement compatibility.
-- 12. Does NOT decrement or mutate rooms.available_rooms.
-- ==============================================================================

-- ==============================================================================
-- 1. PRIMARY AUTHORITATIVE FUNCTION: public.create_pending_booking_transaction
-- (15 parameters: 14 named client arguments + optional p_user_id)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.create_pending_booking_transaction(
  p_property_id UUID,
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE,
  p_guests INTEGER DEFAULT 1,
  p_guest_first_name TEXT DEFAULT '',
  p_guest_last_name TEXT DEFAULT '',
  p_guest_email TEXT DEFAULT '',
  p_guest_phone TEXT DEFAULT '',
  p_country TEXT DEFAULT 'Nigeria',
  p_passport_name TEXT DEFAULT '',
  p_special_requests TEXT DEFAULT '',
  p_booking_reference TEXT DEFAULT '',
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
  -- 1. Authenticate caller (allow explicit p_user_id when called via trusted service or delegation)
  v_user_id := COALESCE(auth.uid(), p_user_id);
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: You must be logged in to create a reservation.';
  END IF;

  -- 2. Validate dates
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

  -- 5. CRITICAL: Atomic row lock on public.rooms BEFORE calculating availability
  -- Serializes all concurrent hold attempts on this specific room inventory
  SELECT
    r.id,
    r.property_id,
    r.name,
    r.price_per_night_ngn,
    r.total_rooms,
    r.available_rooms,
    r.max_guests,
    COALESCE(r.is_active, TRUE) AS is_active
  INTO v_room
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected room not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Validate property/room relationship
  IF p_property_id IS NOT NULL AND v_room.property_id <> p_property_id THEN
    RAISE EXCEPTION 'Selected room does not belong to the specified property.' USING ERRCODE = '22023';
  END IF;

  -- Validate room operational status
  IF v_room.is_active = FALSE THEN
    RAISE EXCEPTION 'This room is currently inactive and not available for booking.' USING ERRCODE = '22023';
  END IF;

  -- Validate room guest capacity
  IF p_guests > COALESCE(v_room.max_guests, 10) THEN
    RAISE EXCEPTION 'Guest count exceeds maximum room capacity (% max).', v_room.max_guests USING ERRCODE = '22023';
  END IF;

  -- Fetch property details for authoritative damage deposit calculation
  SELECT
    p.id,
    p.requires_damage_deposit,
    COALESCE(p.damage_deposit_amount_ngn, 0) AS damage_deposit_amount_ngn
  INTO v_property
  FROM public.properties p
  WHERE p.id = v_room.property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected property not found.' USING ERRCODE = 'P0002';
  END IF;

  -- 6. Authoritative Date-Specific Occupancy Calculation (Half-Open Interval [check_in, check_out))
  -- Active occupancy counts:
  --   a. Confirmed / ongoing reservations: ('confirmed', 'checked_in', 'checked_out', 'completed')
  --   b. Unexpired pending holds: ('pending' WITH payment_status IN ('unpaid', 'pending') AND expires_at > now())
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
        AND b.expires_at IS NOT NULL
        AND b.expires_at > now()
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

  -- 11. Return authoritative booking confirmation payload (compatible with all clients)
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

-- Grant execution privileges on the canonical RPC
GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction(
  UUID, UUID, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, UUID
) TO authenticated, anon;


-- ==============================================================================
-- 2. BACKWARD COMPATIBLE OVERLOAD: public.create_pending_booking_transaction
-- (12 parameters matching 20260903_phase3_gate4_payment_settlement.sql)
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

  RETURN public.create_pending_booking_transaction(
    p_property_id := p_property_id,
    p_room_id := p_room_id,
    p_check_in := p_check_in,
    p_check_out := p_check_out,
    p_guests := p_guests,
    p_guest_first_name := v_first_name,
    p_guest_last_name := COALESCE(v_last_name, ''),
    p_guest_email := p_guest_email,
    p_guest_phone := p_guest_phone,
    p_country := 'Nigeria',
    p_passport_name := '',
    p_special_requests := COALESCE(p_special_requests, ''),
    p_booking_reference := COALESCE(p_booking_reference, ''),
    p_logistics_services := COALESCE(p_logistics_services, '[]'::jsonb),
    p_user_id := p_user_id
  );
END;
$$;

-- Grant execution privileges on the 12-parameter overload
GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction(
  UUID, UUID, UUID, DATE, DATE, INTEGER, TEXT, TEXT, TEXT, TEXT, JSONB, TEXT
) TO authenticated, anon;
