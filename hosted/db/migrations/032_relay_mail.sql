-- Mail address confirmation and inbound mail.
-- A mail channel turns on only after its address is confirmed through a one-time /v/<letters> link. confirmed_hash
-- is the keyed hash of the address that was confirmed; a changed address no longer matches it and must be confirmed again.
ALTER TABLE relay_channels DROP CONSTRAINT relay_channels_status_check;
ALTER TABLE relay_channels ADD CONSTRAINT relay_channels_status_check
  CHECK (status IN ('off', 'awaiting-start', 'awaiting-confirmation', 'on', 'stopped'));
ALTER TABLE relay_channels ADD COLUMN confirmed_hash text;
-- A mail channel that was on without a confirmation waits for one (the desktop's next save sends it).
UPDATE relay_channels SET status = 'awaiting-confirmation' WHERE channel = 'mail' AND status = 'on';

-- Confirmation mails: the token only as a keyed hash, set when the mail is sent; no address is copied here (it is
-- read from the channel's sealed address at send time). Rows stay two days so the daily limit can count them.
CREATE TABLE relay_mail_confirmations (
  id text PRIMARY KEY,
  account_id text NOT NULL,
  recipient_hash text NOT NULL,
  token_hash text UNIQUE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'replaced', 'confirmed')),
  expires_at timestamptz,
  used_at timestamptz,
  provider_message_id text,
  last_error text CHECK (last_error IS NULL OR last_error ~ '^[A-Z][A-Z0-9_]{1,63}$'),
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE INDEX relay_mail_confirmations_account ON relay_mail_confirmations (account_id, created_at);

-- Fixed replies by mail, counted per sender (keyed hash of the normalized address) per Indian day. No content.
CREATE TABLE relay_mail_senders (
  sender_hash text NOT NULL,
  day text NOT NULL CHECK (day ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
  replies integer NOT NULL DEFAULT 0 CHECK (replies >= 0),
  PRIMARY KEY (sender_hash, day)
);
