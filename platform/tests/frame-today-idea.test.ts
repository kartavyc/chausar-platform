import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import type { Context } from '../runtime/contracts.ts';
import { IDEA_RANGES, ideaDraft, type IdeaState } from '../runtime/frame-today/idea.ts';
import { frameTodayModule } from '../runtime/modules/lane-frame-today.ts';
import { IDEA_REFUSALS, isIdeaReply } from '../../app/ui/src/bridge/todayx-contract.ts';

const passphrase = 'Frame today idea synthetic passphrase 2026';
const valid = (value: unknown) => assert.ok(isIdeaReply(value), JSON.stringify(value));
const code = (expected: string) => (error: any) => error?.code === expected;

async function engineWith(t: any, name = 'Synthetic Idea') {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-frame-idea-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  t.after(async () => { await engine.close(); await rm(directory, { recursive: true, force: true }); });
  await engine.request('workspace.create', { name, passphrase, demo: true, pack: 'ecommerce', folder: 'main' });
  return engine;
}
async function memberOf(engine: Engine, role: 'viewer' | 'accountant'): Promise<Context> {
  const member = await engine.request('members.add', { id: `idea-${role}`, name: `Synthetic ${role}`, role, branches: ['*'] });
  return { memberId: member.id, role, epoch: member.epoch, channel: 'desktop' };
}

/** Every run of digits anywhere in the draft's words, collected from text fields only. */
function digitRuns(value: unknown, out: string[] = []): string[] {
  if (Array.isArray(value)) for (const item of value) digitRuns(item, out);
  else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) {
      if (['claimId', 'replaces', 'correctedBy', 'at', 'startedAt'].includes(key)) continue;
      if (typeof item === 'string') out.push(...(item.match(/[0-9०-९]+/g) ?? []));
      else digitRuns(item, out);
    }
  }
  return out;
}

test('an idea: statements become owner-labelled lines in the section the owner picked; unknowns stay blank until told', async t => {
  const engine = await engineWith(t);
  const empty = await engine.request('todayx.idea.get', {});
  valid(empty);
  assert.deepEqual(empty, { state: 'not-started' });
  await assert.rejects(engine.request('todayx.idea.tell', { text: 'Tiffin service', section: 'business' }), code('IDEA_NOT_STARTED'));

  const started = await engine.request('todayx.idea.start', {});
  valid(started);
  assert.equal(started.state, 'drafting');
  assert.deepEqual(started.unknowns.map((u: any) => [u.id, u.state, u.range]), [['price', 'blank', null], ['sale-cost', 'blank', null], ['first-customers', 'blank', null], ['licences', 'blank', null]]);
  // Starting again keeps what is there.
  assert.equal((await engine.request('todayx.idea.start', {})).startedAt, started.startedAt);

  const typed = ['Home-cooked tiffin for office workers in Pune', 'About 40 tiffins a day by month three, maybe', '₹120 per tiffin'];
  await engine.request('todayx.idea.tell', { text: `  ${typed[0]}  `, section: 'business' });
  await engine.request('todayx.idea.tell', { text: typed[1], section: 'plan', guess: true });
  const draft = await engine.request('todayx.idea.tell', { text: typed[2], answers: 'price' });
  valid(draft);
  assert.deepEqual(draft.business.map((l: any) => [l.text, l.label]), [[typed[0], 'told-by-owner']]);
  assert.deepEqual(draft.plan.map((l: any) => [l.text, l.label]), [[typed[1], 'assumption']]);
  assert.deepEqual(draft.sale, []);
  const price = draft.unknowns.find((u: any) => u.id === 'price');
  assert.equal(price.state, 'told');
  assert.deepEqual(price.lines.map((l: any) => [l.text, l.label]), [[typed[2], 'told-by-owner']]);
  assert.deepEqual(draft.unknowns.filter((u: any) => u.state === 'blank').map((u: any) => u.id), ['sale-cost', 'first-customers', 'licences']);
  assert.equal(draft.writtenBy, 'owner-only');
  assert.deepEqual(draft.conversation.map((c: any) => c.text), typed);

  // The owner's own unknown, then wrong fields and an unknown in the wrong part are refused.
  const own = await engine.request('todayx.idea.tell', { text: 'Rent for a kitchen', section: 'unknown' });
  assert.deepEqual(own.unknownsTold.map((l: any) => l.text), ['Rent for a kitchen']);
  await assert.rejects(engine.request('todayx.idea.tell', { text: 'x', section: 'elsewhere' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.idea.tell', { text: 'x', answers: 'price', section: 'plan' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.idea.tell', { text: '   ', section: 'business' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.idea.tell', { text: 'x'.repeat(501), section: 'business' }), code('INVALID_TODAYX_REQUEST'));
  await assert.rejects(engine.request('todayx.idea.tell', { text: 'x', section: 'business', amount: 120 }), code('INVALID_TODAYX_REQUEST'));
  for (const refusal of ['IDEA_NOT_STARTED', 'IDEA_CLAIM_NOT_FOUND', 'IDEA_CLAIM_DECIDED']) assert.ok((IDEA_REFUSALS as readonly string[]).includes(refusal));
});

test('no number appears that the owner did not type, and nothing is computed from what was typed', async t => {
  const engine = await engineWith(t);
  await engine.request('todayx.idea.start', {});
  const typed = ['Sell 3 kinds of pickle', 'do lakh to start', '450 rupees a jar', 'Cost of a jar is ₹1,80', 'First 25 customers from my society'];
  await engine.request('todayx.idea.tell', { text: typed[0], section: 'business' });
  await engine.request('todayx.idea.tell', { text: typed[1], section: 'plan' });
  await engine.request('todayx.idea.tell', { text: typed[2], answers: 'price' });
  await engine.request('todayx.idea.tell', { text: typed[3], answers: 'sale-cost' });
  const draft = await engine.request('todayx.idea.tell', { text: typed[4], answers: 'first-customers' });
  valid(draft);
  const owned = new Set(typed.flatMap(text => text.match(/[0-9०-९]+/g) ?? []));
  const shown = digitRuns(draft);
  assert.ok(shown.length > 0);
  for (const run of shown) assert.ok(owned.has(run), `a number the owner did not type: ${run}`);
  // Every line is the owner's text, unchanged: no margin, no total, no rewritten amount.
  const lines = [...draft.business, ...draft.sale, ...draft.plan, ...draft.unknownsTold, ...draft.unknowns.flatMap((u: any) => u.lines)].map((l: any) => l.text);
  assert.deepEqual(lines.sort(), [...typed].sort());
  assert.equal(JSON.stringify(draft).includes('270'), false);
});

test('ranges carry a source and a date or are absent', async t => {
  // The shipped table holds no range: nothing was checked against an official source in this build.
  assert.deepEqual(IDEA_RANGES, []);
  const engine = await engineWith(t);
  const draft = await engine.request('todayx.idea.start', {});
  assert.ok(draft.unknowns.every((u: any) => u.range === null));

  const idea: IdeaState = { startedAt: '2026-10-14T09:00:00.000Z', startedBy: 'owner', claims: [] };
  const sourced = ideaDraft(idea, [{ unknown: 'licences', low: 'text as printed', high: 'text as printed', unit: 'per year', source: 'Synthetic official schedule', checkedOn: '2026-10-01' }]);
  valid(sourced);
  const licences = (sourced as any).unknowns.find((u: any) => u.id === 'licences');
  assert.deepEqual([licences.state, licences.range.source, licences.range.checkedOn, licences.range.label], ['range', 'Synthetic official schedule', '2026-10-01', 'assumption']);
  // A row without a source or a date is never shown.
  for (const bad of [{ source: '', checkedOn: '2026-10-01' }, { source: 'Somewhere', checkedOn: 'recently' }]) {
    const draftWithout = ideaDraft(idea, [{ unknown: 'price', low: 'a', high: 'b', unit: 'c', ...bad }]) as any;
    assert.equal(draftWithout.unknowns.find((u: any) => u.id === 'price').range, null);
  }
  // A range never sits beside the owner's own answer.
  const told = ideaDraft({ ...idea, claims: [{ id: 'idea_claim_x', at: idea.startedAt, by: 'owner', text: 'My own fee', section: 'plan', answers: 'licences', label: 'told-by-owner', status: 'active', replaces: null, correctedBy: null }] },
    [{ unknown: 'licences', low: 'a', high: 'b', unit: 'c', source: 'Synthetic official schedule', checkedOn: '2026-10-01' }]) as any;
  assert.equal(told.unknowns.find((u: any) => u.id === 'licences').range, null);
  // The validator refuses a range without its source.
  assert.equal(isIdeaReply({ ...sourced, unknowns: (sourced as any).unknowns.map((u: any) => u.range ? { ...u, range: { ...u.range, source: ' ' } } : u) }), false);
});

test('a statement is corrected or withdrawn; the old words are kept in the conversation and leave the draft', async t => {
  const engine = await engineWith(t);
  await engine.request('todayx.idea.start', {});
  const first = await engine.request('todayx.idea.tell', { text: '₹100 a tiffin', answers: 'price' });
  const claimId = first.conversation[0].claimId;
  const corrected = await engine.request('todayx.idea.correct', { claimId, text: '₹130 a tiffin', guess: true });
  valid(corrected);
  const price = corrected.unknowns.find((u: any) => u.id === 'price');
  assert.deepEqual(price.lines.map((l: any) => [l.text, l.label]), [['₹130 a tiffin', 'assumption']]);
  assert.deepEqual(corrected.conversation.map((c: any) => [c.text, c.status]), [['₹100 a tiffin', 'corrected'], ['₹130 a tiffin', 'active']]);
  assert.equal(corrected.conversation[1].replaces, claimId);
  assert.equal(corrected.conversation[0].correctedBy, corrected.conversation[1].claimId);
  await assert.rejects(engine.request('todayx.idea.correct', { claimId, text: 'again' }), code('IDEA_CLAIM_DECIDED'));
  await assert.rejects(engine.request('todayx.idea.correct', { claimId: 'idea_claim_missing', withdraw: true }), code('IDEA_CLAIM_NOT_FOUND'));
  await assert.rejects(engine.request('todayx.idea.correct', { claimId, text: 'x', withdraw: true }), code('INVALID_TODAYX_REQUEST'));

  const withdrawn = await engine.request('todayx.idea.correct', { claimId: corrected.conversation[1].claimId, withdraw: true });
  valid(withdrawn);
  assert.equal(withdrawn.unknowns.find((u: any) => u.id === 'price').state, 'blank');
  assert.deepEqual(withdrawn.conversation.map((c: any) => c.status), ['corrected', 'withdrawn']);
});

test('a viewer reads the idea but tells nothing; an accountant or a phone does not speak for the founder', async t => {
  const engine = await engineWith(t);
  await engine.request('todayx.idea.start', {});
  const told = await engine.request('todayx.idea.tell', { text: 'Tiffins', section: 'business' });
  const viewer = await memberOf(engine, 'viewer');
  await assert.rejects(engine.requestAs(viewer, 'todayx.idea.start', {}), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(viewer, 'todayx.idea.tell', { text: 'x', section: 'business' }), code('FORBIDDEN'));
  await assert.rejects(engine.requestAs(viewer, 'todayx.idea.correct', { claimId: told.conversation[0].claimId, withdraw: true }), code('FORBIDDEN'));
  valid(await engine.requestAs(viewer, 'todayx.idea.get', {}));
  const accountant = await memberOf(engine, 'accountant');
  await assert.rejects(engine.requestAs(accountant, 'todayx.idea.tell', { text: 'x', section: 'business' }), code('IDEA_FOUNDER_ONLY'));
  const owner = (await engine.request('ui.context', {})).member;
  await assert.rejects(engine.requestAs({ memberId: owner.id, role: 'owner', epoch: owner.epoch, channel: 'mcp' }, 'todayx.idea.tell', { text: 'x', section: 'business' }), code('IDEA_APP_ONLY'));
  assert.equal((await engine.request('todayx.idea.get', {})).conversation.length, 1);
});

test('purge: the idea is owner text, untouched by a source purge, and deleted with the workspace', async t => {
  const engine = await engineWith(t, 'Synthetic Idea Purge');
  await engine.request('todayx.idea.start', {});
  await engine.request('todayx.idea.tell', { text: 'Tiffins for offices', section: 'business' });
  const sources = await engine.request('sources.list', {});
  assert.ok(Array.isArray(sources) && sources.length > 0);
  await engine.request('sources.delete', { id: sources[0].id });
  assert.deepEqual((await engine.request('todayx.idea.get', {})).business.map((l: any) => l.text), ['Tiffins for offices']);
  // The module's purge derives nothing from sources, so it removes nothing.
  const state: any = { modules: { 'frame-today': { idea: { startedAt: '2026-10-14T09:00:00.000Z', startedBy: 'o', claims: [] } } } };
  assert.equal(frameTodayModule.purge!(state, { sourceIds: ['any'], removedIds: new Set(['any']), at: '2026-10-14T09:00:00.000Z' }), 0);

  await engine.request('workspace.delete', { confirmation: 'Synthetic Idea Purge' });
  await assert.rejects(engine.request('todayx.idea.get', {}));
  await engine.request('workspace.create', { name: 'Synthetic Idea Again', passphrase, demo: true, pack: 'ecommerce', folder: 'main' });
  assert.deepEqual(await engine.request('todayx.idea.get', {}), { state: 'not-started' });
});
