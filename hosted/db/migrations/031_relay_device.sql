-- Approval envelopes belong to the desktop install that offered them: the sending device is kept on the message
-- and copied onto each envelope, and only that device collects or acknowledges it. Server-side notify messages
-- (worker reminders) carry no offer and no device.
ALTER TABLE relay_messages ADD COLUMN device_id text;
ALTER TABLE relay_envelopes ADD COLUMN device_id text;
DROP INDEX relay_envelopes_account;
CREATE INDEX relay_envelopes_device ON relay_envelopes (account_id, device_id, created_at);

-- A press on a channel that is not on (stopped or off) decides nothing.
ALTER TABLE relay_refusals DROP CONSTRAINT relay_refusals_reason_check;
ALTER TABLE relay_refusals ADD CONSTRAINT relay_refusals_reason_check
  CHECK (reason IN ('unknown', 'used', 'expired', 'decided', 'not-owner', 'wrong-channel', 'channel-off'));
