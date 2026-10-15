-- Recovery through a contact (FR-13). Half of a two-part escrow: the relay keeps the 32-byte key K that opens the
-- recovery code the desktop encrypted and kept on its own disk. The relay never receives the recovery code.
-- K and the contact's address are sealed with a server key; the local request credential and the contact are kept only
-- as keyed hashes. The contact's name is never sent here.
CREATE TABLE recovery_enrolments (
  id text PRIMARY KEY CHECK (id ~ '^rce_[0-9a-f-]{36}$'),
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  device_id text NOT NULL REFERENCES devices (id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('active', 'released', 'revoked')),
  key_sealed text,
  contact_channel text NOT NULL CHECK (contact_channel IN ('whatsapp', 'mail')),
  contact_sealed text,
  contact_hash text NOT NULL,
  contact_mask text,
  credential_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL,
  -- K and the address exist only while the enrolment is active: a release or a removal deletes both.
  CHECK ((status = 'active') = (key_sealed IS NOT NULL)),
  CHECK ((status = 'active') = (contact_sealed IS NOT NULL))
);
-- One active enrolment per desktop install; enrolling again replaces it.
CREATE UNIQUE INDEX recovery_enrolments_one_active ON recovery_enrolments (account_id, device_id) WHERE status = 'active';

-- Requests: the confirmation token only as a keyed hash, set when the contact's message is sent. Rows stay two days
-- so the daily limits (per enrolment and per contact) can count them.
CREATE TABLE recovery_requests (
  id text PRIMARY KEY CHECK (id ~ '^rcr_[0-9a-f-]{36}$'),
  enrolment_id text NOT NULL REFERENCES recovery_enrolments (id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  contact_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('queued', 'sent', 'confirmed', 'declined', 'failed', 'replaced', 'released')),
  token_hash text UNIQUE,
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  released_at timestamptz,
  provider_message_id text,
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX recovery_requests_enrolment ON recovery_requests (enrolment_id, created_at);
CREATE INDEX recovery_requests_contact ON recovery_requests (contact_hash, created_at);
