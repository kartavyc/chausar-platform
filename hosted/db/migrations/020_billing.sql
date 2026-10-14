-- Every checkout the payment partner opened. Paying any of them activates the account's subscription.
CREATE TABLE billing_checkouts (
  checkout_id text PRIMARY KEY CHECK (checkout_id ~ '^[A-Za-z0-9_-]{6,128}$'),
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  partner text NOT NULL CHECK (partner ~ '^[a-z]{2,32}$'),
  plan text NOT NULL CHECK (plan = 'paid'),
  idempotency_key text NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9_-]{16,128}$'),
  checkout_url text NOT NULL CHECK (checkout_url ~ '^https://' AND char_length(checkout_url) <= 2048),
  created_at timestamptz NOT NULL,
  UNIQUE (account_id, idempotency_key)
);

-- The account's current subscription. A new checkout after cancelling replaces the row.
CREATE TABLE billing_subscriptions (
  account_id text PRIMARY KEY REFERENCES accounts (id) ON DELETE CASCADE,
  partner text NOT NULL CHECK (partner ~ '^[a-z]{2,32}$'),
  plan text NOT NULL CHECK (plan = 'paid'),
  status text NOT NULL CHECK (status IN ('pending', 'active', 'past_due', 'cancelled')),
  checkout_id text,
  subscription_ref text UNIQUE CHECK (subscription_ref IS NULL OR subscription_ref ~ '^[A-Za-z0-9_-]{6,128}$'),
  current_period_end timestamptz,
  past_due_since timestamptz,
  cancelled_at timestamptz,
  updated_at timestamptz NOT NULL,
  CHECK ((status = 'past_due') = (past_due_since IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL)),
  CHECK (status = 'pending' OR status = 'cancelled' OR subscription_ref IS NOT NULL)
);

-- Partner webhook events already applied: a replay changes nothing.
CREATE TABLE billing_events (
  partner text NOT NULL CHECK (partner ~ '^[a-z]{2,32}$'),
  event_id text NOT NULL CHECK (event_id ~ '^[A-Za-z0-9_.-]{1,128}$'),
  type text NOT NULL CHECK (type IN ('activated', 'charged', 'past_due', 'cancelled')),
  -- NULL when no subscription matched the event (recorded so a replay stays a no-op).
  account_id text,
  received_at timestamptz NOT NULL,
  PRIMARY KEY (partner, event_id)
);
