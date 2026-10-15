import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context } from '../runtime/contracts.ts';
import { laneState } from '../runtime/trust-ext/lane-state.ts';
import '../runtime/core-data/trust-rules.ts';

// Synthetic records and files only.
const passphrase = 'Synthetic-core-data-trust-keep';
// Forty days ago: past a thirty-day keep period, inside the ninety-day fact retention, and never in this month.
const oldMs = Date.now() - 40 * 86400000, OLD = new Date(oldMs).toISOString();
const exists = (path: string) => lstat(path).then(() => true, () => false);

async function fixture(t: any) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-core-data-keep-'));
  const outside = await mkdtemp(join(tmpdir(), 'chausar-core-data-keep-outside-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });
  const call = async (method: string, payload: any = {}) => {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    return { status: response.status, body: await response.json() as any };
  };
  async function rpc(method: string, payload: any = {}) { const r = await call(method, payload); assert.equal(r.status, 200, `${method}: ${JSON.stringify(r.body.error)}`); return r.body.result; }
  await rpc('workspace.create', { name: 'Synthetic keep', passphrase, demo: false });
  return { engine, directory, outside, call, rpc, store: () => engine.vault!, owner: engine.bootstrapContext() };
}
async function seed(f: Awaited<ReturnType<typeof fixture>>) {
  const recent = new Date().toISOString();
  await f.store().update(state => {
    state.modelReceipts.push({ id: 'mr-old', kind: 'model-preview', status: 'completed', digest: 'd'.repeat(64), createdAt: OLD },
      { id: 'mr-waiting', kind: 'model-preview', status: 'preview', approvalId: 'mr-approval', createdAt: OLD },
      { id: 'mr-approval', kind: 'outbound-approval', createdAt: OLD }, { id: 'mr-new', kind: 'model-preview', status: 'completed', createdAt: recent });
    state.actions.push({ id: 'action-open', status: 'prepared', sourceIds: [], createdAt: recent });
    state.activity.push({ id: 'ev-old', at: OLD, event: 'calculation.completed', details: {} }, { id: 'ev-action', at: OLD, event: 'action.prepared', details: { actionId: 'action-open' } },
      { id: 'ev-seat', at: OLD, event: 'auth.invitation.accepted', details: { memberId: 'owner', invitationId: 'invite-x' } }, { id: 'ev-linked', at: OLD, event: 'calculation.completed', details: {} });
    laneState(state).tools.record = { links: [{ seq: 1, id: 'ev-linked', hash: 'h', at: OLD, computer: 'x' }] };
    laneState(state).reports.briefs = { 'owner:2020-01-06': { brief: { id: 'brief-old', builtAt: OLD }, sourceIds: [], rowIds: [], memberId: 'owner' },
      'owner:now': { brief: { id: 'brief-new', builtAt: recent }, sourceIds: [], rowIds: [], memberId: 'owner' } };
    state.learning.push({ id: 'learning-old', type: 'note', at: OLD }, { id: 'learning-new', type: 'note', at: recent });
  });
  for (const kind of ['modelReceipts', 'activity', 'briefs', 'exports', 'learning']) await f.rpc('trustx.setKeep', { kind, days: 30 });
}
async function files(f: Awaited<ReturnType<typeof fixture>>) {
  const root = join(f.directory, 'exports'); await mkdir(join(root, 'reports'), { recursive: true }); await mkdir(join(root, 'questions'), { recursive: true });
  const everything = join(root, 'everything-2020-01-06T10-00-00-000Z'); await mkdir(everything);
  const paths = {
    prepared: join(root, 'chausar-prepared-20200106-100000Z-abc123-prepared.json'), checklist: join(root, 'chausar-prepared-20200106-100000Z-abc123-checklist.txt'),
    plain: join(root, 'chausar-workspace_12345678-1234-1234-1234-123456789abc-1578304800000.json'), locked: join(root, 'chausar-workspace_12345678-1234-1234-1234-123456789abc-1578304800000.vault'),
    report: join(root, 'reports', 'sales-summary-en-2020-01-01-2020-01-31-2020-02-01T00-00-00-000Z.csv'), question: join(root, 'questions', 'question-2020-02-01T00-00-00-000Z.html'),
    facts: join(everything, 'facts.csv'), members: join(everything, 'members.json'), notes: join(root, 'notes.txt'), fresh: join(root, 'chausar-prepared-20260101-100000Z-abc123-prepared.json'),
    outsideTarget: join(f.outside, 'keep-me.html'), link: join(root, 'questions', 'question-link.html'),
  };
  for (const [name, path] of Object.entries(paths)) if (!['link', 'fresh'].includes(name)) { await writeFile(path, 'synthetic'); await utimes(path, oldMs / 1000, oldMs / 1000); }
  await writeFile(paths.fresh, 'synthetic'); await symlink(paths.outsideTarget, paths.link);
  await utimes(everything, oldMs / 1000, oldMs / 1000);
  await f.store().update(state => { const reports = laneState(state).reports;
    reports.pageExports = [{ id: 'pe-1', at: OLD, path: paths.report }]; reports.questions = [{ id: 'q-1', at: OLD, path: paths.question }];
    reports.exports = [{ id: 'ex-1', at: OLD, locked: false, folder: everything }, { id: 'ex-2', at: OLD, locked: true, folder: root }]; });
  return { ...paths, everything };
}

test('keep.enforce removes what is older than each keep period, holds what other records need, and records the clean-up', async t => {
  const f = await fixture(t); await seed(f); const paths = await files(f);
  const result = await f.rpc('keep.enforce', {});
  const row = (kind: string) => result.kinds.find((r: any) => r.kind === kind);
  assert.deepEqual(result.kinds.map((r: any) => r.kind), ['modelReceipts', 'activity', 'briefs', 'exports', 'learning']);
  assert.deepEqual([row('modelReceipts').removed, row('modelReceipts').held], [1, 2]);
  assert.deepEqual([row('activity').removed, row('activity').held], [1, 3]); assert.equal(row('activity').why.length, 3);
  assert.deepEqual([row('briefs').removed, row('briefs').held], [1, 0]);
  assert.deepEqual([row('learning').removed, row('learning').held], [1, 0]);
  assert.deepEqual([row('exports').removed, row('exports').held, row('exports').days], [6, 1, 30]);
  const state = f.store().read();
  assert.deepEqual(state.modelReceipts.map(r => r.id).sort(), ['mr-approval', 'mr-new', 'mr-waiting']);
  assert.ok(state.tombstones.some(t => t.kind === 'retention' && t.digest === 'd'.repeat(64)));
  assert.deepEqual(state.activity.filter(a => a.at === OLD).map(a => a.id).sort(), ['ev-action', 'ev-linked', 'ev-seat']);
  const lane = (state.extensions as any)['reports-tools-trust'];
  assert.deepEqual(Object.keys(lane.reports.briefs), ['owner:now']);
  assert.deepEqual(state.learning.map(l => l.id).filter(id => id.startsWith('learning-')), ['learning-new']);
  for (const gone of [paths.prepared, paths.checklist, paths.plain, paths.report, paths.question, paths.everything]) assert.equal(await exists(gone), false, gone);
  for (const kept of [paths.locked, paths.notes, paths.fresh, paths.link]) assert.equal(await exists(kept), true, kept);
  assert.equal(await readFile(paths.outsideTarget, 'utf8'), 'synthetic');
  assert.deepEqual([lane.reports.pageExports.length, lane.reports.questions.length, lane.reports.exports.map((e: any) => e.id)], [0, 0, ['ex-2']]);
  // The clean-up is recorded by counts, never by content.
  const event = state.activity.filter(a => a.event === 'trust.keep.enforced').at(-1);
  assert.equal(event.details.kinds.length, 5); assert.ok(!JSON.stringify(event).includes('ev-old'));
  // Running again removes nothing more.
  const again = await f.rpc('keep.enforce', {}); assert.equal(again.kinds.reduce((sum: number, r: any) => sum + r.removed, 0), 0);
});

test('keep.enforce takes no fields, is an admin method, and keeps everything when no period is set', async t => {
  const f = await fixture(t);
  assert.equal((await f.call('keep.enforce', { kind: 'activity' })).body.error.code, 'INVALID_KEEP');
  await f.rpc('members.add', { id: 'accountant-1', name: 'Synthetic accountant', role: 'accountant' });
  const accountant: Context = { memberId: 'accountant-1', role: 'accountant', epoch: 1, channel: 'desktop' };
  await assert.rejects(f.engine.requestAs(accountant, 'keep.enforce', {}), (e: any) => e.code === 'FORBIDDEN');
  await f.store().update(state => { state.learning.push({ id: 'learning-old', type: 'note', at: OLD }); });
  const result = await f.rpc('keep.enforce', {});
  assert.ok(result.kinds.every((r: any) => r.days === null && r.removed === 0));
  assert.ok(f.store().read().learning.some(l => l.id === 'learning-old'));
  assert.equal(f.store().read().activity.some(a => a.event === 'trust.keep.enforced'), false);
});

test('the retention clean-up and the daily tick apply the keep periods too', async t => {
  const f = await fixture(t); await seed(f);
  await f.engine.services.trust.cleanup(f.owner);
  let state = f.store().read();
  assert.equal(state.learning.some(l => l.id === 'learning-old'), false); assert.equal(state.modelReceipts.some(r => r.id === 'mr-old'), false);
  assert.ok(state.activity.some(a => a.event === 'trust.keep.enforced'));
  // The tick runs once a day while autonomy is on.
  await f.store().update(s => { s.learning.push({ id: 'learning-old-2', type: 'note', at: OLD }); s.policy.autonomy = true; });
  f.engine.updateJobLifecycle({ awake: true, windowOpen: true, backgroundEnabled: false });
  const first = await f.engine.tick();
  assert.ok(first.some((r: any) => r.module === 'core-data' && r.event === 'trust.keep.enforced'), JSON.stringify(first));
  state = f.store().read(); assert.equal(state.learning.some(l => l.id === 'learning-old-2'), false);
  const second = await f.engine.tick(); assert.equal(second.some((r: any) => r.module === 'core-data'), false);
});
