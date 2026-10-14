-- Documents sent from the phone (experimental). The relay downloads a document the opted-in owner sends,
-- encrypts it to the paired desktop's public key in memory and keeps only the sealed bytes, the size, the
-- media type and when it arrived. No file name, caption or plaintext is stored. Deleted when the desktop
-- acknowledges it, or after seven days.

-- One X25519 public key (raw 32 bytes, base64) per desktop install.
CREATE TABLE relay_device_keys (
  account_id text NOT NULL,
  device_id text NOT NULL,
  public_key text NOT NULL CHECK (public_key ~ '^[A-Za-z0-9+/]{43}=$'),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, device_id)
);

-- One sealed copy per document and desktop install. `sealed` is magic, ephemeral public key, nonce, ciphertext and tag.
CREATE TABLE relay_documents (
  id text PRIMARY KEY,
  document_id text NOT NULL,
  account_id text NOT NULL,
  device_id text NOT NULL,
  channel text NOT NULL CHECK (channel IN ('whatsapp', 'telegram')),
  media_type text NOT NULL CHECK (media_type IN ('application/pdf', 'image/jpeg', 'image/png', 'text/csv')),
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
  received_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  sealed bytea NOT NULL,
  UNIQUE (document_id, device_id)
);
CREATE INDEX relay_documents_device ON relay_documents (account_id, device_id, received_at);
CREATE INDEX relay_documents_expiry ON relay_documents (expires_at);

-- The per-account daily limit (Indian calendar day). The row is the lock that counts a document once.
CREATE TABLE relay_document_days (
  account_id text NOT NULL,
  day date NOT NULL,
  received integer NOT NULL DEFAULT 0 CHECK (received >= 0),
  PRIMARY KEY (account_id, day)
);
