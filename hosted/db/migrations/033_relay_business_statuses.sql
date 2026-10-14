-- Delivery statuses of messages a business sends through its OWN WhatsApp Business account (the writeback lane).
-- Each account registers one webhook: the hook token and the verify token are stored only as keyed hashes, and the
-- app secret that signs Meta's callbacks is sealed at rest. From each callback only the status line is kept:
-- message id, status, time and the business's own reference (biz_opaque_callback_data). Never a message or a number.
CREATE TABLE relay_business_hooks (
  account_id text PRIMARY KEY,
  hook_hash text NOT NULL UNIQUE,
  verify_hash text NOT NULL,
  app_secret_sealed text NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);

CREATE TABLE relay_business_statuses (
  account_id text NOT NULL,
  message_id text NOT NULL CHECK (char_length(message_id) <= 256 AND message_id ~ '^[A-Za-z0-9._=:+/-]+$'),
  status text NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  at timestamptz NOT NULL,
  reference text NOT NULL CHECK (reference ~ '^[A-Za-z0-9_.:-]{1,128}$'),
  received_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, message_id, status)
);
CREATE INDEX relay_business_statuses_reference ON relay_business_statuses (account_id, reference);
CREATE INDEX relay_business_statuses_received ON relay_business_statuses (received_at);
