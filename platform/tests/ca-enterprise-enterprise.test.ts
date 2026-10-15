import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../runtime/engine.ts';
import { createLocalServer } from '../runtime/server.ts';
import type { Context } from '../runtime/contracts.ts';
import { laneState } from '../runtime/ca-enterprise/state.ts';
import { GRANTABLE } from '../runtime/ca-enterprise/enterprise.ts';

// Synthetic people and companies only.
const code = (name: string) => (e: any) => { assert.equal(e.code, name, e.message); return true; };

async function fixture(t: any, on = true) {
  const directory = await mkdtemp(join(tmpdir(), 'chausar-ca-enterprise-'));
  const engine = new Engine({ directory, demo: true, storage: 'experimental-file' });
  const app = createLocalServer(engine); const { origin, token } = await app.listen();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  async function rpc(method: string, payload: any = {}) {
    const response = await fetch(`${origin}/api/rpc`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ method, payload }) });
    const body = await response.json() as any; assert.equal(response.status, 200, `${method}: ${JSON.stringify(body.error)}`); return body.result;
  }
  await rpc('workspace.create', { name: 'Synthetic group', passphrase: 'Synthetic-enterprise-fixture', demo: false });
  const owner: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'desktop' };
  async function member(name: string, role: string, branches?: string[]): Promise<Context> {
    const invite = await rpc('auth.invite', { name, role, ...(branches ? { branches } : {}) }); const accepted = await rpc('auth.accept', { token: invite.token });
    return { ...accepted.context, channel: 'desktop' };
  }
  const as = (ctx: Context, method: string, payload: any = {}) => engine.requestAs(ctx, method, payload);
  if (on) await as(owner, 'enterprise.setup', { on: true });
  return { engine, store: engine.vault!, rpc, member, as, owner };
}

test('the shell is desktop until enterprise is set up, and a CA firm keeps its shell', async t => {
  const f = await fixture(t, false);
  assert.deepEqual(await f.as(f.owner, 'caent.shell'), { kind: 'desktop', administers: false, allowed: null, views: null, home: null });
  await assert.rejects(f.as(f.owner, 'enterprise.lens.get'), code('ENTERPRISE_NOT_ON'));
  await assert.rejects(f.as(f.owner, 'enterprise.holds.list'), code('ENTERPRISE_NOT_ON'));
  await assert.rejects(f.as(f.owner, 'company.overview'), code('ENTERPRISE_NOT_ON'));
  await assert.rejects(f.as(f.owner, 'enterprise.setup', { on: 'yes' }), code('ENTERPRISE_SETUP_INVALID'));
  const viewer = await f.member('Synthetic Viewer', 'viewer');
  await assert.rejects(f.as(viewer, 'enterprise.setup', { on: true }), code('FORBIDDEN'));
  assert.deepEqual(await f.as(f.owner, 'enterprise.setup', { on: true }), { kind: 'enterprise' });
  const shell = await f.as(f.owner, 'caent.shell');
  assert.deepEqual(shell, { kind: 'enterprise', administers: true, allowed: null, views: ['guided', 'books'], home: null });
  assert.deepEqual(await f.as(viewer, 'caent.shell'), { kind: 'enterprise', administers: false, allowed: null, views: ['simple', 'guided', 'books'], home: null });
  assert.equal(laneState(f.store.read()).shell?.by, 'owner');
  assert.deepEqual(await f.as(f.owner, 'enterprise.setup', { on: false }), { kind: 'desktop' });
  await assert.rejects(f.as(f.owner, 'enterprise.lens.get'), code('ENTERPRISE_NOT_ON'));
  await f.store.update(state => { laneState(state).shell = { kind: 'ca-firm', by: 'owner', at: new Date().toISOString() }; });
  assert.deepEqual(await f.as(f.owner, 'caent.shell'), { kind: 'ca-firm', administers: false, allowed: null, views: null, home: { place: 'clients' } });
  await assert.rejects(f.as(f.owner, 'enterprise.setup', { on: false }), code('ENTERPRISE_SHELL_TAKEN'));
  await assert.rejects(f.as(f.owner, 'enterprise.setup', { on: true }), code('ENTERPRISE_SHELL_TAKEN'));
});

test('personas give a home and a default grant list; own grants win; grants are validated', async t => {
  const f = await fixture(t);
  const ops = await f.member('Synthetic Payables', 'accountant');
  await f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, persona: 'operator' });
  let shell = await f.as(ops, 'caent.shell');
  assert.deepEqual(shell.home, { place: 'today' }); assert.equal(shell.administers, false); assert.deepEqual(shell.views, ['guided', 'books']);
  assert.ok(shell.allowed.includes('work.cases') && !shell.allowed.includes('trust.access') && shell.allowed.every((g: string) => GRANTABLE.includes(g)));
  await f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, grants: ['today.today', 'work.approvals'] });
  shell = await f.as(ops, 'caent.shell'); assert.deepEqual(shell.allowed, ['today.today', 'work.approvals']);
  await f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, persona: 'auditor', grants: null });
  shell = await f.as(ops, 'caent.shell'); assert.deepEqual(shell.home, { place: 'trust', sub: 'record' }); assert.ok(shell.allowed.includes('trust.record'));
  // A developer who does not administer has no Company to land on.
  await f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, persona: 'developer' });
  assert.equal((await f.as(ops, 'caent.shell')).home, null);
  await f.as(f.owner, 'enterprise.access.set', { memberId: 'owner', persona: 'developer' });
  assert.deepEqual((await f.as(f.owner, 'caent.shell')).home, { place: 'company', sub: 'build' });
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, grants: ['today.today', 'books.customers'] }), code('ENTERPRISE_GRANT_UNKNOWN'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, grants: ['today.today', 'today.today'] }), code('ENTERPRISE_GRANT_UNKNOWN'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, persona: 'boss' }), code('ENTERPRISE_PERSONA_INVALID'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: 'nobody' }), code('ENTERPRISE_MEMBER_UNKNOWN'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: ops.memberId, extra: 1 }), code('ENTERPRISE_INVALID_FIELDS'));
  const list = await f.as(f.owner, 'enterprise.access.list');
  assert.deepEqual(list.personas, ['leader', 'operator', 'specialist', 'administrator', 'auditor', 'developer']);
  assert.deepEqual(list.grantable, [...GRANTABLE]);
  const row = list.people.find((p: any) => p.memberId === ops.memberId);
  assert.deepEqual(row, { memberId: ops.memberId, name: 'Synthetic Payables', role: 'accountant', branches: ['*'], persona: 'developer', grants: null, administers: false, active: true });
});

test('administrators: owners by default, at least one kept, only owners or cofounders', async t => {
  const f = await fixture(t);
  const acc = await f.member('Synthetic Accountant', 'accountant'); const co = await f.member('Synthetic Cofounder', 'cofounder');
  assert.equal((await f.as(co, 'caent.shell')).administers, false);
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: 'owner', administers: false }), code('ENTERPRISE_LAST_ADMINISTRATOR'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.set', { memberId: acc.memberId, administers: true }), code('ENTERPRISE_ADMINISTERS_ROLE'));
  assert.equal((await f.as(f.owner, 'enterprise.access.set', { memberId: co.memberId, administers: true })).administers, true);
  assert.equal((await f.as(f.owner, 'enterprise.access.set', { memberId: 'owner', administers: false })).administers, false);
  assert.equal((await f.as(f.owner, 'caent.shell')).administers, false); assert.equal((await f.as(co, 'caent.shell')).administers, true);
  await assert.rejects(f.as(co, 'enterprise.access.set', { memberId: co.memberId, administers: false }), code('ENTERPRISE_LAST_ADMINISTRATOR'));
});

test('viewers and accountants are refused the admin methods', async t => {
  const f = await fixture(t);
  const viewer = await f.member('Synthetic Viewer', 'viewer'); const acc = await f.member('Synthetic Accountant', 'accountant');
  const admin: [string, any][] = [['enterprise.group.set', { companies: [] }], ['enterprise.teams.set', { teams: [] }], ['enterprise.access.list', {}], ['enterprise.access.set', { memberId: 'owner' }],
    ['enterprise.access.review.start', {}], ['enterprise.access.reviews', {}], ['enterprise.channels.set', { id: 'mail', may: [], as: 'company' }], ['enterprise.holds.list', {}], ['enterprise.holds.place', {}],
    ['company.overview', {}], ['enterprise.setup', { on: true }]];
  for (const ctx of [viewer, acc]) for (const [method, payload] of admin) await assert.rejects(f.as(ctx, method, payload), code('FORBIDDEN'), method);
  // Reads work for a viewer.
  assert.deepEqual(await f.as(viewer, 'enterprise.lens.get'), { lens: 'whole-group', lenses: ['whole-group', 'finance', 'sales', 'operations'] });
  assert.equal((await f.as(viewer, 'enterprise.channels.get')).channels.length, 4);
});

test('lens is kept per person', async t => {
  const f = await fixture(t); const viewer = await f.member('Synthetic Viewer', 'viewer');
  assert.deepEqual(await f.as(f.owner, 'enterprise.lens.set', { lens: 'finance' }), { lens: 'finance', lenses: ['whole-group', 'finance', 'sales', 'operations'] });
  assert.equal((await f.as(f.owner, 'enterprise.lens.get')).lens, 'finance');
  assert.equal((await f.as(viewer, 'enterprise.lens.get')).lens, 'whole-group');
  assert.equal((await f.as(viewer, 'enterprise.lens.set', { lens: 'sales' })).lens, 'sales');
  await assert.rejects(f.as(viewer, 'enterprise.lens.set', { lens: 'marketing' }), code('ENTERPRISE_LENS_INVALID'));
});

test('group companies are seen only within a member\'s branches; the choice stays in scope', async t => {
  const f = await fixture(t);
  const north = await f.member('Synthetic North Lead', 'accountant', ['north']);
  const group = await f.as(f.owner, 'enterprise.group.set', { companies: [{ id: 'north', name: 'Synthetic North Pvt Ltd' }, { id: 'south', name: 'Synthetic South LLP' }] });
  assert.deepEqual(group, { companies: [{ id: 'north', name: 'Synthetic North Pvt Ltd' }, { id: 'south', name: 'Synthetic South LLP' }], chosen: 'all', combined: { eliminations: 'not-built' } });
  assert.deepEqual(await f.as(north, 'enterprise.companies'), { companies: [{ id: 'north', name: 'Synthetic North Pvt Ltd' }], chosen: 'all', combined: { eliminations: 'not-built' } });
  await assert.rejects(f.as(north, 'enterprise.company.set', { id: 'south' }), code('ENTERPRISE_COMPANY_FORBIDDEN'));
  await assert.rejects(f.as(north, 'enterprise.company.set', { id: 'west' }), code('ENTERPRISE_COMPANY_FORBIDDEN'));
  assert.equal((await f.as(north, 'enterprise.company.set', { id: 'north' })).chosen, 'north');
  assert.equal((await f.as(f.owner, 'enterprise.company.set', { id: 'south' })).chosen, 'south');
  assert.equal((await f.as(f.owner, 'enterprise.companies')).chosen, 'south');
  assert.equal((await f.as(f.owner, 'enterprise.company.set', { id: 'all' })).chosen, 'all');
  // A company dropped from the group falls back to all.
  await f.as(f.owner, 'enterprise.group.set', { companies: [{ id: 'south', name: 'Synthetic South LLP' }] });
  assert.deepEqual(await f.as(north, 'enterprise.companies'), { companies: [], chosen: 'all', combined: { eliminations: 'not-built' } });
  for (const companies of [[{ id: 'bad id', name: 'x' }], [{ id: 'a', name: '' }], [{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }], Array.from({ length: 51 }, (_, i) => ({ id: `c${i}`, name: 'C' })), [{ id: 'a', name: 'A', gstin: 'x' }]])
    await assert.rejects(f.as(f.owner, 'enterprise.group.set', { companies }), code('ENTERPRISE_GROUP_INVALID'));
});

test('whose is kept per list; team members are the union of a person\'s teams', async t => {
  const f = await fixture(t);
  const a = await f.member('Synthetic A', 'accountant'); const b = await f.member('Synthetic B', 'viewer'); const c = await f.member('Synthetic C', 'viewer');
  assert.deepEqual(await f.as(a, 'enterprise.whose.get', { list: 'work.approvals' }), { list: 'work.approvals', whose: 'everyone' });
  assert.deepEqual(await f.as(a, 'enterprise.whose.set', { list: 'work.approvals', whose: 'mine' }), { list: 'work.approvals', whose: 'mine' });
  assert.equal((await f.as(a, 'enterprise.whose.get', { list: 'work.approvals' })).whose, 'mine');
  assert.equal((await f.as(b, 'enterprise.whose.get', { list: 'work.approvals' })).whose, 'everyone');
  await assert.rejects(f.as(a, 'enterprise.whose.set', { list: 'Work Approvals', whose: 'mine' }), code('ENTERPRISE_WHOSE_INVALID'));
  await assert.rejects(f.as(a, 'enterprise.whose.set', { list: 'work', whose: 'ours' }), code('ENTERPRISE_WHOSE_INVALID'));
  const teams = await f.as(f.owner, 'enterprise.teams.set', { teams: [{ id: 'payables', name: 'Accounts Payable', memberIds: [a.memberId, b.memberId] }, { name: 'Close', memberIds: [a.memberId, c.memberId] }] });
  assert.equal(teams.teams.length, 2); assert.equal(teams.teams[0].id, 'payables'); assert.match(teams.teams[1].id, /^team_/);
  assert.deepEqual(await f.as(b, 'enterprise.teams.list'), teams);
  assert.deepEqual(await f.as(a, 'enterprise.whose.members', { whose: 'team' }), { whose: 'team', memberIds: [a.memberId, b.memberId, c.memberId] });
  assert.deepEqual(await f.as(b, 'enterprise.whose.members', { whose: 'team' }), { whose: 'team', memberIds: [b.memberId, a.memberId] });
  assert.deepEqual(await f.as(f.owner, 'enterprise.whose.members', { whose: 'team' }), { whose: 'team', memberIds: ['owner'] });
  assert.deepEqual(await f.as(b, 'enterprise.whose.members', { whose: 'mine' }), { whose: 'mine', memberIds: [b.memberId] });
  assert.deepEqual(await f.as(b, 'enterprise.whose.members', { whose: 'everyone' }), { whose: 'everyone', memberIds: null });
  await assert.rejects(f.as(f.owner, 'enterprise.teams.set', { teams: [{ name: 'Ghosts', memberIds: ['member_none'] }] }), code('ENTERPRISE_TEAM_MEMBER_UNKNOWN'));
  await assert.rejects(f.as(f.owner, 'enterprise.teams.set', { teams: [{ name: '', memberIds: [] }] }), code('ENTERPRISE_TEAMS_INVALID'));
  await assert.rejects(f.as(f.owner, 'enterprise.teams.set', { teams: [{ id: 't', name: 'A', memberIds: [] }, { id: 't', name: 'B', memberIds: [] }] }), code('ENTERPRISE_TEAMS_INVALID'));
});

test('an access review keeps or removes each person; removing goes through trustx.removeSeat', async t => {
  const f = await fixture(t);
  const a = await f.member('Synthetic Keep', 'accountant'); const b = await f.member('Synthetic Leaver', 'viewer');
  const review = await f.as(f.owner, 'enterprise.access.review.start');
  assert.equal(review.closedAt, null); assert.deepEqual(review.rows.map((r: any) => r.memberId), ['owner', a.memberId, b.memberId]);
  assert.deepEqual(review.rows[1], { memberId: a.memberId, name: 'Synthetic Keep', role: 'accountant', decision: null, decidedBy: null });
  await assert.rejects(f.as(f.owner, 'enterprise.access.review.start'), code('ENTERPRISE_REVIEW_OPEN'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: 'owner', keep: true }), code('ENTERPRISE_REVIEW_SELF'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.review.decide', { reviewId: 'review_none', memberId: a.memberId, keep: true }), code('ENTERPRISE_REVIEW_UNKNOWN'));
  await assert.rejects(f.as(f.owner, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: 'member_none', keep: true }), code('ENTERPRISE_REVIEW_MEMBER_UNKNOWN'));
  let r = await f.as(f.owner, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: a.memberId, keep: true });
  assert.equal(r.rows[1].decision, 'keep'); assert.equal(r.rows[1].decidedBy, 'owner');
  await assert.rejects(f.as(f.owner, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: a.memberId, keep: false }), code('ENTERPRISE_REVIEW_DECIDED'));
  r = await f.as(f.owner, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: b.memberId, keep: false });
  assert.equal(r.rows[2].decision, 'remove');
  // trustx applied the removal (removing a seat needs no second person): the seat is gone and its audit is written by trustx.
  const state = f.store.read();
  assert.equal(state.members.find(m => m.id === b.memberId)!.active, false);
  assert.ok(state.activity.some(e => e.event === 'trustx.seat.removed' && e.details.memberId === b.memberId));
  await assert.rejects(f.as(b, 'caent.shell'), code('ACCESS_REVOKED'));
  assert.equal(r.closedAt, null); // the owner's own row waits for someone else
  const co = await f.member('Synthetic Cofounder', 'cofounder');
  r = await f.as(co, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: 'owner', keep: true });
  assert.ok(r.closedAt);
  await assert.rejects(f.as(co, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: a.memberId, keep: true }), code('ENTERPRISE_REVIEW_CLOSED'));
  const all = await f.as(f.owner, 'enterprise.access.reviews'); assert.equal(all.reviews.length, 1); assert.equal(all.reviews[0].reviewId, review.reviewId);
  const next = await f.as(co, 'enterprise.access.review.start'); assert.equal(next.rows.length, 3); // the leaver is no longer active
  assert.equal((await f.as(f.owner, 'enterprise.access.reviews')).reviews[0].reviewId, next.reviewId);
});

test('a removal trustx refuses leaves the row undecided', async t => {
  const f = await fixture(t);
  const co = await f.member('Synthetic Cofounder', 'cofounder');
  const review = await f.as(co, 'enterprise.access.review.start');
  // The only owner cannot be removed (trustx LAST_OWNER); the row stays open.
  await assert.rejects(f.as(co, 'enterprise.access.review.decide', { reviewId: review.reviewId, memberId: 'owner', keep: false }), code('LAST_OWNER'));
  assert.equal((await f.as(co, 'enterprise.access.reviews')).reviews[0].rows[0].decision, null);
});

test('channels default to nothing allowed, as the company; holds are not enforced', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.as(f.owner, 'enterprise.channels.get'), { channels: ['whatsapp', 'telegram', 'mail', 'phone'].map(id => ({ id, may: [], as: 'company' })) });
  const set = await f.as(f.owner, 'enterprise.channels.set', { id: 'whatsapp', may: ['approval-link', 'brief'], as: 'person' });
  assert.deepEqual(set.channels[0], { id: 'whatsapp', may: ['brief', 'approval-link'], as: 'person' });
  for (const bad of [{ id: 'sms', may: [], as: 'company' }, { id: 'mail', may: ['money'], as: 'company' }, { id: 'mail', may: [], as: 'bot' }, { id: 'mail', may: ['brief', 'brief'], as: 'company' }])
    await assert.rejects(f.as(f.owner, 'enterprise.channels.set', bad), code('ENTERPRISE_CHANNEL_INVALID'));
  assert.deepEqual(await f.as(f.owner, 'enterprise.holds.list'), { holds: [], enforced: false });
  await assert.rejects(f.as(f.owner, 'enterprise.holds.place', { what: 'synthetic' }), code('ENTERPRISE_HOLDS_NOT_ENFORCED'));
});
