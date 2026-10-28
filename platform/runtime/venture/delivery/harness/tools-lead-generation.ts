import {wholeCount} from '../../playbooks/kit/count.ts';
// Chausar leadgen tools. revenue-squad MIT, reddit-skills no-licence ideas only; no code copied.
import { check } from '../../../contracts.ts';
import type { ToolName } from '../../contracts.ts';
import type { Spec, Field } from './tools.ts';
const textField = (about: string, max = 200, required = true): Field => ({ type: 'text', about, max, required });
/** Bounded JSON supplied from earlier sourced tool output or the owner's pasted community posts. */
function parsed(value: unknown): any { try { return JSON.parse(String(value)); } catch { check(false, 'INVALID_VENTURE_REQUEST', 'Send valid JSON from the sourced records.'); } }
type LeadGenerationToolName = Extract<ToolName, 'leads.osm' | 'leads.enrich' | 'leads.dedupe' | 'community.vote'>;
export const LEAD_GENERATION_TOOLS: Readonly<Record<LeadGenerationToolName, Spec>> = Object.freeze({
  'leads.osm': { name: 'leads.osm', effect: 'read', tier: 'code', endsTurn: false, summary: 'Reads bounded local businesses from OpenStreetMap with attribution, for the city and OSM business tag at intake. Never scrapes Maps or directories.', input: { city: textField('The city named at intake.'), vertical: textField('An OSM tag, such as shop=bakery.'), count: textField('Prospect limit; defaults to ten.', 2, false) }, async run(env, input) {
    for (const key of ['city', 'vertical']) if (typeof env.intake?.fields?.[key] === 'string') check(input[key] === env.intake.fields[key], 'LEAD_INTAKE_CHANGED', 'Research only the city and business kind the owner approved at intake.');
    const [{ osmLeads }, { citiesFor }] = await Promise.all([import('../../playbooks/lead-generation/osm.ts'), import('../../playbooks/lead-generation/nominatim.ts')]);
    const [{ findRecord, requireVenture }, { pipelineSettings }, { coldEmailMonthPlan }, { acceptedBlueprintOrNull }] = await Promise.all([import('../../records.ts'), import('../../network/pipeline.ts'), import('../../playbooks/lead-generation/daily-run.ts'), import('../shared.ts')]);
    const state = env.deps.store.read();
    const run = env.runRef.kind === 'delivery' ? findRecord(state, 'venture-delivery-run', env.runRef.runId) : undefined;
    const order = run ? findRecord(state, 'venture-order', run.orderId) : undefined;
    const venture = requireVenture(state);
    const offerKey = order && order.ventureId === env.ventureId ? acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId)?.playbookOffer : undefined;
    const offerPlan = offerKey === 'cold-email-month' ? coldEmailMonthPlan(pipelineSettings(state, env.ventureId), env.now()) : null;
    const ownerCount = order?.intake?.fields?.count ?? env.intake?.fields?.count;
    const approvedCount = ownerCount === undefined || ownerCount === '' ? offerPlan?.prospectLimit : typeof ownerCount === 'string' && /^\d{1,2}$/.test(ownerCount) ? wholeCount(ownerCount) : NaN;
    const requestedCount = input.count === undefined ? undefined : /^\d{1,2}$/.test(input.count) ? wholeCount(input.count) : NaN;
    check(approvedCount === undefined || requestedCount === undefined || requestedCount === approvedCount, 'LEAD_INTAKE_CHANGED', 'Research only the prospect count the owner approved at intake.');
    const count = approvedCount ?? requestedCount ?? 10;
    check(Number.isInteger(count) && count >= 1 && count <= 50, 'INVALID_VENTURE_REQUEST', 'Choose a daily count from one to fifty.');
    const box = await citiesFor(env.deps.net).find(input.city);
    return { result: { offerPlan, prospects: await osmLeads({ box, vertical: input.vertical, count }, env.deps.net), note: 'OSM has gaps for small Indian shops; a missing listing is not proof a shop does not exist.' } };
  } },
  'leads.enrich': { name: 'leads.enrich', effect: 'read', tier: 'code', endsTurn: false, summary: 'Reads the business own homepage and a few same-host contact pages, respects robots, and returns at most three useful emails. Never reads directories or LinkedIn.', input: { url: textField('The business own website.', 1000) }, async run(env, input) { const { enrichSite } = await import('../../playbooks/lead-generation/enrich.ts'); return { result: await enrichSite(input.url, env.deps.net) }; } },
  'leads.dedupe': { name: 'leads.dedupe', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Deduplicates sourced prospects by stable place id, domain, then normalised name and address.', input: { prospects: textField('JSON array of sourced prospect records.', 11000) }, async run(_env, input) {
    const rows = parsed(input.prospects);
    check(Array.isArray(rows) && rows.length <= 100 && rows.every(row => row && typeof row.name === 'string' && typeof row.address === 'string' && typeof row.sourceUrl === 'string' && typeof row.licence === 'string' && (row.website === null || typeof row.website === 'string') && (row.osmId === null || typeof row.osmId === 'string')), 'INVALID_VENTURE_REQUEST', 'Send a bounded array of sourced prospects.');
    const { dedupeProspects } = await import('../../playbooks/lead-generation/dedupe.ts'); return { result: { prospects: dedupeProspects(rows) } };
  } },
  'community.vote': { name: 'community.vote', effect: 'compute', tier: 'code', endsTurn: false, summary: 'Reads the exact community evidence and product confirmed by the owner in the community desk. Never accepts model assertions of owner permission or invented posts.', input: { sourceId: textField('An owner-confirmed source id; omit to list up to twenty recent approved sources.', 100, false) }, async run(env, input) {
    if (input.sourceId === undefined) {
      check(Object.keys(input).length === 0, 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'Ask the owner to confirm the product and permitted pasted posts in the community desk.');
      const { listRecords } = await import('../../records.ts');
      const sources = listRecords(env.deps.store.read(), 'venture-lead-source', env.ventureId).filter(source => source.source === 'community' && source.community).slice(-20).reverse();
      return { result: { sources: sources.map(source => ({ sourceId: source.id, product: source.community!.product, problem: source.community!.problem, confirmedAt: source.fetchedAt })) } };
    }
    check(typeof input.sourceId === 'string', 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'Ask the owner to confirm the product and permitted pasted posts in the community desk.');
    check(Object.keys(input).every(key => key === 'sourceId'), 'INVALID_VENTURE_REQUEST', 'Use only the owner-confirmed community source.');
    const [{ findRecord }, { communityReport }] = await Promise.all([import('../../records.ts'), import('../../playbooks/lead-generation/community.ts')]);
    const source = findRecord(env.deps.store.read(), 'venture-lead-source', input.sourceId);
    check(source?.ventureId === env.ventureId && source.source === 'community' && source.community, 'COMMUNITY_OWNER_SOURCE_REQUIRED', 'Ask the owner to confirm the product and permitted pasted posts in the community desk.');
    return { result: { ...communityReport(source.community), sourceId: source.id } };
  } },
});
