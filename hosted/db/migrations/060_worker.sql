-- Always-on jobs. NOT end-to-end encrypted: the server reads these inputs to do the work.
-- A job is on only with recorded consent: consent_at is the server time, consent_recorded_at the desktop's.
CREATE TABLE worker_jobs (
  account_id text NOT NULL CHECK (account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  type text NOT NULL CHECK (type IN ('due-date-reminder')),
  enabled boolean NOT NULL,
  consent_at timestamptz,
  consent_recorded_at timestamptz,
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, type),
  CHECK (NOT enabled OR (consent_at IS NOT NULL AND consent_recorded_at IS NOT NULL))
);

-- Due dates for the due-date-reminder job: an id and a date only, never an amount or a name.
CREATE TABLE worker_due_dates (
  account_id text NOT NULL CHECK (account_id ~ '^[A-Za-z0-9_-]{1,128}$'),
  id text NOT NULL CHECK (id ~ '^[A-Za-z0-9_-]{1,64}$'),
  due_on date NOT NULL,
  remind_days_before integer NOT NULL CHECK (remind_days_before BETWEEN 0 AND 30),
  updated_at timestamptz NOT NULL,
  PRIMARY KEY (account_id, id)
);
CREATE INDEX worker_due_dates_window ON worker_due_dates (due_on);
