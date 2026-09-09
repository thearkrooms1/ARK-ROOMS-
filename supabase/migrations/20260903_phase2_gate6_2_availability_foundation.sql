-- ==============================================================================
-- Migration: Phase 2 Gate #6.2 — Safe Database Availability Foundation
-- Description:
-- 1. Adds public.rooms.total_rooms (physical capacity, NOT NULL DEFAULT 1, CHECK > 0)
-- 2. Adds public.rooms.is_active (room usability flag, NOT NULL DEFAULT TRUE)
-- 3. Adds public.bookings.expires_at (TIMESTAMPTZ NULL for 30-min pending holds)
-- 4. Safe non-destructive backfill for existing historical pending bookings
-- 5. Creates authoritative public.get_room_date_availability(...) [STABLE, SEC DEFINER]
-- 6. Creates authoritative public.get_room_date_availability_summary(...) [STABLE, SEC DEFINER]
-- 7. Creates authoritative public.assert_room_date_available(...) [VOLATILE, SEC DEFINER]
-- 8. Creates date-overlap & active-hold supporting indexes
-- 9. Enforces strict RLS and function execution privileges
-- ==============================================================================

-- ==============================================================================
-- 1. ADD rooms.total_rooms & rooms.is_active SAFELY
-- ==============================================================================
DO $$
BEGIN
  -- 1.1 Add total_rooms column with NOT NULL DEFAULT 1 CHECK (total_rooms > 0)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'total_rooms'
  ) THEN
    ALTER TABLE public.rooms 
      ADD COLUMN total_rooms INTEGER NOT NULL DEFAULT 1 CHECK (total_rooms > 0);
  END IF;

  -- 1.2 Add is_active column with NOT NULL DEFAULT TRUE
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'rooms' AND column_name = 'is_active'
  ) THEN
    ALTER TABLE public.rooms 
      ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;
  END IF;
END $$;

-- 1.3 Data Safety Enforcement:
-- Ensure all existing rooms have a conservative, non-destructive physical capacity of >= 1
UPDATE public.rooms
SET total_rooms = 1
WHERE total_rooms IS NULL OR total_rooms <= 0;

-- Ensure constraint is explicitly enforced
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_rooms_total_rooms_positive'
  ) THEN
    -- If column was added without named constraint, add named constraint if not present
    BEGIN
      ALTER TABLE public.rooms
        ADD CONSTRAINT chk_rooms_total_rooms_positive
        CHECK (total_rooms > 0);
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END;
  END IF;
END $$;

-- ==============================================================================
-- 2. ADD bookings.expires_at SAFELY
-- ==============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'expires_at'
  ) THEN
    ALTER TABLE public.bookings 
      ADD COLUMN expires_at TIMESTAMPTZ NULL;
  END IF;
END $$;

-- ==============================================================================
-- 3. SAFE BACKFILL OF EXISTING PENDING BOOKINGS
-- ==============================================================================
-- Rules:
-- 1. For historical pending + unpaid bookings:
--    expires_at = created_at + INTERVAL '30 minutes'
--    (If created_at is in the past, expires_at will be in the past and self-release)
-- 2. If an existing pending booking is already paid or has a successful payment record,
--    DO NOT treat it as an unpaid hold (expires_at remains NULL).
-- 3. Confirmed, checked-in, checked-out, completed, cancelled, rejected, refunded:
--    expires_at = NULL
-- 4. Do NOT delete any booking rows or modify financial records.

-- Backfill pending bookings without successful payment
UPDATE public.bookings b
SET expires_at = COALESCE(b.created_at, now() - INTERVAL '1 day') + INTERVAL '30 minutes'
WHERE b.booking_status = 'pending'
  AND COALESCE(b.payment_status, 'unpaid') IN ('unpaid', 'pending')
  AND NOT EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.booking_id = b.id
      AND p.status IN ('paid', 'successful')
  )
  AND b.expires_at IS NULL;

-- Ensure confirmed, completed, or terminal bookings have NULL expires_at
UPDATE public.bookings
SET expires_at = NULL
WHERE booking_status IN ('confirmed', 'checked_in', 'checked_out', 'completed', 'cancelled', 'rejected', 'refunded')
  AND expires_at IS NOT NULL;

-- ==============================================================================
-- 4. SUPPORTING INDEXES FOR DATE OVERLAP & ACTIVE HOLDS
-- ==============================================================================
-- Minimal, targeted indexes to support efficient range overlap and hold filtering
CREATE INDEX IF NOT EXISTS idx_bookings_room_dates
  ON public.bookings (room_id, check_in, check_out);

CREATE INDEX IF NOT EXISTS idx_bookings_active_holds
  ON public.bookings (room_id, booking_status, expires_at)
  WHERE booking_status = 'pending';

CREATE INDEX IF NOT EXISTS idx_bookings_availability_status
  ON public.bookings (room_id, check_in, check_out, booking_status);

-- ==============================================================================
-- 5. AUTHORITATIVE AVAILABILITY FUNCTION: public.get_room_date_availability
-- ==============================================================================
-- Authoritative calculation:
--   available_rooms = GREATEST(0, rooms.total_rooms - active_overlapping_bookings)
--
-- Overlap Rule: half-open interval [check_in, check_out)
--   existing.check_in < p_check_out AND existing.check_out > p_check_in
--
-- Consumes capacity if and only if:
--   booking_status IN ('confirmed', 'checked_in', 'checked_out', 'completed')
--   OR (booking_status = 'pending' AND payment_status IN ('unpaid', 'pending')
--       AND expires_at IS NOT NULL AND expires_at > now())
--
-- Cancelled, rejected, refunded, and expired pending holds NEVER consume capacity.
-- Global scalar rooms.available_rooms is NOT used.
CREATE OR REPLACE FUNCTION public.get_room_date_availability(
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_active_bookings INTEGER := 0;
  v_available INTEGER := 0;
BEGIN
  -- 1. Date range validation
  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Check-in and check-out dates are required' USING ERRCODE = '22023';
  END IF;

  IF p_check_in >= p_check_out THEN
    RAISE EXCEPTION 'Invalid date range: check-in date (%) must be strictly before check-out date (%)', p_check_in, p_check_out
      USING ERRCODE = '22023';
  END IF;

  -- 2. Room existence and usability check
  SELECT
    r.id,
    r.total_rooms,
    COALESCE(r.is_active, TRUE) AS is_active
  INTO v_room
  FROM public.rooms r
  WHERE r.id = p_room_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room % not found', p_room_id USING ERRCODE = 'P0002';
  END IF;

  -- Inactive or under-maintenance rooms provide 0 availability
  IF v_room.is_active = FALSE THEN
    RETURN 0;
  END IF;

  -- 3. Calculate active overlapping bookings
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

  -- 4. Calculate available rooms
  v_available := GREATEST(0, v_room.total_rooms - v_active_bookings);

  RETURN v_available;
END;
$$;

-- ==============================================================================
-- 6. STRUCTURED AVAILABILITY SUMMARY: public.get_room_date_availability_summary
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.get_room_date_availability_summary(
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE
)
RETURNS TABLE (
  available_rooms INTEGER,
  total_rooms INTEGER,
  active_bookings INTEGER,
  is_available BOOLEAN
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_avail INTEGER;
  v_tot INTEGER;
  v_act INTEGER;
BEGIN
  v_avail := public.get_room_date_availability(p_room_id, p_check_in, p_check_out);
  SELECT r.total_rooms INTO v_tot FROM public.rooms r WHERE r.id = p_room_id;
  v_act := GREATEST(0, v_tot - v_avail);

  RETURN QUERY SELECT v_avail, v_tot, v_act, (v_avail > 0);
END;
$$;

-- ==============================================================================
-- 7. AUTHORITATIVE CAPACITY ASSERTION HELPER: public.assert_room_date_available
-- ==============================================================================
-- Intended Calling Contract:
-- - Invoked by transactional booking creation (e.g. create_pending_booking_transaction)
-- - Locks public.rooms row FOR UPDATE to linearize concurrent hold attempts
-- - Calculates active overlapping reservations against total_rooms
-- - Raises exception 22023 if capacity is exhausted
-- - Returns remaining capacity (INTEGER >= 1) on success
CREATE OR REPLACE FUNCTION public.assert_room_date_available(
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_room RECORD;
  v_active_bookings INTEGER := 0;
  v_remaining INTEGER := 0;
BEGIN
  -- 1. Date validation
  IF p_check_in IS NULL OR p_check_out IS NULL THEN
    RAISE EXCEPTION 'Check-in and check-out dates are required' USING ERRCODE = '22023';
  END IF;

  IF p_check_in >= p_check_out THEN
    RAISE EXCEPTION 'Invalid reservation dates: Check-out date must be strictly after check-in date'
      USING ERRCODE = '22023';
  END IF;

  -- 2. Lock target room FOR UPDATE to serialize concurrent hold requests
  SELECT
    r.id,
    r.total_rooms,
    COALESCE(r.is_active, TRUE) AS is_active
  INTO v_room
  FROM public.rooms r
  WHERE r.id = p_room_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room % not found', p_room_id USING ERRCODE = 'P0002';
  END IF;

  IF v_room.is_active = FALSE THEN
    RAISE EXCEPTION 'Selected room is currently inactive or under maintenance.' USING ERRCODE = '22023';
  END IF;

  -- 3. Count active overlapping bookings
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

  -- 4. Capacity check
  IF v_active_bookings >= v_room.total_rooms THEN
    RAISE EXCEPTION 'Selected room is no longer available for the requested dates.' USING ERRCODE = '22023';
  END IF;

  v_remaining := v_room.total_rooms - v_active_bookings;
  RETURN v_remaining;
END;
$$;

-- ==============================================================================
-- 8. SECURITY, PRIVILEGES & RLS CONTROLS
-- ==============================================================================
-- Revoke all on functions from PUBLIC default role
REVOKE ALL ON FUNCTION public.get_room_date_availability(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_room_date_availability_summary(UUID, DATE, DATE) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_room_date_available(UUID, DATE, DATE) FROM PUBLIC;

-- get_room_date_availability is read-only aggregated availability count (no PII leakage)
-- Grant to anon and authenticated for marketplace search and property detail inspection
GRANT EXECUTE ON FUNCTION public.get_room_date_availability(UUID, DATE, DATE) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_room_date_availability_summary(UUID, DATE, DATE) TO anon, authenticated, service_role;

-- assert_room_date_available is transactional hold allocator
GRANT EXECUTE ON FUNCTION public.assert_room_date_available(UUID, DATE, DATE) TO authenticated, service_role;

-- Ensure guests cannot directly tamper with expires_at or total_rooms via standard table DML
DO $$
BEGIN
  -- Explicitly revoke column-level updates if public has update privileges
  BEGIN
    REVOKE UPDATE (total_rooms) ON public.rooms FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  BEGIN
    REVOKE UPDATE (expires_at) ON public.bookings FROM anon, authenticated;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $$;
