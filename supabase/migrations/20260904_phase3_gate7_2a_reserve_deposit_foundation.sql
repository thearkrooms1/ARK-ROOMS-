-- ==============================================================================
-- Migration: Phase 3 Gate #7.2A — Guest Assurance Reserve & Financial Foundation
--
-- Scope:
-- 1. Chart of Accounts & 2040 Guest Assurance Reserve Liability
-- 2. Guest Assurance Reserves Schema Invariants & RLS
-- 3. Damage Deposits Schema Reconciliation (Canonical + Compatibility) & 48h Inspection Deadline
-- 4. Webhook Events Composite Uniqueness (event_source, event_type, event_reference)
-- 5. Canonical Locking Fix in evaluate_payout_eligibility (bookings -> partner_payouts)
-- 6. Balanced Ledger Conservation (Zero unbacked reserve allocation until formula finalized)
-- 7. Evidence Storage Security Foundation (Private bucket RLS)
-- 8. Execution Privilege Hardening (Revoke direct client financial mutations)
-- ==============================================================================

-- ==============================================================================
-- 1. CHART OF ACCOUNTS & 2040 GUEST ASSURANCE RESERVE LIABILITY
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.chart_of_accounts (
  account_code TEXT PRIMARY KEY,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  normal_balance TEXT NOT NULL CHECK (normal_balance IN ('debit', 'credit')),
  description TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed Authoritative Chart of Accounts
INSERT INTO public.chart_of_accounts (account_code, account_name, account_type, normal_balance, description)
VALUES
  ('1010', 'Gateway Clearing (Paystack)', 'asset', 'debit', 'Clearing account for inbound guest payments collected via payment gateway'),
  ('2010', 'Guest Unearned Revenue', 'liability', 'credit', 'Inbound guest payments held in liability until service delivery / check-in confirmation'),
  ('2040', 'Guest Assurance Reserve Liability', 'liability', 'credit', 'Dedicated liability account for Guest Assurance Reserve protection. Never treated as Ark revenue.'),
  ('2100', 'Partner Payout Payable (Host)', 'liability', 'credit', 'Net accommodation payout owed to host partner following commission deduction'),
  ('2110', 'Logistics Provider Payable', 'liability', 'credit', 'Net logistics payout owed to transportation provider partner following commission deduction'),
  ('2300', 'Damage Deposit Liability', 'liability', 'credit', 'Escrow liability holding refundable apartment damage deposits'),
  ('4010', 'Accommodation Platform Commission Revenue', 'revenue', 'credit', 'TheArk Rooms earned commission revenue on accommodation stays'),
  ('4020', 'Car Service Platform Commission Revenue', 'revenue', 'credit', 'TheArk Rooms earned commission revenue on car & logistics services')
ON CONFLICT (account_code) DO UPDATE
SET
  account_name = EXCLUDED.account_name,
  account_type = EXCLUDED.account_type,
  normal_balance = EXCLUDED.normal_balance,
  description = EXCLUDED.description,
  is_active = TRUE;

ALTER TABLE public.chart_of_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Chart of accounts read policy" ON public.chart_of_accounts;
CREATE POLICY "Chart of accounts read policy"
  ON public.chart_of_accounts FOR SELECT
  TO authenticated, anon
  USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.chart_of_accounts FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.chart_of_accounts TO service_role;

-- ==============================================================================
-- 2. GUEST ASSURANCE RESERVES SCHEMA & INVARIANTS
-- ==============================================================================
-- Ensure remaining_reserve_ngn exists for backwards-compatibility and auditing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'guest_assurance_reserves' AND column_name = 'remaining_reserve_ngn'
  ) THEN
    ALTER TABLE public.guest_assurance_reserves 
      ADD COLUMN remaining_reserve_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (remaining_reserve_ngn >= 0);
  END IF;
END $$;

-- Verify check constraints on guest_assurance_reserves
ALTER TABLE public.guest_assurance_reserves DROP CONSTRAINT IF EXISTS chk_reserve_balances;
ALTER TABLE public.guest_assurance_reserves ADD CONSTRAINT chk_reserve_balances
  CHECK (consumed_reserve_ngn + released_reserve_ngn <= original_reserve_ngn);

ALTER TABLE public.guest_assurance_reserves DROP CONSTRAINT IF EXISTS chk_reserve_non_negative;
ALTER TABLE public.guest_assurance_reserves ADD CONSTRAINT chk_reserve_non_negative
  CHECK (original_reserve_ngn >= 0 AND consumed_reserve_ngn >= 0 AND released_reserve_ngn >= 0);

-- Trigger to maintain remaining_reserve_ngn
CREATE OR REPLACE FUNCTION public.sync_guest_assurance_reserve_remaining()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.remaining_reserve_ngn := GREATEST(0, NEW.original_reserve_ngn - NEW.consumed_reserve_ngn - NEW.released_reserve_ngn);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_guest_assurance_reserve_remaining ON public.guest_assurance_reserves;
CREATE TRIGGER trg_sync_guest_assurance_reserve_remaining
  BEFORE INSERT OR UPDATE ON public.guest_assurance_reserves
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_guest_assurance_reserve_remaining();

-- RLS: Guests cannot view/mutate. Hosts can view their own. Admins can view all.
ALTER TABLE public.guest_assurance_reserves ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Hosts can view own property reserves" ON public.guest_assurance_reserves;
CREATE POLICY "Hosts can view own property reserves"
  ON public.guest_assurance_reserves FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = guest_assurance_reserves.host_id AND hp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.guest_assurance_reserves FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.guest_assurance_reserves TO service_role;

-- ==============================================================================
-- 3. DAMAGE DEPOSIT SCHEMA RECONCILIATION & 48-HOUR INSPECTION DEADLINE
-- ==============================================================================
-- Add backward-compatible alias columns if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'damage_deposits' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE public.damage_deposits 
      ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'damage_deposits' AND column_name = 'amount_ngn'
  ) THEN
    ALTER TABLE public.damage_deposits 
      ADD COLUMN amount_ngn NUMERIC(14,2);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'damage_deposits' AND column_name = 'deposit_status'
  ) THEN
    ALTER TABLE public.damage_deposits 
      ADD COLUMN deposit_status TEXT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'damage_deposits' AND column_name = 'retained_amount_ngn'
  ) THEN
    ALTER TABLE public.damage_deposits 
      ADD COLUMN retained_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'damage_deposits' AND column_name = 'refunded_amount_ngn'
  ) THEN
    ALTER TABLE public.damage_deposits 
      ADD COLUMN refunded_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0;
  END IF;
END $$;

-- Backfill data for existing rows
UPDATE public.damage_deposits SET user_id = guest_id WHERE user_id IS NULL AND guest_id IS NOT NULL;
UPDATE public.damage_deposits SET guest_id = user_id WHERE guest_id IS NULL AND user_id IS NOT NULL;
UPDATE public.damage_deposits SET amount_ngn = deposit_amount_ngn WHERE amount_ngn IS NULL AND deposit_amount_ngn IS NOT NULL;
UPDATE public.damage_deposits SET deposit_amount_ngn = amount_ngn WHERE deposit_amount_ngn IS NULL AND amount_ngn IS NOT NULL;
UPDATE public.damage_deposits SET deposit_status = status WHERE deposit_status IS NULL AND status IS NOT NULL;
UPDATE public.damage_deposits SET status = deposit_status WHERE status IS NULL AND deposit_status IS NOT NULL;

-- Ensure damage deposit balance constraints
ALTER TABLE public.damage_deposits DROP CONSTRAINT IF EXISTS chk_deposit_balances;
ALTER TABLE public.damage_deposits ADD CONSTRAINT chk_deposit_balances
  CHECK (
    retained_amount_ngn >= 0 
    AND refunded_amount_ngn >= 0 
    AND (retained_amount_ngn + refunded_amount_ngn <= deposit_amount_ngn)
  );

-- Trigger to automatically synchronize alias columns and guarantee inspection_deadline
CREATE OR REPLACE FUNCTION public.handle_damage_deposits_sync_and_deadline()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_b RECORD;
  v_cot_str TEXT;
  v_cot TIME;
BEGIN
  -- Synchronize guest_id and user_id
  NEW.guest_id := COALESCE(NEW.guest_id, NEW.user_id);
  NEW.user_id := COALESCE(NEW.user_id, NEW.guest_id);

  -- Synchronize deposit_amount_ngn and amount_ngn
  NEW.deposit_amount_ngn := COALESCE(NEW.deposit_amount_ngn, NEW.amount_ngn, 0);
  NEW.amount_ngn := COALESCE(NEW.amount_ngn, NEW.deposit_amount_ngn, 0);

  -- Synchronize status and deposit_status
  NEW.status := COALESCE(NEW.status, NEW.deposit_status, 'held');
  NEW.deposit_status := COALESCE(NEW.deposit_status, NEW.status, 'held');

  -- Ensure retained and refunded are initialized
  NEW.retained_amount_ngn := COALESCE(NEW.retained_amount_ngn, 0);
  NEW.refunded_amount_ngn := COALESCE(NEW.refunded_amount_ngn, 0);

  -- If inspection_deadline is not specified, calculate checkout + property check_out_time + 48 hours
  IF NEW.inspection_deadline IS NULL THEN
    SELECT b.check_out, p.check_out_time INTO v_b
    FROM public.bookings b
    LEFT JOIN public.properties p ON p.id = b.property_id
    WHERE b.id = NEW.booking_id;

    IF FOUND AND v_b.check_out IS NOT NULL THEN
      v_cot_str := COALESCE(NULLIF(TRIM(v_b.check_out_time), ''), '12:00');
      BEGIN
        v_cot := v_cot_str::TIME;
      EXCEPTION WHEN OTHERS THEN
        v_cot := '12:00'::TIME;
      END;
      NEW.inspection_deadline := (v_b.check_out + v_cot) AT TIME ZONE 'Africa/Lagos' + INTERVAL '48 hours';
    ELSE
      NEW.inspection_deadline := now() + INTERVAL '48 hours';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_damage_deposits_sync_and_deadline ON public.damage_deposits;
CREATE TRIGGER trg_damage_deposits_sync_and_deadline
  BEFORE INSERT OR UPDATE ON public.damage_deposits
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_damage_deposits_sync_and_deadline();

-- RLS: Guest can view own deposits; Host can view deposits for their properties; Admin can view all
ALTER TABLE public.damage_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Parties can view damage deposits" ON public.damage_deposits;
CREATE POLICY "Parties can view damage deposits"
  ON public.damage_deposits FOR SELECT
  TO authenticated
  USING (
    guest_id = auth.uid()
    OR user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties prop
      JOIN public.host_profiles hp ON prop.host_id = hp.id
      WHERE prop.id = damage_deposits.property_id AND hp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.damage_deposits FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.damage_deposits TO service_role;

-- ==============================================================================
-- 4. WEBHOOK EVENT IDENTITY: COMPOSITE (source, type, reference)
-- ==============================================================================
-- Drop binary unique constraint and add composite (event_source, event_type, event_reference)
ALTER TABLE public.webhook_events DROP CONSTRAINT IF EXISTS uq_webhook_events_source_ref;
ALTER TABLE public.webhook_events DROP CONSTRAINT IF EXISTS uq_webhook_events_source_type_ref;

ALTER TABLE public.webhook_events ADD CONSTRAINT uq_webhook_events_source_type_ref
  UNIQUE (event_source, event_type, event_reference);

-- Update claim_webhook_event to use composite uniqueness
CREATE OR REPLACE FUNCTION public.claim_webhook_event(
  p_event_reference TEXT,
  p_event_type TEXT,
  p_event_source TEXT DEFAULT 'paystack',
  p_payload JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_event RECORD;
  v_now TIMESTAMPTZ := now();
  v_clean_source TEXT;
  v_clean_type TEXT;
  v_clean_ref TEXT;
BEGIN
  v_clean_source := COALESCE(NULLIF(TRIM(p_event_source), ''), 'paystack');
  v_clean_type := NULLIF(TRIM(p_event_type), '');
  v_clean_ref := NULLIF(TRIM(p_event_reference), '');

  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'Event reference cannot be empty' USING ERRCODE = '22023';
  END IF;

  IF v_clean_type IS NULL THEN
    RAISE EXCEPTION 'Event type cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- 1. Insert record in 'received' state if not exists using composite identity
  INSERT INTO public.webhook_events (
    event_source,
    event_type,
    event_reference,
    payload,
    status,
    retry_count,
    created_at
  ) VALUES (
    v_clean_source,
    v_clean_type,
    v_clean_ref,
    COALESCE(p_payload, '{}'::jsonb),
    'received',
    0,
    v_now
  )
  ON CONFLICT (event_source, event_type, event_reference) DO NOTHING;

  -- 2. Lock and inspect current state
  SELECT id, status, retry_count, processing_started_at
  INTO v_event
  FROM public.webhook_events
  WHERE event_source = v_clean_source
    AND event_type = v_clean_type
    AND event_reference = v_clean_ref
  FOR UPDATE;

  -- 3. Idempotency Check:
  IF v_event.status = 'completed' THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'completed',
      'event_id', v_event.id,
      'message', 'Event already successfully processed'
    );
  END IF;

  -- Concurrent Lock Contention Check (3-minute lease)
  IF v_event.status = 'processing' AND v_event.processing_started_at > (v_now - INTERVAL '3 minutes') THEN
    RETURN jsonb_build_object(
      'claimed', false,
      'status', 'processing',
      'event_id', v_event.id,
      'message', 'Event is currently being processed by another worker lease'
    );
  END IF;

  -- 4. Transition to 'processing'
  UPDATE public.webhook_events
  SET
    status = 'processing',
    processing_started_at = v_now,
    retry_count = v_event.retry_count + 1
  WHERE id = v_event.id;

  RETURN jsonb_build_object(
    'claimed', true,
    'status', 'processing',
    'event_id', v_event.id,
    'retry_count', v_event.retry_count + 1,
    'message', 'Event claimed successfully for processing'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_webhook_event(TEXT, TEXT, TEXT, JSONB) TO service_role;

-- ==============================================================================
-- 5. CANONICAL LOCKING FIX: evaluate_payout_eligibility (bookings -> partner_payouts)
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.evaluate_payout_eligibility(
  p_payout_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_booking_id UUID;
  v_booking RECORD;
  v_payout RECORD;
  v_has_tier3_dispute BOOLEAN;
  v_now TIMESTAMPTZ := now();
BEGIN
  -- 1. Identify booking ID first WITHOUT taking lock
  SELECT booking_id INTO v_booking_id
  FROM public.partner_payouts
  WHERE id = p_payout_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner payout % not found', p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 2. CANONICAL LOCK ORDER: Lock booking row FIRST
  SELECT * INTO v_booking
  FROM public.bookings
  WHERE id = v_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found for payout %', v_booking_id, p_payout_id USING ERRCODE = 'P0002';
  END IF;

  -- 3. CANONICAL LOCK ORDER: Lock payout row SECOND
  SELECT * INTO v_payout
  FROM public.partner_payouts
  WHERE id = p_payout_id
  FOR UPDATE;

  -- 4. Check qualifying active Tier 3 disputes on booking
  SELECT EXISTS (
    SELECT 1 FROM public.booking_issues bi
    WHERE bi.booking_id = v_booking.id
      AND bi.issue_tier = 'tier_3'
      AND bi.status NOT IN ('resolved_dismissed', 'resolved_compensated')
  ) INTO v_has_tier3_dispute;

  IF v_has_tier3_dispute THEN
    IF v_payout.status != 'frozen_dispute' THEN
      UPDATE public.partner_payouts
      SET status = 'frozen_dispute', updated_at = v_now
      WHERE id = v_payout.id;
    END IF;
    RETURN jsonb_build_object(
      'success', false,
      'status', 'frozen_dispute',
      'reason', 'Active Tier 3 dispute exists on booking'
    );
  END IF;

  -- 5. Protection window transition check
  IF v_payout.status = 'protection_window' THEN
    IF v_payout.scheduled_eligibility_at IS NOT NULL AND v_now >= v_payout.scheduled_eligibility_at THEN
      IF v_booking.payment_status = 'paid' AND v_booking.booking_status = 'checked_in' THEN
        UPDATE public.partner_payouts
        SET status = 'eligible', updated_at = v_now
        WHERE id = v_payout.id;

        RETURN jsonb_build_object(
          'success', true,
          'status', 'eligible',
          'message', 'Payout successfully transitioned to eligible'
        );
      END IF;
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'status', 'protection_window',
        'reason', 'Protection window has not elapsed yet',
        'scheduled_eligibility_at', v_payout.scheduled_eligibility_at
      );
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'status', v_payout.status,
    'message', 'No transition performed'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.evaluate_payout_eligibility(UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.evaluate_payout_eligibility(UUID) TO service_role;

-- ==============================================================================
-- 6. SETTLEMENT FUNCTION REALIGNMENT (Strict Ledger Conservation)
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
  v_property RECORD;
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
  v_host_net_settlement NUMERIC(14,2);
  v_ark_accommodation_commission NUMERIC(14,2);
  v_provider_net_settlement NUMERIC(14,2);
  v_ark_logistics_commission NUMERIC(14,2);
  v_room_payout_id UUID;
  v_logistics_payout_id UUID;
  v_deposit_id UUID;
  v_ledger_group_id UUID := gen_random_uuid();
  v_checkout_time_str TEXT;
  v_checkout_time TIME;
  v_stay_end TIMESTAMPTZ;
  v_inspection_deadline TIMESTAMPTZ;
BEGIN
  v_clean_ref := NULLIF(TRIM(p_payment_reference), '');
  IF v_clean_ref IS NULL THEN
    RAISE EXCEPTION 'Authoritative payment reference cannot be empty' USING ERRCODE = '22023';
  END IF;

  -- 1. Lock and retrieve authoritative booking record
  SELECT b.*, p.host_id, p.check_out_time, p.requires_damage_deposit, p.damage_deposit_amount
  INTO v_booking
  FROM public.bookings b
  JOIN public.properties p ON p.id = b.property_id
  WHERE b.id = p_booking_id
  FOR UPDATE OF b;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking % not found for payment settlement', p_booking_id USING ERRCODE = 'P0002';
  END IF;

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
        'message', 'Payment was previously settled and confirmed'
      );
    END IF;
  END IF;

  -- 3. Calculate Authoritative Prices
  v_auth_room_total := ROUND(COALESCE(v_booking.total_price_ngn, 0)::NUMERIC, 2);
  v_auth_logistics_total := ROUND(COALESCE(v_booking.logistics_price_ngn, 0)::NUMERIC, 2);
  v_auth_damage_deposit := ROUND(COALESCE(v_booking.damage_deposit_ngn, 0)::NUMERIC, 2);
  v_auth_total := v_auth_room_total + v_auth_logistics_total + v_auth_damage_deposit;

  -- 4. Amount Verification
  IF ROUND(p_amount_paid::NUMERIC, 2) != v_auth_total THEN
    RAISE EXCEPTION 'Payment amount mismatch: Gateway charged %, authoritative total is %',
      ROUND(p_amount_paid::NUMERIC, 2), v_auth_total USING ERRCODE = '22023';
  END IF;

  -- 5. Determine Negotiated Host Commission Rate (10.00% to 15.00%)
  SELECT COALESCE(hp.commission_rate_percentage, 10.00) INTO v_host_commission_rate
  FROM public.host_profiles hp
  WHERE hp.id = v_booking.host_id;

  v_host_commission_rate := COALESCE(v_host_commission_rate, 10.00);

  -- 6. Split Accommodation
  v_ark_accommodation_commission := ROUND(v_auth_room_total * (v_host_commission_rate / 100.00), 2);
  v_host_net_settlement := v_auth_room_total - v_ark_accommodation_commission;

  -- 7. Split Logistics (10.00% platform commission, 90.00% partner net)
  IF v_auth_logistics_total > 0 THEN
    v_ark_logistics_commission := ROUND(v_auth_logistics_total * 0.10, 2);
    v_provider_net_settlement := v_auth_logistics_total - v_ark_logistics_commission;
  ELSE
    v_ark_logistics_commission := 0;
    v_provider_net_settlement := 0;
  END IF;

  -- 8. Fetch Host Payout Profile Snapshots
  SELECT * INTO v_host_payout_profile
  FROM public.host_payout_profiles
  WHERE host_id = v_booking.host_id AND is_active = TRUE
  ORDER BY created_at DESC LIMIT 1;

  -- 9. Fetch Logistics Provider Payout Profile Snapshots
  IF v_auth_logistics_total > 0 THEN
    SELECT * INTO v_logistics_payout_profile
    FROM public.logistics_payout_profiles
    WHERE is_active = TRUE
    ORDER BY created_at DESC LIMIT 1;
  END IF;

  -- 10. Update Booking State to Confirmed
  UPDATE public.bookings
  SET
    payment_status = 'paid',
    booking_status = 'confirmed',
    updated_at = v_now
  WHERE id = v_booking.id;

  -- 11. Record Authoritative Inbound Payment Record
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

  -- 12. Insert or Update Accommodation Partner Payout (24h protection window after confirmed check-in)
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

  -- 13. Insert Logistics Partner Payout if applicable
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

  -- 14. Create Damage Deposit record with 48h inspection deadline if applicable
  IF v_auth_damage_deposit > 0 THEN
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

  -- 15. DOUBLE-ENTRY BALANCED FINANCIAL LEDGER POSTINGS
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

  -- Host Net Settlement: 2010 Guest Unearned Revenue -> 2100 Partner Payout Payable
  IF v_host_net_settlement > 0 THEN
    PERFORM public.record_balanced_ledger_transaction(
      gen_random_uuid(),
      v_booking.id,
      'ACCOMMODATION_HOST_NET',
      v_clean_ref || '-HOST-NET',
      'Host net settlement allocation (' || (100.00 - v_host_commission_rate)::TEXT || '%)',
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
      'TheArk Rooms accommodation commission revenue (' || v_host_commission_rate::TEXT || '%)',
      '2010',
      '4010',
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

  -- Damage Deposit Escrow Liability: 2010 Guest Unearned Revenue -> 2300 Damage Deposit Liability
  IF v_auth_damage_deposit > 0 THEN
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

  -- NOTE ON GUEST ASSURANCE RESERVE:
  -- The business has not finalized the reserve funding formula (commission vs Ark margin vs escrow).
  -- In accordance with Gate #7.2A, zero unbacked reserve ledger entries are manufactured.
  -- 2040 liability remains unposted until legitimate source of funds is authoritatively designated.

  -- 16. Return authoritative settlement confirmation payload
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

REVOKE ALL ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_successful_booking_payment(UUID, TEXT, NUMERIC, TEXT, TEXT, JSONB) TO service_role;

-- ==============================================================================
-- 7. EVIDENCE STORAGE SECURITY FOUNDATION
-- ==============================================================================
-- Ensure issue-evidence-private bucket exists and is private
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'issue-evidence-private',
  'issue-evidence-private',
  FALSE,
  FALSE,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE;

-- Storage object RLS policies
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Issue evidence private select" ON storage.objects;
CREATE POLICY "Issue evidence private select"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'issue-evidence-private'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "Issue evidence private insert" ON storage.objects;
CREATE POLICY "Issue evidence private insert"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'issue-evidence-private'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "Issue evidence private update" ON storage.objects;
CREATE POLICY "Issue evidence private update"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'issue-evidence-private'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Issue evidence private delete" ON storage.objects;
CREATE POLICY "Issue evidence private delete"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'issue-evidence-private'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ==============================================================================
-- 8. FINANCIAL FUNCTION PRIVILEGE HARDENING
-- ==============================================================================
REVOKE ALL ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_balanced_ledger_transaction(UUID, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, NUMERIC) TO service_role;

REVOKE ALL ON FUNCTION public.settle_partner_payout_transfer(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_partner_payout_transfer(UUID, TEXT, TEXT, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.record_partner_payout_failure(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_partner_payout_failure(UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.flag_partner_payout_reconciliation(UUID, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_partner_payout_reconciliation(UUID, TEXT, JSONB) TO service_role;

REVOKE ALL ON FUNCTION public.finalize_webhook_event(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.finalize_webhook_event(UUID, TEXT, TEXT, JSONB) TO service_role;
