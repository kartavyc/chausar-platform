// The customer engine's lead rules as engine methods (venture.leads.add, .list, .draft, .recordSend). A lead needs the
// page it was found on; an email counts only after a mail server check; the blocklist comes before any draft; every
// draft carries the business postal address and an unsubscribe line; agents only draft and the owner records each send.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import { APP_ONLY_METHODS, METHOD_OWNERS, VENTURE_METHODS } from '../runtime/venture/contracts.ts';
import type { LeadView, OutreachDraftView, VentureDeps } from '../runtime/venture/contracts.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import { handlers } from '../runtime/venture/build/index.ts';
import { code, owner, phone, setup, type Env } from './venture-views-env.ts';

const agent: Context = { memberId: 'owner', role: 'owner', epoch: 1, channel: 'mcp' };
type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
const call = <T>(deps: VentureDeps, method: string, payload: unknown, ctx: Context = owner) =>
  ((handlers as Record<string, Handler>)[method])(deps, ctx, payload) as Promise<T>;
const SOURCE = 'https://directory.example/pune/cafes';

/** A mail server check that answers from a table: aroma.example has a server, nomail.example accepts none. */
function withMx(env: Env): { deps: VentureDeps; asked: string[] } {
  const asked: string[] = [];
  const deps: VentureDeps = {
    ...env.deps,
    mx: async domain => {
      asked.push(domain);
      if (domain === 'aroma.example') return [{ exchange: 'mx.aroma.example', priority: 10 }];
      if (domain === 'nomail.example') return [{ exchange: '.', priority: 0 }];
      throw Object.assign(new Error('not found'), { code: 'ENOTFOUND' });
    },
  };
  return { deps, asked };
}

test('the lead methods belong to the build package; only recording a send needs the app', () => {
  for (const method of ['venture.leads.add', 'venture.leads.list', 'venture.leads.draft', 'venture.leads.recordSend'] as const) {
    assert.ok((VENTURE_METHODS as readonly string[]).includes(method), method);
    assert.equal(METHOD_OWNERS[method], 'build');
    assert.equal(typeof (handlers as Record<string, unknown>)[method], 'function', method);
  }
  assert.deepEqual(['venture.leads.add', 'venture.leads.list', 'venture.leads.draft', 'venture.leads.recordSend'].filter(method => APP_ONLY_METHODS.includes(method as any)), ['venture.leads.recordSend']);
});

test('venture.leads.add: a source page is required, and the email is checked for a mail server', async () => {
  const env = await setup();
  const { deps, asked } = withMx(env);
  await assert.rejects(call(deps, 'venture.leads.add', { name: 'Cafe Aroma', email: 'owner@aroma.example' }), code('INVALID_VENTURE_REQUEST'));
  await assert.rejects(call(deps, 'venture.leads.add', { name: 'Cafe Aroma', sourceUrl: 'not a page' }), code('LEADS_SOURCE_REQUIRED'));

  const lead = await call<LeadView>(deps, 'venture.leads.add', { name: 'Asha Rao', company: 'Cafe Aroma', email: 'Owner@Aroma.example', sourceUrl: SOURCE }, agent);
  assert.match(lead.id, /^lead_/);
  assert.deepEqual([lead.email, lead.sourceUrl, lead.status, lead.addedBy], ['owner@aroma.example', SOURCE, 'new', 'owner']);
  assert.deepEqual(lead.emailCheck, { status: 'verified', at: '2026-10-15T10:00:00.000Z', line: 'Mail servers found for aroma.example.' });
  const none = await call<LeadView>(deps, 'venture.leads.add', { name: 'Ravi', email: 'ravi@nomail.example', sourceUrl: SOURCE });
  assert.equal(none.emailCheck.status, 'failed');
  assert.match(none.emailCheck.line, /accepts no email/);
  const noEmail = await call<LeadView>(deps, 'venture.leads.add', { name: 'Meera', sourceUrl: SOURCE });
  assert.deepEqual(noEmail.emailCheck, { status: 'unverified', at: null, line: 'No email yet.' });
  assert.deepEqual(asked, ['aroma.example', 'nomail.example']);

  const listed = await call<{ leads: LeadView[] }>(deps, 'venture.leads.list', {});
  assert.deepEqual(listed.leads.map(item => item.name), ['Meera', 'Ravi', 'Asha Rao'], 'newest first');
  assert.equal(listRecords(env.store.read(), 'venture-lead').length, 3);
});

test('venture.leads.draft: blocklist first, a verified email, the postal address only from the owner, then a draft that sends nothing', async () => {
  const env = await setup();
  const { deps } = withMx(env);
  const lead = await call<LeadView>(deps, 'venture.leads.add', { name: 'Asha Rao', company: 'Cafe Aroma', email: 'owner@aroma.example', sourceUrl: SOURCE });
  const unverified = await call<LeadView>(deps, 'venture.leads.add', { name: 'Ravi', email: 'ravi@nomail.example', sourceUrl: SOURCE });
  const draft = { leadId: lead.id, subject: 'Monthly books for Cafe Aroma', body: 'We close cafe books every month and you check them.' };

  await assert.rejects(call(deps, 'venture.leads.draft', draft, agent), code('LEADS_ADDRESS_MISSING'));
  await assert.rejects(call(deps, 'venture.leads.draft', { ...draft, postalAddress: '12 FC Road, Pune 411004' }, agent), code('APP_APPROVAL_REQUIRED'),
    'an agent never sets the business postal address');
  await assert.rejects(call(deps, 'venture.leads.draft', { ...draft, leadId: unverified.id, postalAddress: '12 FC Road, Pune 411004' }), code('LEADS_EMAIL_UNVERIFIED'));
  assert.equal(listRecords(env.store.read(), 'venture-lead-settings').length, 0, 'a refused draft keeps nothing');

  const made = await call<{ lead: LeadView; draft: OutreachDraftView }>(deps, 'venture.leads.draft', { ...draft, postalAddress: '12 FC Road, Pune 411004' });
  assert.equal(made.draft.by, 'owner');
  assert.equal(made.draft.to, 'owner@aroma.example');
  assert.match(made.draft.text, /--\nLedger Cafe Books\n12 FC Road, Pune 411004\nTo stop these emails, reply with the word unsubscribe/);
  assert.equal(made.lead.status, 'drafted');
  const [settings] = listRecords(env.store.read(), 'venture-lead-settings');
  assert.equal(settings.postalAddress, '12 FC Road, Pune 411004');

  // The stored address serves the agent's next draft.
  const second = await call<{ lead: LeadView; draft: OutreachDraftView }>(deps, 'venture.leads.draft', { ...draft, subject: 'A second note' }, agent);
  assert.equal(second.draft.by, 'agent');
  assert.equal(second.lead.drafts.length, 2);

  // On the blocklist: refused before anything else.
  await ventureAction(env.deps, owner, 'admin', 'seed.block', tx => {
    const [current] = tx.list('venture-lead-settings');
    tx.replace({ ...current, blockedDomains: ['aroma.example'] });
  });
  await assert.rejects(call(deps, 'venture.leads.draft', draft, agent), code('LEADS_BLOCKED'));
  await assert.rejects(call(deps, 'venture.leads.draft', { leadId: 'lead_missing', subject: 'x', body: 'y' }), code('LEADS_NOT_FOUND'));
});

test('venture.leads.recordSend: the owner records a send they made themselves; Chausar never sends', async () => {
  const env = await setup();
  const { deps } = withMx(env);
  const lead = await call<LeadView>(deps, 'venture.leads.add', { name: 'Asha Rao', email: 'owner@aroma.example', sourceUrl: SOURCE });
  const { draft } = await call<{ lead: LeadView; draft: OutreachDraftView }>(deps, 'venture.leads.draft',
    { leadId: lead.id, subject: 'Monthly books', body: 'A short note.', postalAddress: '12 FC Road, Pune 411004' });
  env.advance(60_000);
  const send = { leadId: lead.id, draftId: draft.id, sentAt: '2026-10-15T10:00:30.000Z' };
  await assert.rejects(call(deps, 'venture.leads.recordSend', send, phone), code('APP_APPROVAL_REQUIRED'));
  await assert.rejects(call(deps, 'venture.leads.recordSend', { ...send, sentAt: '2026-10-16T10:00:00.000Z' }), code('INVALID_VENTURE_REQUEST'));
  const contacted = await call<LeadView>(deps, 'venture.leads.recordSend', send);
  assert.equal(contacted.status, 'contacted');
  assert.deepEqual(contacted.sends, [{ draftId: draft.id, sentAt: '2026-10-15T10:00:30.000Z', recordedBy: 'owner', recordedAt: '2026-10-15T10:01:00.000Z', channel: 'own-mailbox' }]);
  const [stored] = listRecords(env.store.read(), 'venture-lead');
  assert.equal(stored.status, 'contacted');
});
