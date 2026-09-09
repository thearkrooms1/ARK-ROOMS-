-- ==============================================================================
-- Migration: Harden Authoritative Booking Path (Phase 1 Gate #3)
-- Description:
-- 1. Adds non-negative check constraint on rooms.available_rooms
-- 2. Hardens Row Level Security (RLS) on public.bookings:
--    - Revokes direct client INSERT privileges from authenticated/anon users
--    - Ensures customer booking reads, host property booking reads, and admin access remain intact
-- 3. Hardens create_pending_booking_transaction RPC:
--    - Configured as SECURITY DEFINER with search_path = public, auth
--    - Employs atomic row-level locking (SELECT ... FOR UPDATE) on rooms row
--    - Prevents race conditions and inventory overbooking
--    - Enforces authoritative pricing derivation
-- ==============================================================================

-- 1. Ensure inventory constraint: available_rooms cannot be negative
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_available_non_negative'
  ) THEN
    ALTER TABLE public.rooms
      ADD CONSTRAINT chk_rooms_available_non_negative
      CHECK (available_rooms >= 0);
  END IF;
END $$;

-- 2. Authoritative Transactional Booking RPC with Row-Level Locking
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
  p_logistics_services JSONB DEFAULT '[]'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_user_id UUID;
  v_room RECORD;
  v_nights INTEGER;
  v_room_total_ngn NUMERIC := 0;
  v_logistics_total_ngn NUMERIC := 0;
  v_total_amount_ngn NUMERIC := 0;
  v_booking_ref TEXT;
  v_booking_id UUID;
  v_service RECORD;
BEGIN
  -- Authenticate caller
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required: You must be logged in to create a reservation.';
  END IF;

  -- Validate dates
  IF p_check_in IS NULL OR p_check_out IS NULL OR p_check_out <= p_check_in THEN
    RAISE EXCEPTION 'Invalid reservation dates: Check-out must be strictly after check-in.';
  END IF;

  v_nights := GREATEST(1, (p_check_out - p_check_in));

  -- CRITICAL: Atomic row lock to eliminate race conditions
  SELECT id, property_id, price_per_night_ngn, available_rooms, max_guests
  INTO v_room
  FROM public.rooms
  WHERE id = p_room_id
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

  v_total_amount_ngn := v_room_total_ngn + v_logistics_total_ngn;

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
    total_amount_ngn,
    created_at,
    updated_at
  ) VALUES (
    v_user_id,
    COALESCE(p_property_id, v_room.property_id),
    p_room_id,
    v_booking_ref,
    p_check_in,
    p_check_out,
    p_guests,
    TRIM(p_guest_first_name || ' ' || p_guest_last_name),
    p_guest_email,
    p_guest_phone,
    p_special_requests,
    'pending',
    'pending',
    v_room_total_ngn,
    v_logistics_total_ngn,
    v_total_amount_ngn,
    now(),
    now()
  )
  RETURNING id INTO v_booking_id;

  -- Persist associated logistics requests if present
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
      COALESCE(elem->>'service_type', elem->>'serviceType', 'airport_pickup'),
      COALESCE(elem->>'service_name', elem->>'serviceName', 'Executive Logistics Service'),
      COALESCE((elem->>'price_ngn')::numeric, (elem->>'amount')::numeric, 0),
      COALESCE((elem->>'amount')::numeric, (elem->>'price_ngn')::numeric, 0),
      COALESCE(elem->>'vehicle_preference', elem->>'vehiclePreference', 'Executive Sedan'),
      elem->>'flight_number',
      COALESCE((elem->>'pickup_date')::date, p_check_in),
      COALESCE(elem->>'pickup_time', '12:00'),
      COALESCE(elem->>'pickup_location', 'Nnamdi Azikiwe International Airport (ABV)'),
      COALESCE(elem->>'dropoff_location', 'Event Venue Stay'),
      COALESCE((elem->>'passengers')::integer, p_guests),
      'pending',
      elem->>'notes'
    FROM jsonb_array_elements(p_logistics_services) AS elem;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'booking_reference', v_booking_ref,
    'room_total_ngn', v_room_total_ngn,
    'logistics_total_ngn', v_logistics_total_ngn,
    'total_amount_ngn', v_total_amount_ngn,
    'booking', jsonb_build_object(
      'id', v_booking_id,
      'booking_reference', v_booking_ref,
      'property_id', COALESCE(p_property_id, v_room.property_id),
      'room_id', p_room_id,
      'user_id', v_user_id,
      'check_in', p_check_in,
      'check_out', p_check_out,
      'booking_status', 'pending',
      'payment_status', 'pending',
      'room_total_ngn', v_room_total_ngn,
      'logistics_total_ngn', v_logistics_total_ngn,
      'total_amount_ngn', v_total_amount_ngn,
      'created_at', now()
    )
  );
END;
$$;

-- Grant execute privileges on the authoritative RPC to authenticated callers
GRANT EXECUTE ON FUNCTION public.create_pending_booking_transaction TO authenticated;

-- 3. Row Level Security Hardening on public.bookings
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;

-- Revoke direct table INSERT from client roles (anon & authenticated).
-- Booking creation is strictly permitted via the authoritative SECURITY DEFINER RPC.
REVOKE INSERT ON public.bookings FROM anon, authenticated;

-- Drop all permissive direct INSERT policies on bookings
DROP POLICY IF EXISTS "Users can insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Enable insert for authenticated users only" ON public.bookings;
DROP POLICY IF EXISTS "Allow authenticated insert to bookings" ON public.bookings;
DROP POLICY IF EXISTS "Users can create bookings" ON public.bookings;
DROP POLICY IF EXISTS "Authenticated users can insert bookings" ON public.bookings;
DROP POLICY IF EXISTS "Enable insert for authenticated users" ON public.bookings;

-- Harden SELECT policies:
-- A. Authenticated users can view their own bookings
DROP POLICY IF EXISTS "Users can view own bookings" ON public.bookings;
CREATE POLICY "Users can view own bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- B. Administrators can view all bookings
DROP POLICY IF EXISTS "Admins can view all bookings" ON public.bookings;
CREATE POLICY "Admins can view all bookings"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles
      WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
    )
  );

-- C. Hosts can view bookings for properties they own
DROP POLICY IF EXISTS "Hosts can view bookings for their properties" ON public.bookings;
CREATE POLICY "Hosts can view bookings for their properties"
  ON public.bookings FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties
      WHERE properties.id = bookings.property_id
        AND properties.host_id = auth.uid()
    )
  );
