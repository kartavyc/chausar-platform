// Wave 6 package 6H2 (DECISIONS D41): recorded flows as the owner uses them. venture.flows.act records a flow in the
// desktop's browser window, runs its dry run, takes the owner's one approval of that exact recipe, then runs it with no
// AI and stops before the submit; the owner's tap on that exact run goes through the exact-approval journal before the
// press. A changed page stops the run and offers the controls on the page; an AI repair is a new version that needs
// its own test and approval. No real browser: a scripted window port.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { VentureDeps } from '../runtime/venture/contracts.ts';
import { handlers as build } from '../runtime/venture/build/index.ts';
import { listRecords } from '../runtime/venture/records.ts';
import type { FlowBrowserPort, FlowFind, FlowPageFacts } from '../runtime/venture/flows/replay.ts';
import type { RecordedControl, RecordedEvent } from '../runtime/venture/flows/recipe.ts';
import { code, owner, setup } from './venture-views-env.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<any>;
const act = (deps: VentureDeps, payload: unknown, ctx: Context = owner) => (build as Record<string, Handler>)['venture.flows.act'](deps, ctx, payload);
const list = (deps: VentureDeps, ctx: Context = owner) => (build as Record<string, Handler>)['venture.flows.list'](deps, ctx, {});

const fp = (seed: string) => seed.repeat(64).slice(0, 64);
const box = (id: string, label: string, seed: string, extra: Partial<RecordedControl> = {}): RecordedControl => ({
  tag: 'input', type: 'text', name: id, id, testId: null, ariaLabel: null, labelText: label, autocomplete: null, role: null, inForm: true,
  formAction: 'https://forms.example/save', text: '', href: null, candidates: [{ kind: 'id', value: id }], fingerprint: fp(seed), ...extra,
});
const NAME = box('client', 'Client name', 'a');
const PW = box('pw', 'Password', 'c', { type: 'password' });
const SAVE = box('save', '', '2', { tag: 'button', type: 'submit', text: 'Save', labelText: null });
const DONE = box('done', '', '5', { tag: 'button', type: 'button', text: 'Close receipt', labelText: null, inForm: false, formAction: null });
const RECORDING: RecordedEvent[] = [
  { kind: 'open', url: 'https://forms.example/new' },
  { kind: 'input', control: NAME, value: 'Asha Rao' },
  { kind: 'input', control: PW, value: null },
  { kind: 'submit', control: SAVE },
  { kind: 'click', control: DONE },
];

type El = { fingerprint: string; count?: number; secret?: boolean; filled?: boolean; submitLike?: boolean };
function windowPort(elements: Record<string, El>) {
  const calls: string[] = [];
  const facts: FlowPageFacts = { url: 'https://forms.example/new', title: 'New record', captcha: false };
  const port: FlowBrowserPort = {
    async record(runId, url) { calls.push(`record ${url}`); return { events: RECORDING }; },
    async open(_r, url) { calls.push(`open ${url}`); return facts; },
    async find(_r, target): Promise<FlowFind> {
      const el = elements[target.candidates[0].value];
      return el ? { count: el.count ?? 1, fingerprint: el.fingerprint, secret: !!el.secret, filled: !!el.filled, submitLike: !!el.submitLike } : { count: 0, fingerprint: null, secret: false, filled: false, submitLike: false };
    },
    async fill(_r, target, _c, value) { calls.push(`fill ${target.candidates[0].value}=${value}`); return { shown: value }; },
    async click(_r, target, approved) { calls.push(`click ${target.candidates[0].value}${approved ? ' approved' : ''}`); return { facts, answered: true }; },
    async facts() { return facts; },
    async controls() { return [{ label: 'Client full name', candidates: [{ kind: 'id', value: 'client2' }], fingerprint: fp('9') }]; },
    async close() { calls.push('close'); },
  };
  return { port, calls, elements };
}
const READY: Record<string, El> = { client: { fingerprint: fp('a') }, pw: { fingerprint: fp('c'), secret: true, filled: true }, save: { fingerprint: fp('2'), submitLike: true }, done: { fingerprint: fp('5') } };

async function desktop(elements: Record<string, El> = READY) {
  const env = await setup();
  const window = windowPort({ ...elements });
  env.deps = { ...env.deps, host: 'desktop', flowBrowser: window.port } as VentureDeps;
  return { env, deps: env.deps, ...window };
}
async function approvedFlow(deps: VentureDeps) {
  const recorded = await act(deps, { action: 'record', name: 'New record', url: 'https://forms.example/new' });
  const tested = await act(deps, { action: 'dry-run', flowId: recorded.flow.flowId, version: 1 });
  return act(deps, { action: 'approve', flowId: tested.flow.flowId, version: 1, digest: tested.flow.digest });
}

test('without the desktop window there is nothing to record with, said plainly', async () => {
  const env = await setup();
  await assert.rejects(act(env.deps, { action: 'record', name: 'New record', url: 'https://forms.example/new' }), code('FLOW_BROWSER_UNAVAILABLE'));
});

test('a recording becomes a draft with blanks; its typed words are not shown back, the password not kept at all', async () => {
  const { deps, calls } = await desktop();
  const done = await act(deps, { action: 'record', name: 'New record', url: 'https://forms.example/new' });
  assert.deepEqual(calls, ['record https://forms.example/new']);
  assert.equal(done.flow.state, 'draft');
  assert.equal(done.flow.version, 1);
  assert.deepEqual(done.flow.blanks, [{ name: 'blank-1', label: 'Client name' }]);
  assert.deepEqual(done.flow.steps.map((step: any) => step.kind), ['open', 'fill', 'secret', 'gate', 'click']);
  assert.equal(done.flow.hasSamples, true);
  assert.equal(JSON.stringify(done).includes('Asha Rao'), false, 'the view never shows the recorded words');
  const [record] = listRecords(deps.store.read(), 'venture-flow');
  assert.deepEqual(record.samples, { 'blank-1': 'Asha Rao' });
  const shown = await list(deps);
  assert.equal(shown.flows.length, 1);
});

test('one approval, only of the exact recipe whose dry run passed; the samples go at approval', async () => {
  const { deps, calls } = await desktop();
  const recorded = await act(deps, { action: 'record', name: 'New record', url: 'https://forms.example/new' });
  const flowId = recorded.flow.flowId;
  await assert.rejects(act(deps, { action: 'approve', flowId, version: 1, digest: recorded.flow.digest }), code('FLOW_NOT_TESTED'));
  await assert.rejects(act(deps, { action: 'run', flowId, values: { 'blank-1': 'Meera' } }), code('FLOW_NOT_TESTED'));
  calls.length = 0;
  const tested = await act(deps, { action: 'dry-run', flowId, version: 1 });
  assert.equal(tested.flow.dryRun.outcome, 'tested');
  assert.deepEqual(calls, ['open https://forms.example/new', 'fill client=Asha Rao', 'close']);
  await assert.rejects(act(deps, { action: 'approve', flowId, version: 1, digest: 'f'.repeat(64) }), code('APPROVAL_STALE'));
  const approved = await act(deps, { action: 'approve', flowId, version: 1, digest: tested.flow.digest });
  assert.equal(approved.flow.state, 'approved');
  assert.equal(approved.flow.hasSamples, false);
  assert.equal(listRecords(deps.store.read(), 'venture-flow')[0].samples, null);
  await assert.rejects(act(deps, { action: 'approve', flowId, version: 1, digest: tested.flow.digest }), code('APPROVAL_STALE'));
});

test('a run fills the blanks with no AI, stops before Save, and the owner\'s tap goes through the journal before the press', async () => {
  const { deps, calls } = await desktop();
  const approved = await approvedFlow(deps);
  calls.length = 0;
  const held = await act(deps, { action: 'run', flowId: approved.flow.flowId, values: { 'blank-1': 'Meera Iyer' } });
  assert.equal(held.run.state, 'held');
  assert.equal(held.run.step, 3);
  assert.equal(held.run.line, 'Chausar stopped before Save. Approve this exact submit to go on.');
  assert.deepEqual(held.run.held.review, [{ label: 'Client name', value: 'Meera Iyer' }]);
  assert.deepEqual(calls, ['open https://forms.example/new', 'fill client=Meera Iyer']);
  assert.equal(listRecords(deps.store.read(), 'venture-journal-entry').length, 0, 'nothing is proposed until the owner taps');
  await assert.rejects(act(deps, { action: 'continue', runId: held.run.id, digest: 'e'.repeat(64) }), code('APPROVAL_STALE'));
  await assert.rejects(act(deps, { action: 'continue', runId: held.run.id, digest: held.run.held.digest }, agent), code('APP_APPROVAL_REQUIRED'));
  const done = await act(deps, { action: 'continue', runId: held.run.id, digest: held.run.held.digest });
  assert.deepEqual(calls.slice(2), ['click save approved', 'click done', 'close']);
  assert.equal(done.run.state, 'done');
  assert.equal(done.run.held, null, 'the review leaves the vault once the run ends');
  const [entry] = listRecords(deps.store.read(), 'venture-journal-entry');
  assert.equal(entry.action, 'connector.write');
  assert.equal(entry.operation, 'flow-submit');
  assert.equal(entry.actionDigest, held.run.held.digest);
  assert.equal(entry.state, 'applied');
  await assert.rejects(act(deps, { action: 'continue', runId: held.run.id, digest: held.run.held.digest }), code('FLOW_HELD'));
});

test('a password stop waits for the owner to type it in the window; Chausar never types it', async () => {
  const { deps, calls, elements } = await desktop({ ...READY, pw: { fingerprint: fp('c'), secret: true, filled: false } });
  const approved = await approvedFlow(deps).catch(() => null);
  assert.equal(approved, null, 'the dry run also waits for the owner at the password');
  const flowId = listRecords(deps.store.read(), 'venture-flow')[0].flowId;
  const runs = listRecords(deps.store.read(), 'venture-flow-run');
  assert.equal(runs.at(-1)!.state, 'needs-you');
  elements.pw.filled = true;
  const tested = await act(deps, { action: 'continue', runId: runs.at(-1)!.id, digest: null });
  assert.equal(tested.run.state, 'tested');
  assert.equal(calls.some(call => call.startsWith('fill pw')), false);
  const flow = await act(deps, { action: 'approve', flowId, version: 1, digest: tested.flow.digest });
  assert.equal(flow.flow.state, 'approved');
});

test('only the owner inside the app records, tests, approves, runs and continues', async () => {
  const { deps } = await desktop();
  for (const payload of [{ action: 'record', name: 'x', url: 'https://forms.example/new' }, { action: 'run', flowId: 'flow_x', values: {} }]) {
    await assert.rejects(act(deps, payload, agent), code('APP_APPROVAL_REQUIRED'));
  }
});

test('a changed page stops the run; an AI repair is a new version that needs its own test and approval', async () => {
  const { deps, calls, elements } = await desktop();
  const approved = await approvedFlow(deps);
  elements.client = { fingerprint: fp('z') };
  const stopped = await act(deps, { action: 'run', flowId: approved.flow.flowId, values: { 'blank-1': 'Meera' } });
  assert.equal(stopped.run.state, 'stopped');
  assert.equal(stopped.run.step, 1);
  assert.deepEqual(stopped.run.repairOptions, [{ label: 'Client full name', candidates: [{ kind: 'id', value: 'client2' }], fingerprint: fp('9') }]);
  assert.equal(calls.at(-1), 'close');
  const repaired = await act(deps, { action: 'repair', runId: stopped.run.id, option: 0 }, agent);
  assert.equal(repaired.flow.version, 2);
  assert.equal(repaired.flow.state, 'draft');
  assert.equal(repaired.flow.proposedBy, 'ai');
  assert.deepEqual(repaired.flow.repairOf, { version: 1, step: 1 });
  assert.equal(repaired.flow.steps[1].target.fingerprint, fp('9'));
  await assert.rejects(act(deps, { action: 'approve', flowId: approved.flow.flowId, version: 2, digest: repaired.flow.digest }), code('FLOW_NOT_TESTED'));
  elements.client2 = { fingerprint: fp('9') };
  const tested = await act(deps, { action: 'dry-run', flowId: approved.flow.flowId, version: 2, values: { 'blank-1': 'Sample name' } });
  assert.equal(tested.flow.dryRun.outcome, 'tested');
  const second = await act(deps, { action: 'approve', flowId: approved.flow.flowId, version: 2, digest: tested.flow.digest });
  assert.equal(second.flow.state, 'approved');
  const versions = listRecords(deps.store.read(), 'venture-flow').map(row => [row.version, row.state]);
  assert.deepEqual(versions, [[1, 'replaced'], [2, 'approved']]);
  await assert.rejects(act(deps, { action: 'repair', runId: stopped.run.id, option: 5 }, agent), code('FLOW_INVALID'));
});

test('a window that closed while a run waits at its stop is never pressed and never left unknown', async () => {
  const { deps, port } = await desktop();
  const approved = await approvedFlow(deps);
  const held = await act(deps, { action: 'run', flowId: approved.flow.flowId, values: { 'blank-1': 'Meera' } });
  port.find = async () => { throw Object.assign(new Error('closed'), { code: 'FLOW_BROWSER_CLOSED' }); };
  const after = await act(deps, { action: 'continue', runId: held.run.id, digest: held.run.held.digest });
  assert.equal(after.run.state, 'not-sent');
  const [entry] = listRecords(deps.store.read(), 'venture-journal-entry');
  assert.equal(entry.state, 'rejected');
});
