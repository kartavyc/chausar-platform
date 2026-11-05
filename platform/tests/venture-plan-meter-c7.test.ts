// C7 task 1: the plan meter reads how much of the owner's Codex or Claude Code plan is used, only from what the tools
// themselves report (Codex's account/rateLimits notification and read, Claude Code's rate_limit_event), with the source
// and the read time. A window it cannot read, or one whose reset has passed, is unknown: never a guessed or old figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PlanMeter, fromClaudeLimit, fromCodexLimits } from '../runtime/venture/models/plan-meter.ts';

const AT = '2026-11-06T09:00:00.000Z', atSeconds = Date.parse(AT) / 1000;
const iso = (seconds: number) => new Date(seconds * 1000).toISOString();

// The shape of Codex 0.166.0's account/rateLimits/updated params (checked with `codex app-server generate-json-schema`).
function codexPayload() {
  return { rateLimits: {
    limitId: 'codex', planType: 'plus', rateLimitReachedType: null,
    primary: { usedPercent: 62, windowDurationMins: 300, resetsAt: atSeconds + 2 * 3600 },
    secondary: { usedPercent: 18, windowDurationMins: 10_080, resetsAt: atSeconds + 3 * 86_400 },
  } };
}

test('a Codex report gives the five-hour and weekly windows with their resets', () => {
  const reading = fromCodexLimits(codexPayload(), AT);
  assert.equal(reading.cli, 'codex'); assert.equal(reading.source, 'codex'); assert.equal(reading.readAt, AT); assert.equal(reading.state, 'ok');
  assert.deepEqual(reading.windows.map(window => [window.kind, window.usedPercent, window.resetsAt]), [
    ['five-hour', 62, iso(atSeconds + 2 * 3600)],
    ['week', 18, iso(atSeconds + 3 * 86_400)],
  ]);
});

test('a window of another length is left out; near and used up follow the reported percent', () => {
  const payload = codexPayload();
  payload.rateLimits.primary = { usedPercent: 40, windowDurationMins: 60, resetsAt: atSeconds + 600 };
  assert.deepEqual(fromCodexLimits(payload, AT).windows.map(window => window.kind), ['week']);
  payload.rateLimits.secondary.usedPercent = 85;
  assert.equal(fromCodexLimits(payload, AT).state, 'near');
  payload.rateLimits.secondary.usedPercent = 100;
  assert.equal(fromCodexLimits(payload, AT).state, 'used-up');
  const reached = codexPayload();
  (reached.rateLimits as any).rateLimitReachedType = 'rate_limit_reached';
  assert.equal(fromCodexLimits(reached, AT).state, 'used-up');
});

test('a Claude Code rejected five-hour event is used up with its reset; a warning is near; other limit kinds are left out', () => {
  const rejected = fromClaudeLimit({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: atSeconds + 1800, utilization: 100 }, AT);
  assert.equal(rejected.cli, 'claude-code'); assert.equal(rejected.source, 'claude-code'); assert.equal(rejected.state, 'used-up');
  assert.deepEqual(rejected.windows, [{ kind: 'five-hour', usedPercent: 100, resetsAt: iso(atSeconds + 1800), state: 'used-up' }]);
  const warning = fromClaudeLimit({ status: 'allowed_warning', rateLimitType: 'seven_day', resetsAt: atSeconds + 86_400 }, AT);
  assert.equal(warning.state, 'near'); assert.deepEqual(warning.windows.map(window => [window.kind, window.usedPercent]), [['week', null]]);
  assert.equal(fromClaudeLimit({ status: 'allowed', rateLimitType: 'seven_day_opus', resetsAt: atSeconds + 60 }, AT).state, 'unknown');
});

test('a percent outside 0 to 100 or a reset that does not read makes that window unknown', () => {
  const over = fromClaudeLimit({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: atSeconds + 60, utilization: 140 }, AT);
  assert.deepEqual(over.windows, [{ kind: 'five-hour', usedPercent: null, resetsAt: null, state: 'unknown' }]);
  assert.equal(over.state, 'unknown');
  const payload = codexPayload();
  (payload.rateLimits.primary as any).resetsAt = 'tomorrow';
  (payload.rateLimits.secondary as any).usedPercent = -3;
  assert.deepEqual(fromCodexLimits(payload, AT).windows.map(window => window.state), ['unknown', 'unknown']);
});

test('an empty or odd shape is unknown, never an error', () => {
  for (const raw of [undefined, null, {}, [], 'text', 42, { rateLimits: null }, { rateLimits: { primary: 'x' } }]) {
    const codex = fromCodexLimits(raw, AT);
    assert.equal(codex.state, 'unknown'); assert.deepEqual(codex.windows, []);
    const claude = fromClaudeLimit(raw, AT);
    assert.equal(claude.state, 'unknown'); assert.deepEqual(claude.windows, []);
  }
  assert.equal(fromCodexLimits(codexPayload(), 'not a time').state, 'unknown');
});

test('the meter keeps the newest window of each kind and reads unknown once a reset has passed', () => {
  const meter = new PlanMeter();
  assert.deepEqual(meter.read('codex', AT), { cli: 'codex', windows: [], state: 'unknown', source: 'codex', readAt: null });
  meter.note(fromCodexLimits(codexPayload(), AT));
  const later = new Date(Date.parse(AT) + 3 * 3600_000).toISOString();
  meter.note(fromClaudeLimit({ status: 'rejected', rateLimitType: 'five_hour', resetsAt: atSeconds + 1800 }, AT));
  meter.note(fromClaudeLimit({ status: 'allowed', rateLimitType: 'seven_day', resetsAt: atSeconds + 86_400, utilization: 30 }, AT));
  assert.equal(meter.read('claude-code', AT).state, 'used-up');
  assert.deepEqual(meter.read('claude-code', AT).windows.map(window => window.kind), ['five-hour', 'week']);
  const codexLater = meter.read('codex', later);
  assert.deepEqual(codexLater.windows.map(window => [window.kind, window.usedPercent, window.state]), [['five-hour', null, 'unknown'], ['week', 18, 'ok']]);
  const claudeLater = meter.read('claude-code', later);
  assert.equal(claudeLater.state, 'ok', 'the used-up window reset, so it no longer holds');
  meter.note(fromCodexLimits({ rateLimits: { primary: { usedPercent: 70, windowDurationMins: 300, resetsAt: atSeconds + 4 * 3600 } } }, later));
  assert.deepEqual(meter.read('codex', later).windows.map(window => [window.kind, window.usedPercent]), [['five-hour', 70], ['week', 18]]);
  assert.equal(meter.read('codex', later).readAt, later);
  meter.note(fromCodexLimits({}, later));
  assert.equal(meter.read('codex', later).windows.length, 2, 'an empty report never wipes what was read');
});
