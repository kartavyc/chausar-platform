-- Learning intake service schema (PostgreSQL 14+).
-- Contributors are known only by the SHA-256 of their bearer token; batches only by the SHA-256 of
-- their deletion token. Deleting a batch hard-deletes its events and credits; the batch row stays,
-- marked deleted, so its idempotency key is never reused.

CREATE TABLE IF NOT EXISTS contributors (
  id          text PRIMARY KEY,
  token_hash  text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  public_name text NULL CHECK (public_name IS NULL OR char_length(public_name) BETWEEN 2 AND 40),
  created_at  timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  reference           text PRIMARY KEY,
  idempotency_key     text NOT NULL UNIQUE,
  contributor_id      text NOT NULL REFERENCES contributors (id),
  body_digest         text NOT NULL,
  boxes               text[] NOT NULL,
  event_count         integer NOT NULL CHECK (event_count BETWEEN 1 AND 5000),
  received_at         timestamptz NOT NULL,
  deleted_at          timestamptz NULL,
  deletion_token_hash text NOT NULL CHECK (deletion_token_hash ~ '^[0-9a-f]{64}$')
);
CREATE INDEX IF NOT EXISTS batches_contributor ON batches (contributor_id);

CREATE TABLE IF NOT EXISTS events (
  batch_reference text NOT NULL REFERENCES batches (reference),
  position        integer NOT NULL,
  event           jsonb NOT NULL,
  PRIMARY KEY (batch_reference, position)
);

-- Credit ledger: one row per accepted batch, worth one credit per accepted event.
CREATE TABLE IF NOT EXISTS credits (
  id              bigserial PRIMARY KEY,
  contributor_id  text NOT NULL REFERENCES contributors (id),
  batch_reference text NOT NULL REFERENCES batches (reference),
  amount          integer NOT NULL CHECK (amount > 0),
  created_at      timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS credits_contributor ON credits (contributor_id);
CREATE INDEX IF NOT EXISTS credits_batch ON credits (batch_reference);
