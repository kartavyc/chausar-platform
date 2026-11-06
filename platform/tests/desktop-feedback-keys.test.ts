// Wave 6 package 6J2 (D47): how the report keys reach a build. Never hard-coded: the founder sets them when building
// (scripts write feedback.json into the package's resources, outside git), or a developer sets them in the shell. The
// desktop shell passes them to the engine worker only as CHAUSAR_FEEDBACK_* variables; a build without them has none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { feedbackEnv } from '../runtime/venture/host-env.ts';

const { feedbackKeys } = createRequire(import.meta.url)('../../app/desktop/feedback-keys.cjs') as {
  feedbackKeys: (input: { env: Record<string, string | undefined>; packaged: boolean; resources: string; read: (path: string) => string }) => Record<string, string>;
};
const KEY = ['fixture', 'posthog', 'project'].join('-');
const DSN = `https://${['fixture', 'public'].join('')}@o1.ingest.sentry.io/42`;
const none = () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); };

test('the shell passes keys from its own environment first, then from the packaged feedback.json, else nothing', () => {
  assert.deepEqual(feedbackKeys({ env: {}, packaged: false, resources: 'R', read: none }), {});
  assert.deepEqual(feedbackKeys({ env: { CHAUSAR_FEEDBACK_POSTHOG_KEY: KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: 'https://us.i.posthog.com' }, packaged: true, resources: 'R', read: none }),
    { CHAUSAR_FEEDBACK_POSTHOG_KEY: KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: 'https://us.i.posthog.com' });
  const seen: string[] = [];
  const file = JSON.stringify({ posthogKey: KEY, posthogHost: 'https://us.i.posthog.com', sentryDsn: DSN, other: 'ignored' });
  assert.deepEqual(feedbackKeys({ env: {}, packaged: true, resources: 'R', read: path => { seen.push(path); return file; } }),
    { CHAUSAR_FEEDBACK_POSTHOG_KEY: KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: 'https://us.i.posthog.com', CHAUSAR_FEEDBACK_SENTRY_DSN: DSN });
  assert.match(seen[0]!, /feedback\.json$/);
  // A development run never reads a file; a broken file gives nothing rather than stopping the app.
  assert.deepEqual(feedbackKeys({ env: {}, packaged: false, resources: 'R', read: () => file }), {});
  assert.deepEqual(feedbackKeys({ env: {}, packaged: true, resources: 'R', read: () => '{not json' }), {});
  assert.deepEqual(feedbackKeys({ env: {}, packaged: true, resources: 'R', read: () => JSON.stringify({ posthogKey: KEY, posthogHost: 'http://plain.example' }) }), {});
});

test('the engine reads only https hosts and a DSN; without them reports say they are not set up', () => {
  assert.equal(feedbackEnv({}), undefined);
  assert.equal(feedbackEnv({ CHAUSAR_FEEDBACK_POSTHOG_KEY: KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: 'http://us.i.posthog.com' }), undefined);
  const both = feedbackEnv({ CHAUSAR_FEEDBACK_POSTHOG_KEY: KEY, CHAUSAR_FEEDBACK_POSTHOG_HOST: 'https://us.i.posthog.com', CHAUSAR_FEEDBACK_SENTRY_DSN: DSN, CHAUSAR_ENGINE_VERSION: '0.6.0' })!;
  assert.deepEqual([both.posthog, both.sentry, both.appVersion], [{ key: KEY, host: 'https://us.i.posthog.com' }, { dsn: DSN }, '0.6.0']);
  assert.ok(['windows', 'linux', 'mac', 'other'].includes(both.os!));
});

test('no key or DSN is written into the repository: the shell reads them, the code holds none', async () => {
  for (const file of ['../../app/desktop/feedback-keys.cjs', '../../app/desktop/main.cjs', '../runtime/venture/host-env.ts', '../runtime/venture/core/feedback.ts']) {
    const source = await readFile(new URL(file, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /phc_[A-Za-z0-9]{10,}/, file);
    assert.doesNotMatch(source, /https:\/\/[0-9a-f]{20,}@/, file);
  }
});
