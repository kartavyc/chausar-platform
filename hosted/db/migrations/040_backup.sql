-- Blind backup storage: metadata only. The bytes are ciphertext in the blob store under <account_id>/<backup_id>.
CREATE TABLE backups (
  account_id text NOT NULL CHECK (account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  backup_id text NOT NULL CHECK (backup_id ~ '^bk_[0-9a-f]{32}$'),
  size_bytes bigint NOT NULL CHECK (size_bytes > 8),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  -- pending: the row holds quota while the bytes are written; stored: readable.
  state text NOT NULL CHECK (state IN ('pending', 'stored')),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, backup_id)
);
CREATE INDEX backups_newest ON backups (account_id, created_at DESC, backup_id DESC);

-- When an account first lost the backup entitlement; its backups are removed 30 days later.
CREATE TABLE backup_lapses (
  account_id text PRIMARY KEY CHECK (account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  lapsed_at timestamptz NOT NULL
);
