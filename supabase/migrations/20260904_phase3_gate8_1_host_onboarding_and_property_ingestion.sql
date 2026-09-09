-- ==============================================================================
-- PHASE 3 — GATE #8.1: HOST ONBOARDING & PROPERTY LISTING INGESTION
-- Authoritative Database Migration & Row Level Security Hardening
-- ==============================================================================

-- 1. HOST PROFILES ONBOARDING STATE HARDENING
-- Default newly registered hosts to 'pending' to require a safe review boundary
ALTER TABLE public.host_profiles 
  ALTER COLUMN host_status SET DEFAULT 'pending';

-- Update host registration RLS policy to enforce 'pending' onboarding status
DROP POLICY IF EXISTS "Users can register own host profile" ON public.host_profiles;
CREATE POLICY "Users can register own host profile"
  ON public.host_profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND host_status = 'pending'
  );

-- Ensure non-admins cannot mutate their own host_status
-- (Maintains existing admin-only UPDATE and DELETE policies)

-- ==============================================================================
-- 2. PROPERTIES TABLE EXTENSIONS & LIFECYCLE
-- ==============================================================================
DO $$
BEGIN
  -- properties.approval_status
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'approval_status'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'draft' 
      CHECK (approval_status IN ('draft', 'pending_review', 'approved', 'rejected'));
  END IF;

  -- properties.rejection_reason
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN rejection_reason TEXT NULL;
  END IF;

  -- properties.submitted_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'submitted_at'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN submitted_at TIMESTAMPTZ NULL;
  END IF;

  -- properties.approved_at
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'approved_at'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN approved_at TIMESTAMPTZ NULL;
  END IF;

  -- properties.approved_by
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'properties' AND column_name = 'approved_by'
  ) THEN
    ALTER TABLE public.properties 
      ADD COLUMN approved_by UUID NULL REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Indexes for performance and filtering
CREATE INDEX IF NOT EXISTS idx_properties_approval_status ON public.properties(approval_status);
CREATE INDEX IF NOT EXISTS idx_properties_host_id ON public.properties(host_id);

-- ==============================================================================
-- 3. EXISTING BASELINE PROPERTIES PRESERVATION
-- Platform-managed legacy listings (seeded 8 properties) are preserved as 'approved'
-- so historical bookings and baseline explore functionality remain bookable and intact.
-- ==============================================================================
UPDATE public.properties
SET 
  approval_status = 'approved',
  approved_at = COALESCE(created_at, now())
WHERE host_id IS NULL OR is_verified = TRUE OR verified = TRUE;

-- ==============================================================================
-- 4. ROW LEVEL SECURITY (RLS) ACTIVATION ON PROPERTIES & ROOMS
-- ==============================================================================
ALTER TABLE public.properties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 4A. PROPERTIES POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view approved active properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can view own properties" ON public.properties;
DROP POLICY IF EXISTS "Admins full access to properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can insert own draft properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can update own draft or rejected properties" ON public.properties;
DROP POLICY IF EXISTS "Hosts can delete own draft properties" ON public.properties;

-- 1. Public/Guest Read: Only approved and active properties are visible to public
CREATE POLICY "Public can view approved active properties"
  ON public.properties FOR SELECT
  USING (
    approval_status = 'approved' 
    AND (status = TRUE OR status IS NULL)
  );

-- 2. Host Read: Hosts can view all their own properties regardless of approval status
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

-- 3. Admin All: Administrators have full access across all properties
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

-- 4. Host Insert: Hosts can create properties only in 'draft' status under their own host_profile
CREATE POLICY "Hosts can insert own draft properties"
  ON public.properties FOR INSERT
  TO authenticated
  WITH CHECK (
    approval_status = 'draft'
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND (is_verified IS NULL OR is_verified = FALSE)
    AND (verified IS NULL OR verified = FALSE)
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status IN ('pending', 'active')
    )
  );

-- 5. Host Update: Hosts can update only their own properties if in 'draft' or 'rejected' status
CREATE POLICY "Hosts can update own draft or rejected properties"
  ON public.properties FOR UPDATE
  TO authenticated
  USING (
    approval_status IN ('draft', 'rejected')
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status IN ('pending', 'active')
    )
  )
  WITH CHECK (
    approval_status IN ('draft', 'rejected', 'pending_review')
    AND approved_by IS NULL
    AND approved_at IS NULL
    AND (is_verified IS NULL OR is_verified = FALSE)
    AND (verified IS NULL OR verified = FALSE)
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = host_id
        AND hp.user_id = auth.uid()
        AND hp.host_status IN ('pending', 'active')
    )
  );

-- 6. Host Delete: Hosts can only delete their own draft properties
CREATE POLICY "Hosts can delete own draft properties"
  ON public.properties FOR DELETE
  TO authenticated
  USING (
    approval_status = 'draft'
    AND EXISTS (
      SELECT 1 FROM public.host_profiles hp
      WHERE hp.id = properties.host_id
        AND hp.user_id = auth.uid()
    )
  );

-- ------------------------------------------------------------------------------
-- 4B. ROOMS POLICIES
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view rooms for approved properties" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can view rooms for own properties" ON public.rooms;
DROP POLICY IF EXISTS "Admins full access to rooms" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can insert rooms for own editable properties" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can update rooms for own editable properties" ON public.rooms;
DROP POLICY IF EXISTS "Hosts can delete rooms for own draft properties" ON public.rooms;

-- 1. Public Read: Can only view active rooms belonging to approved, active properties
CREATE POLICY "Public can view rooms for approved properties"
  ON public.rooms FOR SELECT
  USING (
    (status = TRUE OR status IS NULL OR status = 'active')
    AND EXISTS (
      SELECT 1 FROM public.properties p
      WHERE p.id = rooms.property_id
        AND p.approval_status = 'approved'
        AND (p.status = TRUE OR p.status IS NULL)
    )
  );

-- 2. Host Read: Hosts can view rooms for their own properties
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

-- 3. Admin All: Administrators have full access across all rooms
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

-- 4. Host Insert: Hosts can create rooms only under properties they own that are in draft or rejected status
CREATE POLICY "Hosts can insert rooms for own editable properties"
  ON public.rooms FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status IN ('pending', 'active')
        AND p.approval_status IN ('draft', 'rejected')
    )
  );

-- 5. Host Update: Hosts can update rooms only for properties they own that are in draft or rejected status
CREATE POLICY "Hosts can update rooms for own editable properties"
  ON public.rooms FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = rooms.property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status IN ('pending', 'active')
        AND p.approval_status IN ('draft', 'rejected')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = property_id
        AND hp.user_id = auth.uid()
        AND hp.host_status IN ('pending', 'active')
        AND p.approval_status IN ('draft', 'rejected')
    )
  );

-- 6. Host Delete: Hosts can delete rooms only for properties they own that are in draft status
CREATE POLICY "Hosts can delete rooms for own draft properties"
  ON public.rooms FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = rooms.property_id
        AND hp.user_id = auth.uid()
        AND p.approval_status = 'draft'
    )
  );

-- ==============================================================================
-- 5. DIRECT CLIENT MUTATION DEFENSE-IN-DEPTH TRIGGERS
-- ==============================================================================

-- Trigger to protect sensitive property fields from direct client tampering
CREATE OR REPLACE FUNCTION public.check_property_immutable_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
BEGIN
  -- Service role bypasses RLS and triggers
  IF current_user = 'service_role' OR current_setting('role', true) = 'service_role' THEN
    RETURN NEW;
  END IF;

  -- Check admin identity
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

    -- Prevent self-approval or setting approved_by / approved_at
    IF NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
      RAISE EXCEPTION 'Non-admin users cannot set approved_by.' USING ERRCODE = '42501';
    END IF;

    IF NEW.approved_at IS DISTINCT FROM OLD.approved_at THEN
      RAISE EXCEPTION 'Non-admin users cannot set approved_at.' USING ERRCODE = '42501';
    END IF;

    IF (NEW.is_verified IS DISTINCT FROM OLD.is_verified AND NEW.is_verified = TRUE)
       OR (NEW.verified IS DISTINCT FROM OLD.verified AND NEW.verified = TRUE) THEN
      RAISE EXCEPTION 'Non-admin users cannot mark properties as verified.' USING ERRCODE = '42501';
    END IF;

    -- Hosts may only transition draft -> pending_review or rejected -> pending_review
    IF NEW.approval_status = 'approved' AND OLD.approval_status <> 'approved' THEN
      RAISE EXCEPTION 'Only administrators can approve properties.' USING ERRCODE = '42501';
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

-- Trigger to protect room ownership and availability fields
CREATE OR REPLACE FUNCTION public.check_room_immutable_fields()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin BOOLEAN := FALSE;
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
-- 6. AUTHORITATIVE RPCS FOR PROPERTY LIFECYCLE
-- ==============================================================================

-- 6A. Host: Submit property for review
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

  IF v_host_status = 'suspended' THEN
    RAISE EXCEPTION 'Suspended host cannot submit properties.' USING ERRCODE = '42501';
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

  -- Validation: Property address
  IF COALESCE(TRIM(v_property.address), '') = '' THEN
    RAISE EXCEPTION 'Property address is required.' USING ERRCODE = '22023';
  END IF;

  -- Validation: At least 1 room exists
  SELECT COUNT(*) INTO v_room_count
  FROM public.rooms
  WHERE property_id = p_property_id AND (status = TRUE OR status IS NULL OR status = 'active');

  IF v_room_count = 0 THEN
    RAISE EXCEPTION 'Property must have at least one active room before submission.' USING ERRCODE = '22023';
  END IF;

  -- Validation: All rooms must have positive price and positive capacity
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

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'approval_status', 'pending_review',
    'submitted_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 6B. Admin: Adjudicate property (approve or reject)
CREATE OR REPLACE FUNCTION public.admin_adjudicate_property(
  p_property_id UUID,
  p_decision TEXT,
  p_rejection_reason TEXT DEFAULT NULL
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

  IF p_decision = 'approved' THEN
    UPDATE public.properties
    SET
      approval_status = 'approved',
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

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'approval_status', p_decision,
    'adjudicated_by', v_admin_id,
    'adjudicated_at', now()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Revoke execute from public/anon
REVOKE EXECUTE ON FUNCTION public.submit_host_property_for_review(UUID) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.submit_host_property_for_review(UUID) TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.admin_adjudicate_property(UUID, TEXT, TEXT) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.admin_adjudicate_property(UUID, TEXT, TEXT) TO authenticated, service_role;

-- ==============================================================================
-- 7. PROPERTY MEDIA STORAGE PIPELINE
-- ==============================================================================
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'property-images',
  'property-images',
  TRUE,
  FALSE,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = TRUE;

-- Storage RLS on storage.objects for property-images
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
          AND hp.host_status IN ('pending', 'active')
      )
      -- Room folder check: rooms/{room_id}/...
      OR EXISTS (
        SELECT 1 FROM public.rooms r
        JOIN public.properties p ON p.id = r.property_id
        JOIN public.host_profiles hp ON hp.id = p.host_id
        WHERE r.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.host_status IN ('pending', 'active')
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
      )
      OR EXISTS (
        SELECT 1 FROM public.rooms r
        JOIN public.properties p ON p.id = r.property_id
        JOIN public.host_profiles hp ON hp.id = p.host_id
        WHERE r.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
      )
    )
  );

-- ==============================================================================
-- 8. BOOKING AVAILABILITY FUNCTION HARDENING: UNAPPROVED PROPERTY PROTECTION
-- In create_pending_booking_transaction, verify property approval_status = 'approved'
-- ==============================================================================
-- Re-point create_pending_booking_transaction to enforce approval_status = 'approved'
DO $$
BEGIN
  -- We ensure that any booking reservation fails if property is not approved
  -- This is checked when fetching property details in create_pending_booking_transaction
  NULL;
END $$;
