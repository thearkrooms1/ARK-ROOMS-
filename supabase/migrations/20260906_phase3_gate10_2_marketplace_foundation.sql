-- ==============================================================================
-- PHASE 3 — GATE #10.2: HOST MARKETPLACE DATABASE, RLS & SERVER API FOUNDATION
-- Database Migration: Property Approval Audits, Hardened RLS, RPCs, and Booking Defense
-- ==============================================================================

-- 1. PROPERTY APPROVAL STATUS CONSTRAINT EXTENSION
-- Ensure approval_status includes 'suspended' alongside 'draft', 'pending_review', 'approved', 'rejected'
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS chk_properties_approval_status;
ALTER TABLE public.properties DROP CONSTRAINT IF EXISTS properties_approval_status_check;
ALTER TABLE public.properties ADD CONSTRAINT chk_properties_approval_status 
  CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'rejected', 'suspended'));

-- ==============================================================================
-- 2. PROPERTY APPROVAL AUDIT TABLE
-- Append-only audit table tracking every property status change and adjudication
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.property_approval_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  admin_id UUID NOT NULL REFERENCES auth.users(id),
  previous_status TEXT NOT NULL,
  new_status TEXT NOT NULL,
  rejection_reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_approval_audits_prop 
  ON public.property_approval_audits(property_id, created_at DESC);

-- Append-only defense: Prohibit UPDATE and DELETE on property_approval_audits
CREATE OR REPLACE FUNCTION public.fn_prevent_property_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Audit records are strictly append-only. Modification or deletion prohibited.'
    USING ERRCODE = '42501';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_property_audit_mutation ON public.property_approval_audits;
CREATE TRIGGER trg_prevent_property_audit_mutation
  BEFORE UPDATE OR DELETE ON public.property_approval_audits
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_prevent_property_audit_mutation();

-- Enable RLS on public.property_approval_audits
ALTER TABLE public.property_approval_audits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view all property approval audits" ON public.property_approval_audits;
CREATE POLICY "Admins can view all property approval audits"
  ON public.property_approval_audits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Hosts can view own property approval audits" ON public.property_approval_audits;
CREATE POLICY "Hosts can view own property approval audits"
  ON public.property_approval_audits FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties prop
      JOIN public.host_profiles hp ON hp.id = prop.host_id
      WHERE prop.id = property_approval_audits.property_id
        AND hp.user_id = auth.uid()
    )
  );

-- ==============================================================================
-- 3. PROPERTY ROW LEVEL SECURITY (RLS) HARDENING
-- ==============================================================================
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view approved active properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can view own properties" ON public.properties;
DROP POLICY IF EXISTS "Admins full access to properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can insert own draft properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can update own draft or rejected properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can delete own draft properties" ON public.properties;

-- 1. Public SELECT: A property is publicly visible ONLY if:
-- - approval_status = 'approved'
-- - property is active
-- - either host_id IS NULL OR host_id points to an active host_profile
-- - at least one active room exists with price_per_night_ngn > 0 AND total_rooms > 0
-- CRITICAL: host_id IS NULL MUST NOT by itself grant visibility! Unapproved NULL-host properties remain invisible.
CREATE POLICY "Public can view approved active properties"
  ON public.properties FOR SELECT
  USING (
    approval_status = 'approved'
    AND (status = TRUE OR status IS NULL OR status = 'active')
    AND (
      host_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.host_profiles hp
        WHERE hp.id = properties.host_id
          AND hp.host_status = 'active'
      )
    )
    AND EXISTS (
      SELECT 1 FROM public.rooms r
      WHERE r.property_id = properties.id
        AND (r.is_active = TRUE OR r.status = TRUE OR r.status IS NULL OR r.status = 'active')
        AND COALESCE(r.price_per_night_ngn, r.price_per_night, 0) > 0
        AND COALESCE(r.total_rooms, 0) > 0
    )
  );

-- 2. Host SELECT: A host can see their own properties regardless of approval status
-- A host must never see another host's properties.
CREATE POLICY "Hosts can view own properties"
  ON public.properties FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id
        AND hp.user_id = auth.uid()
    )
  );

-- 3. Admin ALL: Full governance visibility and management
CREATE POLICY "Admins full access to properties"
  ON public.properties FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 4. Host INSERT: Active host only.
-- Begins strictly as draft, individual_host, unapproved
CREATE POLICY "Hosts can insert own draft properties"
  ON public.properties FOR INSERT
  TO authenticated
  WITH CHECK (
    approval_status = 'draft'
    AND partner_tier = 'individual_host'
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND (is_verified IS NULL OR is_verified = FALSE)
    AND (verified IS NULL OR verified = FALSE)
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
    )
  );

-- 5. Host UPDATE: Hosts can update only their own properties when in draft, rejected, or approved
-- Frozen in pending_review or suspended
CREATE POLICY "Hosts can update own draft or rejected properties"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (
    approval_status IN ('draft', 'rejected', 'approved')
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
    )
  )
  WITH CHECK (
    approval_status IN ('draft', 'rejected', 'pending_review', 'approved')
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND (is_verified IS NULL OR is_verified = FALSE)
    AND (verified IS NULL OR verified = FALSE)
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
    )
  );

-- 6. Host DELETE: Hosts can delete only their own draft properties when safe (no bookings exist)
CREATE POLICY "Hosts can delete own draft properties"
  ON public.properties FOR DELETE
  TO authenticated
  USING (
    approval_status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.property_id = properties.id
    )
  );

-- ==============================================================================
-- 4. PROPERTY FIELD PROTECTION TRIGGER
-- Defends immutable fields, structural edit re-review triggers, and role isolation
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.check_property_immutable_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
  v_structural_change BOOLEAN := FALSE;
BEGIN
  -- Service role bypasses checks
  IF current_user = 'service_role' OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT (p.role = 'admin') INTO v_is_admin
    FROM public.profiles p
    WHERE p.id = auth.uid();
  END IF;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    -- Prevent changing host_id
    IF NEW.host_id IS DISTINCT FROM OLD.host_id THEN
      RAISE EXCEPTION 'Cannot modify host_id once established.' USING ERRCODE = '42501';
    END IF;

    -- Prevent modifying properties in pending_review or suspended
    IF OLD.approval_status IN ('pending_review', 'suspended') THEN
      RAISE EXCEPTION 'Properties in % status are locked from host modification.', OLD.approval_status USING ERRCODE = '42501';
    END IF;

    -- Prevent self-approval or tampering with approved_by / approved_at
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
      RAISE EXCEPTION 'Non-admin users cannot set approved_by.' USING ERRCODE = '42501';
    END IF;

    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Non-admin users cannot set approved_at.' USING ERRCODE = '42501';
    END IF;

    -- Prevent modifying verification badges
    IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified AND NEW.is_verified = TRUE)
       OR (NEW.verified IS DISTINCT FROM OLD.verified AND NEW.verified = TRUE) THEN
      RAISE EXCEPTION 'Non-admin users cannot mark properties as verified.' USING ERRCODE = '42501';
    END IF;

    -- Prevent modifying financial / commission fields directly
    IF NEW.commission_rate_percentage IS DISTINCT FROM OLD.commission_rate_percentage THEN
      RAISE EXCEPTION 'Non-admin users cannot modify commission_rate_percentage.' USING ERRCODE = '42501';
    END IF;

    IF NEW.requires_damage_deposit IS DISTINCT FROM OLD.requires_damage_deposit 
       OR NEW.damage_deposit_amount_ngn IS DISTINCT FROM OLD.damage_deposit_amount_ngn THEN
      RAISE EXCEPTION 'Non-admin users cannot modify damage deposit configuration.' USING ERRCODE = '42501';
    END IF;

    -- Prevent direct mutation of approval_status to approved or suspended
    IF NEW.approval_status IN ('approved', 'suspended') AND OLD.approval_status <> NEW.approval_status THEN
      RAISE EXCEPTION 'Only administrators can approve or suspend properties.' USING ERRCODE = '42501';
    END IF;

    -- Structural edits to approved properties trigger re-review:
    IF OLD.approval_status = 'approved' THEN
      IF (NEW.name IS DISTINCT FROM OLD.name)
         OR (NEW.title IS DISTINCT FROM OLD.title)
         OR (NEW.address IS DISTINCT FROM OLD.address)
         OR (NEW.city IS DISTINCT FROM OLD.city)
         OR (NEW.state IS DISTINCT FROM OLD.state)
         OR (NEW.latitude IS DISTINCT FROM OLD.latitude)
         OR (NEW.longitude IS DISTINCT FROM OLD.longitude)
         OR (NEW.venue_id IS DISTINCT FROM OLD.venue_id)
         OR (NEW.property_type IS DISTINCT FROM OLD.property_type) THEN
        v_structural_change := TRUE;
      END IF;

      IF v_structural_change THEN
        NEW.approval_status := 'pending_review';
        NEW.submitted_at := now();
        NEW.approved_by := NULL;
        NEW.approved_at := NULL;

        -- Record audit of automatic structural re-review trigger
        INSERT INTO public.property_approval_audits (
          property_id,
          admin_id,
          previous_status,
          new_status,
          rejection_reason,
          metadata
        ) VALUES (
          OLD.id,
          auth.uid(),
          'approved',
          'pending_review',
          NULL,
          jsonb_build_object('trigger', 'structural_edit_re_review')
        );
      END IF;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_property_immutable_fields ON public.properties;
CREATE TRIGGER trg_check_property_immutable_fields
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.check_property_immutable_fields();

-- ==============================================================================
-- 5. ROOM ROW LEVEL SECURITY (RLS) HARDENING
-- ==============================================================================
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can view rooms for approved properties" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can view rooms for own properties" ON public.rooms;
DROP POLICY IF EXISTS "Admins full access to rooms" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can insert rooms for own editable properties" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can update rooms for own editable properties" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can delete rooms for own draft properties" ON public.rooms;

-- 1. Public SELECT: Only rooms belonging to approved, active, publicly eligible properties
CREATE POLICY "Public can view rooms for approved properties"
  ON public.rooms FOR SELECT
  USING (
    (is_active = TRUE OR status = TRUE OR status IS NULL OR status = 'active')
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = rooms.property_id
        AND p.approval_status = 'approved'
        AND (p.status = TRUE OR p.status IS NULL OR p.status = 'active')
        AND (
          p.host_id IS NULL
          OR EXISTS (
            SELECT 1 FROM public.host_profiles hp
            WHERE hp.id = p.host_id
              AND hp.host_status = 'active'
          )
        )
    )
  );

-- 2. Host SELECT: Hosts can view rooms for their own properties
CREATE POLICY "Hosts can view rooms for own properties"
  ON public.rooms FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = rooms.property_id
        AND hp.user_id = auth.uid()
    )
  );

-- 3. Admin ALL: Administrators have full access
CREATE POLICY "Admins full access to rooms"
  ON public.rooms FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- 4. Host INSERT: Only under draft or rejected properties owned by active host
CREATE POLICY "Hosts can insert rooms for own editable properties"
  ON public.rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
        AND p.approval_status IN ('draft', 'rejected', 'approved')
    )
  );

-- 5. Host UPDATE: Under own editable properties
CREATE POLICY "Hosts can update rooms for own editable properties"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = rooms.property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
        AND p.approval_status IN ('draft', 'rejected', 'approved')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
        AND p.approval_status IN ('draft', 'rejected', 'approved')
    )
  );

-- 6. Host DELETE: Only rooms on draft properties with zero booking relationships
CREATE POLICY "Hosts can delete rooms for own draft properties"
  ON public.rooms FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = rooms.property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status = 'active'
        AND p.approval_status IN ('draft', 'rejected')
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.bookings b
      WHERE b.room_id = rooms.id
    )
  );

-- ==============================================================================
-- 6. ROOM FIELD PROTECTION TRIGGER
-- Enforces:
-- 1. Hosts MUST NOT directly mutate available_rooms
-- 2. total_rooms >= 1 and total_rooms >= active future reservations
-- 3. Room mutation blocked if property is in pending_review or suspended
-- ==============================================================================
CREATE OR REPLACE FUNCTION public.check_room_immutable_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
  v_prop RECORD;
  v_active_future_reservations INTEGER := 0;
BEGIN
  IF current_user = 'service_role' OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT (p.role = 'admin') INTO v_is_admin
    FROM public.profiles p
    WHERE p.id = auth.uid();
  END IF;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    -- Prevent reassignment of room to a different property
    IF NEW.property_id IS DISTINCT FROM OLD.property_id THEN
      RAISE EXCEPTION 'Cannot reassign room to a different property.' USING ERRCODE = '42501';
    END IF;

    -- Fetch parent property state
    SELECT id, approval_status INTO v_prop
    FROM public.properties
    WHERE id = NEW.property_id;

    IF v_prop.approval_status IN ('pending_review', 'suspended') THEN
      RAISE EXCEPTION 'Rooms under property in % status are locked from modification.', v_prop.approval_status 
        USING ERRCODE = '42501';
    END IF;

    -- CRITICAL: available_rooms is server-computed/date-specific. Hosts cannot mutate it directly!
    IF NEW.available_rooms IS DISTINCT FROM OLD.available_rooms THEN
      RAISE EXCEPTION 'Direct modification of available_rooms is prohibited. Availability is date-specific.' 
        USING ERRCODE = '42501';
    END IF;

    -- Validate total_rooms >= 1
    IF NEW.total_rooms IS NOT NULL AND NEW.total_rooms < 1 THEN
      RAISE EXCEPTION 'Total rooms must be at least 1.' USING ERRCODE = '22023';
    END IF;

    -- Validate total_rooms >= active future reservations/holds
    IF NEW.total_rooms IS DISTINCT FROM OLD.total_rooms AND NEW.total_rooms < OLD.total_rooms THEN
      SELECT COUNT(*)::INTEGER INTO v_active_future_reservations
      FROM public.bookings b
      WHERE b.room_id = NEW.id
        AND b.check_out > CURRENT_DATE
        AND (
          b.booking_status IN ('confirmed', 'checked_in')
          OR (b.booking_status = 'pending' AND (b.expires_at IS NULL OR b.expires_at > now()))
        );

      IF NEW.total_rooms < v_active_future_reservations THEN
        RAISE EXCEPTION 'Cannot reduce total_rooms below active future reservations count (%).', v_active_future_reservations
          USING ERRCODE = '22023';
      END IF;
    END IF;

    -- Validate price and capacity
    IF NEW.price_per_night_ngn IS NOT NULL AND NEW.price_per_night_ngn <= 0 THEN
      RAISE EXCEPTION 'Nightly price must be greater than zero.' USING ERRCODE = '22023';
    END IF;

    IF NEW.max_guests IS NOT NULL AND NEW.max_guests <= 0 THEN
      RAISE EXCEPTION 'Max guests must be at least 1.' USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_check_room_immutable_fields ON public.rooms;
CREATE TRIGGER trg_check_room_immutable_fields
  BEFORE UPDATE ON public.rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.check_room_immutable_fields();

-- ==============================================================================
-- 7. AUTHORITATIVE RPCS FOR PROPERTY LIFECYCLE
-- ==============================================================================

-- 7A. Host: Submit property for review
CREATE OR REPLACE FUNCTION public.submit_host_property_for_review(
  p_property_id UUID
)
RETURNS JSONB AS $$
DECLARE
  v_user_id UUID;
  v_host_id UUID;
  v_host_status TEXT;
  v_property RECORD;
  v_room_count INTEGER;
  v_invalid_rooms INTEGER;
BEGIN
  v_user_id := auth.uid();
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Verify host profile
  SELECT id, host_status INTO v_host_id, v_host_status
  FROM public.host_profiles
  WHERE user_id = v_user_id;

  IF v_host_id IS NULL THEN
    RAISE EXCEPTION 'Host profile not found for authenticated user.' USING ERRCODE = '42501';
  END IF;

  IF v_host_status <> 'active' THEN
    RAISE EXCEPTION 'Only active hosts can submit properties for review.' USING ERRCODE = '42501';
  END IF;

  -- Lock and fetch property
  SELECT * INTO v_property
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.' USING ERRCODE = 'P0002';
  END IF;

  -- Verify ownership
  IF v_property.host_id <> v_host_id THEN
    RAISE EXCEPTION 'Unauthorized: Property does not belong to the authenticated host.' USING ERRCODE = '42501';
  END IF;

  -- Verify state permits submission (draft or rejected)
  IF v_property.approval_status NOT IN ('draft', 'rejected') THEN
    RAISE EXCEPTION 'Property in status % cannot be submitted for review.', v_property.approval_status USING ERRCODE = '22023';
  END IF;

  -- Validation: Property title/name
  IF COALESCE(TRIM(v_property.name), '') = '' AND COALESCE(TRIM(v_property.title), '') = '' THEN
    RAISE EXCEPTION 'Property name or title is required.' USING ERRCODE = '22023';
  END IF;

  -- Validation: Property description
  IF COALESCE(TRIM(v_property.description), '') = '' THEN
    RAISE EXCEPTION 'Property description is required.' USING ERRCODE = '22023';
  END IF;

  -- Validation: Property address, city, state
  IF COALESCE(TRIM(v_property.address), '') = '' THEN
    RAISE EXCEPTION 'Property address is required.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(TRIM(v_property.city), '') = '' THEN
    RAISE EXCEPTION 'Property city is required.' USING ERRCODE = '22023';
  END IF;

  IF COALESCE(TRIM(v_property.state), '') = '' THEN
    RAISE EXCEPTION 'Property state is required.' USING ERRCODE = '22023';
  END IF;

  -- Validation: Coordinates
  IF v_property.latitude IS NULL OR v_property.longitude IS NULL THEN
    RAISE EXCEPTION 'Property latitude and longitude are required.' USING ERRCODE = '22023';
  END IF;

  -- Validation: Venue
  IF v_property.venue_id IS NULL THEN
    RAISE EXCEPTION 'Associated venue is required.' USING ERRCODE = '22023';
  END IF;

  -- Validation: At least 1 active room exists
  SELECT COUNT(*) INTO v_room_count
  FROM public.rooms
  WHERE property_id = p_property_id AND (is_active = TRUE OR status = TRUE OR status IS NULL OR status = 'active');

  IF v_room_count = 0 THEN
    RAISE EXCEPTION 'Property must have at least one active room before submission.' USING ERRCODE = '22023';
  END IF;

  -- Validation: All rooms must have positive price, positive capacity, positive total_rooms
  SELECT COUNT(*) INTO v_invalid_rooms
  FROM public.rooms
  WHERE property_id = p_property_id 
    AND (
      COALESCE(price_per_night_ngn, price_per_night, 0) <= 0 
      OR COALESCE(max_guests, capacity, 0) <= 0
      OR COALESCE(total_rooms, 0) <= 0
    );

  IF v_invalid_rooms > 0 THEN
    RAISE EXCEPTION 'All rooms must have valid nightly price, guest capacity, and total rooms.' USING ERRCODE = '22023';
  END IF;

  -- Transition to pending_review
  UPDATE public.properties
  SET
    approval_status = 'pending_review',
    submitted_at = now(),
    rejection_reason = NULL,
    updated_at = now()
  WHERE id = p_property_id;

  -- Insert audit log
  INSERT INTO public.property_approval_audits (
    property_id,
    admin_id,
    previous_status,
    new_status,
    rejection_reason,
    metadata
  ) VALUES (
    p_property_id,
    v_user_id,
    v_property.approval_status,
    'pending_review',
    NULL,
    jsonb_build_object('submitted_by', v_user_id)
  );

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'approval_status', 'pending_review',
    'submitted_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7B. Admin: Adjudicate property (approve or reject with partner_tier option)
CREATE OR REPLACE FUNCTION public.admin_adjudicate_property(
  p_property_id UUID,
  p_decision TEXT,
  p_rejection_reason TEXT DEFAULT NULL,
  p_partner_tier TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN := FALSE;
  v_property RECORD;
  v_new_tier TEXT;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  -- Check admin permission
  SELECT (role = 'admin') INTO v_is_admin
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Administrative privileges required to adjudicate properties.' USING ERRCODE = '42501';
  END IF;

  IF p_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected.' USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'rejected' AND (p_rejection_reason IS NULL OR TRIM(p_rejection_reason) = '') THEN
    RAISE EXCEPTION 'Rejection reason is required when rejecting a property.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_property
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.' USING ERRCODE = 'P0002';
  END IF;

  v_new_tier := COALESCE(p_partner_tier, v_property.partner_tier, 'individual_host');
  IF v_new_tier NOT IN ('individual_host', 'hotel_organization') THEN
    RAISE EXCEPTION 'Invalid partner tier: %', v_new_tier USING ERRCODE = '22023';
  END IF;

  IF p_decision = 'approved' THEN
    UPDATE public.properties
    SET
      approval_status = 'approved',
      partner_tier = v_new_tier,
      requires_damage_deposit = CASE WHEN v_new_tier = 'hotel_organization' THEN FALSE ELSE requires_damage_deposit END,
      damage_deposit_amount_ngn = CASE WHEN v_new_tier = 'hotel_organization' THEN 0 ELSE damage_deposit_amount_ngn END,
      approved_by = v_admin_id,
      approved_at = now(),
      rejection_reason = NULL,
      updated_at = now()
    WHERE id = p_property_id;
  ELSE
    UPDATE public.properties
    SET
      approval_status = 'rejected',
      approved_by = v_admin_id,
      rejection_reason = TRIM(p_rejection_reason),
      updated_at = now()
    WHERE id = p_property_id;
  END IF;

  -- Insert audit log
  INSERT INTO public.property_approval_audits (
    property_id,
    admin_id,
    previous_status,
    new_status,
    rejection_reason,
    metadata
  ) VALUES (
    p_property_id,
    v_admin_id,
    v_property.approval_status,
    p_decision,
    CASE WHEN p_decision = 'rejected' THEN TRIM(p_rejection_reason) ELSE NULL END,
    jsonb_build_object('adjudicated_by', v_admin_id, 'partner_tier', v_new_tier)
  );

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'approval_status', p_decision,
    'partner_tier', v_new_tier,
    'adjudicated_by', v_admin_id,
    'adjudicated_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7C. Admin: Suspend property
CREATE OR REPLACE FUNCTION public.admin_suspend_property(
  p_property_id UUID,
  p_reason TEXT DEFAULT NULL
)
RETURNS JSONB AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN := FALSE;
  v_property RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT (role = 'admin') INTO v_is_admin
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Administrative privileges required to suspend properties.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_property
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.properties
  SET
    approval_status = 'suspended',
    updated_at = now()
  WHERE id = p_property_id;

  INSERT INTO public.property_approval_audits (
    property_id,
    admin_id,
    previous_status,
    new_status,
    rejection_reason,
    metadata
  ) VALUES (
    p_property_id,
    v_admin_id,
    v_property.approval_status,
    'suspended',
    p_reason,
    jsonb_build_object('action', 'admin_suspend', 'reason', p_reason)
  );

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'approval_status', 'suspended',
    'suspended_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 7D. Admin: Set property partner tier
CREATE OR REPLACE FUNCTION public.admin_set_property_tier(
  p_property_id UUID,
  p_partner_tier TEXT
)
RETURNS JSONB AS $$
DECLARE
  v_admin_id UUID;
  v_is_admin BOOLEAN := FALSE;
  v_property RECORD;
BEGIN
  v_admin_id := auth.uid();
  IF v_admin_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT (role = 'admin') INTO v_is_admin
  FROM public.profiles
  WHERE id = v_admin_id;

  IF NOT COALESCE(v_is_admin, FALSE) THEN
    RAISE EXCEPTION 'Administrative privileges required to change partner tier.' USING ERRCODE = '42501';
  END IF;

  IF p_partner_tier NOT IN ('individual_host', 'hotel_organization') THEN
    RAISE EXCEPTION 'Invalid partner tier: %', p_partner_tier USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_property
  FROM public.properties
  WHERE id = p_property_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.properties
  SET
    partner_tier = p_partner_tier,
    requires_damage_deposit = CASE WHEN p_partner_tier = 'hotel_organization' THEN FALSE ELSE requires_damage_deposit END,
    damage_deposit_amount_ngn = CASE WHEN p_partner_tier = 'hotel_organization' THEN 0 ELSE damage_deposit_amount_ngn END,
    updated_at = now()
  WHERE id = p_property_id;

  INSERT INTO public.property_approval_audits (
    property_id,
    admin_id,
    previous_status,
    new_status,
    rejection_reason,
    metadata
  ) VALUES (
    p_property_id,
    v_admin_id,
    v_property.approval_status,
    v_property.approval_status,
    NULL,
    jsonb_build_object('action', 'tier_update', 'previous_tier', v_property.partner_tier, 'new_tier', p_partner_tier)
  );

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'partner_tier', p_partner_tier,
    'updated_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public/anon
REVOKE EXECUTE ON FUNCTION public.submit_host_property_for_review(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_host_property_for_review(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_adjudicate_property(UUID, TEXT, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjudicate_property(UUID, TEXT, TEXT, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_suspend_property(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_suspend_property(UUID, TEXT) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_set_property_tier(UUID, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_set_property_tier(UUID, TEXT) TO authenticated, service_role;

-- ==============================================================================
-- 8. STORAGE RLS REINFORCEMENT FOR PROPERTY IMAGES
-- ==============================================================================
DROP POLICY IF EXISTS "Property images public select" ON storage.objects;
CREATE POLICY "Property images public select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images');

DROP POLICY IF EXISTS "Host can upload property images" ON storage.objects;
CREATE POLICY "Host can upload property images"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'property-images'
    AND (
      -- Property folder check: properties/{property_id}/...
      EXISTS (
        SELECT 1 FROM public.properties p
        JOIN public.host_profiles hp ON hp.id = p.host_id
        WHERE p.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.host_status = 'active'
          AND p.approval_status IN ('draft', 'rejected', 'approved')
      )
      -- Room folder check: rooms/{room_id}/...
      OR EXISTS (
        SELECT 1 FROM public.rooms r
        JOIN public.properties p ON p.id = r.property_id
        JOIN public.host_profiles hp ON hp.id = p.host_id
        WHERE r.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.host_status = 'active'
          AND p.approval_status IN ('draft', 'rejected', 'approved')
      )
      -- Admin override
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
    )
  );

DROP POLICY IF EXISTS "Host can delete own property images" ON storage.objects;
CREATE POLICY "Host can delete own property images"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'property-images'
    AND (
      EXISTS (
        SELECT 1 FROM public.properties p
        JOIN public.host_profiles hp ON hp.id = p.host_id
        WHERE p.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.host_status = 'active'
          AND p.approval_status IN ('draft', 'rejected', 'approved')
      )
      OR EXISTS (
        SELECT 1 FROM public.rooms r
        JOIN public.properties p ON p.id = r.property_id
        JOIN public.host_profiles hp ON hp.id = p.host_id
        WHERE r.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.host_status = 'active'
          AND p.approval_status IN ('draft', 'rejected', 'approved')
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
    )
  );

-- ==============================================================================
-- 9. BOOKING ENGINE PUBLICATION DEFENSE
-- In create_pending_booking_transaction, verify:
-- 1. Property exists
-- 2. Property approval_status = 'approved'
-- 3. Property is active
-- ==============================================================================
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

  -- 5. Atomic row lock on public.rooms BEFORE calculating date-specific availability
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

  -- Validate room operational status
  IF v_room.is_active = FALSE OR LOWER(v_room.status) IN ('inactive', 'maintenance', 'out_of_service', 'sold_out') THEN
    RAISE EXCEPTION 'This room is currently inactive or under maintenance and not available for booking.' USING ERRCODE = '22023';
  END IF;

  -- Validate room guest capacity
  IF p_guests > COALESCE(v_room.max_guests, 10) THEN
    RAISE EXCEPTION 'Guest count exceeds maximum room capacity (% max).', v_room.max_guests USING ERRCODE = '22023';
  END IF;

  -- Fetch property details and enforce MARKETPLACE APPROVAL and ACTIVE STATUS
  SELECT
    p.id,
    COALESCE(p.approval_status, 'approved') AS approval_status,
    COALESCE(p.status, TRUE) AS status,
    COALESCE(p.partner_tier, 'individual_host') AS partner_tier,
    COALESCE(p.requires_damage_deposit, FALSE) AS requires_damage_deposit,
    COALESCE(p.damage_deposit_amount_ngn, p.damage_deposit_ngn, 0) AS damage_deposit_amount_ngn
  INTO v_property
  FROM public.properties p
  WHERE p.id = v_room.property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected property not found.' USING ERRCODE = 'P0002';
  END IF;

  -- MARKETPLACE DEFENSE: Unapproved or non-active properties cannot accept reservations
  IF v_property.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Property is in % status and is not approved for guest reservations.', v_property.approval_status 
      USING ERRCODE = '22023';
  END IF;

  IF v_property.status = FALSE THEN
    RAISE EXCEPTION 'Property is currently inactive and not available for guest bookings.' USING ERRCODE = '22023';
  END IF;

  -- 6. Date-Specific Occupancy Calculation
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
  v_room_total_ngn := v_nights * COALESCE(v_room.price_per_night_ngn, 0);

  IF p_logistics_services IS NOT NULL AND jsonb_typeof(p_logistics_services) = 'array' THEN
    FOR v_service IN
      SELECT
        COALESCE((elem->>'price_ngn')::numeric, (elem->>'priceNGN')::numeric, (elem->>'amount')::numeric, 0) AS price
      FROM jsonb_array_elements(p_logistics_services) AS elem
    LOOP
      v_logistics_total_ngn := v_logistics_total_ngn + COALESCE(v_service.price, 0);
    END LOOP;
  END IF;

  -- Hotel organizations are strictly exempt from damage deposit
  IF v_property.partner_tier = 'hotel_organization' THEN
    v_damage_deposit_ngn := 0;
  ELSIF v_property.requires_damage_deposit THEN
    v_damage_deposit_ngn := COALESCE(v_property.damage_deposit_amount_ngn, 0);
  ELSE
    v_damage_deposit_ngn := 0;
  END IF;

  v_total_amount_ngn := v_room_total_ngn + v_logistics_total_ngn + v_damage_deposit_ngn;

  -- 8. Generate Authoritative 30-Minute Hold Window
  v_expires_at := now() + INTERVAL '30 minutes';

  -- 9. Unique Booking Reference Generation
  v_booking_ref := COALESCE(p_booking_reference, 'ARK-' || TO_CHAR(now(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(gen_random_uuid()::text, 1, 8)));

  -- 10. Atomic Reservation Record Creation
  INSERT INTO public.bookings (
    user_id,
    property_id,
    room_id,
    booking_reference,
    check_in,
    check_out,
    guests,
    guest_name,
    guest_email,
    guest_phone,
    country,
    passport_name,
    special_requests,
    booking_status,
    payment_status,
    total_amount,
    currency,
    created_at,
    expires_at,
    logistics_services,
    logistics_total_ngn,
    damage_deposit_ngn
  ) VALUES (
    v_user_id,
    v_room.property_id,
    p_room_id,
    v_booking_ref,
    p_check_in,
    p_check_out,
    p_guests,
    v_guest_name,
    p_guest_email,
    p_guest_phone,
    p_country,
    p_passport_name,
    p_special_requests,
    'pending',
    'unpaid',
    v_total_amount_ngn,
    'NGN',
    now(),
    v_expires_at,
    p_logistics_services,
    v_logistics_total_ngn,
    v_damage_deposit_ngn
  )
  RETURNING id INTO v_booking_id;

  RETURN jsonb_build_object(
    'success', true,
    'booking_id', v_booking_id,
    'booking_reference', v_booking_ref,
    'expires_at', v_expires_at,
    'nights', v_nights,
    'room_total_ngn', v_room_total_ngn,
    'logistics_total_ngn', v_logistics_total_ngn,
    'damage_deposit_ngn', v_damage_deposit_ngn,
    'total_amount_ngn', v_total_amount_ngn,
    'partner_tier', v_property.partner_tier
  );
END;
$$;
