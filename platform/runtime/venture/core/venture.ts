// Chausar venture launcher, core (P1): venture.create and venture.get.
// One business per vault. Create sets the books up for the country (retention, dictionary currency) in their own
// writes first, then makes the venture record and its empty interview in one venture action. Never nested.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import { starterPacks, type DictionaryDraft } from '../../ontology.ts';
import { currentVenture, digest, exactPayload, listRecords, plainText, requireAppChannel, singleLine, ventureAction } from '../records.ts';
import type { InterviewRecord, VentureDeps, VentureRecord, VentureView } from '../contracts.ts';
import { checklistFor } from './checklist.ts';
import { countryProfile } from './countries.ts';
import { classifyIdea } from './service-types.ts';
import { DEFAULT_WORKING_NAME } from './words.ts';

/** Records are kept for ten years, as tax rules expect; the owner is told on the Keep it safe screen. */
export const VENTURE_RETENTION_DAYS = 3650;

export function buildView(state: State): VentureView | null {
  const venture = currentVenture(state);
  if (!venture) return null;
  return { venture, ...checklistFor(state, venture), terms: listRecords(state, 'venture-term', venture.id) };
}

/** The services starter pack in the venture's currency. The GST mode is only a label; nothing here computes tax. */
export function servicesDictionary(currency: string): DictionaryDraft {
  const pack = starterPacks.find(p => p.pack === 'services');
  check(pack, 'UNKNOWN_PACK', 'The services starter pack is missing.');
  const draft = structuredClone(pack);
  draft.currency = currency;
  draft.definitions = draft.definitions.map(d => ({ ...d, currency }));
  draft.gstMode = 'unregistered';
  return draft;
}

/** venture.create { idea, countryCode, workingName? } (admin, inside the app). */
export async function createVenture(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView> {
  requireAppChannel(ctx, 'venture.create');
  const body = exactPayload(payload, ['idea', 'countryCode', 'workingName'], ['idea', 'countryCode']);
  const idea = plainText(body.idea, 'Your idea', { min: 10, max: 2000 });
  const workingName = Object.hasOwn(body, 'workingName') ? singleLine(body.workingName, 'The working name', { min: 2, max: 80 }) : DEFAULT_WORKING_NAME;
  authorize(deps.store, ctx, 'admin');

  // 1. One business per vault, from a known country.
  const state = deps.store.read();
  check(!currentVenture(state), 'VENTURE_EXISTS', 'This workspace already has a business. Chausar keeps one business per workspace.');
  const country = countryProfile(body.countryCode);

  // 2. A workspace with books in another currency cannot switch.
  const dictionary = deps.services.ontology.current(ctx);
  if (dictionary && dictionary.currency !== country.currency && state.facts.length > 0) {
    throw new ChausarError('CURRENCY_CONFLICT', `This workspace already keeps books in ${dictionary.currency}.`);
  }

  // 3. Keep records for ten years. Its own write, before the venture action.
  const before = state.policy.retentionDays;
  const retentionChanged = before < VENTURE_RETENTION_DAYS;
  if (retentionChanged) await deps.services.trust.updatePolicy(ctx, { retentionDays: VENTURE_RETENTION_DAYS });

  // 4. Books in the country's currency. Its own write too.
  if (!dictionary || dictionary.currency !== country.currency) await deps.services.ontology.publish(ctx, servicesDictionary(country.currency));

  // 5. The venture record and its empty interview, in one action.
  return ventureAction(deps, ctx, 'admin', 'create', tx => {
    check(!tx.venture, 'VENTURE_EXISTS', 'This workspace already has a business. Chausar keeps one business per workspace.');
    const record: VentureRecord = {
      ...tx.base('venture-record'),
      idea,
      ideaDigest: digest(idea),
      workingName,
      country,
      serviceType: null,
      status: 'interview',
      launchStage: 'rehearsal',
      blueprintId: null,
      acceptedBlueprintId: null,
      playbookId: null,
      invoiceSequence: 0,
      updatedAt: tx.now,
    };
    tx.put(record);
    const interview: InterviewRecord = {
      ...tx.base('venture-interview'),
      serviceType: { value: classifyIdea(idea), label: 'assumption', by: 'template' },
      questions: [],
      modelCallIds: [],
      source: 'template',
    };
    tx.put(interview);
    tx.emit('venture-created', { countryCode: country.code, currency: country.currency });
    if (retentionChanged) tx.emit('retention-changed', { from: before, to: VENTURE_RETENTION_DAYS });
    const view = buildView(tx.state);
    check(view, 'VENTURE_NOT_FOUND', 'Start a business first.');
    return view;
  }, { create: true });
}

/** venture.get {} (read): the venture with its checklist and terms, or null before one exists. */
export async function getVenture(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView | null> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  return buildView(deps.store.read());
}
