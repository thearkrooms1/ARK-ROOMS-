-- ==============================================================================
-- Migration: Phase 3 Gate #2 — Database Foundation Implementation
-- Description:
-- 1. Adds host and damage deposit extensions to public.properties
-- 2. Adds dual check-in timestamps and damage deposit to public.bookings
-- 3. Creates public.host_payout_profiles (masked bank info, Paystack recipient code)
-- 4. Creates public.partner_payouts (Option A 80% accommodation payout lifecycle)
-- 5. Creates public.guest_assurance_reserves (20% accommodation reserve lifecycle)
-- 6. Creates public.booking_issues (disputes & tiered resolutions)
-- 7. Creates public.booking_issue_evidence (private storage metadata)
-- 8. Creates public.damage_deposits (apartment damage deposit lifecycle)
-- 9. Creates public.financial_ledger (authoritative double-entry append-only ledger)
-- 10. Creates public.webhook_events (idempotent Paystack webhook lifecycle)
-- 11. Enforces strict RLS and REVOKES direct client financial mutations
-- ==============================================================================

-- 0. Ensure host_profiles prerequisite table exists
CREATE TABLE IF NOT EXISTS public.host_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  host_status TEXT NOT NULL DEFAULT 'active' CHECK (host_status IN ('pending', 'active', 'suspended')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_host_profiles_user_id UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_host_profiles_user_id ON public.host_profiles(user_id);
CREATE INDEX IF NOT EXISTS idx_host_profiles_status ON public.host_profiles(host_status);

ALTER TABLE public.host_profiles ENABLE ROW LEVEL SECURITY;

-- 1. PROPERTIES EXTENSIONS (Non-destructive, additive only)
DO $$
BEGIN
  -- properties.host_id
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'host_id'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN host_id UUID REFERENCES public.host_profiles(id) ON DELETE SET NULL;
  END IF;

  -- properties.requires_damage_deposit
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'requires_damage_deposit'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN requires_damage_deposit BOOLEAN NOT NULL DEFAULT FALSE;
  END IF;

  -- properties.damage_deposit_amount_ngn
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'damage_deposit_amount_ngn'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN damage_deposit_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (damage_deposit_amount_ngn >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_properties_host_id ON public.properties(host_id);

-- 2. BOOKINGS EXTENSIONS (Non-destructive, additive only)
DO $$
BEGIN
  -- bookings.guest_check_in_confirmed_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'guest_check_in_confirmed_at'
  ) THEN
    ALTER TABLE public.bookings 
      ADD COLUMN guest_check_in_confirmed_at TIMESTAMPTZ NULL;
  END IF;

  -- bookings.host_check_in_confirmed_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'host_check_in_confirmed_at'
  ) THEN
    ALTER TABLE public.bookings 
      ADD COLUMN host_check_in_confirmed_at TIMESTAMPTZ NULL;
  END IF;

  -- bookings.actual_check_in_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'actual_check_in_at'
  ) THEN
    ALTER TABLE public.bookings 
      ADD COLUMN actual_check_in_at TIMESTAMPTZ NULL;
  END IF;

  -- bookings.partner_payout_eligible_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'partner_payout_eligible_at'
  ) THEN
    ALTER TABLE public.bookings 
      ADD COLUMN partner_payout_eligible_at TIMESTAMPTZ NULL;
  END IF;

  -- bookings.damage_deposit_ngn
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'bookings' AND column_name = 'damage_deposit_ngn'
  ) THEN
    ALTER TABLE public.bookings 
      ADD COLUMN damage_deposit_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (damage_deposit_ngn >= 0);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_bookings_actual_check_in_at ON public.bookings(actual_check_in_at);
CREATE INDEX IF NOT EXISTS idx_bookings_partner_payout_eligible_at ON public.bookings(partner_payout_eligible_at);

-- 3. HOST PAYOUT PROFILES (Masked banking info & Paystack recipient code)
CREATE TABLE IF NOT EXISTS public.host_payout_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS idx_host_payout_profiles_host_id ON public.host_payout_profiles(host_id);

-- 4. PARTNER PAYOUTS (Option A: 80% partner allocation)
CREATE TABLE IF NOT EXISTS public.partner_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE RESTRICT,
  payout_profile_id UUID REFERENCES public.host_payout_profiles(id),
  gross_accommodation_amount_ngn NUMERIC(14,2) NOT NULL CHECK (gross_accommodation_amount_ngn > 0),
  partner_amount_ngn NUMERIC(14,2) NOT NULL CHECK (partner_amount_ngn > 0),
  status TEXT NOT NULL DEFAULT 'allocated' CHECK (
    status IN (
      'allocated',
      'protection_window',
      'eligible',
      'authorized',
      'processing',
      'completed',
      'frozen_dispute',
      'cancelled',
      'failed'
    )
  ),
  scheduled_eligibility_at TIMESTAMPTZ NULL,
  authorized_at TIMESTAMPTZ NULL,
  disbursed_at TIMESTAMPTZ NULL,
  paystack_recipient_code_snapshot TEXT NULL,
  paystack_transfer_reference TEXT UNIQUE NULL,
  paystack_transfer_code TEXT NULL,
  failure_reason TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_payouts_booking_id ON public.partner_payouts(booking_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_host_id ON public.partner_payouts(host_id);
CREATE INDEX IF NOT EXISTS idx_partner_payouts_status ON public.partner_payouts(status);

-- 5. GUEST ASSURANCE RESERVES (20% retained until Checkout + 24h)
CREATE TABLE IF NOT EXISTS public.guest_assurance_reserves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  host_id UUID NOT NULL REFERENCES public.host_profiles(id) ON DELETE RESTRICT,
  original_reserve_ngn NUMERIC(14,2) NOT NULL CHECK (original_reserve_ngn >= 0),
  consumed_reserve_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (consumed_reserve_ngn >= 0),
  released_reserve_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (released_reserve_ngn >= 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (
    status IN (
      'held',
      'locked_dispute',
      'eligible_for_release',
      'disbursed_to_host',
      'partially_consumed',
      'fully_consumed',
      'cancelled_void'
    )
  ),
  matures_at TIMESTAMPTZ NOT NULL,
  settled_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_reserve_balances CHECK (consumed_reserve_ngn + released_reserve_ngn <= original_reserve_ngn)
);

CREATE INDEX IF NOT EXISTS idx_guest_assurance_reserves_booking_id ON public.guest_assurance_reserves(booking_id);
CREATE INDEX IF NOT EXISTS idx_guest_assurance_reserves_host_id ON public.guest_assurance_reserves(host_id);
CREATE INDEX IF NOT EXISTS idx_guest_assurance_reserves_maturity ON public.guest_assurance_reserves(matures_at, status);

-- 6. BOOKING ISSUES (Dispute logging & tiered resolutions)
CREATE TABLE IF NOT EXISTS public.booking_issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  guest_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  issue_tier TEXT NOT NULL CHECK (issue_tier IN ('tier_1', 'tier_2', 'tier_3')),
  category TEXT NOT NULL CHECK (
    category IN ('cleanliness', 'amenities', 'access', 'safety', 'hvac_plumbing', 'host_conduct', 'other')
  ),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted' CHECK (
    status IN (
      'submitted',
      'under_review',
      'remedy_in_progress',
      'resolved_dismissed',
      'resolved_compensated',
      'escalated_relocation'
    )
  ),
  requested_resolution TEXT NULL CHECK (
    requested_resolution IS NULL OR requested_resolution IN ('remediation', 'partial_refund', 'full_refund', 'emergency_relocation')
  ),
  refund_awarded_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refund_awarded_ngn >= 0),
  reserve_draw_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (reserve_draw_ngn >= 0),
  contingency_draw_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (contingency_draw_ngn >= 0),
  resolution_notes TEXT NULL,
  resolved_by UUID REFERENCES auth.users(id),
  resolved_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_issues_booking_id ON public.booking_issues(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_issues_guest_id ON public.booking_issues(guest_id);
CREATE INDEX IF NOT EXISTS idx_booking_issues_property_id ON public.booking_issues(property_id);
CREATE INDEX IF NOT EXISTS idx_booking_issues_status ON public.booking_issues(status);

-- 7. PRIVATE ISSUE EVIDENCE METADATA
CREATE TABLE IF NOT EXISTS public.booking_issue_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  issue_id UUID NOT NULL REFERENCES public.booking_issues(id) ON DELETE CASCADE,
  booking_id UUID NOT NULL REFERENCES public.bookings(id) ON DELETE RESTRICT,
  uploaded_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  storage_bucket TEXT NOT NULL DEFAULT 'issue-evidence-private',
  storage_path TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  file_size_bytes BIGINT NOT NULL CHECK (file_size_bytes > 0),
  mime_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_booking_issue_evidence_issue_id ON public.booking_issue_evidence(issue_id);
CREATE INDEX IF NOT EXISTS idx_booking_issue_evidence_booking_id ON public.booking_issue_evidence(booking_id);
CREATE INDEX IF NOT EXISTS idx_booking_issue_evidence_uploaded_by ON public.booking_issue_evidence(uploaded_by);

-- 8. APARTMENT DAMAGE DEPOSITS (48-hour inspection window)
CREATE TABLE IF NOT EXISTS public.damage_deposits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.bookings(id) ON DELETE RESTRICT,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE RESTRICT,
  guest_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  deposit_amount_ngn NUMERIC(14,2) NOT NULL CHECK (deposit_amount_ngn > 0),
  retained_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (retained_amount_ngn >= 0),
  refunded_amount_ngn NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (refunded_amount_ngn >= 0),
  status TEXT NOT NULL DEFAULT 'held' CHECK (
    status IN ('held', 'claim_pending', 'partially_retained', 'fully_retained', 'refunded_to_guest')
  ),
  inspection_deadline TIMESTAMPTZ NOT NULL,
  adjudicated_at TIMESTAMPTZ NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_deposit_balances CHECK (retained_amount_ngn + refunded_amount_ngn <= deposit_amount_ngn)
);

CREATE INDEX IF NOT EXISTS idx_damage_deposits_booking_id ON public.damage_deposits(booking_id);
CREATE INDEX IF NOT EXISTS idx_damage_deposits_property_id ON public.damage_deposits(property_id);
CREATE INDEX IF NOT EXISTS idx_damage_deposits_inspection ON public.damage_deposits(inspection_deadline, status);

-- 9. AUTHORITATIVE DOUBLE-ENTRY FINANCIAL LEDGER (Append-only)
CREATE TABLE IF NOT EXISTS public.financial_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_group_id UUID NOT NULL,
  booking_id UUID REFERENCES public.bookings(id) ON DELETE RESTRICT,
  transaction_type TEXT NOT NULL,
  account_code TEXT NOT NULL,
  account_name TEXT NOT NULL,
  entry_type TEXT NOT NULL CHECK (entry_type IN ('debit', 'credit')),
  amount_ngn NUMERIC(14,2) NOT NULL CHECK (amount_ngn > 0),
  description TEXT NOT NULL,
  reference TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_financial_ledger_group_id ON public.financial_ledger(transaction_group_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_booking_id ON public.financial_ledger(booking_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_reference ON public.financial_ledger(reference);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_created_at ON public.financial_ledger(created_at);

-- 10. WEBHOOK EVENTS (4-State idempotent Paystack event log)
CREATE TABLE IF NOT EXISTS public.webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_source TEXT NOT NULL DEFAULT 'paystack',
  event_type TEXT NOT NULL,
  event_reference TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'received' CHECK (
    status IN ('received', 'processing', 'completed', 'failed')
  ),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  processing_started_at TIMESTAMPTZ NULL,
  processed_at TIMESTAMPTZ NULL,
  last_error TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_webhook_events_source_ref UNIQUE (event_source, event_reference)
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_status ON public.webhook_events(status);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON public.webhook_events(created_at);
CREATE INDEX IF NOT EXISTS idx_webhook_events_processing ON public.webhook_events(processing_started_at);

-- 11. ROW LEVEL SECURITY (RLS) ACTIVATION
ALTER TABLE public.host_payout_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.partner_payouts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.guest_assurance_reserves ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_issue_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.damage_deposits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- 12. REVOKE DIRECT CLIENT PRIVILEGES
-- Strict isolation: Neither anon nor authenticated users may execute direct table operations on ledger or webhook events
REVOKE ALL ON public.financial_ledger FROM anon, authenticated;
REVOKE ALL ON public.webhook_events FROM anon, authenticated;

-- Revoke direct mutation privileges on financial entities from anon and authenticated
REVOKE INSERT, UPDATE, DELETE ON public.partner_payouts FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.guest_assurance_reserves FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.damage_deposits FROM anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.booking_issues FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.booking_issue_evidence FROM anon, authenticated;

-- 13. RLS POLICIES FOR SECURE READS & RESTRICTED ACCESS

-- A. host_payout_profiles
DROP POLICY IF EXISTS "Hosts can view own payout profile" ON public.host_payout_profiles;
CREATE POLICY "Hosts can view own payout profile"
  ON public.host_payout_profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = host_payout_profiles.host_id AND hp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- B. partner_payouts
DROP POLICY IF EXISTS "Hosts can view own payouts" ON public.partner_payouts;
CREATE POLICY "Hosts can view own payouts"
  ON public.partner_payouts FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = partner_payouts.host_id AND hp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- C. guest_assurance_reserves
DROP POLICY IF EXISTS "Hosts and admins can view reserves" ON public.guest_assurance_reserves;
CREATE POLICY "Hosts and admins can view reserves"
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

-- D. booking_issues
DROP POLICY IF EXISTS "Guests can view own issues" ON public.booking_issues;
CREATE POLICY "Guests can view own issues"
  ON public.booking_issues FOR SELECT
  TO authenticated
  USING (
    guest_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.properties prop
      JOIN public.host_profiles hp ON prop.host_id = hp.id
      WHERE prop.id = booking_issues.property_id AND hp.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- E. booking_issue_evidence
DROP POLICY IF EXISTS "Guests and admins can view evidence" ON public.booking_issue_evidence;
CREATE POLICY "Guests and admins can view evidence"
  ON public.booking_issue_evidence FOR SELECT
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Evidence upload allowed only for own issues
DROP POLICY IF EXISTS "Guests can upload evidence for own issues" ON public.booking_issue_evidence;
CREATE POLICY "Guests can upload evidence for own issues"
  ON public.booking_issue_evidence FOR INSERT
  TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.booking_issues bi
      WHERE bi.id = issue_id AND bi.guest_id = auth.uid()
    )
  );

-- F. damage_deposits
DROP POLICY IF EXISTS "Parties can view damage deposits" ON public.damage_deposits;
CREATE POLICY "Parties can view damage deposits"
  ON public.damage_deposits FOR SELECT
  TO authenticated
  USING (
    guest_id = auth.uid()
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

-- 14. PRIVATE STORAGE BUCKET INITIALIZATION (Idempotent for Supabase Storage)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'issue-evidence-private',
  'issue-evidence-private',
  FALSE,
  10485760, -- 10MB per file limit
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4']
)
ON CONFLICT (id) DO UPDATE 
SET public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf', 'video/mp4'];
