-- OTP starts are also limited across the whole server and per client address (behind a trusted proxy), so nobody can
-- run up the SMS bill. Only a keyed hash of the address is kept, and only as long as the challenge row.
ALTER TABLE otp_challenges ADD COLUMN client_hash text CHECK (client_hash IS NULL OR client_hash ~ '^[0-9a-f]{64}$');
CREATE INDEX otp_challenges_client ON otp_challenges (client_hash, created_at) WHERE client_hash IS NOT NULL;
