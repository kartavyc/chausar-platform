-- One live binding per chat, number and mail address.
-- A Telegram chat, a WhatsApp number or a confirmed mail address belongs to at most one account at a time. A binding
-- is live while its row is not 'off' (a stopped row still owns its chat: the person said STOP there, and only they may
-- START it again); for mail only a confirmed address (confirmed_hash = recipient_hash) is a binding. Before this, a
-- connect link from a second account rebound a chat that was already bound, and inbound messages went to the newest.
--
-- Existing duplicates are resolved without guessing which account is the rightful one: every live row in a group of
-- two or more is unbound. Telegram rows lose their chat (each owner connects again from the desktop: enabled rows wait
-- in 'awaiting-start', which hands out a fresh connect link on the next save); mail rows lose their confirmation (an
-- 'on' row waits in 'awaiting-confirmation' and the next save sends a confirmation mail to the address, which only its
-- holder can press); WhatsApp rows (impossible while account phones are unique) are turned off.
WITH duplicated AS (
  SELECT channel, recipient_hash FROM relay_channels
  WHERE recipient_hash IS NOT NULL AND status <> 'off' AND (channel <> 'mail' OR confirmed_hash = recipient_hash)
  GROUP BY channel, recipient_hash HAVING count(*) > 1
)
UPDATE relay_channels c SET
  status = CASE
    WHEN c.channel = 'telegram' THEN CASE WHEN c.enabled THEN 'awaiting-start' ELSE 'off' END
    WHEN c.channel = 'mail' THEN CASE WHEN c.status = 'on' THEN 'awaiting-confirmation' ELSE c.status END
    ELSE 'off' END,
  recipient_hash = CASE WHEN c.channel = 'telegram' THEN NULL ELSE c.recipient_hash END,
  address_sealed = CASE WHEN c.channel = 'telegram' THEN NULL ELSE c.address_sealed END,
  address_mask = CASE WHEN c.channel = 'telegram' THEN NULL ELSE c.address_mask END,
  stopped_at = CASE WHEN c.channel = 'telegram' THEN NULL ELSE c.stopped_at END,
  confirmed_hash = CASE WHEN c.channel = 'mail' THEN NULL ELSE c.confirmed_hash END,
  updated_at = now()
FROM duplicated d
WHERE c.channel = d.channel AND c.recipient_hash = d.recipient_hash
  AND c.status <> 'off' AND (c.channel <> 'mail' OR c.confirmed_hash = c.recipient_hash);

CREATE UNIQUE INDEX relay_channels_one_live_binding ON relay_channels (channel, recipient_hash)
  WHERE recipient_hash IS NOT NULL AND status <> 'off' AND (channel <> 'mail' OR confirmed_hash = recipient_hash);

-- A connect link for a chat bound to another account, or a confirmation for an address another account confirmed,
-- changes nothing and is recorded here.
ALTER TABLE relay_refusals DROP CONSTRAINT relay_refusals_reason_check;
ALTER TABLE relay_refusals ADD CONSTRAINT relay_refusals_reason_check
  CHECK (reason IN ('unknown', 'used', 'expired', 'decided', 'not-owner', 'wrong-channel', 'channel-off', 'chat-in-use', 'address-in-use'));

-- Help tickets are limited per account (or, for a sender no account owns, per keyed sender hash) per day.
ALTER TABLE relay_help_requests ADD COLUMN sender_hash text;
CREATE INDEX relay_help_requests_account ON relay_help_requests (account_id, created_at);
CREATE INDEX relay_help_requests_sender ON relay_help_requests (sender_hash, created_at);
