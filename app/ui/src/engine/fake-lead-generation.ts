/** Lead-generation fake source desk. Protocol matches the real desk; sample research stays in memory. */
import { EngineError, type LeadView, type PersonView, type PeopleView, type FollowupView, type NetworkImportResult, type OfferIntakeLite } from './types';
import type { FakePlaybookDesk } from './fake-playbooks';
import type { W4DeskHost } from './fake-w4';
import metadata from './fixtures-lead-generation.json';
import { communityReport, CommunityError, type CommunityInput } from '../../../../platform/runtime/venture/playbooks/lead-generation/community-core';
export const LEADGEN_INTAKE_FIELDS = metadata.intakeFields as NonNullable<OfferIntakeLite['kit']>;
export const LEADGEN_OFFERS = metadata.offers;
export const LEADGEN_REGISTRATION = metadata.registration;
export const LEADGEN_ROLES = metadata.roles;
export type LeadDeskRow = { id: string; type: 'lead' | 'followup' | 'community'; name: string; email: string | null; sourceUrl: string | null; licence: string; status: string; due: string | null; draft: string | null };
const need = (ok: unknown, code: string, message: string): void => { if (!ok) throw new EngineError(code, message); };
function exact(value: unknown, allowed: string[], required: string[] = []): Record<string, unknown> {
  need(value !== null && typeof value === 'object' && !Array.isArray(value), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  const p = value as Record<string, unknown>;
  need(Object.keys(p).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(p, key)), 'INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  return p;
}
const text = (value: unknown, label: string, min: number, max: number): string => { need(typeof value === 'string' && value.trim().length >= min && value.trim().length <= max && !/[\x00-\x1f\x7f]/.test(value.trim()), 'INVALID_VENTURE_REQUEST', `${label} must be one line of text.`); return (value as string).trim(); };
/** Browser fake for the source desk, reusing the existing network, leads and pipeline fakes. */
export function fakeLeadGenerationDesk(host: W4DeskHost): FakePlaybookDesk {
  let sequence = 0;
  const paid = new Set<string>();
  const communitySources = new Map<string, { business: string; input: CommunityInput; report: ReturnType<typeof communityReport> }>();
  const states = new Map<string, { id: string; person: boolean; licence: string; sourceUrl: string | null }[]>();
  const current = () => { if (!states.has(host.current())) states.set(host.current(), []); return states.get(host.current())!; };
  const rows = (): LeadDeskRow[] => {
    const leads = (host.ask('venture.leads.list', {}) as { leads: LeadView[] }).leads;
    const people = (host.ask('venture.network.people', { limit: 500 }) as PeopleView).people;
    const data: LeadDeskRow[] = [];
    for (const source of current()) {
      const community = communitySources.get(source.id);
      if (community?.business === host.current()) { data.push({ id: source.id, type: 'community', name: community.report.product, email: null, sourceUrl: null, licence: 'Owner-pasted evidence', status: 'confirmed', due: null, draft: null }); continue; }
      const lead = !source.person ? leads.find(lead => lead.id === source.id) : null;
      const summary = source.person ? people.find(person => person.id === source.id && !person.hidden) : null;
      if ((!lead && !summary) || data.some(row => row.id === source.id)) continue;
      const person = summary ? host.ask('venture.network.person', { id: summary.id }) as PersonView : null;
      data.push({ id: source.id, type: 'lead', name: lead?.name ?? summary!.name, email: lead?.email ?? person?.fields.find(field => field.field === 'Email')?.value ?? null, sourceUrl: source.sourceUrl, licence: source.licence, status: lead?.status ?? 'new', due: null, draft: lead?.drafts.at(-1)?.text ?? null });
    }
    for (const due of (host.ask('venture.pipeline.followups', {}) as { due: FollowupView[] }).due) data.push({ id: due.cardId, type: 'followup', name: due.name, email: null, sourceUrl: null, licence: '', status: 'due', due: due.due, draft: null });
    return data;
  };
  const envelope = (p: Record<string, unknown>, op: 'list' | 'get' | 'act') => {
    exact(p, op === 'list' ? ['playbook', 'kind', 'filter'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], op === 'list' ? ['playbook', 'kind'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload']);
    need(p.playbook === 'lead-generation' && p.kind === 'source', 'INVALID_VENTURE_REQUEST', 'Choose the lead generation source desk.');
    if (op === 'list' && p.filter !== undefined) exact(p.filter, []);
    if (op !== 'list') need(typeof p.id === 'string' && p.id.length <= 100, 'INVALID_VENTURE_REQUEST', 'Choose a lead or a new research run.');
  };
  const quote = (query: unknown) => {
    const value = text(query, 'The search', 2, 500);
    const age = (Date.parse(new Date(Date.parse(host.now()) + 330 * 60000).toISOString().slice(0, 10)) - Date.parse('2026-10-27')) / 86400000;
    need(age >= 0 && age <= 90, 'LEAD_RATE_STALE', 'Recheck Happenstance credit pricing before searching.');
    const fields = { query: value, credits: '2', checkedOn: '2026-10-27', source: 'https://developer.happenstance.ai/openapi.json' };
    return { ...fields, digest: host.digest(fields) };
  };
  return { playbook: 'lead-generation',
    forgetPeople(people, erase) {
      if (!erase) return;
      const parts = new Set<string>();
      for (const person of people) for (const raw of person.names) {
        const name = raw.trim(); if (!name || name.includes('@') || name.startsWith('+') || name.startsWith('http')) continue;
        parts.add(name); for (const word of name.split(/[\s,.]+/)) if ([...word].length >= 3) parts.add(word);
      }
      const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const sorted = [...parts].sort((a, b) => b.length - a.length);
      const patterns = [...sorted.filter(part => !/\s/.test(part)).map(part => escape(part) + '\\s+\\p{L}\\.'), ...sorted.map(escape)];
      const names = patterns.length ? new RegExp('(?<![\\p{L}\\p{N}])(?:' + patterns.join('|') + ')(?![\\p{L}\\p{N}])', 'iu') : null;
      const contacts = people.flatMap(person => [...person.emails, ...person.phones]).map(value => value.toLowerCase());
      for (const [id, source] of communitySources) {
        const evidence = JSON.stringify(source.input);
        if (source.business === host.current() && (names?.test(evidence) || contacts.some(value => evidence.toLowerCase().includes(value)))) communitySources.delete(id);
      }
      const ids = new Set(people.map(person => person.id));
      states.set(host.current(), current().filter(source => !source.person || !ids.has(source.id)));
      host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() });
    }, kinds: { source: {
    list(p) { envelope(p, 'list'); const list = rows(), leads = list.filter(row => row.type === 'lead'); return { playbook: 'lead-generation', kind: 'source', rows: list, line: `emails found for ${leads.filter(row => row.email).length} of ${leads.length}` }; },
    get(p) { envelope(p, 'get'); const source = communitySources.get(String(p.id)); if (source?.business === host.current()) { const item = { ...source.report, sourceId: p.id }; return { playbook: 'lead-generation', kind: 'source', item, digest: host.digest(item) }; } const item = rows().find(row => row.id === p.id); need(item, 'LEADS_NOT_FOUND', 'This lead is not in this business.'); return { playbook: 'lead-generation', kind: 'source', item, digest: host.digest(item) }; },
    act(p) {
      envelope(p, 'act');
      const finish = (result: unknown, line: string) => ({ playbook: 'lead-generation', kind: 'source', id: p.id, result, line });
      const announce = () => host.emit({ type: 'desk.changed', businessId: host.current(), at: host.now() });
      if (p.action === 'quote') { const b = exact(p.payload, ['query'], ['query']); return finish(quote(b.query), 'Read the exact search and credit cost before approving.'); }
      if (p.action === 'search') {
        const b = exact(p.payload, ['query', 'key', 'approvedDigest'], ['query', 'key', 'approvedDigest']), shown = quote(b.query);
        need(p.digest === shown.digest && b.approvedDigest === shown.digest, 'APPROVAL_CHANGED', 'Approve the exact search and credit cost shown.');
        need(typeof b.key === 'string' && b.key.length >= 8 && !/[\r\n]/.test(b.key), 'KEY_REQUIRED', 'Enter your own Happenstance key.');
        const paidKey = `${host.current()}:${shown.digest}:${host.digest(b.key)}`;
        need(!paid.has(paidKey), 'JOURNAL_ALREADY_DECIDED', 'This was already decided. Chausar never does the same thing twice.');
        paid.add(paidKey);
        const journalId = `journal-lead-${++sequence}`;
        host.journal?.().push({ id: journalId, action: 'connector.write', target: 'Happenstance paid search', state: 'applied', at: host.now(), line: `${shown.query}; ${shown.credits} credits, price checked ${shown.checkedOn}.` });
        return finish({ source: 'from Happenstance', value: { id: 'sample-search', url: 'https://happenstance.ai/', source: 'from Happenstance' }, journalId, state: 'applied' }, 'from Happenstance');
      }
      if (p.action === 'community') {
        const b = exact(p.payload, ['product', 'confirmed', 'problem', 'categories', 'painWords', 'days', 'posts'], ['product', 'confirmed', 'problem', 'categories', 'painWords', 'days', 'posts']);
        try { const report = communityReport(b as CommunityInput), sourceId = `leadsource-community-${++sequence}`; const approved = structuredClone(b) as CommunityInput; approved.posts = approved.posts.filter(post => !post.removed && !/^\[(?:removed|deleted)\]$/i.test(post.text.trim())); communitySources.set(sourceId, { business: host.current(), input: approved, report }); current().push({ id: sourceId, person: false, licence: 'Owner-pasted evidence', sourceUrl: null }); announce(); return finish({ ...report, sourceId }, 'Community report only; nothing was posted or sent.'); } catch (error) { if (error instanceof CommunityError) throw new EngineError(error.code, error.message); throw error; }
      }
      if (p.action === 'forget-community') {
        exact(p.payload, []);
        need(communitySources.get(String(p.id))?.business === host.current(), 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'Choose an owner-confirmed community report.');
        communitySources.delete(String(p.id)); announce();
        return finish({ forgotten: true }, 'The pasted community evidence was deleted.');
      }
      if (p.action === 'manual') {
        const b = exact(p.payload, ['name', 'email', 'company', 'source'], ['name', 'email', 'source']);
        const name = text(b.name, 'Name', 1, 120), email = text(b.email, 'Email', 3, 254);
        need(b.source === 'walk-in' || b.source === 'referral', 'INVALID_VENTURE_REQUEST', 'Choose a walk-in or referral source.');
        const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
        const imported = host.ask('venture.network.import', { kind: 'contacts-csv', name: `${b.source}.csv`, text: `Name,E-mail 1 - Value,Organization 1 - Name\n${[name, email, b.company ?? ''].map(cell).join(',')}\n` }) as NetworkImportResult;
        need(imported.mode === 'import', 'INVALID_VENTURE_REQUEST', 'Import the owner-entered contact first.');
        const people = (host.ask('venture.network.people', { limit: 500 }) as PeopleView).people;
        const person = people.find(person => (host.ask('venture.network.person', { id: person.id }) as PersonView).fields.some(field => field.field === 'Email' && field.value.toLowerCase() === email.toLowerCase()));
        need(person, 'OUTREACH_BLOCKED', 'This contact was previously forgotten and was not brought back.');
        const importId = imported.mode === 'import' ? imported.import.id : '';
        host.ask('venture.pipeline.add', { personId: person!.id, trigger: { kind: 'import', ref: importId } });
        current().push({ id: person!.id, person: true, licence: 'Entered by you', sourceUrl: null }); announce();
        return finish({ personId: person!.id }, 'Owner-entered contact is in your pipeline. Nothing was sent.');
      }
      need(p.action === 'run', 'INVALID_VENTURE_REQUEST', 'Choose research, manual contact, community report or paid search.');
      const b = exact(p.payload, ['city', 'vertical', 'count', 'ownOffer', 'postalAddress'], ['city', 'vertical', 'ownOffer', 'postalAddress']);
      text(b.city, 'City', 2, 100); const vertical = text(b.vertical, 'Business kind', 3, 70); const offer = text(b.ownOffer, 'Your own offer', 2, 300); const address = text(b.postalAddress, 'Business postal address', 5, 300);
      const count = b.count === undefined || b.count === '' ? 10 : typeof b.count === 'string' && /^[1-9]\d?$/.test(b.count) ? Number(b.count) : NaN;
      need(Number.isInteger(count) && count >= 1 && count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a daily count from one to fifty.');
      need(/^(?:shop|amenity|craft|office)=[a-z_]{1,50}$/.test(vertical), 'INVALID_VENTURE_REQUEST', 'Use an OSM tag such as shop=bakery.');
      const prospects: unknown[] = [], drafts: unknown[] = [];
      for (let i = 0; i < count; i++) {
        const index = ++sequence, sourceUrl = `https://www.openstreetmap.org/node/${index}`, name = `Sample local business ${index}`, email = `shop${index}@example.in`, licence = '\u00A9 OpenStreetMap contributors, ODbL';
        const lead = host.ask('venture.leads.add', { name, company: name, email, sourceUrl }) as LeadView;
        const body = `Hello ${name}, I found your business through its public listing. I offer ${offer}. Would it be useful to hear more?`;
        const made = host.ask('venture.leads.draft', { leadId: lead.id, subject: 'A question about your business', body, postalAddress: address }) as { lead: LeadView; draft: { text: string; footer: { businessName: string; postalAddress: string; unsubscribe: string } } };
        const footer = made.draft.footer, fullText = `${made.draft.text}\n\n--\n${footer.businessName}\n${footer.postalAddress}\n${footer.unsubscribe}`;
        current().push({ id: lead.id, person: false, licence, sourceUrl });
        prospects.push({ osmId: `node/${index}`, name, address: '', website: 'https://example.in', sourceUrl, licence, emails: [email] });
        drafts.push({ sourceUrl, email, text: fullText, mode: 'handoff' });
      }
      announce(); const followups = rows().filter(row => row.type === 'followup').map(row => ({ id: row.id, name: row.name, due: row.due! }));
      return finish({ prospects, drafts, foundRate: `emails found for ${count} of ${count}`, followups, outsideWrites: [] }, 'Research and drafts are ready. You review and send every message.');
    },
  } } };
}
