// Leads move forward only (catalogue H8). A lead runs found (new), drafted, contacted, replied, then won or lost. Won and
// lost are terminal; blocked (an opt-out) can come from any stage and is never left. Recording a send on a lead that
// already replied keeps it replied, where it used to drop back to contacted. Every move keeps the evidence it rests on:
// the draft, the send, the reply, the outcome or the opt-out.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type { LeadRecord, LeadView, OutreachDraftView, VentureDeps } from '../runtime/venture/contracts.ts';
import { VENTURE_ERRORS } from '../runtime/venture/contracts.ts';
import {
  createLead, draftOutreach, moveLead, optOut, parseBlocklist, recordSend, verifyLeadEmail, type Lead,
} from '../runtime/venture/customers/leads.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { code, owner, setup } from './venture-views-env.ts';

const at = '2026-10-21T10:00:00.000Z';
const later = '2026-10-21T11:00:00.000Z';
const BUSINESS = { name: 'Lumen Studio', postalAddress: '12 Lake Road, Pune 411001, India' };
const blocklist = parseBlocklist('');
const mx = async () => [{ exchange: 'mx1.bluecafe.example', priority: 10 }];

/** A verified lead with one draft, recorded as sent by the owner: stage contacted. */
async function contactedLead(): Promise<{ lead: Lead; draftId: string }> {
  const found = createLead({ name: 'Asha Rao', company: 'Blue Cafe', email: 'asha@bluecafe.example', sourceUrl: 'https://bluecafe.example/contact' }, { by: 'agent:prospector', at });
  const verified = await verifyLeadEmail(found, { resolver: mx, now: at });
  const { lead: drafted, draft } = draftOutreach(verified, { subject: 'Hello', body: 'Hi Asha', by: 'agent', business: BUSINESS, blocklist, at });
  return { lead: recordSend(drafted, { draftId: draft.id, sentAt: at }, owner, at), draftId: draft.id };
}

test('a lead moves forward through its stages, and every move keeps its evidence', async () => {
  const { lead, draftId } = await contactedLead();
  assert.equal(lead.status, 'contacted');
  assert.deepEqual(lead.moves, [
    { from: 'new', to: 'drafted', at, by: 'agent', evidence: { kind: 'draft', id: draftId } },
    { from: 'drafted', to: 'contacted', at, by: 'owner', evidence: { kind: 'send', id: draftId } },
  ]);
  const replied = moveLead(lead, 'replied', { evidence: { kind: 'reply', id: 'mail-2041' }, by: 'owner', at: later });
  assert.equal(replied.status, 'replied');
  const won = moveLead(replied, 'won', { evidence: { kind: 'outcome', id: 'INV-0007' }, by: 'owner', at: later });
  assert.equal(won.status, 'won');
  assert.deepEqual(won.moves.slice(2), [
    { from: 'contacted', to: 'replied', at: later, by: 'owner', evidence: { kind: 'reply', id: 'mail-2041' } },
    { from: 'replied', to: 'won', at: later, by: 'owner', evidence: { kind: 'outcome', id: 'INV-0007' } },
  ]);
  assert.equal(lead.moves.length, 2, 'a move returns a new lead and leaves the old one as it was');
});

test('recording a send on a lead that already replied keeps it replied', async () => {
  const { lead } = await contactedLead();
  const replied = moveLead(lead, 'replied', { evidence: { kind: 'reply', id: 'mail-2041' }, by: 'owner', at: later });
  const { lead: again, draft } = draftOutreach(replied, { subject: 'Following up', body: 'Thanks for writing back.', by: 'owner', business: BUSINESS, blocklist, at: later });
  assert.equal(again.status, 'replied', 'a new draft does not move a replied lead back');
  const sent = recordSend(again, { draftId: draft.id, sentAt: later }, owner, later);
  assert.equal(sent.status, 'replied');
  assert.equal(sent.sends.length, 2, 'the send itself is still recorded');
  assert.equal(sent.moves.length, replied.moves.length, 'no move is recorded when the stage stays');
});

test('stages never move back; won and lost are terminal; an opt-out blocks from any stage, for good', async () => {
  const { lead } = await contactedLead();
  const move = { evidence: { kind: 'outcome' as const, id: 'note-1' }, by: 'owner', at: later };
  assert.throws(() => moveLead(lead, 'drafted', move), code('LEADS_STAGE_BACKWARD'));
  assert.throws(() => moveLead(lead, 'contacted', move), code('LEADS_STAGE_BACKWARD'));
  assert.throws(() => moveLead(lead, 'new', move), code('LEADS_STAGE_BACKWARD'));
  assert.throws(() => moveLead(lead, 'archived' as never, move), code('INVALID_VENTURE_REQUEST'));

  const lost = moveLead(lead, 'lost', move);
  assert.equal(lost.status, 'lost', 'lost can follow any open stage');
  assert.throws(() => moveLead(lost, 'replied', move), code('LEADS_STAGE_CLOSED'));
  assert.throws(() => moveLead(lost, 'won', move), code('LEADS_STAGE_CLOSED'));
  const won = moveLead(moveLead(lead, 'replied', move), 'won', move);
  assert.throws(() => moveLead(won, 'lost', move), code('LEADS_STAGE_CLOSED'));

  const { draft } = draftOutreach(won, { subject: 'Thank you', body: 'Glad to work together.', by: 'owner', business: BUSINESS, blocklist, at: later });
  const thanked = recordSend({ ...won, drafts: [...won.drafts, draft] }, { draftId: draft.id, sentAt: later }, owner, later);
  assert.equal(thanked.status, 'won', 'a send to a won client stays won');

  const out = optOut(won, blocklist, { by: 'owner', at: later });
  assert.equal(out.lead.status, 'blocked');
  assert.deepEqual(out.lead.moves.at(-1), { from: 'won', to: 'blocked', at: later, by: 'owner', evidence: { kind: 'opt-out', id: 'asha@bluecafe.example' } });
  assert.throws(() => moveLead(out.lead, 'replied', move), code('LEADS_BLOCKED'));
  assert.throws(() => moveLead(out.lead, 'blocked', move), code('LEADS_BLOCKED'));
});

test('a move needs its evidence', async () => {
  const { lead } = await contactedLead();
  for (const evidence of [undefined, null, {}, { kind: 'reply' }, { kind: 'reply', id: '' }, { kind: 'reply', id: 'x'.repeat(201) }, { kind: 'guess', id: 'mail-1' }]) {
    assert.throws(() => moveLead(lead, 'replied', { evidence: evidence as never, by: 'owner', at: later }), code('INVALID_VENTURE_REQUEST'), JSON.stringify(evidence));
  }
  for (const stageCode of ['LEADS_STAGE_BACKWARD', 'LEADS_STAGE_CLOSED']) assert.ok((VENTURE_ERRORS as readonly string[]).includes(stageCode), stageCode);
});

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown, ctx: Context = owner) =>
  ((handlers as Record<string, Handler>)[method])(deps, ctx, payload) as Promise<T>;

test('venture.leads.block moves every lead it covers to blocked, with the block as the evidence, as the screen shows', async () => {
  const env = await setup();
  const deps: VentureDeps = { ...env.deps, mx: async () => [{ exchange: 'mx.example', priority: 10 }] };
  const asha = await call<LeadView>(deps, 'venture.leads.add', { name: 'Asha Rao', email: 'owner@aroma.example', sourceUrl: 'https://directory.example/pune/cafes' });
  const ravi = await call<LeadView>(deps, 'venture.leads.add', { name: 'Ravi', email: 'ravi@other.example', sourceUrl: 'https://directory.example/pune/cafes' });
  await call(deps, 'venture.leads.block', { value: 'aroma.example' });
  const { leads } = await call<{ leads: LeadView[] }>(deps, 'venture.leads.list', {});
  const byId = new Map(leads.map(lead => [lead.id, lead]));
  assert.equal(byId.get(asha.id)!.status, 'blocked');
  assert.deepEqual(byId.get(asha.id)!.moves, [{ from: 'new', to: 'blocked', at: '2026-10-15T10:00:00.000Z', by: 'owner', evidence: { kind: 'opt-out', id: 'aroma.example' } }]);
  assert.equal(byId.get(ravi.id)!.status, 'new', 'a lead the block does not cover keeps its stage');
  await call(deps, 'venture.leads.block', { value: 'aroma.example' });
  const again = await call<{ leads: LeadView[] }>(deps, 'venture.leads.list', {});
  assert.equal(again.leads.find(lead => lead.id === asha.id)!.moves.length, 1, 'blocking again records no second move');
});

test('venture.leads.recordSend keeps a replied lead replied, and a lead stored before stages had moves still reads', async () => {
  const env = await setup();
  const deps: VentureDeps = { ...env.deps, mx: async () => [{ exchange: 'mx.aroma.example', priority: 10 }] };
  const lead = await call<LeadView>(deps, 'venture.leads.add', { name: 'Asha Rao', email: 'owner@aroma.example', sourceUrl: 'https://directory.example/pune/cafes' });
  const { draft } = await call<{ lead: LeadView; draft: OutreachDraftView }>(deps, 'venture.leads.draft',
    { leadId: lead.id, subject: 'Monthly books', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' });
  // A record written before this change: replied, and no moves field at all.
  await ventureAction(env.deps, owner, 'admin', 'seed.replied', tx => {
    const stored = tx.find('venture-lead', lead.id)!;
    const { moves: _moves, ...old } = stored as LeadRecord & { moves?: unknown };
    tx.replace({ ...old, status: 'replied' } as LeadRecord);
  });
  const listed = await call<{ leads: LeadView[] }>(deps, 'venture.leads.list', {});
  assert.deepEqual(listed.leads[0]!.moves, []);
  env.advance(60_000);
  const sent = await call<LeadView>(deps, 'venture.leads.recordSend', { leadId: lead.id, draftId: draft.id, sentAt: '2026-10-15T10:00:30.000Z' });
  assert.equal(sent.status, 'replied');
  assert.equal(sent.sends.length, 1);
  const [stored] = listRecords(env.store.read(), 'venture-lead');
  assert.equal(stored.status, 'replied');
  assert.deepEqual(stored.moves, []);
});
