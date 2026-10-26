import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import { EngineError, type NetworkImportResult, type NetworkSearchView, type NetworkSourcesView, type PeopleView, type PersonView, type ReceiptLite } from '../../src/engine/types';

/**
 * The fake engine answers the network as the engine's 4D1 to 4D3 do (platform/runtime/venture/network/*): the source
 * cards with the stale line after 60 days, the bands with their count receipt, the person sheet with its tie receipt,
 * the import's Check, import and Undo with the engine's refusals, the search with its refusal of protected traits and
 * "Web search is not set up here." The sample people are this fake's own.
 */
const NOW = '2026-10-23T10:00:00.000Z';
const engineAt = (options: { hosted?: boolean; fresh?: boolean } = {}) => new FakeEngine({ now: () => NOW, ...options });
const ask = <T>(engine: FakeEngine, method: string, params: Record<string, unknown> = {}) => engine.request(method, params) as Promise<T>;
const refused = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error as EngineError; } throw new Error('not refused'); };

const CONNECTIONS = ['Notes:', '"When exporting your connection data, you may notice some missing emails."', '',
  'First Name,Last Name,URL,Email Address,Company,Position,Connected On',
  'Riya,Shetty,https://www.linkedin.com/in/riya-shetty,,Fern Audio,Founder,12 Oct 2026',
  'Tara,Iyer,https://www.linkedin.com/in/tara-iyer-kettle,,Kettle Audio,Brand partnerships lead,1 Mar 2023'].join('\n');

describe('fake engine: the owner\'s network (4D4)', () => {
  it('sources: one card per kind, newest first in the engine\'s order, the stale line past 60 days, and the bands with a receipt', async () => {
    const engine = engineAt();
    const view = await ask<NetworkSourcesView>(engine, 'venture.network.sources');
    expect(view.sources.map((source) => source.kind)).toEqual(['linkedin-connections', 'vcard', 'calendar-ics', 'mail-headers']);
    const vcard = view.sources[1]!;
    expect(vcard.line).toBe('4 people, imported 10 Aug 2026.');
    expect(view.webSearch).toBe('not-set-up');
    expect(vcard.stale).toBe('Imported 2 months ago. Export a new copy to catch new contacts.');
    expect(view.sources[0]!.stale).toBeNull();
    expect(view.bands).toMatchObject({ close: 1, knowWell: 1, know: 2, metOnce: 2, cold: 3 });
    expect(view.bands!.permille).toEqual({ close: 111, knowWell: 111, know: 222, metOnce: 222, cold: 333 });
    const receipt = await ask<ReceiptLite>(engine, 'venture.receipt.get', { id: view.bands!.receiptId });
    expect(receipt.explanation).toContain('1 Close, 1 Know well, 2 Know, 2 Met once, 3 Cold');
  });

  it('a person: fields with their source rows, how you know them with the tie receipt, paths, and merged when two files named them', async () => {
    const engine = engineAt();
    const sana = await ask<PersonView>(engine, 'venture.network.person', { id: 'person_sana' });
    expect(sana.merged).toBe(true);
    expect(sana.fields.map((field) => field.sourceId)).toContain('netimport_vcf:6');
    const nisha = await ask<PersonView>(engine, 'venture.network.person', { id: 'person_nisha' });
    expect(nisha.paths.map((path) => path.confirmed)).toEqual([true, false]);
    const tie = await ask<ReceiptLite>(engine, 'venture.receipt.get', { id: nisha.how[0]!.receiptId! });
    expect(tie.explanation).toContain('How well you know Nisha Rao, worked out by Chausar\'s code');
    expect((await refused(ask(engine, 'venture.network.person', { id: 'person_nobody' }))).code).toBe('INVALID_VENTURE_REQUEST');
  });

  it('import: Check stores nothing, Import keeps the people, the same file again is refused, and Undo takes them out', async () => {
    const engine = engineAt();
    const checked = await ask<NetworkImportResult>(engine, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS, check: true });
    expect(checked.mode).toBe('check');
    if (checked.mode !== 'check') return;
    expect([checked.people, checked.merged, checked.samples.map((sample) => sample.name)]).toEqual([1, 1, ['Riya Shetty', 'Tara Iyer']]);
    expect(checked.line).toBe('Chausar would keep 2 people from Connections.csv: 1 new, 1 already in your network. Nothing is saved until you import.');
    expect((await ask<PeopleView>(engine, 'venture.network.people')).total).toBe(9);
    expect(await ask<PeopleView>(engine, 'venture.network.people', { limit: 0 })).toMatchObject({ people: [], total: 9 });
    const done = await ask<NetworkImportResult>(engine, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS });
    expect(done.mode).toBe('import');
    if (done.mode !== 'import') return;
    expect((await ask<PeopleView>(engine, 'venture.network.people')).total).toBe(10);
    expect((await refused(ask(engine, 'venture.network.import', { kind: 'linkedin-connections', name: 'Connections.csv', text: CONNECTIONS }))).code).toBe('NETWORK_ALREADY_IMPORTED');
    const preview = await ask<{ preview: boolean; line: string }>(engine, 'venture.network.importUndo', { importId: done.import.id, preview: true });
    expect(preview.line).toBe('Undo would remove 1 person this import brought in, and take off what it added to others. Nothing has changed yet.');
    await ask(engine, 'venture.network.importUndo', { importId: done.import.id });
    expect((await ask<PeopleView>(engine, 'venture.network.people')).total).toBe(9);
  });

  it('import refusals: too large with its size, a bad line, mail only through the desktop, and the hosted app', async () => {
    const engine = engineAt();
    const big = await refused(ask(engine, 'venture.network.import', { kind: 'contacts-csv', name: 'big.csv', text: 'x'.repeat(6_500_000) }));
    expect([big.code, big.message]).toEqual(['NETWORK_FILE_TOO_LARGE', 'This file is 6.2 MB; Chausar reads at most 4 MB at once. Export a smaller part and import each one.']);
    const bad = await refused(ask(engine, 'venture.network.import', { kind: 'linkedin-connections', name: 'c.csv', text: 'First Name,Last Name,URL,Email Address,Company,Position,Connected On\nA,B,https://www.linkedin.com/in/ab,,X,Y,' }));
    expect([bad.code, bad.message]).toEqual(['NETWORK_FILE_INVALID', 'Line 2: the Connected On date could not be read. Nothing was imported.']);
    expect((await refused(ask(engine, 'venture.network.import', { kind: 'mail-headers', name: 'm.mbox', text: 'From a@b' }))).code).toBe('NETWORK_FILE_INVALID');
    const hosted = await refused(ask(engineAt({ hosted: true }), 'venture.network.import', { kind: 'vcard', name: 'c.vcf', text: 'BEGIN:VCARD' }));
    expect([hosted.code, hosted.message]).toEqual(['TIER_UNAVAILABLE', 'Import your network in the desktop app. It reads the file on your computer.']);
  });

  it('search: protected traits refused before anything, results with checked quotes, web not set up, Save search', async () => {
    const engine = engineAt();
    expect((await refused(ask(engine, 'venture.network.search', { text: 'founders by religion' }))).code).toBe('NETWORK_TRAIT_PROTECTED');
    const view = await ask<NetworkSearchView>(engine, 'venture.network.search', { text: 'founders in Pune', web: true });
    expect(view.traits.map((trait) => trait.label)).toEqual(['Founder or owner', 'Based in Pune']);
    expect(view.results[0]!.person!.name).toBe('Dev Malhotra');
    expect([view.results[0]!.receiptId, view.results[0]!.linkedin]).toEqual(['tie_person_dev', 'https://www.linkedin.com/in/dev-malhotra-saffron']);
    expect((await ask<PeopleView>(engine, 'venture.network.people')).consent).toBeNull();
    expect(view.results[0]!.why).toBe('Why: Dev\'s role reads "Founder" (LinkedIn connections, Connections.csv, line 47); Dev\'s place reads "Pune" (LinkedIn connections, Connections.csv, line 47).');
    expect([view.web, view.webLine]).toEqual(['not-set-up', 'Web search is not set up here. Only your network was searched.']);
    expect((await ask<{ search: { name: string } }>(engine, 'venture.network.saveSearch', { searchId: view.id, name: 'Pune founders' })).search.name).toBe('Pune founders');
  });

  it('a fresh computer has no network, and the never-contact list still checks', async () => {
    const engine = engineAt();
    expect((await refused(ask(engine, 'workspace.custody.neverContactReset', { confirmation: 'Lumen Studio' }))).code).toBe('NEVER_CONTACT_OK');
    expect((await refused(ask(engine, 'workspace.custody.neverContactReset', { confirmation: 'Lumen' }))).code).toBe('CONFIRMATION_REQUIRED');
    await engine.request('workspace.open', { folder: 'ledgerline' });
    expect(await ask<NetworkSourcesView>(engine, 'venture.network.sources')).toMatchObject({ sources: [], bands: null, webSearch: 'not-set-up' }); // 4E4 adds the mailbox and calendar state
  });
});
