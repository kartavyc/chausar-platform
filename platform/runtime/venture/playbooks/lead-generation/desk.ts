// Chausar lead research desk. Original W4 integration; revenue-squad (MIT) and Happenstance proprietary protocol ideas only.
import { authorize, check, ChausarError } from '../../../contracts.ts';
import type { Context } from '../../../contracts.ts';
import type { VentureDeps, LeadSourceRecord, Json } from '../../contracts.ts';
import type { DeskHandlers, DeskActPayload, DeskActView, DeskListPayload, DeskListView, DeskGetPayload, DeskItemView } from '../desk-types.ts';
import { digest, exactPayload, listRecords, readVenture, requireAppChannel, singleLine, ventureAction } from '../../records.ts';
import { leadsAdd, leadsDraft, leadsList } from '../../customers/lead-methods.ts';
import { createLead, onBlocklist, verifyLeadEmail } from '../../customers/leads.ts';
import { refuseNeverContact } from '../../network/outreach-checks.ts';
import { blocklistOf, cardsOf, planOf } from '../../network/pipeline.ts';
import { networkImport } from '../../network/import.ts';
import { removeRecords } from '../../network/people.ts';
import { pipelineAdd } from '../../network/pipeline-methods.ts';
import { localDayAt } from '../../local-day.ts';
import { journalled } from '../../journal/journal.ts';
import { osmLeads, type Prospect } from './osm.ts';
import { citiesFor } from './nominatim.ts';
import { enrichSite } from './enrich.ts';
import { buildDailyRun } from './daily-run.ts';
import { communityReport, type CommunityInput } from './community.ts';
import { happenstanceQuote, happenstanceSearch } from './happenstance.ts';
import type { LeadDeskRow } from './records.ts';
export type LeadGenerationDeskTypes = { source: { filter: Json; row: LeadDeskRow; item: LeadDeskRow | (ReturnType<typeof communityReport> & { sourceId: string }); actions: Record<string, { payload: Json; result: unknown }> } };
/** Exact envelope checks match the fake before any network or vault access. */
function request(payload: unknown, op: 'list' | 'get' | 'act'): Record<string, unknown> {
  const p = exactPayload(payload, op === 'list' ? ['playbook', 'kind', 'filter'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload', 'digest'], op === 'list' ? ['playbook', 'kind'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload']);
  check(p.playbook === 'lead-generation' && p.kind === 'source', 'INVALID_VENTURE_REQUEST', 'Choose the lead generation source desk.');
  if (op === 'list' && p.filter !== undefined) exactPayload(p.filter, []);
  if (op !== 'list') check(typeof p.id === 'string' && p.id.length <= 100, 'INVALID_VENTURE_REQUEST', 'Choose a lead or a new research run.');
  return p;
}
async function rowsOf(deps: VentureDeps, ctx: Context): Promise<LeadDeskRow[]> {
  const { state, venture } = readVenture(deps, ctx);
  const sources = listRecords(state, 'venture-lead-source', venture.id);
  const leads = (await leadsList(deps, ctx, {})).leads;
  const rows: LeadDeskRow[] = [];
  for (const source of sources) {
    if (source.source === 'community' && source.community) { rows.push({ id: source.id, type: 'community', name: source.community.product, email: null, sourceUrl: null, licence: 'Owner-pasted evidence', status: 'confirmed', due: null, draft: null }); continue; }
    const lead = source.leadId ? leads.find(l => l.id === source.leadId) : null;
    const person = source.personId ? listRecords(state, 'venture-person', venture.id).find(p => p.id === source.personId && !p.hidden) : null;
    if (!lead && !person) continue;
    const id = lead?.id ?? person!.id;
    if (rows.some(row => row.id === id)) continue;
    rows.push({ id, type: 'lead', name: lead?.name ?? person!.name, email: lead?.email ?? person!.handles.emails[0] ?? null, sourceUrl: source.url, licence: source.licence, status: lead?.status ?? 'new', due: null, draft: lead?.drafts.at(-1)?.text ?? null });
  }
  const today = localDayAt(deps.clock(), venture.country);
  for (const card of cardsOf(state, venture, today)) {
    const plan = planOf(card);
    if (plan?.kind === 'nudge' && plan.due <= today) rows.push({ id: card.key, type: 'followup', name: card.name, email: card.emails[0] ?? null, sourceUrl: null, licence: '', status: 'due', due: plan.due, draft: null });
  }
  return rows;
}
/** Lists source-linked prospects and existing W4 follow-ups due, never invented meeting states. */
export async function leadDeskList(deps: VentureDeps, ctx: Context, payload: DeskListPayload): Promise<DeskListView> {
  request(payload, 'list');
  const rows = await rowsOf(deps, ctx), leads = rows.filter(r => r.type === 'lead');
  return { playbook: 'lead-generation', kind: 'source', rows, line: `emails found for ${leads.filter(r => r.email).length} of ${leads.length}` };
}
/** A source-linked row and the digest of exactly what the owner sees. */
export async function leadDeskGet(deps: VentureDeps, ctx: Context, payload: DeskGetPayload): Promise<DeskItemView> {
  const p = request(payload, 'get');
  const { state, venture } = readVenture(deps, ctx);
  const source = listRecords(state, 'venture-lead-source', venture.id).find(row => row.id === p.id && row.source === 'community');
  if (source?.community) { const item = { ...communityReport(source.community), sourceId: source.id }; return { playbook: 'lead-generation', kind: 'source', item, digest: digest(item) }; }
  const item = (await rowsOf(deps, ctx)).find(row => row.id === p.id);
  check(item, 'LEADS_NOT_FOUND', 'This lead is not in this business.');
  return { playbook: 'lead-generation', kind: 'source', item, digest: digest(item) };
}
/** Runs only a one-off owner request; paid provider requests require their own displayed exact credit approval. */
export async function leadDeskAct(deps: VentureDeps, ctx: Context, payload: DeskActPayload): Promise<DeskActView> {
  requireAppChannel(ctx, 'venture.desk.act');
  const p = request(payload, 'act');
  authorize(deps.store, ctx, 'approve');
  const { state, venture } = readVenture(deps, ctx);
  const finish = (result: unknown, line: string): DeskActView => ({ playbook: 'lead-generation', kind: 'source', id: String(p.id), result, line });
  if (p.action === 'quote') {
    const b = exactPayload(p.payload, ['query'], ['query']);
    check(typeof b.query === 'string', 'INVALID_VENTURE_REQUEST', 'Write the exact search as text.');
    return finish(happenstanceQuote(String(b.query), localDayAt(deps.clock(), venture.country)), 'Read the exact search and credit cost before approving.');
  }
  if (p.action === 'search') {
    const b = exactPayload(p.payload, ['query', 'key', 'approvedDigest'], ['query', 'key', 'approvedDigest']);
    check(typeof b.query === 'string', 'INVALID_VENTURE_REQUEST', 'Write the exact search as text.');
    const quote = happenstanceQuote(b.query, localDayAt(deps.clock(), venture.country));
    check(b.approvedDigest === quote.digest && p.digest === quote.digest, 'APPROVAL_CHANGED', 'Approve the exact search and credit cost shown.');
    check(typeof b.key === 'string' && b.key.length >= 8 && !/[\r\n]/.test(b.key), 'KEY_REQUIRED', 'Enter your own Happenstance key.');
    const done = await journalled<unknown>(deps, ctx, { action: 'connector.write', operation: 'happenstance-search', subject: `happenstance:${quote.digest}`, target: 'Happenstance paid search', actionDigest: quote.digest, line: `${quote.query}; ${quote.credits} credits, price checked ${quote.checkedOn}.`, descriptionComplete: true, account: digest(b.key) }, async handle => {
      handle.fence(digest(b.key));
      try { return { outcome: 'applied', line: 'Happenstance confirmed the search.', value: await happenstanceSearch({ quote, approvedDigest: quote.digest, key: String(b.key) }, deps.net), by: 'platform' }; }
      catch { return { outcome: 'unknown', line: 'Check Happenstance before trying again; the search may have used credits.', value: null }; }
    }, { account: digest(b.key) });
    return finish({ source: 'from Happenstance', value: done.value ?? null, journalId: done.entry.id, state: done.entry.state }, done.entry.state === 'applied' ? 'from Happenstance' : 'Check Happenstance before trying again.');
  }
  if (p.action === 'community') {
    const b = exactPayload(p.payload, ['product', 'confirmed', 'problem', 'categories', 'painWords', 'days', 'posts'], ['product', 'confirmed', 'problem', 'categories', 'painWords', 'days', 'posts']);
    const report = communityReport(b as CommunityInput);
    const approved = structuredClone(b) as CommunityInput;
    approved.posts = approved.posts.filter(post => !post.removed && !/^\[(?:removed|deleted)\]$/i.test(post.text.trim()));
    const sourceId = await ventureAction(deps, ctx, 'approve', 'leads.community', tx => {
      const source = tx.put<LeadSourceRecord>({ ...tx.base('venture-lead-source'), source: 'community', url: null, licence: 'Owner-pasted evidence', fetchedAt: tx.now, leadId: null, personId: null, importId: null, sourceId: null, domain: null, community: approved });
      tx.emit('desk.changed', { playbook: 'lead-generation' }); return source.id;
    });
    return finish({ ...report, sourceId }, 'Community report only; nothing was posted or sent.');
  }
  if (p.action === 'forget-community') {
    exactPayload(p.payload, []);
    await ventureAction(deps, ctx, 'approve', 'leads.community.forget', tx => {
      const source = tx.find('venture-lead-source', String(p.id));
      check(source?.source === 'community', 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'Choose an owner-confirmed community report.');
      removeRecords(tx, record => record.id === source.id);
      tx.emit('desk.changed', { playbook: 'lead-generation' });
    });
    return finish({ forgotten: true }, 'The pasted community evidence was deleted.');
  }
  if (p.action === 'manual') {
    const b = exactPayload(p.payload, ['name', 'email', 'company', 'source'], ['name', 'email', 'source']);
    const name = singleLine(b.name, 'Name', { min: 1, max: 120 }), email = singleLine(b.email, 'Email', { min: 3, max: 254 });
    check(b.source === 'walk-in' || b.source === 'referral', 'INVALID_VENTURE_REQUEST', 'Choose a walk-in or referral source.');
    await refuseNeverContact(deps, [email], name);
    const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`;
    const imported = await networkImport(deps, ctx, { kind: 'contacts-csv', name: `${b.source}.csv`, text: `Name,E-mail 1 - Value,Organization 1 - Name\n${[name, email, b.company ?? ''].map(cell).join(',')}\n` });
    check(imported.mode === 'import', 'INVALID_VENTURE_REQUEST', 'Import the owner-entered contact first.');
    const people = listRecords(deps.store.read(), 'venture-person', venture.id).filter(person => person.facts.some(fact => fact.source.importId === imported.import.id));
    const person = people.find(person => person.handles.emails.includes(email.toLowerCase()));
    check(person, 'OUTREACH_BLOCKED', 'This contact was previously forgotten and was not brought back.');
    await pipelineAdd(deps, ctx, { personId: person.id, trigger: { kind: 'import', ref: imported.import.id } });
    await ventureAction(deps, ctx, 'prepare', 'leads.source', tx => { tx.put<LeadSourceRecord>({ ...tx.base('venture-lead-source'), source: b.source as 'walk-in' | 'referral', url: null, licence: 'Entered by you', fetchedAt: tx.now, leadId: null, personId: person.id, importId: imported.import.id, sourceId: null, domain: null }); tx.emit('desk.changed', { playbook: 'lead-generation' }); });
    return finish({ personId: person.id }, 'Owner-entered contact is in your pipeline. Nothing was sent.');
  }
  check(p.action === 'run', 'INVALID_VENTURE_REQUEST', 'Choose research, manual contact, community report or paid search.');
  const b = exactPayload(p.payload, ['city', 'vertical', 'count', 'ownOffer', 'postalAddress'], ['city', 'vertical', 'ownOffer', 'postalAddress']);
  const city = singleLine(b.city, 'City', { min: 2, max: 100 }), vertical = singleLine(b.vertical, 'Business kind', { min: 3, max: 70 });
  const ownOffer = singleLine(b.ownOffer, 'Your own offer', { min: 2, max: 300 }), postalAddress = singleLine(b.postalAddress, 'Business postal address', { min: 5, max: 300 });
  const count = b.count === undefined || b.count === '' ? 10 : typeof b.count === 'string' && /^[1-9]\d?$/.test(b.count) ? Number(b.count) : NaN;
  check(Number.isInteger(count) && count >= 1 && count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a daily count from one to fifty.');
  const sources = listRecords(state, 'venture-lead-source', venture.id);
  const existing: Prospect[] = sources.filter(s => s.leadId).map(s => ({ osmId: s.sourceId, name: '', address: '', website: s.domain ? `https://${s.domain}` : null, sourceUrl: s.url ?? '', licence: s.licence }));
  const list = await rowsOf(deps, ctx);
  const box = await citiesFor(deps.net).find(city);
  const blocklist = blocklistOf(state, venture.id);
  const report = await buildDailyRun({ city, vertical, count, ownOffer, postalAddress, existing, followups: list.filter(r => r.type === 'followup').map(r => ({ id: r.id, name: r.name, due: r.due! })) }, {
    source: async () => osmLeads({ box, vertical, count: Math.min(50, count * 3) }, deps.net),
    enrich: url => enrichSite(url, deps.net),
    allowed: async row => { const candidate = createLead({ name: row.name || 'Business', sourceUrl: row.sourceUrl, email: row.emails?.[0] ?? undefined }, { by: ctx.memberId, at: deps.clock().toISOString() }); if (onBlocklist(candidate, blocklist)) return false; try { await refuseNeverContact(deps, [candidate.email], row.name); return true; } catch { return false; } },
    verify: async email => (await verifyLeadEmail(createLead({ name: 'Business', email, sourceUrl: 'https://www.openstreetmap.org/' }, { by: ctx.memberId, at: deps.clock().toISOString() }), { resolver: deps.mx, now: deps.clock().toISOString() })).emailCheck.status === 'verified',
  });
  for (const prospect of report.prospects) {
    const lead = await leadsAdd(deps, ctx, { name: prospect.name, company: prospect.name, sourceUrl: prospect.sourceUrl, email: prospect.emails?.[0] ?? null });
    await ventureAction(deps, ctx, 'prepare', 'leads.source', tx => { tx.put<LeadSourceRecord>({ ...tx.base('venture-lead-source'), source: 'osm', url: prospect.sourceUrl, licence: prospect.licence, fetchedAt: tx.now, leadId: lead.id, personId: null, importId: null, sourceId: prospect.osmId, domain: prospect.website ? new URL(prospect.website).hostname : null }); tx.emit('desk.changed', { playbook: 'lead-generation' }); });
    const draft = report.drafts.find(d => d.sourceUrl === prospect.sourceUrl);
    if (draft && lead.emailCheck.status === 'verified') {
      // W4 writes the current business name/address/footer and checks the shared never-contact list again.
      const body = draft.text.split('\n\n--\n')[0];
      await leadsDraft(deps, ctx, { leadId: lead.id, subject: 'A question about your business', body, postalAddress });
    }
  }
  return finish(report, 'Research and drafts are ready. You review and send every message.');
}
export const LEAD_GENERATION_DESK: DeskHandlers = Object.freeze({ source: { list: leadDeskList, get: leadDeskGet, act: leadDeskAct } });
