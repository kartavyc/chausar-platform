-- The relay: channel opt-ins, the monthly message budget, messages, one-time buttons and sealed envelopes.
-- accounts (010) is read at send time only; nothing here holds a foreign key to it.
-- Recipients are stored sealed (address_sealed) and looked up by a keyed hash (recipient_hash); no message text is stored.
CREATE TABLE relay_channels (
  account_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'mail')),
  enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'off' CHECK (status IN ('off', 'awaiting-start', 'on', 'stopped')),
  opt_in_at timestamptz,
  opt_in_recorded_at timestamptz,
  opt_in_text_sha256 text CHECK (opt_in_text_sha256 IS NULL OR opt_in_text_sha256 ~ '^[0-9a-f]{64}$'),
  recipient_hash text,
  address_sealed text,
  address_mask text,
  stopped_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, channel)
);
CREATE INDEX relay_channels_recipient ON relay_channels (channel, recipient_hash);

-- Telegram connect links: single use, thirty minutes.
CREATE TABLE relay_connect_tokens (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);

-- The budget counter. A send locks this row, so no race lets one more through.
CREATE TABLE relay_months (
  account_id text NOT NULL,
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-[0-9]{2}$'),
  sent integer NOT NULL DEFAULT 0 CHECK (sent >= 0),
  PRIMARY KEY (account_id, month)
);

-- kind 'template' is a catalogue message the desktop asked for; kind 'reply' is a fixed reply to an inbound message.
CREATE TABLE relay_messages (
  id text PRIMARY KEY,
  account_id text,
  kind text NOT NULL CHECK (kind IN ('template', 'reply')),
  event text CHECK (event IS NULL OR event IN ('week-ahead-ready', 'review-ready', 'document-received', 'due-date-near')),
  reply_key text CHECK (reply_key IS NULL OR reply_key IN ('freeText', 'help', 'stop', 'start', 'approved', 'notNow', 'buttonGone', 'documentReceived')),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'mail')),
  idempotency_key text,
  request_digest text,
  month text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'delivered', 'read', 'failed')),
  buttons text NOT NULL DEFAULT 'open-only' CHECK (buttons IN ('open-only', 'approve-not-now-open', 'none')),
  decided text CHECK (decided IS NULL OR decided IN ('approve', 'not-now')),
  decided_at timestamptz,
  expires_at timestamptz,
  open_expires_at timestamptz,
  reply_recipient_sealed text,
  reply_callback text,
  window_until timestamptz,
  provider_message_id text,
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK ((kind = 'template' AND event IS NOT NULL AND account_id IS NOT NULL AND idempotency_key IS NOT NULL) OR (kind = 'reply' AND reply_key IS NOT NULL)),
  UNIQUE (account_id, idempotency_key)
);
CREATE INDEX relay_messages_month ON relay_messages (account_id, month) WHERE kind = 'template';
CREATE INDEX relay_messages_provider ON relay_messages (channel, provider_message_id);

-- The two sealed blobs of an approval offer, copied verbatim into an envelope on a press. Deleted at expiry.
CREATE TABLE relay_offers (
  message_id text PRIMARY KEY REFERENCES relay_messages (id) ON DELETE CASCADE,
  approve_nonce text NOT NULL,
  approve_ciphertext text NOT NULL,
  not_now_nonce text NOT NULL,
  not_now_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL
);

-- One-time buttons and links, stored only as keyed hashes of their letter tokens.
CREATE TABLE relay_buttons (
  token_hash text PRIMARY KEY,
  message_id text NOT NULL REFERENCES relay_messages (id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('open', 'approve', 'not-now')),
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX relay_buttons_message ON relay_buttons (message_id);
CREATE INDEX relay_buttons_expiry ON relay_buttons (expires_at);

-- Sealed bytes waiting for the desktop. Deleted when acknowledged or expired.
CREATE TABLE relay_envelopes (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  message_id text NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'approval-intent'),
  decision text NOT NULL CHECK (decision IN ('approve', 'not-now')),
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'mail')),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  nonce text NOT NULL,
  ciphertext text NOT NULL
);
CREATE INDEX relay_envelopes_account ON relay_envelopes (account_id, created_at);

-- What arrived, never its content. event_hash makes provider retries of one webhook event count once.
CREATE TABLE relay_inbound (
  id text PRIMARY KEY,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'mail')),
  event_hash text NOT NULL UNIQUE,
  account_id text,
  kind text NOT NULL CHECK (kind IN ('text', 'help', 'stop', 'start', 'connect', 'button', 'document', 'other')),
  created_at timestamptz NOT NULL
);

-- Presses that changed nothing.
CREATE TABLE relay_refusals (
  id text PRIMARY KEY,
  account_id text,
  message_id text,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'mail')),
  reason text NOT NULL CHECK (reason IN ('unknown', 'used', 'expired', 'decided', 'not-owner', 'wrong-channel')),
  created_at timestamptz NOT NULL
);

-- HELP opens a ticket for a person.
CREATE TABLE relay_help_requests (
  id text PRIMARY KEY,
  account_id text,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram', 'mail')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  created_at timestamptz NOT NULL
);
