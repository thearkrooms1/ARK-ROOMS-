-- ==============================================================================
-- PHASE 3 — GATE #10.2.2: HOST MEDIA STORAGE SECURITY REMEDIATION
-- Migration: 20260906_phase3_gate10_2_2_storage_remediation.sql
--
-- TARGET ARCHITECTURE: Two-Bucket Host Media Pipeline
-- 1. BUCKET A (property-media-staging): PRIVATE (public = false)
--    - Used for draft, pending_review, rejected, and unapproved property/room media.
--    - Enforces strict RLS: Accessible ONLY by authenticated owning active host,
--      admins, and server service-role.
--    - Anonymous and non-owner users have ZERO access (No SELECT, INSERT, UPDATE, DELETE).
-- 2. BUCKET B (property-images-public): PUBLIC (public = true)
--    - Used ONLY for published media of approved + active listings.
--    - Public SELECT allowed.
--    - Direct host INSERT/UPDATE/DELETE strictly blocked; modified ONLY via
--      controlled server-side promotion, demotion, and cleanup mechanisms.
-- 3. BUCKET C (property-images): DEPRECATED / HARDENED
--    - Revoke permissive public select and host upload policies.
-- 4. Append-only Media Audit Trail (public.property_media_audits).
-- ==============================================================================

-- 1. PROVISION & CONFIGURE BUCKETS
INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'property-media-staging',
  'property-media-staging',
  FALSE,
  FALSE,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = FALSE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

INSERT INTO storage.buckets (id, name, public, avif_autodetection, file_size_limit, allowed_mime_types)
VALUES (
  'property-images-public',
  'property-images-public',
  TRUE,
  FALSE,
  10485760, -- 10MB limit
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET public = TRUE,
    file_size_limit = 10485760,
    allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

-- 2. HARDEN / SUNSET LEGACY property-images POLICIES
DROP POLICY IF EXISTS "Property images public select" ON storage.objects;
DROP POLICY IF EXISTS "Host can upload property images" ON storage.objects;
DROP POLICY IF EXISTS "Host can delete own property images" ON storage.objects;

-- 3. ROW LEVEL SECURITY ON storage.objects
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- BUCKET A: property-media-staging (PRIVATE) POLICIES
-- ------------------------------------------------------------------------------

-- SELECT: Owning active host, Admin, or Service Role only
DROP POLICY IF EXISTS "Staging media authorized select" ON storage.objects;
CREATE POLICY "Staging media authorized select"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'property-media-staging'
    AND (
      -- Platform Admin
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
      OR
      -- Owning active host for property media (path: properties/{property_id}/...)
      EXISTS (
        SELECT 1 FROM public.properties prop
        JOIN public.host_profiles hp ON hp.id = prop.host_id
        WHERE prop.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.status = 'active'
      )
      OR
      -- Owning active host for room media (path: rooms/{room_id}/...)
      EXISTS (
        SELECT 1 FROM public.rooms rm
        JOIN public.properties prop ON prop.id = rm.property_id
        JOIN public.host_profiles hp ON hp.id = prop.host_id
        WHERE rm.id::text = (storage.foldername(name))[2]
          AND hp.user_id = auth.uid()
          AND hp.status = 'active'
      )
    )
  );

-- INSERT: Owning active host (draft/rejected/approved states only) or Admin
DROP POLICY IF EXISTS "Staging media host upload" ON storage.objects;
CREATE POLICY "Staging media host upload"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-media-staging'
    AND (
      -- Platform Admin
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
      OR (
        -- Property staging upload: must be owner, active host, in editable lifecycle state
        EXISTS (
          SELECT 1 FROM public.properties prop
          JOIN public.host_profiles hp ON hp.id = prop.host_id
          WHERE prop.id::text = (storage.foldername(name))[2]
            AND hp.user_id = auth.uid()
            AND hp.status = 'active'
            AND prop.approval_status IN ('draft', 'rejected', 'approved')
        )
        OR
        -- Room staging upload: must be room owner, active host, in editable lifecycle state
        EXISTS (
          SELECT 1 FROM public.rooms rm
          JOIN public.properties prop ON prop.id = rm.property_id
          JOIN public.host_profiles hp ON hp.id = prop.host_id
          WHERE rm.id::text = (storage.foldername(name))[2]
            AND hp.user_id = auth.uid()
            AND hp.status = 'active'
            AND prop.approval_status IN ('draft', 'rejected', 'approved')
        )
      )
    )
  );

-- DELETE: Owning active host (draft/rejected/approved states only) or Admin
DROP POLICY IF EXISTS "Staging media host delete" ON storage.objects;
CREATE POLICY "Staging media host delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-media-staging'
    AND (
      -- Platform Admin
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid() AND p.role = 'admin'
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.properties prop
          JOIN public.host_profiles hp ON hp.id = prop.host_id
          WHERE prop.id::text = (storage.foldername(name))[2]
            AND hp.user_id = auth.uid()
            AND hp.status = 'active'
            AND prop.approval_status IN ('draft', 'rejected', 'approved')
        )
        OR
        EXISTS (
          SELECT 1 FROM public.rooms rm
          JOIN public.properties prop ON prop.id = rm.property_id
          JOIN public.host_profiles hp ON hp.id = prop.host_id
          WHERE rm.id::text = (storage.foldername(name))[2]
            AND hp.user_id = auth.uid()
            AND hp.status = 'active'
            AND prop.approval_status IN ('draft', 'rejected', 'approved')
        )
      )
    )
  );

-- ------------------------------------------------------------------------------
-- BUCKET B: property-images-public (PUBLIC PRODUCTION) POLICIES
-- ------------------------------------------------------------------------------

-- SELECT: Public can read published objects
DROP POLICY IF EXISTS "Public media public select" ON storage.objects;
CREATE POLICY "Public media public select"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'property-images-public');

-- INSERT / UPDATE / DELETE: Strictly restricted to Admin or Server Service Role
-- Hosts have ZERO direct write access to the public production bucket!
DROP POLICY IF EXISTS "Public media admin insert" ON storage.objects;
CREATE POLICY "Public media admin insert"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'property-images-public'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Public media admin update" ON storage.objects;
CREATE POLICY "Public media admin update"
  ON storage.objects FOR UPDATE
  USING (
    bucket_id = 'property-images-public'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

DROP POLICY IF EXISTS "Public media admin delete" ON storage.objects;
CREATE POLICY "Public media admin delete"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'property-images-public'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- ------------------------------------------------------------------------------
-- 4. APPEND-ONLY MEDIA AUDIT TRAIL TABLE
-- ------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.property_media_audits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_id UUID REFERENCES public.rooms(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action IN ('staging_upload', 'public_promotion', 'quarantine_demotion', 'deletion_cleanup', 'admin_override')),
  source_bucket TEXT NOT NULL,
  target_bucket TEXT,
  storage_path TEXT NOT NULL,
  public_url TEXT,
  performed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  performed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_property_media_audits_prop
  ON public.property_media_audits(property_id, performed_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_media_audits_action
  ON public.property_media_audits(action);

ALTER TABLE public.property_media_audits ENABLE ROW LEVEL SECURITY;

-- Admins can view all media audit entries
DROP POLICY IF EXISTS "Admins view all media audits" ON public.property_media_audits;
CREATE POLICY "Admins view all media audits"
  ON public.property_media_audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = auth.uid() AND p.role = 'admin'
    )
  );

-- Hosts can view media audit entries for their own properties
DROP POLICY IF EXISTS "Hosts view own property media audits" ON public.property_media_audits;
CREATE POLICY "Hosts view own property media audits"
  ON public.property_media_audits FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.properties p
      JOIN public.host_profiles hp ON hp.id = p.host_id
      WHERE p.id = property_media_audits.property_id
        AND hp.user_id = auth.uid()
    )
  );

-- Prevent any UPDATE or DELETE on property_media_audits (strictly append-only)
CREATE OR REPLACE FUNCTION prevent_property_media_audit_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'Security invariant violation: property_media_audits records are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_property_media_audit_mutation ON public.property_media_audits;
CREATE TRIGGER trg_prevent_property_media_audit_mutation
  BEFORE UPDATE OR DELETE ON public.property_media_audits
  FOR EACH ROW
  EXECUTE FUNCTION prevent_property_media_audit_mutation();

-- ------------------------------------------------------------------------------
-- 5. AUTHORITATIVE RPC: promote_property_media
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION promote_property_media(
  p_property_id UUID,
  p_admin_id UUID,
  p_source_path TEXT,
  p_target_path TEXT,
  p_public_url TEXT,
  p_room_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_prop RECORD;
  v_audit_id UUID;
BEGIN
  -- Verify property exists and is approved and active
  SELECT * INTO v_prop
  FROM public.properties
  WHERE id = p_property_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Property % not found.', p_property_id;
  END IF;

  IF v_prop.approval_status <> 'approved' THEN
    RAISE EXCEPTION 'Cannot promote media to public bucket for property in status %.', v_prop.approval_status;
  END IF;

  -- Record audit
  INSERT INTO public.property_media_audits (
    property_id,
    room_id,
    action,
    source_bucket,
    target_bucket,
    storage_path,
    public_url,
    performed_by,
    performed_at,
    metadata
  ) VALUES (
    p_property_id,
    p_room_id,
    'public_promotion',
    'property-media-staging',
    'property-images-public',
    p_target_path,
    p_public_url,
    p_admin_id,
    NOW(),
    p_metadata
  ) RETURNING id INTO v_audit_id;

  -- If room_id is specified, update room image_url
  IF p_room_id IS NOT NULL THEN
    UPDATE public.rooms
    SET image_url = p_public_url,
        updated_at = NOW()
    WHERE id = p_room_id AND property_id = p_property_id;
  ELSE
    -- Update property image_url and photos array
    UPDATE public.properties
    SET image_url = COALESCE(image_url, p_public_url),
        photos = array_append(COALESCE(photos, ARRAY[]::TEXT[]), p_public_url),
        updated_at = NOW()
    WHERE id = p_property_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'room_id', p_room_id,
    'public_url', p_public_url,
    'audit_id', v_audit_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ------------------------------------------------------------------------------
-- 6. AUTHORITATIVE RPC: demote_property_media
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION demote_property_media(
  p_property_id UUID,
  p_performer_id UUID,
  p_staging_path TEXT,
  p_reason TEXT,
  p_room_id UUID DEFAULT NULL,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS JSONB AS $$
DECLARE
  v_audit_id UUID;
BEGIN
  -- Record audit
  INSERT INTO public.property_media_audits (
    property_id,
    room_id,
    action,
    source_bucket,
    target_bucket,
    storage_path,
    public_url,
    performed_by,
    performed_at,
    metadata
  ) VALUES (
    p_property_id,
    p_room_id,
    'quarantine_demotion',
    'property-images-public',
    'property-media-staging',
    p_staging_path,
    NULL,
    p_performer_id,
    NOW(),
    p_metadata || jsonb_build_object('reason', p_reason)
  ) RETURNING id INTO v_audit_id;

  -- Revert media reference to staging path in database
  IF p_room_id IS NOT NULL THEN
    UPDATE public.rooms
    SET image_url = p_staging_path,
        updated_at = NOW()
    WHERE id = p_room_id AND property_id = p_property_id;
  ELSE
    UPDATE public.properties
    SET image_url = p_staging_path,
        photos = ARRAY[p_staging_path]::TEXT[],
        updated_at = NOW()
    WHERE id = p_property_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'property_id', p_property_id,
    'room_id', p_room_id,
    'staging_path', p_staging_path,
    'audit_id', v_audit_id
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON TABLE public.property_media_audits IS
'Gate #10.2.2: Append-only audit trail for all host marketplace media lifecycle events (staging uploads, public promotions, quarantine demotions, and deletion cleanups).';
