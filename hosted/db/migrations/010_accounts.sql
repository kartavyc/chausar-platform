-- Accounts: phone OTP sign-in for desktop installs. Other modules read accounts.phone by id.
CREATE TABLE accounts (
  id text PRIMARY KEY CHECK (id ~ '^acct_[0-9a-f-]{36}$'),
  phone text NOT NULL UNIQUE CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  created_at timestamptz NOT NULL
);

-- One row per code sent. Only a keyed hash of the code is kept. Rows stay an hour after creation so the
-- per-phone rate limits can count them; the sweep removes them after that.
CREATE TABLE otp_challenges (
  id text PRIMARY KEY CHECK (id ~ '^otp_[0-9a-f-]{36}$'),
  phone text NOT NULL CHECK (phone ~ '^\+91[6-9][0-9]{9}$'),
  code_hash text NOT NULL CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  wrong_tries integer NOT NULL DEFAULT 0 CHECK (wrong_tries BETWEEN 0 AND 5),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX otp_challenges_phone ON otp_challenges (phone, created_at);
CREATE INDEX otp_challenges_created ON otp_challenges (created_at);

CREATE TABLE devices (
  id text PRIMARY KEY CHECK (id ~ '^dev_[0-9a-f-]{36}$'),
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  device_name text NOT NULL CHECK (char_length(device_name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX devices_account ON devices (account_id, created_at);

-- A session belongs to one device. Only a keyed hash of the bearer token is kept.
CREATE TABLE sessions (
  id text PRIMARY KEY CHECK (id ~ '^sess_[0-9a-f-]{36}$'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_device ON sessions (device_id);
CREATE INDEX sessions_expires ON sessions (expires_at);
