// Wave 6 package 6J2 (D47): how the opt-in report keys reach the engine worker. Nothing is hard-coded. A developer
// sets CHAUSAR_FEEDBACK_POSTHOG_KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST and CHAUSAR_FEEDBACK_SENTRY_DSN in the shell; a
// packaged build reads feedback.json from its resources, a file the founder's build writes from the same variables
// (never in git). Only the PostHog project key (write-only ingestion) and the Sentry DSN (a public send key) are ever
// read: no admin or personal token. A missing or broken file gives no keys, and the app says reports are not set up.
const { join } = require('node:path');

const NAMES = Object.freeze({ posthogKey: 'CHAUSAR_FEEDBACK_POSTHOG_KEY', posthogHost: 'CHAUSAR_FEEDBACK_POSTHOG_HOST', sentryDsn: 'CHAUSAR_FEEDBACK_SENTRY_DSN' });
const https = value => typeof value === 'string' && /^https:\/\/[^\s]+$/.test(value);
const keyish = value => typeof value === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(value);

/** The CHAUSAR_FEEDBACK_* variables to give the worker: the shell's own first, else the packaged file's, else none. */
function feedbackKeys({ env, packaged, resources, read }) {
  const pick = source => {
    const out = {};
    if (keyish(source.posthogKey) && https(source.posthogHost)) { out[NAMES.posthogKey] = source.posthogKey; out[NAMES.posthogHost] = source.posthogHost; }
    if (https(source.sentryDsn)) out[NAMES.sentryDsn] = source.sentryDsn;
    return out;
  };
  const fromEnv = pick({ posthogKey: env[NAMES.posthogKey], posthogHost: env[NAMES.posthogHost], sentryDsn: env[NAMES.sentryDsn] });
  if (Object.keys(fromEnv).length || !packaged) return fromEnv;
  try {
    const file = JSON.parse(read(join(resources, 'feedback.json')));
    return file && typeof file === 'object' ? pick(file) : {};
  } catch {
    return {};
  }
}

module.exports = Object.freeze({ feedbackKeys });
