-- ==============================================================================
-- PHASE 3 — GATE #10.2.4: MEDIA LIFECYCLE CONSISTENCY & CONCURRENCY REMEDIATION
-- Authoritative Database Schema Migration
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. ADD MEDIA REVISION & PUBLICATION STATUS TO PROPERTIES TABLE
-- ------------------------------------------------------------------------------
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS media_revision INT NOT NULL DEFAULT 1;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS media_publication_status TEXT NOT NULL DEFAULT 'not_published'
  CHECK (media_publication_status IN ('not_published', 'publishing', 'published', 'reconciliation_required'));

-- Create indexing for media lifecycle queries
CREATE INDEX IF NOT EXISTS idx_properties_media_publication_status
  ON public.properties(media_publication_status);

CREATE INDEX IF NOT EXISTS idx_properties_approval_active_media
  ON public.properties(approval_status, is_active, media_publication_status);

-- Backfill existing approved & active properties to 'published'
UPDATE public.properties
SET media_publication_status = 'published'
WHERE approval_status = 'approved' AND is_active = TRUE;

-- ------------------------------------------------------------------------------
-- 2. ADD EXECUTION STATUS TO PROPERTY MEDIA AUDITS TABLE
-- ------------------------------------------------------------------------------
ALTER TABLE public.property_media_audits
  ADD COLUMN IF NOT EXISTS execution_status TEXT NOT NULL DEFAULT 'success'
  CHECK (execution_status IN ('success', 'failed', 'pending', 'reconciliation_required'));

CREATE INDEX IF NOT EXISTS idx_property_media_audits_status
  ON public.property_media_audits(execution_status);

CREATE INDEX IF NOT EXISTS idx_property_media_audits_prop_status
  ON public.property_media_audits(property_id, execution_status);

-- ------------------------------------------------------------------------------
-- 3. AUTHORITATIVE MEDIA REVISION GUARD TRIGGER
-- Guarantees media_revision increments on any lifecycle status or active state change.
-- Automatically resets media_publication_status to 'not_published' if leaving approved/active.
-- ------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.trg_properties_media_revision_guard()
RETURNS TRIGGER AS $$
BEGIN
  IF (TG_OP = 'UPDATE') THEN
    -- If approval_status or is_active changes, advance media_revision
    IF (OLD.approval_status IS DISTINCT FROM NEW.approval_status) OR
       (OLD.is_active IS DISTINCT FROM NEW.is_active) THEN
      IF (NEW.media_revision = OLD.media_revision) THEN
        NEW.media_revision := OLD.media_revision + 1;
      END IF;

      -- If status is no longer approved or active, demote media_publication_status
      IF (NEW.approval_status <> 'approved' OR NEW.is_active IS NOT TRUE) THEN
        IF (NEW.media_publication_status = 'published' OR NEW.media_publication_status = 'publishing') THEN
          NEW.media_publication_status := 'not_published';
        END IF;
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_properties_media_revision ON public.properties;
CREATE TRIGGER trg_properties_media_revision
  BEFORE UPDATE ON public.properties
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_properties_media_revision_guard();

-- ------------------------------------------------------------------------------
-- 4. VERIFY PRESERVATION OF IMMUTABLE AUDIT RULES
-- Ensure no UPDATE or DELETE policies exist on public.property_media_audits
-- ------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'public' 
      AND tablename = 'property_media_audits' 
      AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: property_media_audits must remain append-only';
  END IF;
END $$;
