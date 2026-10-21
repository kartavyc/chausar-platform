// Chausar venture launcher, core (P1): venture.create and venture.get.
// One business per vault. Create sets the books up for the country (retention, dictionary currency) in their own
// writes first, then makes the venture record and its empty interview in one venture action. Never nested.
// Onboarding v2: when the owner composed a plan or connected an AI before the vault, the same one action adopts the
// draft (the composition, an answered interview, blueprint version 1, the AI connections and their calls); the keys
// move to the vault's memory-only shelf only after that commit, and the draft is then wiped.
import { authorize, check, ChausarError, type Context, type State } from '../../contracts.ts';
import { starterPacks, type DictionaryDraft } from '../../ontology.ts';
import { bpsPercent, currentVenture, digest, exactPayload, listRecords, plainText, requireAppChannel, singleLine, ventureAction, type VentureTx } from '../records.ts';
import { INTERVIEW_IDS } from '../contracts.ts';
import type { CountryProfile, InterviewRecord, ModelCallRecord, ModelConnectionRecord, VentureDeps, VentureRecord, VentureView } from '../contracts.ts';
import type { ComposedPlan, CompositionRecord, DraftAi, DraftCompose } from '../onboarding-contracts.ts';
import { assembleComposedBlueprint, structureOf } from './blueprint.ts';
import { checklistFor } from './checklist.ts';
import { revalidateComposed } from './compose.ts';
import { countryProfile } from './countries.ts';
import { engineQuestions, storedQuestion, taxRateQuestion } from './interview.ts';
import { classifyIdea } from './service-types.ts';
import { DEFAULT_WORKING_NAME, labelled } from './words.ts';
import { recordPlanEvidence } from '../evidence/ledger.ts';

/** Records are kept for ten years, as tax rules expect; the owner is told under More of your plan and in Trust. */
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

const COMPOSE_ID = /^compose_[A-Za-z0-9_-]{1,80}$/;
const DIGEST = /^[a-f0-9]{64}$/;

/** Minor units as decimal text for the interview's stored amount: '1850' with two digits is '18.50'. Digits only, no arithmetic. */
export function minorText(minor: string, digits: number): string {
  if (digits <= 0) return minor;
  const padded = minor.padStart(digits + 1, '0');
  return `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
}

/** The held plan venture.create may adopt: the engine's own copy, checked again; never anything the renderer sent. */
function heldPlan(deps: VentureDeps, body: Record<string, unknown>, idea: string, countryCode: unknown): { held: DraftCompose; plan: ComposedPlan } | null {
  const hasId = Object.hasOwn(body, 'composeId'), hasDigest = Object.hasOwn(body, 'composedDigest');
  check(hasId === hasDigest, 'INVALID_VENTURE_REQUEST', 'Send the plan id and its digest together.');
  if (!hasId) return null;
  check(typeof body.composeId === 'string' && COMPOSE_ID.test(body.composeId), 'INVALID_VENTURE_REQUEST', 'Send the id of the plan you kept.');
  check(typeof body.composedDigest === 'string' && DIGEST.test(body.composedDigest), 'INVALID_VENTURE_REQUEST', 'Send the digest of the plan you kept.');
  const held = deps.draft?.compose(body.composeId) ?? null;
  check(held, 'COMPOSE_NOT_FOUND', 'Your plan was only kept in memory, and it is gone. Make it again.');
  check(held.plan.digest === body.composedDigest, 'APPROVAL_STALE', 'Your plan changed since you read it. Read it again, then keep it.');
  check(held.plan.text === idea && held.plan.country.code === countryCode, 'INVALID_VENTURE_REQUEST', 'This is not the plan you made. Keep the plan from what you wrote.');
  return { held, plan: revalidateComposed(held) };
}

/** The interview a composed plan arrives with, every question answered, so the interview needs no model call. */
function composedInterview(tx: VentureTx, plan: ComposedPlan, callIds: string[], country: CountryProfile): InterviewRecord {
  const first = plan.offers[0];
  const model = first.pricing.model;
  const at = tx.now;
  const answered = (question: ReturnType<typeof storedQuestion>, answer: InterviewRecord['questions'][number]['answer'], minor: string | null = null, bps: string | null = null) =>
    ({ ...question, answer, answerMinor: minor, answerBps: bps, answeredAt: at });
  const [pricing, price, tax] = engineQuestions(country, model);
  // The stored pricing question offers only offer_1's allowed pricing, so a later answer can't pick another.
  const pricingQuestion = { ...pricing, choices: pricing.choices.filter(choice => first.allowedPricing.includes(choice.id as typeof model)) };
  const registered = plan.backOffice.taxRegistered.value;
  const questions: InterviewRecord['questions'] = [
    ...plan.questions.map(q => {
      const { block: _block, answer, ...question } = q;
      return answered(storedQuestion(question), answer ?? { skipped: true });
    }),
    answered(storedQuestion(pricingQuestion), { choiceId: model }),
    first.pricing.unitPriceMinor === null
      ? answered(storedQuestion(price), { skipped: true })
      : answered(storedQuestion(price), { amount: minorText(first.pricing.unitPriceMinor, country.minorDigits) }, first.pricing.unitPriceMinor),
    answered(storedQuestion(tax), { yes: registered }),
  ];
  if (registered) {
    const bps = plan.backOffice.taxRateBps;
    questions.push(answered(storedQuestion(taxRateQuestion(country)), { rate: bpsPercent(bps) }, null, bps));
  }
  check(questions.some(q => q.id === INTERVIEW_IDS.pricingModel), 'INVALID_VENTURE_REQUEST', 'The plan has no pricing question.');
  return {
    ...tx.base('venture-interview'),
    serviceType: labelled(plan.family.value, 'assumption', 'model'),
    questions,
    modelCallIds: [...callIds],
    source: 'model',
  };
}

/** Adopted draft records keep their id, time and every other field; only who and which venture are re-based. */
function rebased<R extends ModelConnectionRecord | ModelCallRecord>(record: R, tx: VentureTx): R {
  return { ...structuredClone(record), ventureId: (tx.venture as VentureRecord).id, memberId: tx.ctx.memberId, epoch: tx.ctx.epoch };
}

/** venture.create { idea, countryCode, workingName?, composeId?, composedDigest? } (admin, inside the app). */
export async function createVenture(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView> {
  requireAppChannel(ctx, 'venture.create');
  const body = exactPayload(payload, ['idea', 'countryCode', 'workingName', 'composeId', 'composedDigest'], ['idea', 'countryCode']);
  const idea = plainText(body.idea, 'Your idea', { min: 10, max: 2000 });
  const named = Object.hasOwn(body, 'workingName') ? singleLine(body.workingName, 'The working name', { min: 2, max: 80 }) : null;
  authorize(deps.store, ctx, 'admin');

  // 0. The plan composed before the vault, when the owner kept one. On hosted there is no draft desk.
  const composed = heldPlan(deps, body, idea, body.countryCode);
  const plan = composed?.plan ?? null;
  const ai: DraftAi | null = deps.draft?.ai() ?? null;
  const workingName = named ?? (plan ? plan.name.value : DEFAULT_WORKING_NAME);

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

  // 5. The venture record and its interview, in one action; with a composed plan also the composition and blueprint
  // version 1; with an AI connected before the vault also its connections and calls (they count toward the cap).
  const connections = ai ? ai.connections.filter(connection => connection.status === 'connected') : [];
  const view = await ventureAction(deps, ctx, 'admin', 'create', tx => {
    check(!tx.venture, 'VENTURE_EXISTS', 'This workspace already has a business. Chausar keeps one business per workspace.');
    const record: VentureRecord = {
      ...tx.base('venture-record'),
      idea,
      ideaDigest: digest(idea),
      workingName,
      country,
      serviceType: plan ? plan.family.value : null,
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
    if (plan && composed) {
      const callIds = [...plan.calls.decide, ...plan.calls.compose];
      const composition: CompositionRecord = {
        ...tx.base('venture-composition'),
        composeId: plan.composeId,
        text: plan.text,
        textDigest: digest(plan.text),
        planKind: plan.kind,
        family: plan.family.value,
        reading: plan.reading.value,
        views: structuredClone(plan.views),
        output: structuredClone(composed.held.output),
        pricing: plan.offers.map(offer => ({ id: offer.id as CompositionRecord['pricing'][number]['id'], model: offer.pricing.model, unitPriceMinor: offer.pricing.unitPriceMinor })),
        answers: plan.questions.filter(q => q.answer !== null).map(q => ({ questionId: q.id as CompositionRecord['answers'][number]['questionId'], answer: structuredClone(q.answer!) })),
        decideCallIds: [...plan.calls.decide],
        composeCallIds: [...plan.calls.compose],
        writtenBy: { ...plan.writtenBy },
        planDigest: plan.digest,
      };
      tx.put(composition);
      tx.emit('plan-composed', { composeId: plan.composeId, kind: plan.kind, views: plan.views.map(view => view.id) });
      const interview = composedInterview(tx, plan, callIds, country);
      tx.put(interview);
      tx.emit('interview-updated', { source: 'model', questions: interview.questions.length });
      const structure = structureOf(record, interview, composition);
      const blueprint = assembleComposedBlueprint(tx, structure, interview, composition, plan);
      tx.put(blueprint);
      // The evidence ledger: the AI wrote these business fields at compose fill, and the owner kept them.
      recordPlanEvidence(tx, blueprint);
      tx.touch({ blueprintId: blueprint.id, status: 'blueprint' });
      tx.emit('blueprint-drafted', { blueprintId: blueprint.id, version: blueprint.version, source: 'model' });
    } else {
      const interview: InterviewRecord = {
        ...tx.base('venture-interview'),
        serviceType: { value: classifyIdea(idea), label: 'assumption', by: 'template' },
        questions: [],
        modelCallIds: [],
        source: 'template',
      };
      tx.put(interview);
    }
    // Every call made before the vault is adopted, even when no connection is left: the plan's records name them,
    // and they count toward this month's cap. Only connected connections come along and announce themselves.
    if (ai) {
      for (const connection of connections) tx.put(rebased(connection, tx));
      for (const call of ai.calls) tx.put(rebased(call, tx));
      for (const connection of connections) tx.emit('model-connected', { presetId: connection.presetId, tiers: [...connection.tiers] });
    }
    if (retentionChanged) tx.emit('retention-changed', { from: before, to: VENTURE_RETENTION_DAYS });
    const view = buildView(tx.state);
    check(view, 'VENTURE_NOT_FOUND', 'Start a business first.');
    return view;
  }, { create: true });

  // 6. After the commit, never inside it: the keys move to the vault's shelf, then the draft is wiped.
  if (deps.draft) {
    if (connections.length) deps.draft.moveKeys(deps.secrets);
    deps.draft.settle();
  }
  // Connecting changes send nothing to send question shapes, as the consent text says (venture.models.connect does the same).
  if (connections.some(connection => connection.presetId !== 'built-in-templates') && deps.store.read().policy.send === 'nothing') {
    await deps.services.trust.updatePolicy(ctx, { send: 'shape' });
    await ventureAction(deps, ctx, 'admin', 'models.send-policy', tx => { tx.emit('send-policy-changed', { from: 'nothing', to: 'shape' }); });
    return buildView(deps.store.read()) ?? view;
  }
  return view;
}

/** venture.get {} (read): the venture with its checklist and terms, or null before one exists. */
export async function getVenture(deps: VentureDeps, ctx: Context, payload: unknown): Promise<VentureView | null> {
  exactPayload(payload, []);
  authorize(deps.store, ctx);
  return buildView(deps.store.read());
}
