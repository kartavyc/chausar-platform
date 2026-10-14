-- The job queue lives on the database. Rows are claimed with FOR UPDATE SKIP LOCKED under a lease.
CREATE TABLE jobs (
  id text PRIMARY KEY,
  type text NOT NULL CHECK (type ~ '^[a-z][a-zA-Z0-9.-]{1,63}$'),
  account_id text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  dedupe_key text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'dead')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 5 CHECK (max_attempts BETWEEN 1 AND 50),
  run_at timestamptz NOT NULL DEFAULT now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE INDEX jobs_ready ON jobs (run_at) WHERE status = 'queued';
CREATE INDEX jobs_leased ON jobs (lease_expires_at) WHERE status = 'running';
