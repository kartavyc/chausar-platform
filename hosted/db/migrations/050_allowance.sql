-- Model allowance ledger. Counts and paise only: no prompt and no answer is ever stored.
-- One row per account and Indian calendar month: the grant in force and the lock every reservation waits on.
CREATE TABLE allowance_months (
  account_id text NOT NULL CHECK (account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  grant_paise bigint NOT NULL CHECK (grant_paise >= 0),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, month)
);

-- One attempt per (account, request id). reserved: the worst case is held; settled: cost_paise is the measured cost;
-- failed: the provider refused, nothing is counted; unknown: no clear answer, the reservation stays counted.
CREATE TABLE allowance_requests (
  account_id text NOT NULL CHECK (account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  request_id text NOT NULL CHECK (request_id ~ '^[A-Za-z0-9_-]{8,128}$'),
  month text NOT NULL CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  route text NOT NULL CHECK (route IN ('anthropic', 'openai')),
  model text NOT NULL CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
  state text NOT NULL CHECK (state IN ('reserved', 'settled', 'failed', 'unknown')),
  reserved_paise bigint NOT NULL CHECK (reserved_paise >= 0),
  cost_paise bigint CHECK (cost_paise >= 0),
  input_tokens integer CHECK (input_tokens >= 0),
  output_tokens integer CHECK (output_tokens >= 0),
  pricing_checked_on date NOT NULL,
  created_at timestamptz NOT NULL,
  settled_at timestamptz,
  PRIMARY KEY (account_id, request_id),
  CHECK ((state = 'settled') = (cost_paise IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL)),
  CHECK ((state = 'reserved') = (settled_at IS NULL))
);
CREATE INDEX allowance_requests_month ON allowance_requests (account_id, month);
