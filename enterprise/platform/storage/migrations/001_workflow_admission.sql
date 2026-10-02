-- Additive enterprise admission migration; apply once after storage/schema.sql.
-- Stop legacy dispatchers before applying. No databases, roles, DROP or extensions.
BEGIN;
ALTER TABLE chausar_core.work_outbox
  ADD COLUMN admission_generation bigint NOT NULL DEFAULT 1 CHECK(admission_generation>0),
  ADD COLUMN admission_binding jsonb,
  ADD COLUMN admission_state text NOT NULL DEFAULT 'pending'
    CHECK(admission_state IN ('pending','admitted','conflict','legacy_unverified')),
  ADD COLUMN claim_token uuid,
  ADD COLUMN lease_until timestamptz,
  ADD COLUMN start_requested_at timestamptz,
  ADD COLUMN expected_run_id text,
  ADD COLUMN last_cause jsonb,
  ADD CONSTRAINT workflow_admission_claim_pair CHECK((claim_token IS NULL)=(lease_until IS NULL)),
  ADD CONSTRAINT workflow_admission_binding_required CHECK(
    (start_requested_at IS NULL AND expected_run_id IS NULL) OR admission_binding IS NOT NULL),
  ADD CONSTRAINT workflow_admission_run_requires_start CHECK(expected_run_id IS NULL OR start_requested_at IS NOT NULL);

-- Prior dispatched rows have no qualified receipt, and prior pending rows may have
-- crossed a lost-ack window. Neither can be assigned new-start eligibility by migration.
UPDATE chausar_core.work_outbox SET admission_state='legacy_unverified',
  last_cause='{"name":"LegacyAdmissionUnverified","code":"legacy_admission_unverified","message":"Pre-migration row requires explicit authoritative lifecycle recovery"}'::jsonb;

CREATE FUNCTION chausar_core.valid_workflow_admission_binding(b jsonb, tenant text, investigation text, generation bigint)
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(jsonb_typeof(b)='object'
    AND b ?& ARRAY['version','tenantId','investigationId','workflowId','workflowType','generation',
      'businessId','businessIncarnation','environmentIncarnation','namespace','taskQueue','inputDigest','semanticInputDigest']
    AND (b - ARRAY['version','tenantId','investigationId','workflowId','workflowType','generation',
      'businessId','businessIncarnation','environmentIncarnation','namespace','taskQueue','inputDigest','semanticInputDigest'])='{}'::jsonb
    AND b->'version'='1'::jsonb AND b->>'tenantId'=tenant AND b->>'investigationId'=investigation
    AND b->>'workflowId'=investigation AND b->>'workflowType'='investigate'
    AND jsonb_typeof(b->'generation')='string' AND b->>'generation'=generation::text
    AND jsonb_typeof(b->'tenantId')='string' AND jsonb_typeof(b->'investigationId')='string'
    AND jsonb_typeof(b->'workflowId')='string' AND jsonb_typeof(b->'workflowType')='string'
    AND jsonb_typeof(b->'businessId')='string' AND length(b->>'businessId')>0
    AND jsonb_typeof(b->'businessIncarnation')='string' AND length(b->>'businessIncarnation')>0
    AND jsonb_typeof(b->'environmentIncarnation')='string' AND length(b->>'environmentIncarnation')>0
    AND jsonb_typeof(b->'namespace')='string' AND length(b->>'namespace')>0
    AND jsonb_typeof(b->'taskQueue')='string' AND length(b->>'taskQueue')>0
    AND jsonb_typeof(b->'inputDigest')='string' AND b->>'inputDigest' ~ '^[0-9a-f]{64}$'
    AND jsonb_typeof(b->'semanticInputDigest')='string' AND b->>'semanticInputDigest' ~ '^[0-9a-f]{64}$',false);
$$;
ALTER TABLE chausar_core.work_outbox ADD CONSTRAINT workflow_admission_binding_shape CHECK(
  admission_binding IS NULL OR chausar_core.valid_workflow_admission_binding(
    admission_binding,tenant_id,investigation_id,admission_generation));

CREATE TABLE chausar_core.workflow_admissions (
  tenant_id text NOT NULL,
  investigation_id text NOT NULL,
  generation bigint NOT NULL CHECK(generation>0),
  namespace text NOT NULL,
  environment_incarnation text GENERATED ALWAYS AS (binding->>'environmentIncarnation') STORED,
  workflow_id text NOT NULL,
  run_id text NOT NULL CHECK(length(run_id)>0),
  binding jsonb NOT NULL,
  execution_receipt jsonb NOT NULL,
  admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(tenant_id,investigation_id,generation),
  UNIQUE(environment_incarnation,namespace,workflow_id),
  FOREIGN KEY(tenant_id,investigation_id) REFERENCES chausar_core.work_outbox,
  CHECK(chausar_core.valid_workflow_admission_binding(binding,tenant_id,investigation_id,generation)),
  CHECK(binding->>'namespace'=namespace AND binding->>'workflowId'=workflow_id),
  CHECK(jsonb_typeof(execution_receipt)='object'
    AND execution_receipt ?& ARRAY['namespace','workflowId','workflowType','taskQueue','inputDigest','binding','runId']
    AND (execution_receipt - ARRAY['namespace','workflowId','workflowType','taskQueue','inputDigest','binding','runId'])='{}'::jsonb
    AND execution_receipt->'binding'=binding
    AND execution_receipt->>'namespace'=namespace AND execution_receipt->>'workflowId'=workflow_id
    AND execution_receipt->>'runId'=run_id AND jsonb_typeof(execution_receipt->'runId')='string'
    AND execution_receipt->'namespace'=binding->'namespace'
    AND execution_receipt->'workflowId'=binding->'workflowId'
    AND execution_receipt->'workflowType'=binding->'workflowType'
    AND execution_receipt->'taskQueue'=binding->'taskQueue'
    AND execution_receipt->'inputDigest'=binding->'inputDigest')
);
CREATE TRIGGER immutable_workflow_admission BEFORE UPDATE OR DELETE ON chausar_core.workflow_admissions
  FOR EACH ROW EXECUTE FUNCTION chausar_core.reject_revision_mutation();

CREATE TABLE chausar_core.workflow_admission_events (
  event_id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id text NOT NULL,
  investigation_id text NOT NULL,
  attempt integer NOT NULL CHECK(attempt>=0),
  state text NOT NULL CHECK(state IN ('pending','admitted','conflict')),
  cause jsonb,
  start_cause jsonb,
  observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(tenant_id,investigation_id) REFERENCES chausar_core.work_outbox,
  CHECK(cause IS NULL OR jsonb_typeof(cause)='object'),
  CHECK(start_cause IS NULL OR jsonb_typeof(start_cause)='object')
);
CREATE TRIGGER immutable_workflow_admission_event BEFORE UPDATE OR DELETE ON chausar_core.workflow_admission_events
  FOR EACH ROW EXECUTE FUNCTION chausar_core.reject_revision_mutation();

CREATE FUNCTION chausar_core.guard_workflow_outbox_admission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='INSERT' THEN
    IF NEW.admission_state<>'pending' OR NEW.dispatched_at IS NOT NULL OR NEW.admission_binding IS NOT NULL
      OR NEW.admission_generation<>1 OR NEW.attempts<>0 OR NEW.start_requested_at IS NOT NULL
      OR NEW.expected_run_id IS NOT NULL OR NEW.claim_token IS NOT NULL OR NEW.lease_until IS NOT NULL THEN
      RAISE EXCEPTION 'Fresh workflow outbox row must begin with unclaimed pending admission';
    END IF;
    RETURN NEW;
  END IF;
  IF TG_OP='DELETE' THEN
    IF OLD.admission_binding IS NOT NULL OR OLD.admission_state<>'pending' THEN
      RAISE EXCEPTION 'Workflow admission custody requires explicit lifecycle recovery';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id OR NEW.investigation_id IS DISTINCT FROM OLD.investigation_id
    OR NEW.admission_generation IS DISTINCT FROM OLD.admission_generation
    OR (OLD.admission_binding IS NOT NULL AND NEW.admission_binding IS DISTINCT FROM OLD.admission_binding)
    OR (OLD.start_requested_at IS NOT NULL AND NEW.start_requested_at IS DISTINCT FROM OLD.start_requested_at)
    OR (OLD.expected_run_id IS NOT NULL AND NEW.expected_run_id IS DISTINCT FROM OLD.expected_run_id)
    OR NEW.attempts<OLD.attempts THEN
    RAISE EXCEPTION 'Workflow admission identity and send evidence are immutable';
  END IF;
  IF OLD.admission_state IN ('admitted','conflict','legacy_unverified')
    AND NEW.admission_state IS DISTINCT FROM OLD.admission_state THEN
    RAISE EXCEPTION 'Explicit authoritative lifecycle recovery required';
  END IF;
  IF NEW.admission_state='admitted' OR (NEW.dispatched_at IS NOT NULL AND OLD.dispatched_at IS NULL) THEN
    IF NEW.admission_state<>'admitted' OR NOT EXISTS (
      SELECT 1 FROM chausar_core.workflow_admissions a WHERE a.tenant_id=NEW.tenant_id
        AND a.investigation_id=NEW.investigation_id AND a.generation=NEW.admission_generation
        AND a.binding=NEW.admission_binding
        AND (NEW.expected_run_id IS NULL OR a.run_id=NEW.expected_run_id)) THEN
      RAISE EXCEPTION 'Matching immutable workflow admission receipt required';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER guarded_workflow_outbox_admission BEFORE INSERT OR UPDATE OR DELETE ON chausar_core.work_outbox
  FOR EACH ROW EXECUTE FUNCTION chausar_core.guard_workflow_outbox_admission();
CREATE INDEX workflow_admission_pending ON chausar_core.work_outbox(tenant_id,investigation_id)
  WHERE dispatched_at IS NULL AND admission_state='pending';
COMMIT;
