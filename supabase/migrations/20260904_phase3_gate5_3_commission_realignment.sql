-- ==============================================================================
-- PHASE 3 — GATE #5.3: THREE-PARTY PARTNER-DEDUCTED COMMISSION REALIGNMENT
-- MIGRATION: 20260904_phase3_gate5_3_commission_realignment.sql
--
-- AUTHORITATIVE BUSINESS MODEL:
-- 1. The guest pays the advertised gross price (Accommodation + Car Service + Deposit).
--    TheArk Rooms does NOT add a separate visible commission to the guest.
-- 2. TheArk Rooms earns commission by deducting it from the partner settlements.
-- 3. Three economic parties:
--    a. Hotel/Host (Accommodation: negotiated 10.00% - 15.00% deducted from gross)
--    b. Car Service Provider (Logistics: exactly 10.00% deducted from gross)
--    c. TheArk Rooms (Platform revenue from deducted commissions)
-- 4. Full financial conservation:
--    Guest Total = Host Net + Car Provider Net + Ark Commission + Damage Deposit
-- ==============================================================================

-- ==============================================================================
-- 1. HOST COMMISSION RATE (Server-Side Authoritative Configuration)
-- ==============================================================================
ALTER TABLE public.host_profiles
ADD COLUMN IF NOT EXISTS commission_rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00;

-- Enforce negotiated boundary: 10.00% to 15.00%
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_host_profiles_commission_rate'
  ) THEN
    ALTER TABLE public.host_profiles
    ADD CONSTRAINT chk_host_profiles_commission_rate
    CHECK (commission_rate_percentage >= 10.00 AND commission_rate_percentage <= 15.00);
  END IF;
END $$;

-- Trigger to prevent unauthorized modification of commission_rate_percentage
CREATE OR REPLACE FUNCTION public.fn_protect_host_commission_rate()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_service BOOLEAN := (
    v_jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
    OR session_user IN ('postgres', 'service_role', 'supabase_admin')
  );
  v_is_admin BOOLEAN := (
    v_caller_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    )
  );
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT v_is_service AND NOT v_is_admin THEN
      NEW.commission_rate_percentage := 10.00;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF (NEW.commission_rate_percentage IS DISTINCT FROM OLD.commission_rate_percentage) AND NOT v_is_service AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Unauthorized: only platform administrators can establish or modify partner commission rates.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_host_commission_rate ON public.host_profiles;
CREATE TRIGGER trg_protect_host_commission_rate
  BEFORE INSERT OR UPDATE ON public.host_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_protect_host_commission_rate();

-- Admin RPC to configure host commission rate
CREATE OR REPLACE FUNCTION public.admin_update_host_commission_rate(
  p_host_id UUID,
  p_commission_rate NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_caller_id UUID := auth.uid();
  v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claim.role', true), '');
  v_is_admin BOOLEAN;
  v_host RECORD;
  v_rate NUMERIC(5,2);
BEGIN
  v_is_admin := (
    (v_caller_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    ))
    OR v_jwt_role = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin')
  );

  IF NOT v_is_admin THEN
    RAISE EXCEPTION 'Unauthorized: only platform administrators can configure partner commission rates.'
      USING ERRCODE = '42501';
  END IF;

  IF p_host_id IS NULL THEN
    RAISE EXCEPTION 'p_host_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_commission_rate IS NULL THEN
    RAISE EXCEPTION 'p_commission_rate is required' USING ERRCODE = '22023';
  END IF;

  v_rate := ROUND(p_commission_rate, 2);

  IF v_rate < 10.00 OR v_rate > 15.00 THEN
    RAISE EXCEPTION 'Commission rate must be between 10.00%% and 15.00%% (received %)', v_rate
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_host FROM public.host_profiles WHERE id = p_host_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Host profile % not found', p_host_id USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.host_profiles
  SET
    commission_rate_percentage = v_rate,
    updated_at = now()
  WHERE id = p_host_id;

  RETURN jsonb_build_object(
    'success', true,
    'host_id', p_host_id,
    'commission_rate_percentage', v_rate
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_update_host_commission_rate(UUID, NUMERIC) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_update_host_commission_rate(UUID, NUMERIC) TO authenticated;

-- ==============================================================================
-- 2. LOGISTICS PROVIDER ENTITIES (Car-Service Provider Party)
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.logistics_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT,
  company_name TEXT NOT NULL,
  contact_email TEXT NULL,
  contact_phone TEXT NULL,
  provider_status TEXT NOT NULL DEFAULT 'active' CHECK (provider_status IN ('pending', 'active', 'suspended')),
  commission_rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00 CHECK (commission_rate_percentage = 10.00),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.logistics_payout_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.logistics_providers(id) ON DELETE CASCADE,
  bank_name TEXT NOT NULL,
  bank_code TEXT NOT NULL,
  account_number_masked TEXT NOT NULL,
  account_name TEXT NOT NULL,
  paystack_recipient_code TEXT NOT NULL UNIQUE,
  is_verified BOOLEAN NOT NULL DEFAULT FALSE,
  is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Associate logistics requests with dedicated provider
ALTER TABLE public.logistics_requests
ADD COLUMN IF NOT EXISTS provider_id UUID REFERENCES public.logistics_providers(id) ON DELETE SET NULL;

-- Seed canonical fleet logistics provider
INSERT INTO public.logistics_providers (
  id,
  company_name,
  contact_email,
  provider_status,
  commission_rate_percentage
) VALUES (
  '70000000-0000-4000-8000-000000000001',
  'TheArk Executive Chauffeur & Logistics Fleet',
  'fleet@thearkrooms.com',
  'active',
  10.00
) ON CONFLICT (id) DO UPDATE
SET
  commission_rate_percentage = 10.00,
  provider_status = 'active';

-- ==============================================================================
-- 3. PARTNER PAYOUTS MULTI-PARTY RESTRUCTURING
-- ==============================================================================

-- Remove 1:1 booking constraint to allow accommodation + logistics payouts
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.partner_payouts'::regclass
    AND contype = 'u'
    AND array_to_string(conkey, ',') = (
      SELECT attnum::text
      FROM pg_attribute
      WHERE attrelid = 'public.partner_payouts'::regclass AND attname = 'booking_id'
    );
  IF v_conname IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.partner_payouts DROP CONSTRAINT ' || quote_ident(v_conname);
  END IF;
END $$;

ALTER TABLE public.partner_payouts DROP CONSTRAINT IF EXISTS partner_payouts_booking_id_key;
DROP INDEX IF EXISTS public.idx_partner_payouts_booking_id_unique;

-- Add settlement category (accommodation vs logistics)
ALTER TABLE public.partner_payouts
ADD COLUMN IF NOT EXISTS payout_category TEXT NOT NULL DEFAULT 'accommodation'
  CHECK (payout_category IN ('accommodation', 'logistics'));

-- Add authoritative financial snapshot fields
ALTER TABLE public.partner_payouts
ADD COLUMN IF NOT EXISTS gross_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0
  CHECK (gross_amount_ngn >= 0);

ALTER TABLE public.partner_payouts
ADD COLUMN IF NOT EXISTS commission_rate_percentage NUMERIC(5,2) NOT NULL DEFAULT 10.00
  CHECK (commission_rate_percentage >= 10.00 AND commission_rate_percentage <= 15.00);

ALTER TABLE public.partner_payouts
ADD COLUMN IF NOT EXISTS commission_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0
  CHECK (commission_amount_ngn >= 0);

ALTER TABLE public.partner_payouts
ADD COLUMN IF NOT EXISTS provider_id UUID NULL REFERENCES public.logistics_providers(id) ON DELETE RESTRICT;

ALTER TABLE public.partner_payouts
ADD COLUMN IF NOT EXISTS logistics_payout_profile_id UUID NULL REFERENCES public.logistics_payout_profiles(id) ON DELETE RESTRICT;

-- Safe backfill of gross_amount_ngn for existing historical records (without altering historical partner_amount_ngn)
UPDATE public.partner_payouts
SET gross_amount_ngn = COALESCE(gross_accommodation_amount_ngn, partner_amount_ngn)
WHERE gross_amount_ngn = 0;

-- Composite uniqueness: Exactly one accommodation payout and one logistics payout per booking
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_partner_payouts_booking_category'
  ) THEN
    ALTER TABLE public.partner_payouts
    ADD CONSTRAINT uq_partner_payouts_booking_category UNIQUE (booking_id, payout_category);
  END IF;
END $$;

-- Strict recipient isolation check constraint:
-- Accommodation payout MUST have host identity and provider_id IS NULL
-- Logistics payout MUST have provider_id and host_id IS NULL
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_partner_payouts_recipient_isolation'
  ) THEN
    ALTER TABLE public.partner_payouts
    ADD CONSTRAINT chk_partner_payouts_recipient_isolation CHECK (
      (payout_category = 'accommodation' AND (host_id IS NOT NULL OR host_user_id IS NOT NULL) AND provider_id IS NULL)
      OR
      (payout_category = 'logistics' AND provider_id IS NOT NULL AND host_id IS NULL)
    );
  END IF;
END $$;

-- Indexes for category and provider lookups
CREATE INDEX IF NOT EXISTS idx_partner_payouts_booking_category ON public.partner_payouts(booking_id, payout_category);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_category_status ON public.partner_payouts(payout_category, status);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_provider_id ON public.partner_payouts(provider_id);

-- ==============================================================================
-- 4. ROW LEVEL SECURITY & DML PROTECTION
-- ==============================================================================
ALTER TABLE public.logistics_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.logistics_payout_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and providers can view providers" ON public.logistics_providers;
CREATE POLICY "Admins and providers can view providers"
  ON public.logistics_providers FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = auth.uid() AND p.role = 'admin')
  );

DROP POLICY IF EXISTS "Hosts can view own payouts" ON public.partner_payouts;
DROP POLICY IF EXISTS "Partners can view own payouts" ON public.partner_payouts;
CREATE POLICY "Partners can view own payouts"
  ON public.partner_payouts FOR SELECT
  TO authenticated
  USING (
    -- Accommodation host
    (
      payout_category = 'accommodation'
      AND (
        host_user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.host_profiles hp
          WHERE hp.id = partner_payouts.host_id AND hp.user_id = auth.uid()
        )
      )
    )
    OR
    -- Logistics car service provider
    (
      payout_category = 'logistics'
      AND EXISTS (
        SELECT 1 FROM public.logistics_providers lp
        WHERE lp.id = partner_payouts.provider_id AND lp.user_id = auth.uid()
      )
    )
    OR
    -- Platform Admin
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Direct client mutation revokes:
REVOKE ALL ON public.logistics_providers FROM PUBLIC, anon;
GRANT SELECT ON public.logistics_providers TO authenticated;

REVOKE ALL ON public.logistics_payout_profiles FROM PUBLIC, anon;
GRANT SELECT ON public.logistics_payout_profiles TO authenticated;

REVOKE INSERT, UPDATE, DELETE ON public.partner_payouts FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.partner_payouts TO authenticated;

-- Revoke direct client access to balanced ledger transaction
REVOKE ALL ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;

-- ==============================================================================
-- 5. ATOMIC THREE-PARTY SETTLEMENT RPC REWRITE
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

  -- 11. Record canonical Payment
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

  -- 12. Create Host Accommodation Partner Payout (Net settlement)
  INSERT INTO public.partner_payouts (
    booking_id,
    host_id,
    host_user_id,
    payout_category,
    gross_amount_ngn,
    gross_accommodation_amount_ngn,
    commission_rate_percentage,
    commission_amount_ngn,
    partner_amount_ngn,
    status,
    scheduled_eligibility_at,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    v_host_profile_id,
    v_host_user_id,
    'accommodation',
    v_auth_room_total,
    v_auth_room_total,
    v_host_commission_rate,
    v_ark_accommodation_commission,
    v_host_net_settlement,
    'allocated',
    NULL,
    v_now,
    v_now
  )
  ON CONFLICT (booking_id, payout_category) DO UPDATE
  SET
    gross_amount_ngn = EXCLUDED.gross_amount_ngn,
    commission_rate_percentage = EXCLUDED.commission_rate_percentage,
    commission_amount_ngn = EXCLUDED.commission_amount_ngn,
    partner_amount_ngn = EXCLUDED.partner_amount_ngn,
    updated_at = v_now
  RETURNING id INTO v_accommodation_payout_id;

  -- 13. Create Car Provider Logistics Partner Payout (if logistics attached)
  IF v_auth_logistics_total > 0 THEN
    INSERT INTO public.partner_payouts (
      booking_id,
      provider_id,
      payout_category,
      gross_amount_ngn,
      commission_rate_percentage,
      commission_amount_ngn,
      partner_amount_ngn,
      status,
      scheduled_eligibility_at,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_logistics_provider_id,
      'logistics',
      v_auth_logistics_total,
      10.00,
      v_ark_logistics_commission,
      v_provider_net_settlement,
      'allocated',
      NULL,
      v_now,
      v_now
    )
    ON CONFLICT (booking_id, payout_category) DO UPDATE
    SET
      gross_amount_ngn = EXCLUDED.gross_amount_ngn,
      commission_rate_percentage = EXCLUDED.commission_rate_percentage,
      commission_amount_ngn = EXCLUDED.commission_amount_ngn,
      partner_amount_ngn = EXCLUDED.partner_amount_ngn,
      updated_at = v_now
    RETURNING id INTO v_logistics_payout_id;
  END IF;

  -- 14. Damage Deposit Escrow Record (if applicable)
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

  -- 15. DOUBLE-ENTRY BALANCED FINANCIAL LEDGER POSTINGS
  -- Inflow: 1010 Gateway Clearing -> 2010 Guest Unearned Revenue
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

  -- Host Net Settlement: 2010 Guest Unearned Revenue -> 2100 Partner Payout Payable
  IF v_host_net_settlement > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'ACCOMMODATION_HOST_NET',
      v_clean_ref || '-HOST-NET',
      'Host net settlement allocation (' || (100.00 - v_host_commission_rate)::TEXT || '%)',
      '2010 - Guest Unearned Revenue',
      '2100 - Partner Payout Payable',
      v_host_net_settlement
    );
  END IF;

  -- TheArk Rooms Accommodation Commission: 2010 Guest Unearned Revenue -> 4010 Accommodation Platform Commission Revenue
  IF v_ark_accommodation_commission > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'ACCOMMODATION_COMMISSION',
      v_clean_ref || '-ARK-COMM-ROOM',
      'TheArk Rooms accommodation commission revenue (' || v_host_commission_rate::TEXT || '%)',
      '2010 - Guest Unearned Revenue',
      '4010 - Accommodation Platform Commission Revenue',
      v_ark_accommodation_commission
    );
  END IF;

  -- Logistics Provider Net Settlement: 2010 Guest Unearned Revenue -> 2110 Logistics Provider Payable
  IF v_provider_net_settlement > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'LOGISTICS_PROVIDER_NET',
      v_clean_ref || '-LOG-NET',
      'Car service provider net settlement allocation (90%)',
      '2010 - Guest Unearned Revenue',
      '2110 - Logistics Provider Payable',
      v_provider_net_settlement
    );
  END IF;

  -- TheArk Rooms Car Service Commission: 2010 Guest Unearned Revenue -> 4020 Car Service Platform Commission Revenue
  IF v_ark_logistics_commission > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'LOGISTICS_COMMISSION',
      v_clean_ref || '-ARK-COMM-LOG',
      'TheArk Rooms car service commission revenue (10%)',
      '2010 - Guest Unearned Revenue',
      '4020 - Car Service Platform Commission Revenue',
      v_ark_logistics_commission
    );
  END IF;

  -- Damage Deposit Escrow Liability (if collected)
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

  -- 16. Return Authoritative Sanitized Receipt
  -- Strictly excludes partner commission rates, amounts, or net settlements
  RETURN jsonb_build_object(
    'success', true,
    'already_settled', false,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'payment_id', v_payment_id,
    'payment_status', 'paid',
    'booking_status', CASE WHEN v_booking.booking_status = 'pending' THEN 'confirmed' ELSE v_booking.booking_status END,
    'room_total_ngn', v_auth_room_total,
    'logistics_total_ngn', v_auth_logistics_total,
    'damage_deposit_ngn', v_auth_damage_deposit,
    'total_amount_ngn', v_auth_total,
    'message', 'Booking payment verified and settled successfully.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role, authenticated;

-- ==============================================================================
-- 6. AUTHORIZE PARTNER PAYOUT RECIPIENT AND DISPATCH UPDATE
-- Ensures host payouts use host recipient and logistics payouts use provider recipient
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
  v_logistics_provider RECORD;
  v_logistics_payout_profile RECORD;
  v_has_tier3_dispute BOOLEAN;
  v_transfer_ref TEXT;
  v_now TIMESTAMPTZ := now();
  v_recipient_code TEXT;
  v_bank_name TEXT;
  v_bank_code TEXT;
  v_account_name TEXT;
  v_account_masked TEXT;
BEGIN
  -- 1. Security Check: Restricted strictly to service_role or platform administrators
  IF v_caller_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.profiles p WHERE p.id = v_caller_id AND p.role = 'admin'
    ) THEN
      RAISE EXCEPTION 'Unauthorized: partner payout authorization is restricted to service role or platform administrators.'
        USING ERRCODE = '42501';
    END IF;
  ELSE
    IF v_jwt_role != 'service_role' AND current_user NOT IN ('postgres', 'service_role', 'supabase_admin') THEN
      RAISE EXCEPTION 'Unauthorized: service role required.' USING ERRCODE = '42501';
    END IF;
  END IF;

  -- 2. Lookup Booking ID associated with target payout
  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. CANONICAL LOCK ORDER: Lock booking first, then lock partner_payout
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

  -- 4. Check for Active Tier 3 Disputes
  SELECT EXISTS (
    SELECT 1 FROM public.booking_issues bi
    WHERE bi.booking_id = v_booking.id
      AND bi.issue_tier = 'tier_3'
      AND bi.status NOT IN ('resolved_dismissed', 'resolved_compensated')
  ) INTO v_has_tier3_dispute;

  IF v_has_tier3_dispute THEN
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

  -- 5. Invariant Checks on Payout Status
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

  -- 6. Invariant Checks on Booking Record
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

  -- 7. RECIPIENT VALIDATION & PROFILE ISOLATION:
  IF v_payout.payout_category = 'logistics' THEN
    -- Validate Logistics Provider Party
    IF v_payout.provider_id IS NULL THEN
      RAISE EXCEPTION 'Logistics payout % lacks provider_id', p_payout_id USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_logistics_provider
    FROM public.logistics_providers
    WHERE id = v_payout.provider_id;

    IF v_logistics_provider.id IS NULL THEN
      RAISE EXCEPTION 'Logistics provider % not found for payout %', v_payout.provider_id, p_payout_id USING ERRCODE = 'P0002';
    END IF;

    IF v_logistics_provider.provider_status != 'active' THEN
      RAISE EXCEPTION 'Logistics provider account is "%" (must be "active" to receive payouts)', v_logistics_provider.provider_status USING ERRCODE = '22023';
    END IF;

    SELECT * INTO v_logistics_payout_profile
    FROM public.logistics_payout_profiles
    WHERE provider_id = v_logistics_provider.id
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'No logistics payout profile configured for provider %', v_logistics_provider.id USING ERRCODE = 'P0002';
    END IF;

    IF NOT v_logistics_payout_profile.is_verified THEN
      RAISE EXCEPTION 'Logistics payout profile % is not verified', v_logistics_payout_profile.id USING ERRCODE = '22023';
    END IF;

    IF v_logistics_payout_profile.is_locked THEN
      RAISE EXCEPTION 'Logistics payout profile % is locked', v_logistics_payout_profile.id USING ERRCODE = '22023';
    END IF;

    IF v_logistics_payout_profile.paystack_recipient_code IS NULL OR length(trim(v_logistics_payout_profile.paystack_recipient_code)) = 0 THEN
      RAISE EXCEPTION 'Logistics payout profile % is missing Paystack recipient code', v_logistics_payout_profile.id USING ERRCODE = '22023';
    END IF;

    v_recipient_code := v_logistics_payout_profile.paystack_recipient_code;
    v_bank_name := v_logistics_payout_profile.bank_name;
    v_bank_code := v_logistics_payout_profile.bank_code;
    v_account_name := v_logistics_payout_profile.account_name;
    v_account_masked := v_logistics_payout_profile.account_number_masked;

  ELSE
    -- Validate Host Party (Accommodation)
    IF v_payout.host_id IS NOT NULL THEN
      SELECT * INTO v_host_profile
      FROM public.host_profiles
      WHERE id = v_payout.host_id;
    END IF;

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

    v_recipient_code := v_payout_profile.paystack_recipient_code;
    v_bank_name := v_payout_profile.bank_name;
    v_bank_code := v_payout_profile.bank_code;
    v_account_name := v_payout_profile.account_name;
    v_account_masked := v_payout_profile.account_number_masked;
  END IF;

  -- 8. Deterministic Transfer Reference
  v_transfer_ref := COALESCE(v_payout.paystack_transfer_reference, 'ARK-TRF-' || v_payout.id::TEXT);

  -- 9. Atomic Authorization & Transition to Processing
  UPDATE public.partner_payouts
  SET
    status = 'processing',
    authorized_at = v_now,
    processing_started_at = v_now,
    paystack_transfer_reference = v_transfer_ref,
    paystack_recipient_code_snapshot = v_recipient_code,
    recipient_bank_name_snapshot = v_bank_name,
    recipient_bank_code_snapshot = v_bank_code,
    recipient_account_name_snapshot = v_account_name,
    recipient_account_number_masked = v_account_masked,
    attempt_count = COALESCE(attempt_count, 0) + 1,
    last_attempt_at = v_now,
    updated_at = v_now
  WHERE id = v_payout.id;

  -- 10. Audit Entry
  INSERT INTO public.admin_payout_audits (
    partner_payout_id,
    booking_id,
    action,
    performed_by,
    caller_role,
    previous_status,
    new_status,
    transfer_reference,
    reason,
    metadata
  ) VALUES (
    v_payout.id,
    v_booking.id,
    'AUTHORIZE',
    v_caller_id,
    CASE WHEN v_jwt_role = 'service_role' THEN 'service_role' ELSE 'admin' END,
    v_payout.status,
    'processing',
    v_transfer_ref,
    'Payout authorized for ' || v_payout.payout_category || ' disbursement via Paystack transfer',
    jsonb_build_object(
      'payout_category', v_payout.payout_category,
      'partner_amount_ngn', v_payout.partner_amount_ngn,
      'gross_amount_ngn', v_payout.gross_amount_ngn,
      'commission_amount_ngn', v_payout.commission_amount_ngn,
      'recipient_code', v_recipient_code
    )
  );

  RETURN jsonb_build_object(
    'success', true,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'payout_category', v_payout.payout_category,
    'partner_amount_ngn', v_payout.partner_amount_ngn,
    'paystack_transfer_reference', v_transfer_ref,
    'status', 'processing',
    'recipient_snapshot', jsonb_build_object(
      'recipient_code', v_recipient_code,
      'bank_name', v_bank_name,
      'bank_code', v_bank_code,
      'account_name', v_account_name,
      'account_number_masked', v_account_masked
    ),
    'reason', 'Authorized for ' || v_payout.payout_category || ' disbursement'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize_partner_payout(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.authorize_partner_payout(UUID) TO service_role;

-- ==============================================================================
-- 7. SETTLE PARTNER PAYOUT TRANSFER UPDATE
-- Debits 2100 Partner Payout Payable for accommodation,
-- Debits 2110 Logistics Provider Payable for logistics
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.settle_partner_payout_transfer(
  p_payout_id UUID,
  p_transfer_reference TEXT,
  p_paystack_transfer_code TEXT DEFAULT NULL,
  p_paystack_response JSONB DEFAULT '{}'::jsonb
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
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_now TIMESTAMPTZ := now();
  v_prior_status TEXT;
  v_ledger_result JSONB;
  v_debit_account TEXT;
BEGIN
  -- 1. Security Authorization: service_role or admin
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
    RAISE EXCEPTION 'Unauthorized: partner payout settlement is restricted to service role or platform administrators.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Input validation
  IF p_payout_id IS NULL THEN
    RAISE EXCEPTION 'p_payout_id is required' USING ERRCODE = '22023';
  END IF;

  IF p_transfer_reference IS NULL OR TRIM(p_transfer_reference) = '' THEN
    RAISE EXCEPTION 'p_transfer_reference is required' USING ERRCODE = '22023';
  END IF;

  -- 3. Lookup booking ID associated with payout
  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 4. CANONICAL LOCK ORDER: Lock booking first, then lock partner_payout
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

  v_prior_status := v_payout.status;

  -- 5. Reference Verification: Must match the permanent payout reference
  IF v_payout.paystack_transfer_reference IS DISTINCT FROM TRIM(p_transfer_reference) THEN
    RAISE EXCEPTION 'Transfer reference mismatch: expected "%", received "%"',
      v_payout.paystack_transfer_reference, p_transfer_reference USING ERRCODE = '22023';
  END IF;

  -- 6. Idempotency Check
  IF v_payout.status = 'completed' THEN
    RETURN jsonb_build_object(
      'success', true,
      'already_completed', true,
      'payout_id', v_payout.id,
      'booking_id', v_booking.id,
      'status', 'completed',
      'partner_amount_ngn', v_payout.partner_amount_ngn,
      'paystack_transfer_reference', v_payout.paystack_transfer_reference,
      'paystack_transfer_code', v_payout.paystack_transfer_code,
      'disbursed_at', v_payout.disbursed_at,
      'message', 'Partner payout transfer has already been completed.'
    );
  END IF;

  -- 7. Validate Payout Status: Must be processing or reconciliation_required
  IF v_payout.status NOT IN ('processing', 'reconciliation_required') THEN
    RAISE EXCEPTION 'Invalid payout status "%" for transfer settlement (must be "processing" or "reconciliation_required")',
      v_payout.status USING ERRCODE = '22023';
  END IF;

  -- 8. Verify Amount Invariant
  IF v_payout.partner_amount_ngn IS NULL OR v_payout.partner_amount_ngn <= 0 THEN
    RAISE EXCEPTION 'Invalid partner payout amount: %', v_payout.partner_amount_ngn USING ERRCODE = '22023';
  END IF;

  -- 9. Transition payout to completed
  UPDATE public.partner_payouts
  SET
    status = 'completed',
    disbursed_at = COALESCE(v_payout.disbursed_at, v_now),
    paystack_transfer_code = COALESCE(TRIM(p_paystack_transfer_code), v_payout.paystack_transfer_code),
    reconciled_at = CASE WHEN v_prior_status = 'reconciliation_required' THEN v_now ELSE v_payout.reconciled_at END,
    reconciliation_notes = CASE
      WHEN v_prior_status = 'reconciliation_required' THEN
        COALESCE(v_payout.reconciliation_notes, '') || ' [Settled and reconciled via Paystack confirmation at ' || v_now::TEXT || ']'
      ELSE v_payout.reconciliation_notes
    END,
    updated_at = v_now
  WHERE id = v_payout.id;

  -- 10. POST BALANCED LEDGER DISBURSEMENT:
  -- If accommodation: DEBIT 2100 Partner Payout Payable, CREDIT 1010 Gateway Clearing
  -- If logistics:     DEBIT 2110 Logistics Provider Payable, CREDIT 1010 Gateway Clearing
  v_debit_account := CASE
    WHEN v_payout.payout_category = 'logistics' THEN '2110 - Logistics Provider Payable'
    ELSE '2100 - Partner Payout Payable'
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.financial_ledger
    WHERE reference = v_payout.paystack_transfer_reference
      AND transaction_type = 'PARTNER_PAYOUT_DISBURSED'
  ) THEN
    v_ledger_result := public.record_balanced_ledger_transaction(
      p_transaction_group_id => gen_random_uuid(),
      p_booking_id => v_booking.id,
      p_transaction_type => 'PARTNER_PAYOUT_DISBURSED',
      p_reference => v_payout.paystack_transfer_reference,
      p_description => v_payout.payout_category || ' partner payout disbursement for booking ' || v_booking.booking_reference || ' via ref: ' || v_payout.paystack_transfer_reference,
      p_debit_account => v_debit_account,
      p_credit_account => '1010 - Gateway Clearing (Paystack)',
      p_amount_ngn => v_payout.partner_amount_ngn
    );
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'already_completed', false,
    'payout_id', v_payout.id,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'payout_category', v_payout.payout_category,
    'status', 'completed',
    'partner_amount_ngn', v_payout.partner_amount_ngn,
    'paystack_transfer_reference', v_payout.paystack_transfer_reference,
    'paystack_transfer_code', COALESCE(TRIM(p_paystack_transfer_code), v_payout.paystack_transfer_code),
    'disbursed_at', COALESCE(v_payout.disbursed_at, v_now)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_partner_payout_transfer(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_partner_payout_transfer(UUID, TEXT, TEXT, JSONB) TO service_role;
