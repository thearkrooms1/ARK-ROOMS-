-- ==============================================================================
-- PHASE 3 — GATE #9.2: PROPERTY-TYPE PAYOUT BIFURCATION
-- MIGRATION: 20260905_phase3_gate9_2_payout_bifurcation.sql
--
-- AUTHORITATIVE BUSINESS RULES (LOCKED GATE #9.1):
-- 1. Property-Type Classification (Server-Authoritative):
--    - 'individual_host': Privately managed serviced apartment / boutique stay / villa
--    - 'hotel_organization': Commercial hotel organization / enterprise property
-- 2. Commission-First Rule:
--    The Ark Rooms platform commission is calculated from the full gross accommodation amount
--    BEFORE any allocation splits or reserve holds.
--    v_commission = ROUND(v_gross_room_total * (v_commission_rate / 100.00), 2)
--    v_net_settlement_pool = v_gross_room_total - v_commission
-- 3. Individual Host Settlement Bifurcation:
--    - Host Net Payout (80% of net pool): ROUND(v_net_settlement_pool * 0.80, 2)
--    - Guest Assurance Reserve (20% of net pool): v_net_settlement_pool - v_host_net_payout
--    - Guest Assurance Reserve record inserted into public.guest_assurance_reserves
--    - Ledger mutation: Dr 2010 (Guest Unearned Revenue) -> Cr 2040 (Guest Assurance Reserve Liability)
-- 4. Hotel / Organization Settlement Bifurcation:
--    - Hotel Net Payout (100% of net pool): v_net_settlement_pool
--    - NO Guest Assurance Reserve record is created (0% reserve)
--    - Zero postings to Account 2040 (Reserve Liability)
-- 5. Protection Window & Payout Scheduling:
--    - Individual Host: actual_check_in_at + 4 hours
--    - Hotel / Organization: actual_check_in_at + 24 hours
-- 6. Damage Deposit & Claim Exclusion for Hotels:
--    - Hotels are excluded from damage deposit requirements and damage claims.
--    - submit_damage_claim rejects claims against hotel properties.
-- ==============================================================================

-- ==============================================================================
-- 1. ADD partner_tier TO public.properties WITH INTEGRITY CONSTRAINTS
-- ==============================================================================
ALTER TABLE public.properties
ADD COLUMN IF NOT EXISTS partner_tier TEXT NOT NULL DEFAULT 'individual_host';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_properties_partner_tier'
  ) THEN
    ALTER TABLE public.properties
    ADD CONSTRAINT chk_properties_partner_tier
    CHECK (partner_tier IN ('individual_host', 'hotel_organization'));
  END IF;
END $$;

-- Backfill authoritative classification for existing properties:
-- Commercial Hotels / Organizations:
UPDATE public.properties
SET partner_tier = 'hotel_organization',
    requires_damage_deposit = FALSE,
    damage_deposit_amount_ngn = 0
WHERE id IN (
  '20000000-0000-4000-8000-000000000001', -- Transcorp Hilton Abuja
  '20000000-0000-4000-8000-000000000002', -- Abuja Continental Hotel
  '20000000-0000-4000-8000-000000000004', -- Maitama Diplomatic Event Suites
  '20000000-0000-4000-8000-000000000005', -- Nordic Hotel Abuja
  '20000000-0000-4000-8000-000000000006'  -- The Wells Carlton Hotel & Apartments
);

-- Individual Hosts / Serviced Apartments / Boutique Residences:
UPDATE public.properties
SET partner_tier = 'individual_host'
WHERE id IN (
  '20000000-0000-4000-8000-000000000003', -- Fraser Suites Abuja
  '20000000-0000-4000-8000-000000000007', -- Hawthorn Suites by Wyndham Abuja
  '20000000-0000-4000-8000-000000000008'  -- Villa One Boutique Hotel Gwarinpa
);

-- Protect partner_tier against unauthorized direct client mutations
CREATE OR REPLACE FUNCTION public.fn_protect_property_partner_tier()
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
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.partner_tier IS DISTINCT FROM OLD.partner_tier) AND NOT v_is_service AND NOT v_is_admin THEN
      RAISE EXCEPTION 'Unauthorized: only platform administrators can modify property partner tier classification.'
        USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_property_partner_tier ON public.properties;
CREATE TRIGGER trg_protect_property_partner_tier
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_protect_property_partner_tier();


-- ==============================================================================
-- 2. UPDATE SETTLEMENT RPC (public.settle_successful_booking_payment)
-- Authoritative Commission-First & Property-Type Payout Bifurcation
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.settle_successful_booking_payment(
  p_booking_id UUID,
  p_payment_reference TEXT,
  p_amount_paid NUMERIC,
  p_provider TEXT DEFAULT 'paystack',
  p_channel TEXT DEFAULT 'card',
  p_gateway_response JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_booking RECORD;
  v_existing_payment RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_ref TEXT;
  v_auth_room_total NUMERIC(14,2);
  v_auth_logistics_total NUMERIC(14,2);
  v_auth_damage_deposit NUMERIC(14,2);
  v_auth_total NUMERIC(14,2);
  v_host_commission_rate NUMERIC(5,2);
  v_host_payout_profile RECORD;
  v_logistics_payout_profile RECORD;
  v_net_settlement_pool NUMERIC(14,2);
  v_host_net_settlement NUMERIC(14,2);
  v_reserve_allocation NUMERIC(14,2) := 0;
  v_ark_accommodation_commission NUMERIC(14,2);
  v_provider_net_settlement NUMERIC(14,2);
  v_ark_logistics_commission NUMERIC(14,2);
  v_room_payout_id UUID;
  v_logistics_payout_id UUID;
  v_deposit_id UUID;
  v_reserve_id UUID;
  v_ledger_group_id UUID := gen_random_uuid();
  v_checkout_time_str TEXT;
  v_checkout_time TIME;
  v_stay_end TIMESTAMPTZ;
  v_inspection_deadline TIMESTAMPTZ;
  v_reserve_maturity TIMESTAMPTZ;
  v_property_tier TEXT;
BEGIN
  v_clean_ref := NULLIF(TRIM(p_payment_reference), '');
  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'Authoritative payment reference cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- 1. Lock and retrieve authoritative booking record along with property metadata
  SELECT b.*, p.host_id, p.check_out_time, p.requires_damage_deposit, p.damage_deposit_amount,
         COALESCE(p.partner_tier, 'individual_host') AS partner_tier
  INTO v_booking
  FROM public.bookings b
  JOIN public.properties p ON p.id = b.property_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found for payment settlement', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  v_property_tier := v_booking.partner_tier;

  -- 2. Idempotency Check: Return successfully if booking is already settled with this reference
  IF v_booking.payment_status = 'paid' THEN
    SELECT * INTO v_existing_payment
    FROM public.payments
    WHERE booking_id = v_booking.id AND transaction_reference = v_clean_ref;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'success', true,
        'booking_id', v_booking.id,
        'booking_reference', v_booking.booking_reference,
        'payment_status', 'paid',
        'booking_status', v_booking.booking_status,
        'message', 'Payment already settled idempotently'
      );
    ELSE
      RAISE EXCEPTION 'Booking % is already paid under a different payment reference', p_booking_id
        USING ERRCODE = '23505';
    END IF;
  END IF;

  -- 3. Precondition Verification: Ensure booking is still pending or confirmed (not cancelled or rejected)
  IF v_booking.booking_status IN ('cancelled', 'rejected') THEN
    RAISE EXCEPTION 'Cannot settle payment for booking % in "%" status', v_booking.id, v_booking.booking_status
      USING ERRCODE = '22023';
  END IF;

  -- 4. Calculate authoritative components from database fields
  v_auth_room_total := ROUND(COALESCE(v_booking.room_total_ngn, 0)::NUMERIC, 2);
  v_auth_logistics_total := ROUND(COALESCE(v_booking.logistics_total_ngn, 0)::NUMERIC, 2);
  v_auth_damage_deposit := ROUND(COALESCE(v_booking.damage_deposit_ngn, 0)::NUMERIC, 2);

  -- Hotels do NOT require damage deposits
  IF v_property_tier = 'hotel_organization' THEN
    v_auth_damage_deposit := 0;
  END IF;

  v_auth_total := v_auth_room_total + v_auth_logistics_total + v_auth_damage_deposit;

  -- 5. Exact Amount Verification: Paid amount must equal calculated total
  IF ROUND(p_amount_paid::NUMERIC, 2) <> v_auth_total THEN
    RAISE EXCEPTION 'Payment amount mismatch: received ₦%, authoritative booking total is ₦%',
      p_amount_paid, v_auth_total
      USING ERRCODE = '22023';
  END IF;

  -- 6. Retrieve Authoritative Host Commission Rate (default 10.00% if unconfigured)
  SELECT COALESCE(commission_rate_percentage, 10.00)
  INTO v_host_commission_rate
  FROM public.host_profiles
  WHERE id = v_booking.host_id;

  IF NOT FOUND OR v_host_commission_rate IS NULL THEN
    v_host_commission_rate := 10.00;
  END IF;

  -- 7. COMMISSION-FIRST CALCULATION (From Full Gross Accommodation Amount)
  -- The platform commission is taken from full gross BEFORE any splits.
  v_ark_accommodation_commission := ROUND(v_auth_room_total * (v_host_commission_rate / 100.00), 2);
  v_net_settlement_pool := v_auth_room_total - v_ark_accommodation_commission;

  -- 8. PROPERTY-TYPE PAYOUT BIFURCATION
  IF v_property_tier = 'hotel_organization' THEN
    -- HOTEL / ORGANIZATION:
    -- 100% of net settlement pool allocated to hotel payout
    -- 0% allocated to Guest Assurance Reserve
    v_host_net_settlement := v_net_settlement_pool;
    v_reserve_allocation := 0;
  ELSE
    -- INDIVIDUAL HOST:
    -- 80% of net settlement pool allocated to host payout
    -- 20% of net settlement pool allocated to Guest Assurance Reserve
    v_host_net_settlement := ROUND(v_net_settlement_pool * 0.80, 2);
    -- Reserve absorbs the exact remainder to eliminate penny rounding discrepancy
    v_reserve_allocation := v_net_settlement_pool - v_host_net_settlement;
  END IF;

  -- Strict Conservation Check on Accommodation
  IF (v_host_net_settlement + v_reserve_allocation + v_ark_accommodation_commission) <> v_auth_room_total THEN
    RAISE EXCEPTION 'Accommodation settlement conservation violation: net (₦%) + reserve (₦%) + comm (₦%) <> gross (₦%)',
      v_host_net_settlement, v_reserve_allocation, v_ark_accommodation_commission, v_auth_room_total
      USING ERRCODE = 'P0001';
  END IF;

  -- 9. Logistics Settlement Calculation (10% platform commission, 90% provider net)
  IF v_auth_logistics_total > 0 THEN
    v_ark_logistics_commission := ROUND(v_auth_logistics_total * 0.10, 2);
    v_provider_net_settlement := v_auth_logistics_total - v_ark_logistics_commission;

    SELECT pp.* INTO v_logistics_payout_profile
    FROM public.logistics_payout_profiles pp
    JOIN public.logistics_requests lr ON lr.provider_id = pp.provider_id
    WHERE lr.booking_id = v_booking.id
    ORDER BY pp.is_default DESC, pp.created_at DESC
    LIMIT 1;
  ELSE
    v_ark_logistics_commission := 0;
    v_provider_net_settlement := 0;
  END IF;

  -- 10. Retrieve Host Payout Profile snapshot
  SELECT * INTO v_host_payout_profile
  FROM public.partner_payout_profiles
  WHERE host_id = v_booking.host_id
  ORDER BY is_default DESC, created_at DESC
  LIMIT 1;

  -- 11. Update Booking State to Confirmed
  UPDATE public.bookings
  SET
    payment_status = 'paid',
    booking_status = 'confirmed',
    updated_at = v_now
  WHERE id = v_booking.id;

  -- 12. Record Authoritative Inbound Payment Record
  INSERT INTO public.payments (
    booking_id,
    amount_ngn,
    currency,
    provider,
    status,
    transaction_reference,
    paid_at,
    created_at
  ) VALUES (
    v_booking.id,
    v_auth_total,
    'NGN',
    COALESCE(p_provider, 'paystack'),
    'paid',
    v_clean_ref,
    v_now,
    v_now
  );

  -- 13. Insert or Update Accommodation Partner Payout
  INSERT INTO public.partner_payouts (
    booking_id,
    payout_category,
    host_id,
    payout_profile_id,
    gross_amount_ngn,
    gross_accommodation_amount_ngn,
    commission_rate_percentage,
    commission_amount_ngn,
    partner_amount_ngn,
    status,
    paystack_recipient_code_snapshot,
    recipient_bank_name_snapshot,
    recipient_bank_code_snapshot,
    recipient_account_name_snapshot,
    recipient_account_number_masked,
    created_at,
    updated_at
  ) VALUES (
    v_booking.id,
    'accommodation',
    v_booking.host_id,
    v_host_payout_profile.id,
    v_auth_room_total,
    v_auth_room_total,
    v_host_commission_rate,
    v_ark_accommodation_commission,
    v_host_net_settlement,
    'protection_window',
    v_host_payout_profile.paystack_recipient_code,
    v_host_payout_profile.bank_name,
    v_host_payout_profile.bank_code,
    v_host_payout_profile.account_name,
    v_host_payout_profile.account_number_masked,
    v_now,
    v_now
  )
  ON CONFLICT (booking_id, payout_category) DO UPDATE
  SET
    gross_amount_ngn = v_auth_room_total,
    gross_accommodation_amount_ngn = v_auth_room_total,
    commission_rate_percentage = v_host_commission_rate,
    commission_amount_ngn = v_ark_accommodation_commission,
    partner_amount_ngn = v_host_net_settlement,
    updated_at = v_now
  RETURNING id INTO v_room_payout_id;

  -- 14. Insert Logistics Partner Payout if applicable
  IF v_auth_logistics_total > 0 THEN
    INSERT INTO public.partner_payouts (
      booking_id,
      payout_category,
      provider_id,
      logistics_payout_profile_id,
      gross_amount_ngn,
      commission_rate_percentage,
      commission_amount_ngn,
      partner_amount_ngn,
      status,
      paystack_recipient_code_snapshot,
      recipient_bank_name_snapshot,
      recipient_bank_code_snapshot,
      recipient_account_name_snapshot,
      recipient_account_number_masked,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      'logistics',
      v_logistics_payout_profile.provider_id,
      v_logistics_payout_profile.id,
      v_auth_logistics_total,
      10.00,
      v_ark_logistics_commission,
      v_provider_net_settlement,
      'protection_window',
      v_logistics_payout_profile.paystack_recipient_code,
      v_logistics_payout_profile.bank_name,
      v_logistics_payout_profile.bank_code,
      v_logistics_payout_profile.account_name,
      v_logistics_payout_profile.account_number_masked,
      v_now,
      v_now
    )
    ON CONFLICT (booking_id, payout_category) DO UPDATE
    SET
      gross_amount_ngn = v_auth_logistics_total,
      commission_rate_percentage = 10.00,
      commission_amount_ngn = v_ark_logistics_commission,
      partner_amount_ngn = v_provider_net_settlement,
      updated_at = v_now
    RETURNING id INTO v_logistics_payout_id;
  END IF;

  -- 15. Create Guest Assurance Reserve Record (INDIVIDUAL HOST ONLY)
  IF v_property_tier = 'individual_host' AND v_reserve_allocation > 0 THEN
    v_checkout_time_str := COALESCE(NULLIF(TRIM(v_booking.check_out_time), ''), '12:00');
    BEGIN
      v_checkout_time := v_checkout_time_str::TIME;
    EXCEPTION WHEN OTHERS THEN
      v_checkout_time := '12:00'::TIME;
    END;
    v_stay_end := (v_booking.check_out + v_checkout_time) AT TIME ZONE 'Africa/Lagos';
    v_reserve_maturity := v_stay_end + INTERVAL '24 hours';

    INSERT INTO public.guest_assurance_reserves (
      booking_id,
      host_id,
      original_reserve_ngn,
      consumed_reserve_ngn,
      released_reserve_ngn,
      status,
      matures_at,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_booking.host_id,
      v_reserve_allocation,
      0,
      0,
      'held',
      v_reserve_maturity,
      v_now,
      v_now
    )
    ON CONFLICT (booking_id) DO UPDATE
    SET
      original_reserve_ngn = v_reserve_allocation,
      matures_at = v_reserve_maturity,
      updated_at = v_now
    RETURNING id INTO v_reserve_id;
  END IF;

  -- 16. Create Damage Deposit record (INDIVIDUAL HOST ONLY)
  IF v_property_tier = 'individual_host' AND v_auth_damage_deposit > 0 THEN
    v_checkout_time_str := COALESCE(NULLIF(TRIM(v_booking.check_out_time), ''), '12:00');
    BEGIN
      v_checkout_time := v_checkout_time_str::TIME;
    EXCEPTION WHEN OTHERS THEN
      v_checkout_time := '12:00'::TIME;
    END;
    v_stay_end := (v_booking.check_out + v_checkout_time) AT TIME ZONE 'Africa/Lagos';
    v_inspection_deadline := v_stay_end + INTERVAL '48 hours';

    INSERT INTO public.damage_deposits (
      booking_id,
      property_id,
      guest_id,
      user_id,
      deposit_amount_ngn,
      amount_ngn,
      retained_amount_ngn,
      refunded_amount_ngn,
      status,
      deposit_status,
      inspection_deadline,
      created_at,
      updated_at
    ) VALUES (
      v_booking.id,
      v_booking.property_id,
      v_booking.user_id,
      v_booking.user_id,
      v_auth_damage_deposit,
      v_auth_damage_deposit,
      0,
      0,
      'held',
      'held',
      v_inspection_deadline,
      v_now,
      v_now
    )
    ON CONFLICT (booking_id) DO UPDATE
    SET
      deposit_amount_ngn = v_auth_damage_deposit,
      amount_ngn = v_auth_damage_deposit,
      status = 'held',
      deposit_status = 'held',
      inspection_deadline = v_inspection_deadline,
      updated_at = v_now
    RETURNING id INTO v_deposit_id;
  END IF;

  -- 17. DOUBLE-ENTRY BALANCED FINANCIAL LEDGER POSTINGS
  -- Inflow: 1010 Gateway Clearing -> 2010 Guest Unearned Revenue
  PERFORM public.record_balanced_ledger_transaction(
    v_ledger_group_id,
    v_booking.id,
    'PAYMENT_RECEIVED',
    v_clean_ref,
    'Payment received via ' || COALESCE(p_provider, 'paystack'),
    '1010',
    '2010',
    v_auth_total
  );

  -- Accommodation Host/Hotel Net Settlement: 2010 Guest Unearned Revenue -> 2100 Partner Payout Payable
  IF v_host_net_settlement > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'ACCOMMODATION_HOST_NET',
      v_clean_ref || '-HOST-NET',
      CASE
        WHEN v_property_tier = 'hotel_organization' THEN
          'Hotel net settlement allocation (100% of net pool after ' || v_host_commission_rate::TEXT || '% platform commission)'
        ELSE
          'Host net settlement allocation (80% of net pool after ' || v_host_commission_rate::TEXT || '% platform commission)'
      END,
      '2010',
      '2100',
      v_host_net_settlement
    );
  END IF;

  -- Accommodation Commission Revenue: 2010 Guest Unearned Revenue -> 4010 Accommodation Platform Commission Revenue
  IF v_ark_accommodation_commission > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'ACCOMMODATION_COMMISSION',
      v_clean_ref || '-ARK-COMM-ROOM',
      'TheArk Rooms accommodation commission revenue (' || v_host_commission_rate::TEXT || '% from full gross)',
      '2010',
      '4010',
      v_ark_accommodation_commission
    );
  END IF;

  -- Guest Assurance Reserve Liability: 2010 Guest Unearned Revenue -> 2040 Guest Assurance Reserve Liability (INDIVIDUAL HOST ONLY)
  IF v_property_tier = 'individual_host' AND v_reserve_allocation > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'RESERVE_HOLD',
      v_clean_ref || '-RESERVE-HOLD',
      'Guest Assurance Reserve allocation (20% of net settlement pool)',
      '2010',
      '2040',
      v_reserve_allocation
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
      '2010',
      '2110',
      v_provider_net_settlement
    );
  END IF;

  -- Logistics Commission Revenue: 2010 Guest Unearned Revenue -> 4020 Car Service Platform Commission Revenue
  IF v_ark_logistics_commission > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'LOGISTICS_COMMISSION',
      v_clean_ref || '-ARK-COMM-LOG',
      'TheArk Rooms car service commission revenue (10%)',
      '2010',
      '4020',
      v_ark_logistics_commission
    );
  END IF;

  -- Damage Deposit Escrow Liability: 2010 Guest Unearned Revenue -> 2300 Damage Deposit Liability (INDIVIDUAL HOST ONLY)
  IF v_property_tier = 'individual_host' AND v_auth_damage_deposit > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'DAMAGE_DEPOSIT_COLLECTED',
      v_clean_ref || '-DEP-HOLD',
      'Damage deposit escrow liability collected',
      '2010',
      '2300',
      v_auth_damage_deposit
    );
  END IF;

  -- 18. Return authoritative settlement confirmation payload
  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking.id,
    'booking_reference', v_booking.booking_reference,
    'payment_status', 'paid',
    'booking_status', 'confirmed',
    'partner_tier', v_property_tier,
    'room_total_ngn', v_auth_room_total,
    'logistics_total_ngn', v_auth_logistics_total,
    'damage_deposit_ngn', v_auth_damage_deposit,
    'commission_rate_percentage', v_host_commission_rate,
    'commission_amount_ngn', v_ark_accommodation_commission,
    'host_net_settlement_ngn', v_host_net_settlement,
    'reserve_amount_ngn', v_reserve_allocation,
    'total_amount_ngn', v_auth_total,
    'settled_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;


-- ==============================================================================
-- 3. UPDATE CHECK-IN RPCs WITH BIFURCATED PAYOUT PROTECTION WINDOWS
-- Individual Host: actual_check_in_at + 4 hours
-- Hotel / Organization: actual_check_in_at + 24 hours
-- ==============================================================================

-- A. Dual-Confirmation Check-In: public.confirm_booking_check_in
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
  v_now TIMESTAMPTZ := now();
  v_is_guest BOOLEAN := FALSE;
  v_is_host BOOLEAN := FALSE;
  v_guest_confirmed_at TIMESTAMPTZ;
  v_host_confirmed_at TIMESTAMPTZ;
  v_actual_check_in_at TIMESTAMPTZ;
  v_partner_payout_eligible_at TIMESTAMPTZ;
  v_new_booking_status TEXT;
  v_payout_rec RECORD;
  v_payout_window_interval INTERVAL;
BEGIN
  -- 1. Authenticate caller
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to confirm check-in.' USING ERRCODE = '42501';
  END IF;

  -- 2. Lock booking row first (Canonical Lock Order)
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
    COALESCE(p.partner_tier, 'individual_host') AS partner_tier
  INTO v_booking
  FROM public.bookings b
  JOIN public.properties p ON p.id = b.property_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- Establish Protection Window Interval based on Property Tier
  IF v_booking.partner_tier = 'hotel_organization' THEN
    v_payout_window_interval := INTERVAL '24 hours';
  ELSE
    v_payout_window_interval := INTERVAL '4 hours';
  END IF;

  -- 3. Determine caller role
  IF v_booking.user_id = v_caller_id THEN
    v_is_guest := TRUE;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.host_profiles hp
    WHERE hp.id = v_booking.host_id AND hp.user_id = v_caller_id
  ) THEN
    v_is_host := TRUE;
  END IF;

  -- Also check admin privileges
  IF EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = v_caller_id AND p.role = 'admin'
  ) THEN
    v_is_host := TRUE;
  END IF;

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
      v_partner_payout_eligible_at := v_actual_check_in_at + v_payout_window_interval;
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

    IF FOUND AND v_payout_rec.status IN ('allocated', 'protection_window') THEN
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
    'partner_tier', v_booking.partner_tier,
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

REVOKE ALL ON FUNCTION public.confirm_booking_check_in(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.confirm_booking_check_in(UUID) TO authenticated;


-- B. Admin Force Check-In: public.admin_force_check_in
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
  v_payout_window_interval INTERVAL;
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
    b.partner_payout_eligible_at,
    COALESCE(p.partner_tier, 'individual_host') AS partner_tier
  INTO v_booking
  FROM public.bookings b
  JOIN public.properties p ON p.id = b.property_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found.', p_booking_id USING ERRCODE = 'P0002';
  END IF;

  -- Establish Protection Window Interval based on Property Tier
  IF v_booking.partner_tier = 'hotel_organization' THEN
    v_payout_window_interval := INTERVAL '24 hours';
  ELSE
    v_payout_window_interval := INTERVAL '4 hours';
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
  -- Establish partner_payout_eligible_at according to property tier (4h vs 24h)
  v_partner_payout_eligible_at := COALESCE(v_booking.partner_payout_eligible_at, v_actual_check_in_at + v_payout_window_interval);

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

  IF FOUND AND v_payout_rec.status IN ('allocated', 'protection_window') THEN
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
    'partner_tier', v_booking.partner_tier,
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

REVOKE ALL ON FUNCTION public.admin_force_check_in(UUID, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_check_in(UUID, TEXT) TO authenticated;


-- ==============================================================================
-- 4. HARD DAMAGE CLAIM REJECTION FOR HOTEL PROPERTIES (public.submit_damage_claim)
-- ==============================================================================
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

  -- 4. HARD EXCLUSION CHECK: Hotels cannot participate in damage deposits or claims
  SELECT * INTO v_property
  FROM public.properties
  WHERE id = v_deposit.property_id;

  IF v_property.partner_tier = 'hotel_organization' THEN
    RAISE EXCEPTION 'Damage claims are not supported for commercial hotel properties. Commercial dispute resolution applies.'
      USING ERRCODE = '22023';
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

  -- 5. CANONICAL LOCK ORDER:
  -- (1) bookings -> (2) damage_deposits
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_deposit.booking_id
  FOR UPDATE;

  SELECT * INTO v_deposit
  FROM public.damage_deposits
  WHERE id = p_deposit_id
  FOR UPDATE;

  -- 6. Status check on deposit
  IF v_deposit.status != 'held' THEN
    RAISE EXCEPTION 'Cannot submit damage claim: Damage deposit is in "%" status, not held.', v_deposit.status
      USING ERRCODE = '22023';
  END IF;

  -- 7. Stay completion check: Guest must have checked out
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

  -- 8. TIMING CHECK: Must be within authoritative 48-hour inspection deadline
  IF v_now > v_deposit.inspection_deadline THEN
    RAISE EXCEPTION 'Cannot submit damage claim: 48-hour inspection deadline has expired (%).',
      v_deposit.inspection_deadline USING ERRCODE = '22023';
  END IF;

  -- 9. Amount check: Cannot exceed available deposit balance
  v_available_deposit := v_deposit.deposit_amount_ngn - v_deposit.retained_amount_ngn;
  IF p_claimed_amount_ngn > v_available_deposit THEN
    RAISE EXCEPTION 'Claim amount (₦%) exceeds available damage deposit balance (₦%).',
      p_claimed_amount_ngn, v_available_deposit USING ERRCODE = '22023';
  END IF;

  -- 10. Insert damage claim record
  INSERT INTO public.damage_claims (
    deposit_id,
    booking_id,
    host_id,
    claimed_amount_ngn,
    description,
    evidence_urls,
    status,
    created_at,
    updated_at
  ) VALUES (
    p_deposit_id,
    v_deposit.booking_id,
    v_host_profile.id,
    p_claimed_amount_ngn,
    TRIM(p_description),
    COALESCE(p_evidence_urls, '{}'),
    'submitted',
    v_now,
    v_now
  )
  RETURNING id INTO v_claim_id;

  -- 11. Lock damage deposit into 'claim_pending' status
  UPDATE public.damage_deposits
  SET
    status = 'claim_pending',
    deposit_status = 'claim_pending',
    updated_at = v_now
  WHERE id = p_deposit_id;

  RETURN jsonb_build_object(
    'success', true,
    'claim_id', v_claim_id,
    'deposit_id', p_deposit_id,
    'booking_id', v_deposit.booking_id,
    'claimed_amount_ngn', p_claimed_amount_ngn,
    'status', 'submitted',
    'created_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_damage_claim(UUID, NUMERIC, TEXT, TEXT[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.submit_damage_claim(UUID, NUMERIC, TEXT, TEXT[]) TO authenticated;
