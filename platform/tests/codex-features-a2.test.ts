// A2 review: the text route switches off everything the agent driver keeps off, and every feature Codex 0.166.0 turns
// on by default is either switched off or left on for a stated reason. A new default-on feature fails this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CODEX_CLI_CONFIG, CODEX_FEATURES_LEFT_ON, CODEX_QUIET_ARGS } from '../runtime/providers/codex-cli.ts';
import { CODEX_PROHIBITED_FEATURES } from '../runtime/venture/agent-runtime/codex-driver.ts';

const FEATURES = readFileSync(new URL('./fixtures/venture/models/cli-help/codex-cli-0.166.0-features.txt', import.meta.url), 'utf8');
const rows = FEATURES.split(/\r?\n/).map(line => line.trim().match(/^([a-z][a-z0-9_.]*)\s+(stable|experimental|under development|deprecated|removed)\s+(true|false)$/)).filter(Boolean) as RegExpMatchArray[];
const off = new Set(CODEX_CLI_CONFIG.filter(value => value.startsWith('features.') && value.endsWith('=false')).map(value => value.slice('features.'.length, -'=false'.length)));

test('the text route switches off every feature the agent driver keeps off', () => {
  assert.deepEqual(CODEX_PROHIBITED_FEATURES.filter(name => !off.has(name)), []);
});

test('every default-on 0.166.0 feature is switched off or left on for a reason', () => {
  const on = rows.filter(row => row[3] === 'true' && row[2] !== 'removed').map(row => row[1]!);
  assert.ok(on.length > 30, 'the real listing was read');
  const unexplained = on.filter(name => !off.has(name) && !Object.hasOwn(CODEX_FEATURES_LEFT_ON, name) && name !== 'skip_host_skill_discovery');
  assert.deepEqual(unexplained, []);
  for (const name of Object.keys(CODEX_FEATURES_LEFT_ON)) assert.ok(rows.some(row => row[1] === name), `${name} is a real 0.166.0 feature`);
  for (const name of off) assert.ok(rows.some(row => row[1] === name && row[2] !== 'removed'), `${name} can be switched off in 0.166.0`);
});

test('the check commands switch off the background and update features too', () => {
  for (const name of ['daemon_auto_start', 'plugin_discovery_prefetch', 'in_app_updates']) assert.ok(CODEX_QUIET_ARGS.join(' ').includes(`--disable ${name}`), name);
});
