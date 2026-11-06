import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { ClientCrmView, CompanyView, CrmListRow, CrmListView, CrmMemberView, MemoryChange, MemoryView } from '../../src/engine/types';

/**
 * The fake engine answers the CRM (6G3) and dated memory (6G4) as the engine does: the same request checks, views and
 * words, taken from the engine's own pure files (crm/crm-data.ts, memory/facts-data.ts), and the same codes for the same
 * refusals (platform/tests/venture-crm-w6.test.ts and venture-memory-facts-w6.test.ts hold the engine's side).
 */
const NOW = '2026-11-01T10:00:00.000Z';
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;

describe('fake engine: the CRM (6G3)', () => {
  it('a client edit is a change row with who and when; the evidence follows; an old client reads as added', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const fresh = await ask<ClientCrmView>(engine, 'venture.crm.client', { clientId: 'c-boat' });
    expect(fresh.history.map((row) => row.line)).toEqual(['Added to Clients']);
    await expect(ask(engine, 'venture.crm.client.edit', { clientId: 'c-boat', field: 'taxId', value: 'x' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Choose the name, the email, the phone or the note.' });
    await expect(ask(engine, 'venture.crm.client.edit', { clientId: 'c-nobody', field: 'note', value: 'Hi' })).rejects.toMatchObject({ code: 'CLIENT_NOT_FOUND' });
    await expect(ask(engine, 'venture.crm.client.edit', { clientId: 'c-boat', field: 'email', value: 'partners@boataudio.in' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'That is the email as it is now.' });
    const edited = await ask<ClientCrmView>(engine, 'venture.crm.client.edit', { clientId: 'c-boat', field: 'email', value: 'team@boataudio.in' });
    expect(edited.history[0]).toMatchObject({ field: 'email', label: 'Email', who: 'You', line: 'You changed Email', before: 'partners@boataudio.in', after: 'team@boataudio.in', at: NOW });
    const clients = await ask<{ id: string; email: string | null }[]>(engine, 'venture.client.list');
    expect(clients.find((client) => client.id === 'c-boat')?.email).toBe('team@boataudio.in');
    const evidence = await ask<{ items: { field: string; value: string; applied: boolean }[] }>(engine, 'venture.evidence.list', { subject: 'client:c-boat' });
    expect(evidence.items.filter((item) => item.field === 'email' && item.applied).map((item) => item.value)).toEqual(['team@boataudio.in']);
  });

  it('a company links clients both ways and keeps its history; lists keep their own stages', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(ask(engine, 'venture.crm.company.save', { domain: 'x.example' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Give the company a name.' });
    const made = await ask<CompanyView>(engine, 'venture.crm.company.save', { name: 'Boat Group', domain: 'https://www.Boat.example/x' });
    expect(made.company).toMatchObject({ name: 'Boat Group', domain: 'boat.example', clients: 0, people: 0, note: null });
    await expect(ask(engine, 'venture.crm.company.save', { name: 'boat  group' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Boat Group is kept already.' });
    const linked = await ask<CrmMemberView>(engine, 'venture.crm.link', { companyId: made.company.id, member: 'client:c-boat' });
    expect([linked.company, linked.history[0]?.line, linked.history[0]?.after]).toEqual([{ id: made.company.id, name: 'Boat Group' }, 'You set Company', 'Boat Group']);
    const company = await ask<CompanyView>(engine, 'venture.crm.company', { companyId: made.company.id });
    expect(company.clients).toEqual([{ id: 'c-boat', name: 'Boat Audio' }]);
    expect(company.history.map((row) => row.line)).toEqual(['You added a member', 'Added to Companies']);
    await expect(ask(engine, 'venture.crm.link', { companyId: 'company_nobody', member: 'client:c-boat' })).rejects.toMatchObject({ code: 'COMPANY_NOT_FOUND' });

    await expect(ask(engine, 'venture.crm.list.save', { name: 'Sponsors', stages: ['One'] })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'A list has two to eight stages.' });
    const list = await ask<CrmListView>(engine, 'venture.crm.list.save', { name: 'Sponsors', stages: ['To ask', 'Asked', 'Signed'] });
    const placed = await ask<CrmListView>(engine, 'venture.crm.list.place', { listId: list.list.id, member: 'client:c-boat', stage: 'Asked' });
    expect(placed.groups.map((group) => [group.stage, group.entries.map((entry) => entry.name)])).toEqual([['To ask', []], ['Asked', ['Boat Audio']], ['Signed', []]]);
    await expect(ask(engine, 'venture.crm.list.save', { listId: list.list.id, name: 'Sponsors', stages: ['To ask', 'Signed'] })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Move the one entry out of Asked first.' });
    expect((await ask<CrmListRow[]>(engine, 'venture.crm.lists')).map((row) => [row.name, row.count])).toEqual([['Sponsors', 1]]);
    expect((await ask<ClientCrmView>(engine, 'venture.crm.client', { clientId: 'c-boat' })).lists).toEqual([{ listId: list.list.id, name: 'Sponsors', stage: 'Asked' }]);
  });

  it('the timeline holds what the owner logged, newest first, and never a day after today', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(ask(engine, 'venture.crm.log', { clientId: 'c-boat', kind: 'call', on: '2026-12-01', text: 'Later call.' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Log what already happened, today or before.' });
    await ask(engine, 'venture.crm.log', { clientId: 'c-boat', kind: 'call', on: '2026-10-28', text: 'Talked about episode slots.' });
    const view = await ask<ClientCrmView>(engine, 'venture.crm.log', { clientId: 'c-boat', kind: 'whatsapp', on: '2026-10-30', text: 'Sent the rate card.' });
    const logged = view.timeline.filter((entry) => entry.kind === 'call' || entry.kind === 'whatsapp');
    expect(logged.map((entry) => [entry.kind, entry.line, entry.text])).toEqual([
      ['whatsapp', 'You logged a WhatsApp message', 'Sent the rate card.'],
      ['call', 'You logged a call', 'Talked about episode slots.'],
    ]);
  });
});

describe('fake engine: dated memory (6G4)', () => {
  it('a fact keeps since when, its source and who may see it; replacing keeps the old one; Forget erases every version', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(ask(engine, 'venture.memory.add', { subject: 'business', topic: 'Card', text: 'Pay with 4111 1111 1111 1111' })).rejects.toMatchObject({ code: 'CHAT_KEY_REFUSED' });
    const first = (await ask<MemoryChange>(engine, 'venture.memory.add', { subject: 'business', topic: 'Episode rate', text: 'Rs 12000 an episode.', since: '2026-09-01' })).fact!;
    expect(first).toMatchObject({ since: '2026-09-01', source: 'owner', sourceLine: 'You told Chausar.', visibility: 'ai', visibilityLine: 'Your AI can read this.', current: true });
    await expect(ask(engine, 'venture.memory.add', { subject: 'business', topic: 'episode RATE', text: 'Rs 15000.' })).rejects.toMatchObject({ code: 'FACT_EXISTS', message: 'A fact about Episode rate is kept already. Replace it instead.' });
    const change = await ask<MemoryChange>(engine, 'venture.memory.replace', { factId: first.id, text: 'Rs 15000 an episode.', since: '2026-10-01' });
    expect([change.fact?.replaces, change.replaced?.replacedBy, change.line]).toEqual([first.id, change.fact?.id, 'Replaced. The earlier fact is kept, marked replaced.']);
    await expect(ask(engine, 'venture.memory.replace', { factId: first.id, text: 'Rs 9000.' })).rejects.toMatchObject({ code: 'FACT_REPLACED' });
    const hidden = await ask<MemoryChange>(engine, 'venture.memory.visibility', { factId: change.fact!.id, visibility: 'owner' });
    expect(hidden.fact?.visibilityLine).toBe('Only you see this.');
    const view = await ask<MemoryView>(engine, 'venture.memory.list', { subject: 'business' });
    expect([view.facts.map((fact) => fact.text), view.earlier.map((fact) => fact.text)]).toEqual([['Rs 15000 an episode.'], ['Rs 12000 an episode.']]);
    const gone = await ask<MemoryChange>(engine, 'venture.memory.forget', { factId: change.fact!.id });
    expect(gone.line).toBe('Forgotten: the words of all 2 versions are erased.');
    const after = await ask<MemoryView>(engine, 'venture.memory.list', {});
    expect([after.facts, after.earlier.map((fact) => [fact.erased, fact.text])]).toEqual([[], [[true, 'Erased: you asked Chausar to forget these words.'], [true, 'Erased: you asked Chausar to forget these words.']]]);
  });
});
