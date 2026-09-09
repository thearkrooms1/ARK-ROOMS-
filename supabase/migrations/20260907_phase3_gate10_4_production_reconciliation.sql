-- ==============================================================================
-- PHASE 3 — GATE #10.4.2: PRODUCTION RECONCILIATION MIGRATION (CORRECTED)
-- AUTHORITATIVE FORWARD-ONLY RECONCILIATION SCRIPT FOR SUPABASE PRODUCTION
-- 
-- TARGET: Supabase Project dadwtevyaugevbqscjzn
-- MODE: FORWARD-ONLY, ADDITIVE, IDEMPOTENT, STRICT PRECONDITIONS, NON-DESTRUCTIVE
-- 
-- PREREQUISITE: Administrator must verify/create a database backup via Supabase 
-- Dashboard (Project Settings -> Database -> Backups) before execution.
-- 
-- AUDIT GUARANTEES:
-- 1. Preserves legacy columns: check_in, check_out, total_amount_ngn, booking_status,
--    status, verified, rating, phone, email, total_rooms, available_rooms.
-- 2. Pending booking hold is STRICTLY 30 minutes (now() + INTERVAL '30 minutes').
-- 3. Partner tier is constrained strictly to: 'individual_host', 'hotel_organization'.
-- 4. Strict preconditions on property ID AND name match before classification.
-- 5. Media publication status is initialized to 'not_published' (NOT 'published')
--    because storage buckets are empty and no verified media objects exist.
-- 6. Zero historical financial records are fabricated.
-- 7. All 22 security-sensitive tables and 3 storage buckets have explicit RLS.
-- ==============================================================================

BEGIN;

-- ==============================================================================
-- BATCH A: AUTH & HOST FOUNDATION
-- ==============================================================================

-- A.1: Create host_profiles table if not exists
CREATE TABLE IF NOT EXISTS public.host_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  bank_name TEXT,
  account_number TEXT,
  account_name TEXT,
  commission_rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 12.00,
  host_status TEXT NOT NULL DEFAULT 'pending',
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_host_profiles_user_id UNIQUE (user_id),
  CONSTRAINT chk_host_profiles_status CHECK (host_status IN ('pending', 'verified', 'suspended')),
  CONSTRAINT chk_host_profiles_commission_rate CHECK (commission_rate_percentage >= 10.00 AND commission_rate_percentage <= 15.00)
);

CREATE INDEX IF NOT EXISTS idx_host_profiles_user_id ON public.host_profiles (user_id);
CREATE INDEX IF NOT EXISTS idx_host_profiles_status ON public.host_profiles (host_status);

-- A.2: Create host_payout_profiles table if not exists
CREATE TABLE IF NOT EXISTS public.host_payout_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE CASCADE,
  paystack_subaccount_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_host_payout_profiles_host_id UNIQUE (host_id)
);

CREATE INDEX IF NOT EXISTS idx_host_payout_profiles_host_id ON public.host_payout_profiles (host_id);

-- A.3: RLS for Host Profiles
ALTER TABLE public.host_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.host_payout_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can register own host profile" ON public.host_profiles;
CREATE POLICY "Users can register own host profile"
  ON public.host_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can view own host profile" ON public.host_profiles;
CREATE POLICY "Users can view own host profile"
  ON public.host_profiles FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own host profile non-sensitive fields" ON public.host_profiles;
CREATE POLICY "Users can update own host profile non-sensitive fields"
  ON public.host_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view and manage all host profiles" ON public.host_profiles;
CREATE POLICY "Admins can view and manage all host profiles"
  ON public.host_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Hosts can view own payout profile" ON public.host_payout_profiles;
CREATE POLICY "Hosts can view own payout profile"
  ON public.host_payout_profiles FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = host_payout_profiles.host_id AND hp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins can view all payout profiles" ON public.host_payout_profiles;
CREATE POLICY "Admins can view all payout profiles"
  ON public.host_payout_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );


-- ==============================================================================
-- BATCH B: BOOKING & AVAILABILITY FOUNDATION
-- ==============================================================================

-- Ensure partner_tier and media_publication_status columns exist on public.properties before any RLS policy or view evaluates them
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS partner_tier TEXT NOT NULL DEFAULT 'individual_host';
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS media_publication_status TEXT NOT NULL DEFAULT 'not_published';

-- B.1: Additive modern columns on bookings (preserving all legacy columns)
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS check_in_date DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS check_out_date DATE;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS total_price_ngn NUMERIC(14,2);
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'pending';
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS guest_check_in_confirmed_at TIMESTAMPTZ;
ALTER TABLE public.bookings ADD COLUMN IF NOT EXISTS actual_check_in_at TIMESTAMPTZ;

-- B.2: Additive modern columns on rooms (preserving total_rooms, available_rooms, status)
ALTER TABLE public.rooms ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;

-- B.3: Ensure indexes for date-range availability calculations
CREATE INDEX IF NOT EXISTS idx_bookings_date_availability 
  ON public.bookings (room_id, check_in, check_out, booking_status, expires_at);
CREATE INDEX IF NOT EXISTS idx_bookings_date_availability_modern 
  ON public.bookings (room_id, check_in_date, check_out_date, status, expires_at);

-- B.4: Legacy-Modern Synchronization Trigger for bookings
CREATE OR REPLACE FUNCTION public.sync_bookings_legacy_modern_fields()
RETURNS TRIGGER AS $$
BEGIN
  -- Sync check_in <-> check_in_date
  IF NEW.check_in_date IS NOT NULL AND NEW.check_in IS NULL THEN
    NEW.check_in := NEW.check_in_date::TEXT;
  ELSIF NEW.check_in IS NOT NULL AND NEW.check_in_date IS NULL THEN
    NEW.check_in_date := NEW.check_in::DATE;
  END IF;

  -- Sync check_out <-> check_out_date
  IF NEW.check_out_date IS NOT NULL AND NEW.check_out IS NULL THEN
    NEW.check_out := NEW.check_out_date::TEXT;
  ELSIF NEW.check_out IS NOT NULL AND NEW.check_out_date IS NULL THEN
    NEW.check_out_date := NEW.check_out::DATE;
  END IF;

  -- Sync status <-> booking_status
  IF NEW.status IS NOT NULL AND NEW.booking_status IS NULL THEN
    NEW.booking_status := NEW.status;
  ELSIF NEW.booking_status IS NOT NULL AND NEW.status IS NULL THEN
    NEW.status := NEW.booking_status;
  END IF;

  -- Sync total_price_ngn <-> total_amount_ngn
  IF NEW.total_price_ngn IS NOT NULL AND NEW.total_amount_ngn IS NULL THEN
    NEW.total_amount_ngn := NEW.total_price_ngn;
  ELSIF NEW.total_amount_ngn IS NOT NULL AND NEW.total_price_ngn IS NULL THEN
    NEW.total_price_ngn := NEW.total_amount_ngn;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_sync_bookings_legacy_modern ON public.bookings;
CREATE TRIGGER trg_sync_bookings_legacy_modern
  BEFORE INSERT OR UPDATE ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_bookings_legacy_modern_fields();

-- B.5: Date-Specific Availability Function (Authoritative)
CREATE OR REPLACE FUNCTION public.get_room_date_availability(
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE
)
RETURNS TABLE (
  room_id UUID,
  total_inventory INTEGER,
  active_reservations INTEGER,
  available_inventory INTEGER,
  is_available BOOLEAN
) AS $$
DECLARE
  v_total INTEGER;
  v_overlapping INTEGER;
BEGIN
  IF p_check_in >= p_check_out THEN
    RAISE EXCEPTION 'Check-out date must be strictly after check-in date' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(total_rooms, 1)
  INTO v_total
  FROM public.rooms
  WHERE id = p_room_id AND is_active = true;

  IF NOT FOUND THEN
    RETURN QUERY SELECT p_room_id, 0, 0, 0, false;
    RETURN;
  END IF;

  SELECT COUNT(*)::INTEGER
  INTO v_overlapping
  FROM public.bookings b
  WHERE b.room_id = p_room_id
    AND COALESCE(b.check_in_date, b.check_in::DATE) < p_check_out
    AND COALESCE(b.check_out_date, b.check_out::DATE) > p_check_in
    AND (
      COALESCE(b.status, b.booking_status) IN ('confirmed', 'checked_in')
      OR (
        COALESCE(b.status, b.booking_status) = 'pending'
        AND (b.expires_at IS NULL OR b.expires_at > now())
      )
    );

  RETURN QUERY SELECT
    p_room_id,
    v_total,
    v_overlapping,
    GREATEST(0, v_total - v_overlapping),
    (v_total - v_overlapping) > 0;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- B.6: Assert Room Available
CREATE OR REPLACE FUNCTION public.assert_room_date_available(
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE
)
RETURNS BOOLEAN AS $$
DECLARE
  v_avail BOOLEAN;
BEGIN
  SELECT is_available INTO v_avail
  FROM public.get_room_date_availability(p_room_id, p_check_in, p_check_out);

  IF NOT COALESCE(v_avail, false) THEN
    RAISE EXCEPTION 'Room % is not available for requested dates % to %', p_room_id, p_check_in, p_check_out
      USING ERRCODE = 'P0001';
  END IF;

  RETURN true;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public;

-- B.7: Authoritative 30-Minute Pending Booking Creation Transaction
CREATE OR REPLACE FUNCTION public.create_pending_booking_transaction(
  p_user_id UUID,
  p_property_id UUID,
  p_room_id UUID,
  p_check_in DATE,
  p_check_out DATE,
  p_guest_name TEXT,
  p_guest_email TEXT,
  p_guest_phone TEXT,
  p_total_price_ngn NUMERIC,
  p_venue_id UUID DEFAULT NULL,
  p_special_requests TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_booking_id UUID;
  v_expires_at TIMESTAMPTZ;
  v_room_valid BOOLEAN;
  v_prop_approved BOOLEAN;
  v_prop_eligible BOOLEAN;
  v_available BOOLEAN;
  v_booking_ref TEXT;
BEGIN
  -- 1. Validate property approved & active, media published, and strictly eligible based on partner tier & host status
  SELECT (
    approval_status = 'approved'
    AND is_active = true
    AND media_publication_status = 'published'
    AND (
      partner_tier = 'hotel_organization'
      OR (
        partner_tier = 'individual_host'
        AND host_id IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.host_profiles hp
          WHERE hp.id = properties.host_id AND hp.status = 'active'
        )
      )
    )
  )
  INTO v_prop_eligible
  FROM public.properties
  WHERE id = p_property_id;

  IF NOT COALESCE(v_prop_eligible, false) THEN
    RAISE EXCEPTION 'Property % is not active, approved, or eligible for marketplace bookings (valid partner tier, active host association, and published media required)', p_property_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. Validate room active, valid pricing (> 0), valid capacity (>= 1), and total_rooms (>= 1)
  SELECT (
    is_active = true
    AND COALESCE(price_per_night_ngn, 0) > 0
    AND COALESCE(capacity, 0) >= 1
    AND COALESCE(total_rooms, 0) >= 1
  ) INTO v_room_valid
  FROM public.rooms
  WHERE id = p_room_id AND property_id = p_property_id;

  IF NOT COALESCE(v_room_valid, false) THEN
    RAISE EXCEPTION 'Room % is not active or has invalid pricing/capacity specifications', p_room_id USING ERRCODE = 'P0002';
  END IF;

  -- Validate requested total price
  IF COALESCE(p_total_price_ngn, 0) <= 0 THEN
    RAISE EXCEPTION 'Booking total price must be greater than zero' USING ERRCODE = '22023';
  END IF;

  -- 3. Validate date-range availability
  SELECT is_available INTO v_available
  FROM public.get_room_date_availability(p_room_id, p_check_in, p_check_out);

  IF NOT COALESCE(v_available, false) THEN
    RAISE EXCEPTION 'Room % is not available for requested dates', p_room_id USING ERRCODE = 'P0001';
  END IF;

  -- 4. AUTHORITATIVE 30-MINUTE HOLD: expires_at = now() + INTERVAL '30 minutes'
  v_expires_at := now() + INTERVAL '30 minutes';
  v_booking_ref := 'ARK-' || to_char(now(), 'YYYYMMDD') || '-' || upper(substring(gen_random_uuid()::text, 1, 6));

  -- 5. Insert pending booking
  INSERT INTO public.bookings (
    user_id,
    property_id,
    room_id,
    venue_id,
    guest_name,
    guest_email,
    guest_phone,
    check_in,
    check_out,
    check_in_date,
    check_out_date,
    total_amount_ngn,
    total_price_ngn,
    status,
    booking_status,
    payment_status,
    expires_at,
    special_requests
  ) VALUES (
    p_user_id,
    p_property_id,
    p_room_id,
    p_venue_id,
    p_guest_name,
    p_guest_email,
    p_guest_phone,
    p_check_in::TEXT,
    p_check_out::TEXT,
    p_check_in,
    p_check_out,
    p_total_price_ngn,
    p_total_price_ngn,
    'pending',
    'pending',
    'unpaid',
    v_expires_at,
    p_special_requests
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'expires_at', v_expires_at,
    'hold_duration_minutes', 30
  );
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

-- B.8: Explicit RLS on Bookings and Rooms
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view active rooms" ON public.rooms;
CREATE POLICY "Public can view active rooms"
  ON public.rooms FOR SELECT
  USING (
    is_active = true AND
    EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = rooms.property_id
        AND p.approval_status = 'approved'
        AND p.is_active = true
        AND p.media_publication_status = 'published'
        AND (
          p.partner_tier = 'hotel_organization'
          OR (
            p.partner_tier = 'individual_host'
            AND p.host_id IS NOT NULL
            AND EXISTS (
              SELECT 1 FROM public.host_profiles hp
              WHERE hp.id = p.host_id AND hp.status = 'active'
            )
          )
        )
    )
  );

DROP POLICY IF EXISTS "Admins full access to rooms" ON public.rooms;
CREATE POLICY "Admins full access to rooms"
  ON public.rooms FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Guests can view own bookings" ON public.bookings;
CREATE POLICY "Guests can view own bookings"
  ON public.bookings FOR SELECT
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Guests can insert own bookings" ON public.bookings;
CREATE POLICY "Guests can insert own bookings"
  ON public.bookings FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins full access to bookings" ON public.bookings;
CREATE POLICY "Admins full access to bookings"
  ON public.bookings FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );


-- ==============================================================================
-- BATCH C: FINANCIAL & PAYMENT FOUNDATION
-- ==============================================================================

-- C.1: Additive columns on payments table
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'paystack';
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS paystack_reference TEXT;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS accommodation_amount_ngn NUMERIC(14,2);
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS damage_deposit_amount_ngn NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS logistics_amount_ngn NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS ark_commission_ngn NUMERIC(14,2) DEFAULT 0.00;
ALTER TABLE public.payments ADD COLUMN IF NOT EXISTS host_payout_ngn NUMERIC(14,2) DEFAULT 0.00;

CREATE INDEX IF NOT EXISTS idx_payments_paystack_ref ON public.payments (paystack_reference);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON public.payments (booking_id);

-- C.2: Partner payouts table
CREATE TABLE IF NOT EXISTS public.partner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  host_id UUID NULL REFERENCES public.host_profiles(id) ON DELETE RESTRICT,
  host_user_id UUID NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  provider_id UUID NULL,
  logistics_payout_profile_id UUID NULL,
  payout_category TEXT NOT NULL DEFAULT 'accommodation',
  amount_ngn NUMERIC(14,2) NOT NULL,
  gross_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  commission_rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 0.00,
  commission_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  currency TEXT NOT NULL DEFAULT 'NGN',
  status TEXT NOT NULL DEFAULT 'pending',
  transfer_reference TEXT,
  paystack_transfer_code TEXT,
  recipient_bank_name_snapshot TEXT NULL,
  recipient_bank_code_snapshot TEXT NULL,
  recipient_account_name_snapshot TEXT NULL,
  recipient_account_number_masked TEXT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ NULL,
  processing_started_at TIMESTAMPTZ NULL,
  reconciliation_required_at TIMESTAMPTZ NULL,
  reconciled_at TIMESTAMPTZ NULL,
  reconciliation_notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_partner_payouts_status CHECK (status IN ('pending', 'scheduled', 'protection_window', 'processing', 'successful', 'failed', 'reconciliation_required')),
  CONSTRAINT uq_partner_payouts_booking_category UNIQUE (booking_id, payout_category)
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_booking ON public.partner_payouts (booking_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_host ON public.partner_payouts (host_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status ON public.partner_payouts (status);

-- C.3: Financial ledger table (Append-Only)
CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_type TEXT NOT NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE RESTRICT,
  payment_id UUID REFERENCES public.payments(id) ON DELETE RESTRICT,
  payout_id UUID REFERENCES public.partner_payouts(id) ON DELETE RESTRICT,
  account_code TEXT NOT NULL,
  debit_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  credit_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  reference TEXT,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_booking ON public.financial_ledger (booking_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created ON public.financial_ledger (created_at);

-- C.4: Webhook events table (Idempotency)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_source TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_reference TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'received',
  processing_started_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_webhook_events_source_type_ref UNIQUE (event_source, event_type, event_reference)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_ref ON public.webhook_events (event_source, event_reference);

-- C.5: Logistics tables
CREATE TABLE IF NOT EXISTS public.logistics_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_name TEXT NOT NULL,
  contact_person TEXT,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logistics_payout_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.logistics_providers(id) ON DELETE CASCADE,
  paystack_subaccount_code TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  account_number TEXT NOT NULL,
  account_name TEXT NOT NULL,
  is_verified BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_logistics_payout_profiles_provider UNIQUE (provider_id)
);

-- C.6: RLS for Financial Tables (Explicitly covers all financial entities)
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_payout_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Guests can view own payments" ON public.payments;
CREATE POLICY "Guests can view own payments"
  ON public.payments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = payments.booking_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins full access to payments" ON public.payments;
CREATE POLICY "Admins full access to payments"
  ON public.payments FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Hosts can view own payouts" ON public.partner_payouts;
CREATE POLICY "Hosts can view own payouts"
  ON public.partner_payouts FOR SELECT
  USING (
    host_user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = partner_payouts.host_id AND hp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins full access to partner payouts" ON public.partner_payouts;
CREATE POLICY "Admins full access to partner payouts"
  ON public.partner_payouts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Admins can view financial ledger" ON public.financial_ledger;
CREATE POLICY "Admins can view financial ledger"
  ON public.financial_ledger FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Admins can view webhook events" ON public.webhook_events;
CREATE POLICY "Admins can view webhook events"
  ON public.webhook_events FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Public can view active logistics providers" ON public.logistics_providers;
CREATE POLICY "Public can view active logistics providers"
  ON public.logistics_providers FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Admins full access to logistics providers" ON public.logistics_providers;
CREATE POLICY "Admins full access to logistics providers"
  ON public.logistics_providers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Admins full access to logistics payout profiles" ON public.logistics_payout_profiles;
CREATE POLICY "Admins full access to logistics payout profiles"
  ON public.logistics_payout_profiles FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );


-- ==============================================================================
-- BATCH D: RESERVE, ISSUE & DAMAGE FOUNDATION
-- ==============================================================================

-- D.1: Chart of Accounts
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  code TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO public.chart_of_accounts (code, name, account_type, description)
VALUES 
  ('1010', 'Cash / Paystack Clearing', 'asset', 'Inbound customer payments clearing account'),
  ('2010', 'Host Payable', 'liability', 'Payable balance to individual hosts'),
  ('2020', 'Hotel Payable', 'liability', 'Payable balance to hotel organizations'),
  ('2030', 'Guest Assurance Reserve', 'liability', '20% individual host escrow reserve for guest protection'),
  ('2040', 'Damage Deposit Escrow', 'liability', 'Customer damage deposit held in escrow'),
  ('4010', 'Ark Commission Revenue', 'revenue', 'Platform fee earned on accommodation and logistics'),
  ('5010', 'Guest Protection Expense', 'expense', 'Platform absorbed loss or reserve payout')
ON CONFLICT (code) DO NOTHING;

-- D.2: Guest Assurance Reserves Table
CREATE TABLE IF NOT EXISTS public.guest_assurance_reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE RESTRICT,
  original_reserve_ngn NUMERIC(14,2) NOT NULL,
  consumed_reserve_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  released_reserve_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  remaining_reserve_ngn NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'held',
  hold_expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_guest_assurance_reserves_booking UNIQUE (booking_id),
  CONSTRAINT chk_guest_assurance_reserves_status CHECK (status IN ('held', 'partially_consumed', 'consumed', 'released')),
  CONSTRAINT chk_reserve_balances CHECK (consumed_reserve_ngn + released_reserve_ngn <= original_reserve_ngn)
);

CREATE INDEX IF NOT EXISTS idx_guest_assurance_booking ON public.guest_assurance_reserves (booking_id);
CREATE INDEX IF NOT EXISTS idx_guest_assurance_host ON public.guest_assurance_reserves (host_id);

-- D.3: Damage Deposits Table
CREATE TABLE IF NOT EXISTS public.damage_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  amount_ngn NUMERIC(14,2) NOT NULL,
  retained_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  refunded_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'held',
  deposit_status TEXT DEFAULT 'held',
  inspection_deadline TIMESTAMPTZ NOT NULL,
  refunded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_damage_deposits_booking UNIQUE (booking_id),
  CONSTRAINT chk_damage_deposits_status CHECK (status IN ('held', 'claim_pending', 'partially_retained', 'retained', 'refunded')),
  CONSTRAINT chk_deposit_balances CHECK (retained_amount_ngn + refunded_amount_ngn <= amount_ngn)
);

CREATE INDEX IF NOT EXISTS idx_damage_deposits_booking ON public.damage_deposits (booking_id);

-- D.4: Booking Issues & Evidence
CREATE TABLE IF NOT EXISTS public.booking_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  reporter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  issue_category TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  adjudicated_by UUID REFERENCES auth.users(id),
  adjudication_notes TEXT,
  resolution_type TEXT,
  compensation_amount_ngn NUMERIC(14,2) DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_booking_issues_status CHECK (status IN ('open', 'under_review', 'resolved_guest_favor', 'resolved_host_favor', 'dismissed'))
);

CREATE TABLE IF NOT EXISTS public.booking_issue_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES public.booking_issues(id) ON DELETE CASCADE,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  file_url TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- D.5: Damage Claims Table
CREATE TABLE IF NOT EXISTS public.damage_claims (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE RESTRICT,
  deposit_id UUID NOT NULL REFERENCES public.damage_deposits(id) ON DELETE RESTRICT,
  claimed_amount_ngn NUMERIC(14,2) NOT NULL,
  approved_amount_ngn NUMERIC(14,2) DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'pending',
  description TEXT NOT NULL,
  adjudicated_by UUID REFERENCES auth.users(id),
  adjudication_notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_damage_claims_status CHECK (status IN ('pending', 'approved', 'partially_approved', 'rejected'))
);

-- D.6: Refund Operations & Financial Audit Logs
CREATE TABLE IF NOT EXISTS public.refund_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  recipient_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  refund_type TEXT NOT NULL,
  amount_ngn NUMERIC(14,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  paystack_refund_reference TEXT,
  failure_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_refund_operations_status CHECK (status IN ('pending', 'processing', 'successful', 'failed', 'reconciliation_required'))
);

CREATE TABLE IF NOT EXISTS public.financial_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  action TEXT NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  performed_by UUID REFERENCES auth.users(id),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- D.7: Enable RLS on Reserve & Damage Tables (Explicit coverage)
ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_assurance_reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damage_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_issue_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damage_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.refund_operations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated can view chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Authenticated can view chart of accounts"
  ON public.chart_of_accounts FOR SELECT
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Admins full access to chart of accounts" ON public.chart_of_accounts;
CREATE POLICY "Admins full access to chart of accounts"
  ON public.chart_of_accounts FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Admins full access to guest assurance reserves" ON public.guest_assurance_reserves;
CREATE POLICY "Admins full access to guest assurance reserves"
  ON public.guest_assurance_reserves FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Guests can view own damage deposits" ON public.damage_deposits;
CREATE POLICY "Guests can view own damage deposits"
  ON public.damage_deposits FOR SELECT
  USING (
    user_id = auth.uid() OR
    EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.id = damage_deposits.booking_id AND b.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins full access to damage deposits" ON public.damage_deposits;
CREATE POLICY "Admins full access to damage deposits"
  ON public.damage_deposits FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Users can view own booking issues" ON public.booking_issues;
CREATE POLICY "Users can view own booking issues"
  ON public.booking_issues FOR SELECT
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Users can create own booking issues" ON public.booking_issues;
CREATE POLICY "Users can create own booking issues"
  ON public.booking_issues FOR INSERT
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Admins full access to booking issues" ON public.booking_issues;
CREATE POLICY "Admins full access to booking issues"
  ON public.booking_issues FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Admins can view financial audit logs" ON public.financial_audit_logs;
CREATE POLICY "Admins can view financial audit logs"
  ON public.financial_audit_logs FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );


-- ==============================================================================
-- BATCH E: PROPERTY APPROVAL & GOVERNANCE FOUNDATION
-- ==============================================================================

-- E.1: Additive modern approval columns on properties (preserving legacy columns)
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS host_id UUID REFERENCES public.host_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS approval_status TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS rejection_reason TEXT NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS submitted_at TIMESTAMPTZ NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS approved_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS requires_damage_deposit BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS damage_deposit_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0.00;

-- Constraint on approval_status
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS chk_properties_approval_status;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_approval_status_check;
ALTER TABLE public.properties ADD CONSTRAINT chk_properties_approval_status 
  CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended'));

-- E.2: Property Approval Audits (Append-Only)
CREATE TABLE IF NOT EXISTS public.property_approval_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_prop_approval_audits_property ON public.property_approval_audits (property_id);

-- Append-Only Trigger on Approval Audits
CREATE OR REPLACE FUNCTION public.fn_prevent_property_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'property_approval_audits is strictly append-only: UPDATE or DELETE not permitted.'
    USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_property_audit_mutation ON public.property_approval_audits;
CREATE TRIGGER trg_prevent_property_audit_mutation
  BEFORE UPDATE OR DELETE ON public.property_approval_audits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_property_audit_mutation();

-- E.3: Property Approval RPCs
CREATE OR REPLACE FUNCTION public.submit_host_property_for_review(p_property_id UUID)
RETURNS JSONB AS $$
DECLARE
  v_prop RECORD;
BEGIN
  SELECT * INTO v_prop FROM public.properties WHERE id = p_property_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property % not found', p_property_id USING ERRCODE = 'P0002';
  END IF;

  IF v_prop.approval_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Property cannot be submitted from status %', v_prop.approval_status USING ERRCODE = '22023';
  END IF;

  UPDATE public.properties
  SET approval_status = 'pending_review',
      submitted_at = now(),
      rejection_reason = NULL,
      updated_at = now()
  WHERE id = p_property_id;

  RETURN jsonb_build_object('success', true, 'approval_status', 'pending_review');
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

CREATE OR REPLACE FUNCTION public.admin_adjudicate_property(
  p_property_id UUID,
  p_decision TEXT,
  p_rejection_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_prev_status TEXT;
  v_new_status TEXT;
BEGIN
  IF p_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject' USING ERRCODE = '22023';
  END IF;

  SELECT approval_status INTO v_prev_status
  FROM public.properties
  WHERE id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property % not found', p_property_id USING ERRCODE = 'P0002';
  END IF;

  IF p_decision = 'approve' THEN
    v_new_status := 'approved';
    UPDATE public.properties
    SET approval_status = 'approved',
        approved_at = now(),
        approved_by = auth.uid(),
        rejection_reason = NULL,
        is_active = true,
        updated_at = now()
    WHERE id = p_property_id;
  ELSE
    v_new_status := 'rejected';
    UPDATE public.properties
    SET approval_status = 'rejected',
        rejection_reason = p_rejection_reason,
        is_active = false,
        updated_at = now()
    WHERE id = p_property_id;
  END IF;

  INSERT INTO public.property_approval_audits (
    property_id, admin_id, previous_status, new_status, rejection_reason
  ) VALUES (
    p_property_id, auth.uid(), v_prev_status, v_new_status, p_rejection_reason
  );

  RETURN jsonb_build_object('success', true, 'previous_status', v_prev_status, 'new_status', v_new_status);
END;
$$ LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public;

-- E.4: RLS Policies for Properties & Audits
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_approval_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view approved active properties" ON public.properties;
CREATE POLICY "Public can view approved active properties"
  ON public.properties FOR SELECT
  USING (
    media_publication_status = 'published'
    AND (
      (
        partner_tier = 'hotel_organization'
        AND approval_status = 'approved'
        AND is_active = true
      )
      OR
      (
        partner_tier = 'individual_host'
        AND approval_status = 'approved'
        AND is_active = true
        AND host_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.host_profiles hp
          WHERE hp.id = public.properties.host_id
            AND hp.status = 'active'
        )
      )
    )
  );

DROP POLICY IF EXISTS "Hosts can view own properties" ON public.properties;
CREATE POLICY "Hosts can view own properties"
  ON public.properties FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id AND hp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Hosts can create own properties" ON public.properties;
CREATE POLICY "Hosts can create own properties"
  ON public.properties FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id AND hp.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Admins full access to properties" ON public.properties;
CREATE POLICY "Admins full access to properties"
  ON public.properties FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Admins can view all property approval audits" ON public.property_approval_audits;
CREATE POLICY "Admins can view all property approval audits"
  ON public.property_approval_audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );


-- ==============================================================================
-- BATCH F: PARTNER-TIER BIFURCATION & DATA PRESERVATION
-- ==============================================================================

-- F.1: Add partner_tier column with strict CHECK constraint
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS partner_tier TEXT NOT NULL DEFAULT 'individual_host';

ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS chk_properties_partner_tier;
ALTER TABLE public.properties ADD CONSTRAINT chk_properties_partner_tier 
  CHECK (partner_tier IN ('individual_host', 'hotel_organization'));

-- F.2: Trigger protecting partner_tier from host modification
CREATE OR REPLACE FUNCTION public.fn_protect_property_partner_tier()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.partner_tier IS DISTINCT FROM NEW.partner_tier THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    ) THEN
      RAISE EXCEPTION 'partner_tier is immutable to hosts; only admins may reclassify property tier'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_protect_property_partner_tier ON public.properties;
CREATE TRIGGER trg_protect_property_partner_tier
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_protect_property_partner_tier();

-- F.3: Check-in Audits
CREATE TABLE IF NOT EXISTS public.admin_check_in_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  admin_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.admin_check_in_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view check in audits" ON public.admin_check_in_audits;
CREATE POLICY "Admins can view check in audits"
  ON public.admin_check_in_audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

-- F.4: PRECONDITION VALIDATION & CONTROLLED DATA BACKFILL
-- Strictly validates exact property IDs, exact names, and exact row counts before mutating.
DO $$
DECLARE
  v_hotel_matches INT;
  v_host_matches INT;
  v_rooms_matches INT;
BEGIN
  -- 1. Assert exact 5 Hotel Organizations exist with exact names
  SELECT count(*) INTO v_hotel_matches
  FROM public.properties
  WHERE (id, name) IN (
    ('20000000-0000-4000-8000-000000000001'::uuid, 'Transcorp Hilton Abuja'),
    ('20000000-0000-4000-8000-000000000002'::uuid, 'Abuja Continental Hotel'),
    ('20000000-0000-4000-8000-000000000004'::uuid, 'Maitama Diplomatic Event Suites'),
    ('20000000-0000-4000-8000-000000000005'::uuid, 'Nordic Hotel Abuja'),
    ('20000000-0000-4000-8000-000000000006'::uuid, 'The Wells Carlton Hotel & Apartments')
  );

  IF v_hotel_matches <> 5 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 5 matching Hotel Organizations, found %', v_hotel_matches
      USING ERRCODE = 'P0002';
  END IF;

  -- 2. Assert exact 3 Individual Hosts exist with exact names
  SELECT count(*) INTO v_host_matches
  FROM public.properties
  WHERE (id, name) IN (
    ('20000000-0000-4000-8000-000000000003'::uuid, 'Fraser Suites Abuja'),
    ('20000000-0000-4000-8000-000000000007'::uuid, 'Hawthorn Suites by Wyndham Abuja'),
    ('20000000-0000-4000-8000-000000000008'::uuid, 'Villa One Boutique Hotel Gwarinpa')
  );

  IF v_host_matches <> 3 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 3 matching Individual Hosts, found %', v_host_matches
      USING ERRCODE = 'P0002';
  END IF;

  -- 3. Assert exact 8 Rooms exist with valid pricing (>0) and total_rooms (>=1)
  SELECT count(*) INTO v_rooms_matches
  FROM public.rooms
  WHERE property_id IN (
    '20000000-0000-4000-8000-000000000001',
    '20000000-0000-4000-8000-000000000002',
    '20000000-0000-4000-8000-000000000003',
    '20000000-0000-4000-8000-000000000004',
    '20000000-0000-4000-8000-000000000005',
    '20000000-0000-4000-8000-000000000006',
    '20000000-0000-4000-8000-000000000007',
    '20000000-0000-4000-8000-000000000008'
  ) AND price_per_night_ngn > 0 AND total_rooms >= 1;

  IF v_rooms_matches <> 8 THEN
    RAISE EXCEPTION 'PRECONDITION FAILED: Expected 8 rooms with valid pricing, found %', v_rooms_matches
      USING ERRCODE = 'P0002';
  END IF;
END $$;

-- 5 Hotel Organizations:
UPDATE public.properties
SET partner_tier = 'hotel_organization',
    approval_status = 'approved',
    is_active = true,
    updated_at = now()
WHERE id IN (
  '20000000-0000-4000-8000-000000000001', -- Transcorp Hilton Abuja
  '20000000-0000-4000-8000-000000000002', -- Abuja Continental Hotel
  '20000000-0000-4000-8000-000000000004', -- Maitama Diplomatic Event Suites
  '20000000-0000-4000-8000-000000000005', -- Nordic Hotel Abuja
  '20000000-0000-4000-8000-000000000006'  -- The Wells Carlton Hotel & Apartments
);

-- 3 Individual Hosts:
UPDATE public.properties
SET partner_tier = 'individual_host',
    approval_status = 'approved',
    is_active = true,
    updated_at = now()
WHERE id IN (
  '20000000-0000-4000-8000-000000000003', -- Fraser Suites Abuja
  '20000000-0000-4000-8000-000000000007', -- Hawthorn Suites by Wyndham Abuja
  '20000000-0000-4000-8000-000000000008'  -- Villa One Boutique Hotel Gwarinpa
);

-- Ensure the 8 rooms have is_active = true
UPDATE public.rooms
SET is_active = true,
    updated_at = now()
WHERE property_id IN (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000008'
);


-- ==============================================================================
-- BATCH G: STORAGE & MEDIA GOVERNANCE
-- ==============================================================================

-- G.1: Provision the 3 Required Storage Buckets
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES 
  ('property-media-staging', 'property-media-staging', false, false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('property-images-public', 'property-images-public', true, false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp']),
  ('issue-evidence-private', 'issue-evidence-private', false, false, 10485760, ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- G.2: Storage RLS Policies
DROP POLICY IF EXISTS "Staging media authorized select" ON storage.objects;
CREATE POLICY "Staging media authorized select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'property-media-staging' AND (
      auth.role() = 'service_role' OR
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
      ) OR
      EXISTS (
        SELECT 1 FROM public.properties prop
        JOIN public.host_profiles hp ON hp.id = prop.host_id
        WHERE hp.user_id = auth.uid()
          AND (storage.objects.name LIKE 'properties/' || prop.id::text || '/%'
               OR storage.objects.name LIKE 'rooms/%')
      )
    )
  );

DROP POLICY IF EXISTS "Public media public select" ON storage.objects;
CREATE POLICY "Public media public select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images-public');

DROP POLICY IF EXISTS "Public media write restricted" ON storage.objects;
CREATE POLICY "Public media write restricted"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images-public' AND (
      auth.role() = 'service_role' OR
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
      )
    )
  );

DROP POLICY IF EXISTS "Evidence private select restricted" ON storage.objects;
CREATE POLICY "Evidence private select restricted"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'issue-evidence-private' AND (
      auth.role() = 'service_role' OR
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
      ) OR
      EXISTS (
        SELECT 1 FROM public.booking_issues bi
        WHERE bi.reporter_id = auth.uid()
          AND storage.objects.name LIKE 'issues/' || bi.id::text || '/%'
      )
    )
  );

-- G.3: Property Media Audits (Append-Only)
CREATE TABLE IF NOT EXISTS public.property_media_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_id UUID NULL REFERENCES public.rooms(id) ON DELETE CASCADE,
  action TEXT NOT NULL,
  source_bucket TEXT NOT NULL,
  target_bucket TEXT,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  execution_status TEXT NOT NULL DEFAULT 'success',
  operation_id UUID DEFAULT gen_random_uuid(),
  media_revision INT DEFAULT 1,
  metadata JSONB DEFAULT '{}'::jsonb,
  CONSTRAINT chk_property_media_action CHECK (
    action IN ('staging_upload', 'public_promotion', 'quarantine_demotion', 'deletion_cleanup', 'admin_override')
  )
);

CREATE INDEX IF NOT EXISTS idx_media_audits_property ON public.property_media_audits (property_id);
CREATE INDEX IF NOT EXISTS idx_media_audits_path ON public.property_media_audits (storage_path);

-- Append-Only Trigger on Media Audits
CREATE OR REPLACE FUNCTION public.prevent_property_media_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'property_media_audits is strictly append-only: UPDATE or DELETE not permitted.'
    USING ERRCODE = '23505';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_property_media_audit_mutation ON public.property_media_audits;
CREATE TRIGGER trg_prevent_property_media_audit_mutation
  BEFORE UPDATE OR DELETE ON public.property_media_audits
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_property_media_audit_mutation();

ALTER TABLE public.property_media_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all media audits" ON public.property_media_audits;
CREATE POLICY "Admins can view all media audits"
  ON public.property_media_audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND (p.role = 'admin' OR p.is_admin = true)
    )
  );

DROP POLICY IF EXISTS "Hosts can view own property media audits" ON public.property_media_audits;
CREATE POLICY "Hosts can view own property media audits"
  ON public.property_media_audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      JOIN public.host_profiles hp ON hp.id = prop.host_id
      WHERE prop.id = property_media_audits.property_id AND hp.user_id = auth.uid()
    )
  );


-- ==============================================================================
-- BATCH H: GENERATION-SAFE MEDIA CONSISTENCY
-- ==============================================================================

-- H.1: Add media revision & publication status to properties
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS media_revision INT NOT NULL DEFAULT 1;
ALTER TABLE public.properties ADD COLUMN IF NOT EXISTS media_publication_status TEXT NOT NULL DEFAULT 'not_published';

-- Explicit CHECK constraint on media_publication_status
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS chk_properties_media_publication_status;
ALTER TABLE public.properties ADD CONSTRAINT chk_properties_media_publication_status
  CHECK (media_publication_status IN ('not_published', 'publishing', 'published', 'reconciliation_required'));

-- CRITICAL CORRECTION: Set media_publication_status = 'not_published' (NOT 'published')
-- Because production storage is empty and zero verified public media objects exist.
UPDATE public.properties
SET media_publication_status = 'not_published',
    media_revision = 1,
    updated_at = now()
WHERE id IN (
  '20000000-0000-4000-8000-000000000001',
  '20000000-0000-4000-8000-000000000002',
  '20000000-0000-4000-8000-000000000003',
  '20000000-0000-4000-8000-000000000004',
  '20000000-0000-4000-8000-000000000005',
  '20000000-0000-4000-8000-000000000006',
  '20000000-0000-4000-8000-000000000007',
  '20000000-0000-4000-8000-000000000008'
);

-- H.2: Media Revision Monotonic Increment Guard
CREATE OR REPLACE FUNCTION public.trg_properties_media_revision_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.media_revision < OLD.media_revision THEN
    RAISE EXCEPTION 'media_revision must be monotonically increasing. Current: %, Attempted: %',
      OLD.media_revision, NEW.media_revision USING ERRCODE = '22023';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_properties_media_revision ON public.properties;
CREATE TRIGGER trg_properties_media_revision
  BEFORE UPDATE OF media_revision ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_properties_media_revision_guard();

COMMIT;
-- ==============================================================================
-- END OF RECONCILIATION SCRIPT
-- ==============================================================================
