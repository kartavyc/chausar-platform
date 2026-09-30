-- Fresh isolated evaluation database only. No roles, databases, DROP or extensions.
BEGIN;
CREATE SCHEMA chausar_core;
CREATE SCHEMA chausar_source;

CREATE TABLE chausar_core.tenants (
 tenant_id text PRIMARY KEY, active boolean NOT NULL DEFAULT true,
 policy_epoch bigint NOT NULL DEFAULT 1 CHECK(policy_epoch>0)
);
CREATE TABLE chausar_core.principals (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants,
 principal_id text NOT NULL, kind text NOT NULL CHECK(kind IN ('human','service')),
 capabilities text[] NOT NULL DEFAULT ARRAY[]::text[],
 active boolean NOT NULL DEFAULT true, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,principal_id)
);
CREATE TABLE chausar_core.policy_revisions (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants, policy_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
 PRIMARY KEY(tenant_id,policy_id,revision)
);
CREATE TABLE chausar_core.policies (
 tenant_id text NOT NULL, policy_id text NOT NULL, revision bigint NOT NULL,
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(tenant_id,policy_id),
 FOREIGN KEY(tenant_id,policy_id,revision) REFERENCES chausar_core.policy_revisions
);
CREATE TABLE chausar_core.datasets (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants, dataset_id text NOT NULL,
 active boolean NOT NULL DEFAULT true, source_revision bigint NOT NULL DEFAULT 1 CHECK(source_revision>0),
 permitted_fields text[] NOT NULL CHECK(cardinality(permitted_fields)>0),
 PRIMARY KEY(tenant_id,dataset_id)
);
CREATE TABLE chausar_core.grants (
 tenant_id text NOT NULL, grant_id text NOT NULL, principal_id text NOT NULL,
 dataset_id text NOT NULL, purpose text NOT NULL CHECK(length(purpose)>0),
 operations text[] NOT NULL CHECK(cardinality(operations)>0 AND operations <@ ARRAY['read','release','retain','model']::text[] AND array_position(operations,NULL) IS NULL),
 fields text[] NOT NULL CHECK(cardinality(fields)>0 AND NOT ('*'=ANY(fields)) AND array_position(fields,NULL) IS NULL),
 regions text[] NOT NULL CHECK(cardinality(regions)>0 AND NOT ('*'=ANY(regions)) AND array_position(regions,NULL) IS NULL),
 policy_id text NOT NULL, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 expires_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(tenant_id,grant_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES chausar_core.principals,
 FOREIGN KEY(tenant_id,dataset_id) REFERENCES chausar_core.datasets,
 FOREIGN KEY(tenant_id,policy_id) REFERENCES chausar_core.policies
);
CREATE TABLE chausar_core.mandates (
 tenant_id text NOT NULL, mandate_id text NOT NULL, principal_id text NOT NULL,
 grant_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('active','paused','suspended','suspended_owner','retired')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 PRIMARY KEY(tenant_id,mandate_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES chausar_core.principals,
 FOREIGN KEY(tenant_id,grant_id) REFERENCES chausar_core.grants
);
CREATE TABLE chausar_core.mandate_owners (
 tenant_id text NOT NULL, mandate_id text NOT NULL, owner_id text NOT NULL,
 active boolean NOT NULL DEFAULT true,
 PRIMARY KEY(tenant_id,mandate_id,owner_id),
 FOREIGN KEY(tenant_id,mandate_id) REFERENCES chausar_core.mandates,
 FOREIGN KEY(tenant_id,owner_id) REFERENCES chausar_core.principals
);
CREATE TABLE chausar_core.ontology_revisions (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants,
 definition_id text NOT NULL, revision bigint NOT NULL CHECK(revision>0),
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
 content_hash text NOT NULL, published_by text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(tenant_id,definition_id,revision),
 FOREIGN KEY(tenant_id,published_by) REFERENCES chausar_core.principals
);
CREATE TABLE chausar_core.publications (
 tenant_id text NOT NULL, definition_id text NOT NULL, revision bigint NOT NULL,
 active boolean NOT NULL DEFAULT true, generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
 PRIMARY KEY(tenant_id,definition_id),
 FOREIGN KEY(tenant_id,definition_id,revision) REFERENCES chausar_core.ontology_revisions
);
CREATE FUNCTION chausar_core.reject_revision_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Published revisions are immutable'; END;
$$;
CREATE TRIGGER immutable_ontology BEFORE UPDATE OR DELETE ON chausar_core.ontology_revisions
 FOR EACH ROW EXECUTE FUNCTION chausar_core.reject_revision_mutation();
CREATE TRIGGER immutable_policy BEFORE UPDATE OR DELETE ON chausar_core.policy_revisions
 FOR EACH ROW EXECUTE FUNCTION chausar_core.reject_revision_mutation();

CREATE TABLE chausar_core.model_endpoint_revisions (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants, endpoint_ref text NOT NULL,
 body jsonb NOT NULL, content_hash text NOT NULL, PRIMARY KEY(tenant_id,endpoint_ref)
);
CREATE TRIGGER immutable_model_endpoint BEFORE UPDATE OR DELETE ON chausar_core.model_endpoint_revisions
 FOR EACH ROW EXECUTE FUNCTION chausar_core.reject_revision_mutation();
CREATE TABLE chausar_core.model_policy_revisions (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants, principal_id text NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), body jsonb NOT NULL,
 PRIMARY KEY(tenant_id,principal_id,revision),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES chausar_core.principals
);
CREATE TRIGGER immutable_model_policy BEFORE UPDATE OR DELETE ON chausar_core.model_policy_revisions
 FOR EACH ROW EXECUTE FUNCTION chausar_core.reject_revision_mutation();
CREATE TABLE chausar_core.model_policies (
 tenant_id text NOT NULL, principal_id text NOT NULL, revision bigint NOT NULL,
 active boolean NOT NULL DEFAULT true, PRIMARY KEY(tenant_id,principal_id),
 FOREIGN KEY(tenant_id,principal_id,revision) REFERENCES chausar_core.model_policy_revisions
);
CREATE TABLE chausar_core.model_invocations (
 tenant_id text NOT NULL, invocation_id text NOT NULL, principal_id text NOT NULL,
 request_id text NOT NULL, request_digest text NOT NULL, endpoint_ref text NOT NULL,
 payload_digest text NOT NULL, authority_digest text NOT NULL, policy_revision bigint NOT NULL,
 state text NOT NULL CHECK(state IN ('dispatched','accepted','clarify','rejected','outcome_unknown','expired')),
 reason text, investigation_id text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 expires_at timestamptz NOT NULL,
 PRIMARY KEY(tenant_id,invocation_id), UNIQUE(tenant_id,principal_id,request_id),
 FOREIGN KEY(tenant_id,principal_id) REFERENCES chausar_core.principals,
 FOREIGN KEY(tenant_id,endpoint_ref) REFERENCES chausar_core.model_endpoint_revisions,
 CHECK(expires_at>created_at)
);

CREATE TABLE chausar_core.investigations (
 tenant_id text NOT NULL, investigation_id text NOT NULL,
 principal_id text NOT NULL, grant_id text NOT NULL, purpose text NOT NULL,
 requested_by text NOT NULL, request_id text NOT NULL, metric_ids text[] NOT NULL,
 request_digest text NOT NULL,
 query_regions text[], definition_revision bigint, model_invocation_id text,
 input_expires_at timestamptz, failure_code text,
 mandate_id text, revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL CHECK(state IN ('queued','running','completed','failed','cancelled')),
 PRIMARY KEY(tenant_id,investigation_id),
 UNIQUE(tenant_id,requested_by,request_id),
 FOREIGN KEY(tenant_id,requested_by) REFERENCES chausar_core.principals,
 FOREIGN KEY(tenant_id,principal_id) REFERENCES chausar_core.principals,
 FOREIGN KEY(tenant_id,grant_id) REFERENCES chausar_core.grants,
 FOREIGN KEY(tenant_id,mandate_id) REFERENCES chausar_core.mandates
);
CREATE TABLE chausar_core.work_outbox (
 tenant_id text NOT NULL, investigation_id text NOT NULL,
 dispatched_at timestamptz, attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 PRIMARY KEY(tenant_id,investigation_id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES chausar_core.investigations
);
CREATE TABLE chausar_core.tasks (
 tenant_id text NOT NULL, task_id text NOT NULL, investigation_id text NOT NULL,
 state text NOT NULL CHECK(state IN ('queued','running','succeeded','failed','cancelled')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
 fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0), lease_until timestamptz,
 PRIMARY KEY(tenant_id,task_id),
 FOREIGN KEY(tenant_id,investigation_id) REFERENCES chausar_core.investigations,
 CHECK(state <> 'running' OR (lease_until IS NOT NULL AND fence>0))
);
CREATE TABLE chausar_core.retained_results (
 tenant_id text NOT NULL, result_id text NOT NULL, task_id text NOT NULL,
 task_fence bigint NOT NULL CHECK(task_fence>0), definition_id text NOT NULL,
 policy_epoch bigint NOT NULL CHECK(policy_epoch>0),
 definition_revision bigint NOT NULL, payload jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 retired_at timestamptz, retirement_reason text,
 PRIMARY KEY(tenant_id,result_id), UNIQUE(tenant_id,task_id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES chausar_core.tasks,
 FOREIGN KEY(tenant_id,definition_id,definition_revision) REFERENCES chausar_core.ontology_revisions,
 CHECK((retired_at IS NULL AND payload IS NOT NULL) OR (retired_at IS NOT NULL AND payload IS NULL)),
 CHECK(expires_at>created_at)
);
CREATE TABLE chausar_core.result_bindings (
 tenant_id text NOT NULL, result_id text NOT NULL, dataset_id text NOT NULL,
 source_revision bigint NOT NULL CHECK(source_revision>0), grant_id text NOT NULL,
 grant_revision bigint NOT NULL CHECK(grant_revision>0), policy_id text NOT NULL,
 policy_revision bigint NOT NULL, fields text[] NOT NULL, regions text[] NOT NULL,
 PRIMARY KEY(tenant_id,result_id,dataset_id),
 FOREIGN KEY(tenant_id,result_id) REFERENCES chausar_core.retained_results,
 FOREIGN KEY(tenant_id,dataset_id) REFERENCES chausar_core.datasets,
 FOREIGN KEY(tenant_id,grant_id) REFERENCES chausar_core.grants,
 FOREIGN KEY(tenant_id,policy_id,policy_revision) REFERENCES chausar_core.policy_revisions
);
CREATE TABLE chausar_source.invoices (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants,
 invoice_id bigint NOT NULL, region text NOT NULL, customer_id text NOT NULL,
 amount numeric(18,2) NOT NULL, discount numeric(18,2) NOT NULL,
 cost numeric(18,2), currency text NOT NULL, fx_to_inr numeric(18,6) NOT NULL CHECK(fx_to_inr>0),
 invoice_date date NOT NULL, order_id bigint, PRIMARY KEY(tenant_id,invoice_id)
);
-- Deliberately no invoice/order FK: orphan parent handling is an acceptance case.
CREATE TABLE chausar_source.orders (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants,
 order_id bigint NOT NULL, status text, PRIMARY KEY(tenant_id,order_id)
);
CREATE TABLE chausar_source.shipments (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants,
 shipment_id bigint NOT NULL, invoice_id bigint NOT NULL, quantity numeric(18,2) NOT NULL,
 PRIMARY KEY(tenant_id,shipment_id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES chausar_source.invoices
);
CREATE TABLE chausar_source.returns (
 tenant_id text NOT NULL REFERENCES chausar_core.tenants,
 return_id bigint NOT NULL, invoice_id bigint NOT NULL, refund numeric(18,2) NOT NULL,
 PRIMARY KEY(tenant_id,return_id),
 FOREIGN KEY(tenant_id,invoice_id) REFERENCES chausar_source.invoices
);
CREATE INDEX grants_principal ON chausar_core.grants(tenant_id,principal_id,dataset_id);
CREATE INDEX invoices_scope ON chausar_source.invoices(tenant_id,region);
COMMIT;
