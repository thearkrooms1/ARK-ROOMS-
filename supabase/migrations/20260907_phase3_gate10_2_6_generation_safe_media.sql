-- ============================================================================
-- PHASE 3 GATE #10.2.6: GENERATION-SAFE MEDIA LIFECYCLE REMEDIATION
-- Authoritative Database Schema Migration for Storage Generation Safety
-- ============================================================================

-- 1. Extend property_media_audits with operation_id UUID and media_revision
ALTER TABLE property_media_audits 
  ADD COLUMN IF NOT EXISTS operation_id UUID DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS media_revision INTEGER;

-- 2. Performance indexes for generation-aware querying and audit isolation
CREATE INDEX IF NOT EXISTS idx_property_media_audits_operation_id 
  ON property_media_audits(operation_id);

CREATE INDEX IF NOT EXISTS idx_property_media_audits_prop_rev 
  ON property_media_audits(property_id, media_revision);

CREATE INDEX IF NOT EXISTS idx_property_media_audits_exec_rev 
  ON property_media_audits(execution_status, media_revision);

COMMENT ON COLUMN property_media_audits.operation_id IS 'Unique execution trace ID correlating multi-step promotion, demotion, or reconciliation batches';
COMMENT ON COLUMN property_media_audits.media_revision IS 'Authoritative lifecycle generation revision pinned during this media operation';

-- 3. Strict verification of append-only invariant on property_media_audits
-- Absolutely no UPDATE or DELETE policies are permitted.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'property_media_audits'
      AND cmd IN ('UPDATE', 'DELETE')
  ) THEN
    RAISE EXCEPTION 'CRITICAL SECURITY VIOLATION: property_media_audits must remain append-only';
  END IF;
END $$;
