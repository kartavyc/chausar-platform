-- A checkout may create a partner subscription before it is paid (Razorpay does): kept so a superseded checkout
-- can be cancelled at the partner and no untracked subscription keeps charging.
ALTER TABLE billing_checkouts ADD COLUMN subscription_ref text CHECK (subscription_ref IS NULL OR subscription_ref ~ '^[A-Za-z0-9_-]{6,128}$');

-- Partner subscriptions Chausar has cancelled, so a late event for one never asks the partner to cancel it twice.
CREATE TABLE billing_cancelled_refs (
  partner text NOT NULL CHECK (partner ~ '^[a-z]{2,32}$'),
  subscription_ref text NOT NULL CHECK (subscription_ref ~ '^[A-Za-z0-9_-]{6,128}$'),
  account_id text,
  reason text NOT NULL CHECK (reason IN ('superseded', 'cancelled')),
  cancelled_at timestamptz NOT NULL,
  PRIMARY KEY (partner, subscription_ref)
);
