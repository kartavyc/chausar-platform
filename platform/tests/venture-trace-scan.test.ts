// The trace scan (Ink v2 wave 4, package 4J15, catalogue Q14). Before any judge reads a run, code scans it for
// secrets, calls that reached outside and writes outside the work folder; a tool outside the auditor's allowlist fails
// the audit; a check that edits what it checks has its verdict voided and the files put back. The real-order judge
// refuses to read a run whose scan found something (JUDGE_NOT_READY with the scan's words).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { DeliveryRunRecord, HarnessState, ToolCallRecord, VentureDeps } from '../runtime/venture/contracts.ts';
import { AUDITOR_TOOLS, CHECK_EDITED_LINE, CHECK_UNGUARDED_LINE, CHECKS_UNCHANGED_ID, guardedCheck, guardedPlaybookChecks, scanRun, scanTrace } from '../runtime/venture/delivery/trace-scan.ts';
import { REDACTED } from '../runtime/venture/core/secrets.ts';
import { applyTurn, DEFAULT_LIMITS, newHarnessState } from '../runtime/venture/delivery/harness/loop.ts';
import type { ToolEnv } from '../runtime/venture/delivery/harness/tools.ts';
import { handlers as deliveryHandlers } from '../runtime/venture/delivery/index.ts';
import { ventureAction } from '../runtime/venture/records.ts';
import { harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup } from './venture-views-env.ts';

// Built at runtime so no key-shaped string sits in the source.
const KEY = ['sk', 'ant', 'a1B2c3D4e5F6g7H8i9J0'].join('-');
const call = (id: string, tool: string, input: Record<string, unknown> = {}, result: unknown = {}, extra: Partial<ToolCallRecord> = {}): ToolCallRecord => ({
  id, turn: 1, tool, input: input as ToolCallRecord['input'], inputDigest: 'd', envelope: { ok: true, result: result as never }, outcome: 'succeeded', effect: 'read', tier: 'code',
  receiptIds: [], tableIds: [], ...extra,
});
const clean = (): HarnessState => harness({ toolCalls: [call('t1.1', 'files.read', { file: 'bank.csv' }, { rows: 4 }), call('t1.2', 'calc.sum', { table: 'bank', column: 'amount' }, { total: 'INR 400.00' })] });

test('scan: a clean run is clean, with nothing to report', () => {
  const scan = scanTrace({ harness: clean(), draft: 'Your books are closed.' });
  assert.equal(scan.clean, true);
  assert.deepEqual(scan.findings, []);
  assert.equal(scan.line, null);
});

test('scan: a secret anywhere in the trace (a call\'s input or result, a turn note, a hand-off, the draft) is found, never echoed', () => {
  for (const [where, state, draft] of [
    ['result', harness({ toolCalls: [call('t1.1', 'files.read', {}, { text: `api ${KEY}` })] }), ''],
    ['input', harness({ toolCalls: [call('t1.1', 'files.read', { file: KEY })] }), ''],
    ['draft', clean(), `Use ${KEY} to log in.`],
  ] as const) {
    const scan = scanTrace({ harness: state, draft });
    assert.equal(scan.clean, false, where);
    assert.equal(scan.findings[0].kind, 'secret', where);
    assert.ok(!JSON.stringify(scan).includes(KEY), `${where}: the secret itself is never repeated`);
  }
  const note = harness({ turns: [{ turn: 1, step: 'act', note: `Found ${KEY} in the file.`, calls: [], finished: false, forced: false, by: 'model', callId: null, costMicros: '0' }] });
  assert.equal(scanTrace({ harness: note }).findings[0].at, 'turn.1');
});

test('scan: a secret the loop already redacted ([redacted secret]) still counts as a secret, in a run stored through the loop', async () => {
  const env: ToolEnv = {
    deps: { services: {}, host: 'test' } as unknown as VentureDeps, ventureId: 'venture_1', memberId: 'owner', epoch: 1, currency: 'INR', dateOrder: 'day-month-year',
    runRef: { kind: 'rehearsal', scenarioId: 'bookkeeping-clean', episode: 0 }, files: [], tables: [], receipts: [], dictionary: [], sandbox: undefined,
    now: () => '2026-10-26T10:00:00.000Z', allowed: [],
  };
  const stored = await applyTurn(env, newHarnessState(['files.list'], DEFAULT_LIMITS, []), { note: `The client sent ${KEY} in the brief.`, calls: [{ tool: 'files.list', input: '{}' }], finished: true }, { by: 'model', callId: 'c1', costMicros: '0' });
  assert.ok(stored.turns[0].note.includes(REDACTED), 'the loop stored the note with the secret taken out');
  assert.ok(!JSON.stringify(stored).includes(KEY));
  const scan = scanTrace({ harness: stored });
  assert.deepEqual(scan.findings.map(item => [item.kind, item.at]), [['secret', 'turn.1']]);
  assert.equal(scanTrace({ harness: harness({ toolCalls: [call('t1.1', 'files.read', {}, { text: `key ${REDACTED}` })] }) }).findings[0].kind, 'secret');
  assert.equal(scanTrace({ harness: clean(), draft: `Your key is ${REDACTED}.` }).findings[0].at, 'draft');
});

test('scan: a call that reached outside is found; a recorded request for the owner is not a call outside', () => {
  const out = scanTrace({ harness: harness({ toolCalls: [call('t2.1', 'web.fetch', { url: 'https://example.com' }, {}, { effect: null })] }) });
  assert.deepEqual(out.findings.map(item => [item.kind, item.at]), [['outbound', 't2.1']]);
  const sent = scanTrace({ harness: harness({ toolCalls: [call('t2.2', 'message.send', {}, {}, { effect: 'outside-write' })] }) });
  assert.equal(sent.findings[0].kind, 'outbound');
  const recorded = scanTrace({ harness: harness({ toolCalls: [call('t2.3', 'outbox.propose', { connector: 'mail-app' }, { recorded: true }, { effect: 'outside-write' })] }) });
  assert.equal(recorded.clean, true, 'outbox.propose only records a request for the owner');
  const refused = scanTrace({ harness: harness({ toolCalls: [call('t2.4', 'web.fetch', {}, {}, { outcome: 'failed', envelope: { ok: false, error: { code: 'TOOL_NOT_GRANTED', name: 'x', message: 'Refused.' } } })] }) });
  assert.equal(refused.clean, true, 'a call that was refused reached nothing');
});

test('scan: a write outside the work folder is found, in a call\'s input or in what heavy work left behind', () => {
  for (const path of ['../secrets.txt', '/etc/passwd', 'C:\\Users\\owner\\notes.txt', '~/x', 'work/../../x']) {
    const scan = scanTrace({ harness: harness({ toolCalls: [call('t3.1', 'sandbox.python', { output: path })] }) });
    assert.deepEqual(scan.findings.map(item => [item.kind, item.at]), [['outside-write', 't3.1']], path);
  }
  assert.equal(scanTrace({ harness: harness({ toolCalls: [call('t3.2', 'sandbox.python', { output: 'out/summary.csv' })] }) }).clean, true);
  const left = scanTrace({ harness: clean(), delegateOutputs: [{ name: 'report.md' }, { name: '../../outside.md' }] });
  assert.deepEqual(left.findings.map(item => [item.kind, item.at]), [['outside-write', 'output:2']]);
});

test('scan: an auditor that calls a tool outside its allowlist fails the audit', () => {
  assert.ok(AUDITOR_TOOLS.includes('files.read') && AUDITOR_TOOLS.includes('calc.sum'));
  assert.ok(!AUDITOR_TOOLS.includes('outbox.propose') && !AUDITOR_TOOLS.includes('evidence.record') && !AUDITOR_TOOLS.includes('agent.delegate'), 'only tools that read');
  const audit = scanTrace({ harness: harness({ toolCalls: [call('a1', 'files.read'), call('a2', 'evidence.record', {}, {}, { effect: 'compute' })] }), allowlist: AUDITOR_TOOLS });
  assert.equal(audit.clean, false);
  assert.deepEqual(audit.findings.map(item => [item.kind, item.at]), [['tool-not-allowed', 'a2']]);
  assert.match(audit.line!, /outside the allowed list/);
});

test('guarded check: a check that edits what it checks has its verdict voided and the files put back', async () => {
  const files = [{ name: 'bank.csv', contentBase64: Buffer.from('date,amount\n1 Sep,400\n').toString('base64') }];
  const before = structuredClone(files);
  const honest = await guardedCheck(files, subject => subject.length === 1 ? 'pass' : 'fail');
  assert.deepEqual(honest, { verdict: 'pass', voided: false, line: null });
  const cheat = await guardedCheck(files, subject => { subject[0].contentBase64 = Buffer.from('date,amount\n').toString('base64'); subject.push({ name: 'extra.csv', contentBase64: '' }); return 'pass'; });
  assert.equal(cheat.voided, true);
  assert.equal(cheat.verdict, null, 'its verdict does not count');
  assert.equal(cheat.line, CHECK_EDITED_LINE);
  assert.deepEqual(files, before, 'the files are put back');
  const record = { draft: 'Hello', checks: [] as string[] };
  const edits = await guardedCheck(record, async subject => { subject.draft = 'Changed'; return true; });
  assert.equal(edits.voided, true);
  assert.deepEqual(record, { draft: 'Hello', checks: [] });
  await assert.rejects(guardedCheck(record, subject => { (subject as { checks: string[] }).checks.push('x'); throw new Error('boom'); }), /boom/);
  assert.deepEqual(record, { draft: 'Hello', checks: [] }, 'put back even when the check throws');
  // Maps and Sets are compared by what they hold, and put back too.
  const held = { seen: new Map([['a', 1]]), tags: new Set(['x']) };
  assert.equal((await guardedCheck(held, () => true)).voided, false);
  const sneaky = await guardedCheck(held, subject => { subject.seen.set('b', 2); subject.tags.add('y'); return true; });
  assert.equal(sneaky.voided, true);
  assert.deepEqual([...held.seen.entries()], [['a', 1]]);
  assert.deepEqual([...held.tags], ['x']);
  // Something that cannot be copied cannot be guarded: the check does not run and its verdict does not count.
  let ran = false;
  const unguarded = await guardedCheck({ run: () => 1 }, () => { ran = true; return 'pass'; });
  assert.deepEqual(unguarded, { verdict: null, voided: true, line: CHECK_UNGUARDED_LINE });
  assert.equal(ran, false);
});

test('guarded playbook checks: a check that edits the draft inside its input is put back in place and fails as one result', async () => {
  const deliverable = { title: 'September books', sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: 'Closed.' }] }], questionsForClient: [] as string[] };
  const files = [{ name: 'bank.csv', contentBase64: 'YQ==' }];
  const sameDraft = deliverable, sameFile = files[0];
  const honest = await guardedPlaybookChecks('youtube', { deliverable, files }, async () => [{ playbook: 'youtube', check: 'hooks', outcome: 'pass' as const, detail: 'ok' }]);
  assert.deepEqual(honest.map(item => item.check), ['hooks']);
  const cheat = await guardedPlaybookChecks('youtube', { deliverable, files }, async () => {
    deliverable.sections[0].parts[0].text = 'Rewritten by the check.';
    files[0].contentBase64 = '';
    return [{ playbook: 'youtube', check: 'hooks', outcome: 'pass' as const, detail: 'ok' }];
  });
  assert.deepEqual(cheat, [{ playbook: 'youtube', check: CHECKS_UNCHANGED_ID, outcome: 'fail', detail: CHECK_EDITED_LINE }]);
  assert.equal(deliverable.sections[0].parts[0].text, 'Closed.', 'the draft the caller holds is put back');
  assert.equal(files[0].contentBase64, 'YQ==');
  assert.ok(deliverable === sameDraft && files[0] === sameFile, 'in place: the same objects');
});

test('the real-order judge refuses a run whose trace scan found something, in the scan\'s words', async () => {
  const env = await setup();
  const blueprint = await seedBlueprint(env);
  await setStage(env, 'approve-each');
  const { order } = await seedOrder(env, blueprint);
  const playbook = await deliveryHandlers['venture.delivery.playbook']!(env.deps, owner, {}) as { id: string; hash: string };
  const deliverable = { title: 'September books', sections: [{ heading: 'Summary', parts: [{ kind: 'text', text: 'Your books are closed.' }] }], questionsForClient: [] };
  const run = await seedRun(env, order, {
    playbookId: playbook.id, playbookHash: playbook.hash, status: 'ready-for-review', deliverable: deliverable as unknown as DeliveryRunRecord['deliverable'], renderedText: 'Your books are closed.',
    harness: harness({ phase: 'done', toolCalls: [call('t1.1', 'files.read', {}, { text: `the key is ${KEY}` })] }),
  });
  assert.equal(scanRun(env.store.read(), run).clean, false);
  await assert.rejects(deliveryHandlers['venture.delivery.judge']!(env.deps, owner, { runId: run.id }), (error: any) => {
    assert.equal(error.code, 'JUDGE_NOT_READY');
    assert.match(error.message, /^Before any judge reads this run, code scanned it and found something that looks like a key or a password \(t1\.1\)\./);
    assert.match(error.message, /No judge reads this run\. Look at it in Work before you decide on the draft yourself\.$/);
    assert.doesNotMatch(error.message, /until/, 'it promises no clearing step that does not exist');
    return true;
  });
  // The same run without the secret goes on to the judge's own checks (here: no AI to judge with).
  await ventureAction(env.deps, owner, 'prepare', 'seed.clean', tx => { tx.replace({ ...run, harness: harness({ phase: 'done', toolCalls: [call('t1.1', 'files.read', {}, { rows: 4 })] }) }); });
  await assert.rejects(deliveryHandlers['venture.delivery.judge']!(env.deps, owner, { runId: run.id }), (error: any) => !/scanned it/.test(error.message));
});
