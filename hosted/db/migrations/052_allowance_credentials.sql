-- Allowance-scoped credentials: a bearer secret that works only on POST /v1/allowance/responses.
-- Bound to one account and one device; only a keyed hash of the token is kept. Revoking the device ends them too.
CREATE TABLE allowance_credentials (
  id text PRIMARY KEY CHECK (id ~ '^alc_[0-9a-f-]{36}$'),
  seq bigint GENERATED ALWAYS AS IDENTITY,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);
CREATE INDEX allowance_credentials_live ON allowance_credentials (device_id, seq) WHERE revoked_at IS NULL;
CREATE INDEX allowance_credentials_account ON allowance_credentials (account_id);
