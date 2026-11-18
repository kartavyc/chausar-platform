import { credentialChange, assertCredentialSession } from '../models/credential-state.ts';
import { prepareAdoptedCredentials } from '../models/credential-adoption.ts';
// Chausar venture launcher, core (P1): venture.create and venture.get.
// One business per vault. Create sets the books up for the country (retention, dictionary currency) in their own
// writes first, then makes the venture record and its empty interview in one venture action. Never nested.
// Onboarding v2: when the owner connected an AI before the vault, the same one action adopts the draft (the AI
// connections and their calls); the keys move to the vault's memory-only shelf only after that commit, and the draft
// is then wiped.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import { starterPacks, type DictionaryDraft } from '../../ontology.ts';
import { currentVenture, digest, exactPayload, findRecord, listRecords, plainText, requireAppChannel, singleLine, ventureAction, type VentureTx } from '../records.ts';
import type { InterviewRecord, ModelCallRecord, ModelConnectionRecord, VentureDeps, VentureRecord, VentureView } from '../contracts.ts';
import type { DraftAi } from '../onboarding-contracts.ts';
import { playbookField } from './lookups.ts';
import { familyOf, isFamilyId } from './families.ts';
import { offerReadiness } from './way-ready.ts';
import { setupProgress } from '../chief/plan-core.ts';
import { countryProfile } from './countries.ts';
import { classifyIdea } from './service-types.ts';
import { DEFAULT_WORKING_NAME } from './words.ts';
import { rememberAiSetup, settingsFrom } from '../models/ai-setup.ts';
import { recordDecision } from '../journal/decisions.ts';

/** Records are kept for ten years, as tax rules expect; the owner is told under More of your plan and in Trust. */
export const VENTURE_RETENTION_DAYS = 3650;

export function buildView(state: State): VentureView | null {
  const venture = currentVenture(state);
  if (!venture) return null;
  return { venture, ...setupOf(state, venture), terms: listRecords(state, 'venture-term', venture.id), ...playbookField(venture.idea), ...sellsOf(state, venture), ...fieldOf(state, venture.id), ...pausedField(state, venture.id) };
}

/**
 * What the accepted plan sells, by its first offer's own name ("Custom cakes"); nothing before a plan is accepted.
 * Re-check 082 (17 Nov 2026): a home baker read "Local services", the field of salons and home visits, under the name.
 */
function sellsOf(state: State, venture: VentureRecord): Pick<VentureView, 'sells'> {
  const plan = venture.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId) : null;
  const name = plan && plan.ventureId === venture.id && plan.status === 'accepted' ? plan.offers[0]?.name.value.trim() : '';
  return name ? { sells: name } : {};
}

/** The field the owner kept (the newest owner profile's familyId), by its own label; nothing until one is kept. */
function fieldOf(state: State, ventureId: string): Pick<VentureView, 'field'> {
  const id = listRecords(state, 'venture-owner-profile', ventureId).at(-1)?.familyId;
  return id && isFamilyId(id) ? { field: { id, label: familyOf(id).label } } : {};
}

/** How far what is sold is from ready, as the chief's standing plan counts its setup (chief/plan-core.ts). */
function setupOf(state: State, venture: VentureRecord): Pick<VentureView, 'done' | 'total'> {
  const found = venture.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId) : null;
  const accepted = !!found && found.ventureId === venture.id && found.status === 'accepted';
  let ready = false;
  try { ready = offerReadiness(state, venture).ready; } catch { ready = false; }
  return setupProgress({ accepted, ready });
}

/** The line the business menu shows while the owner has paused the business (4F3). */
export const PAUSED_VIEW_LINE = 'Paused by you. No new work starts until you unpause.';

/**
 * 4F3: while the business is paused (its newest Pause all record says paused), since when: the first of the paused
 * records after the last unpause, so pausing again keeps the first moment. Absent when it is not paused.
 */
function pausedField(state: State, ventureId: string): Pick<VentureView, 'paused'> {
  const records = listRecords(state, 'venture-pause', ventureId).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  if (!records.length || !records[records.length - 1]!.paused) return {};
  let since = records.length - 1;
  while (since > 0 && records[since - 1]!.paused) since -= 1;
  return { paused: { since: records[since]!.at, line: PAUSED_VIEW_LINE } };
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

/** Adopted draft records keep their id, time and every other field; only who and which venture are re-based. */
function rebased<R extends ModelConnectionRecord | ModelCallRecord>(record: R, tx: VentureTx): R {
  return { ...structuredClone(record), ventureId: (tx.venture as VentureRecord).id, memberId: tx.ctx.memberId, epoch: tx.ctx.epoch };
}

/**
 * venture.create { idea, countryCode, workingName? } (admin, inside the app).
 * The AI comes along from the draft only (onboarding v2). When the draft's AI was the one already set up in another
 * business on this computer (venture.ai.reuse, models/ai-setup.ts), the agents' models come with it and the new
 * business notes where its AI came from.
 */
export function createVenture(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView> {
  return credentialChange(deps, () => createVentureUnlocked(deps, ctx, payload));
}
async function createVentureUnlocked(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView> {
  requireAppChannel(ctx, 'venture.create');
  const body = exactPayload(payload, ['idea', 'countryCode', 'workingName'], ['idea', 'countryCode']);
  const idea = plainText(body.idea, 'Your idea', { min: 10, max: 2000 });
  const named = Object.hasOwn(body, 'workingName') ? singleLine(body.workingName, 'The working name', { min: 2, max: 80 }) : null;
  authorize(deps.store, ctx, 'admin');

  // 0. The AI connected before the vault, when there is one. On hosted there is no draft desk.
  const ai: DraftAi | null = deps.draft?.ai() ?? null;
  const workingName = named ?? DEFAULT_WORKING_NAME;

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

  // 5. The venture record and its interview, in one action; with an AI connected before the vault also its connections
  // and calls (they count toward the cap).
  const connections = ai ? ai.connections.filter(connection => connection.status === 'connected') : [];
  // The setup the draft reused from another business (it passed every gate venture.models.connect runs there), while
  // one of its connections is still connected.
  const reused = ai?.reused && ai.reused.from.workspaceId !== state.workspace.id ? ai.reused : null;
  const keys = await prepareAdoptedCredentials(deps, ctx, connections);
  let view: VentureView;
  try { view = await ventureAction(deps, ctx, 'admin', 'create', tx => {
    assertCredentialSession(deps, ctx);
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
    tx.emit('venture-created', { countryCode: country.code, currency: country.currency });
    const interview: InterviewRecord = {
      ...tx.base('venture-interview'),
      serviceType: { value: classifyIdea(idea), label: 'assumption', by: 'template' },
      questions: [],
      modelCallIds: [],
      source: 'template',
    };
    tx.put(interview);
    // Every call made before the vault is adopted, even when no connection is left: they count toward this month's
    // cap. Only connected connections come along and announce themselves.
    if (ai) {
      for (const connection of connections) tx.put(rebased(connection, tx));
      for (const call of ai.calls) tx.put(rebased(call, tx));
      for (const connection of connections) tx.emit('model-connected', { presetId: connection.presetId, tiers: [...connection.tiers] });
    }
    if (reused) {
      // A4 fix round: the AI setup only. Its connections came along with the draft above, each with the agreement the
      // owner gave in the other business and when; here the agents' models, and the decision, so the owner sees where
      // it came from. No call, consent or record of the other business comes along.
      tx.touch({ aiSettings: settingsFrom(reused) });
      recordDecision(tx, { subject: `ai-setup:${reused.from.workspaceId}`, action: 'reuse-ai', ruleId: null, reason: `This business uses the same AI as ${reused.from.name}.`, rowId: null, who: 'chausar' });
    }
    if (retentionChanged) tx.emit('retention-changed', { from: before, to: VENTURE_RETENTION_DAYS });
    const view = buildView(tx.state);
    check(view, 'VENTURE_NOT_FOUND', 'Start a business first.');
    return view;
  }, { create: true });
  } catch (error) { await keys.rollback(); throw error; }
  keys.commit();

  // 6. After the commit, never inside it: the keys move to the vault's shelf, then the draft is wiped.
  if (deps.draft) {
    deps.draft.settle();
  }
  // Connecting changes send nothing to send question shapes, as the consent text says (venture.models.connect does the same).
  // A4 fix round: this business's AI setup is now the newest on this computer.
  await rememberAiSetup(deps);
  if (connections.some(connection => connection.presetId !== 'built-in-templates') && deps.store.read().policy.send === 'nothing') {
    await deps.services.trust.updatePolicy(ctx, { send: 'shape' });
    await ventureAction(deps, ctx, 'admin', 'models.send-policy', tx => { tx.emit('send-policy-changed', { from: 'nothing', to: 'shape' }); });
    return buildView(deps.store.read()) ?? view;
  }
  return view;
}

/** venture.get {} (read): the venture with its terms, or null before one exists. */
export async function getVenture(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView | null> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  return buildView(deps.store.read());
}
