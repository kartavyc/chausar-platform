// Chausar venture launcher, core (Ink v2 wave 4, package 4J8; catalogue U3, the business picker): "Add this to
// {business}" on Start. With a business open, venture.blueprint.suggest asks that business's own AI how the plan should
// change to take in the owner's sentence, with a dropped file as background only (core/attachment.ts, the same screen
// as the composer's drop). The owner's words pass the shared screen (screenReadback) first.
//
// It answers a draft patch in exactly the shape venture.blueprint.update takes, bound to the plan version it read
// (basedOn, so a plan changed since is refused as stale), each change in plain words from code, and writes nothing to
// the plan: the owner applies the patch with venture.blueprint.update (their own action, so the words become the
// owner's), then accepts the plan as today. It may change the one line summary, the customer line and the words of
// offers that are not a flagship playbook's own, and add at most one offer (core/owner-offers.ts keeps it across every
// rewrite). It never sets a price: no word it writes may hold a number or a price (core/words.ts noNumberWords), and a
// new offer starts with none, so Today's "Set your prices" names it. The model call itself is recorded, as every call
// is, for "What was sent" and the spend cap; a call that carries a file is client data, recorded as 'owner-file-drop'.
import { authorize, check, ChausarError, type Context } from '../../contracts.ts';
import { PURPOSE_TIER } from '../contracts.ts';
import type {
  BlueprintPatch, BlueprintRecord, Json, ModelOutcome, ModelTask, PlanChangeView, PlanSuggestionView, PricingModel, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { OPEN_BOX_TEXT, WORD_CAPS } from '../onboarding-contracts.ts';
import { copiedTokens, exactPayload, plainText, requireAppChannel, requireVenture } from '../records.ts';
import { droppedFile, screenedFile, sendFileDropTask, withFile, type DroppedFile } from './attachment.ts';
import { isComposedRecord } from './blueprint.ts';
import { isPricingModel } from './interview.ts';
import { latestBlueprint } from './lookups.ts';
import { OWNER_OFFERS_MAX } from './owner-offers.ts';
import { screenReadback } from './secrets.ts';
import { noMarkup, noNumberWords, styledWords, wordCap } from './words.ts';

export const SUGGEST_MARKER = 'chausar-plan-suggest-v1';
/** What a suggestion can't do, said with every one. */
export const SUGGEST_LEFT = 'This can reword your plan and add one offer at a time. It never sets a price: a new offer starts with none, for you to set.';
/** A second refusal of the AI's answer, said plainly. */
export const SUGGEST_REFUSED = "The AI's suggestion failed Chausar's checks twice. Nothing changed. Try again, or edit your plan yourself.";
const NO_AI = 'Connect your AI first. It suggests the change; you apply it.';
const REJECTED = 'MODEL_OUTPUT_REJECTED';

const INSTRUCTIONS = `${SUGGEST_MARKER}. The owner runs the business under plan and wants to add what they wrote under ask. `
  + 'Rewrite only these words so the plan takes it in where it fits: oneLiner (one sentence on what the business does), customer '
  + '(who it is for), and the name and description of each offer under plan.offers, keeping every offer id and its order. '
  + 'Offers under plan.fixedOffers belong to a playbook: read them, never rewrite them. Give back words that need no change exactly '
  + 'as they are. When the ask needs a service the plan does not sell, put one new offer under addOffers with its name, description '
  + 'and pricingModel (monthly, project or hourly); otherwise leave addOffers empty. Never write a price, a fee, a rate, a cost or a '
  + 'discount, and never write a number, in digits or in words. Plain words, no dashes, no hype.';
const COMPOSED_LINE = ' Keep the one line summary and the customer line to twenty four words or fewer, offer names to four words or fewer and descriptions to thirty.';
const FULL_LINE = ' The plan holds as many added offers as it can, so leave addOffers empty.';

export type SuggestedOffer = { name: string; description: string; pricingModel: PricingModel };
export type SuggestOutput = { oneLiner: string; customer: string; offers: { id: string; name: string; description: string }[]; addOffers: SuggestedOffer[] };

/** The offers whose words a suggestion may change: every offer that is not a flagship playbook's own. */
function editableOffers(blueprint: BlueprintRecord): BlueprintRecord['offers'] {
  return blueprint.offers.filter(offer => !offer.playbookOffer);
}

/** Whether the plan has room for one more offer the owner adds. */
function canAdd(blueprint: BlueprintRecord): boolean {
  return blueprint.offers.filter(offer => offer.addedByOwner).length < OWNER_OFFERS_MAX;
}

/** Name-like tokens the owner or the plan already wrote (B2B, GST); never a number. */
function allowedTokens(venture: VentureRecord, blueprint: BlueprintRecord, words: string): string[] {
  return copiedTokens(venture.idea, words, blueprint.oneLiner.value, blueprint.customer.value, ...blueprint.offers.flatMap(offer => [offer.name.value, offer.description.value]));
}

function schemaFor(ids: readonly string[]): Json {
  const line = (description: string) => ({ type: 'string', description });
  const schema: { [key: string]: Json } = {
    type: 'object', additionalProperties: false, required: ['oneLiner', 'customer', 'addOffers'],
    properties: {
      oneLiner: line('One sentence on what the business does. No numbers or prices.'), customer: line('Who it is for. No numbers.'),
      addOffers: {
        type: 'array', description: 'At most one new offer, only when the ask needs a service the plan does not sell.',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'description', 'pricingModel'],
          properties: { name: line('Offer name. No numbers or prices.'), description: line('One sentence. No numbers or prices.'), pricingModel: { type: 'string', enum: ['monthly', 'project', 'hourly'] } },
        },
      },
    },
  };
  if (ids.length) {
    (schema.required as string[]).splice(2, 0, 'offers');
    (schema.properties as { [key: string]: Json }).offers = {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['id', 'name', 'description'],
        properties: { id: { type: 'string', enum: [...ids] }, name: line('Offer name. No numbers or prices.'), description: line('One sentence. No numbers or prices.') },
      },
    };
  }
  return schema;
}

/**
 * Local authority over the AI's answer: exactly the summary, the customer line, the plan's editable offers back in
 * order with their own ids (when it has any), and at most one new offer (none once the plan is full). Every string is
 * checked words (no amount of money, house style, no claim of finished work, no markup), then holds no number in
 * digits or words and no price talk, in every field; a composed plan keeps its word caps. MODEL_OUTPUT_REJECTED
 * otherwise.
 */
export function validateSuggestOutput(raw: unknown, blueprint: BlueprintRecord, allowed: readonly string[]): SuggestOutput {
  const editable = editableOffers(blueprint);
  const composed = isComposedRecord(blueprint);
  const keys = editable.length ? ['oneLiner', 'customer', 'offers', 'addOffers'] : ['oneLiner', 'customer', 'addOffers'];
  const body = exactPayload(raw, keys, keys, REJECTED);
  const words = (value: unknown, field: string, max: number, cap: number) => {
    const text = styledWords(value, field, max, allowed);
    noNumberWords(text, field, allowed);
    if (composed) wordCap(text, field, cap);
    return noMarkup(text, field);
  };
  const oneLiner = words(body.oneLiner, 'one line summary', 160, WORD_CAPS.oneLiner);
  const customer = words(body.customer, 'customer line', 200, WORD_CAPS.customer);
  let offers: SuggestOutput['offers'] = [];
  if (editable.length) {
    check(Array.isArray(body.offers) && body.offers.length === editable.length, REJECTED, 'The AI changed the offers in the plan.');
    offers = (body.offers as unknown[]).map((item, index) => {
      const offer = exactPayload(item, ['id', 'name', 'description'], ['id', 'name', 'description'], REJECTED);
      check(offer.id === editable[index].id, REJECTED, 'The AI changed the offers in the plan.');
      return {
        id: editable[index].id,
        name: words(offer.name, 'offer name', 60, WORD_CAPS.offerName),
        description: words(offer.description, 'offer description', 200, WORD_CAPS.offerDescription),
      };
    });
  }
  check(Array.isArray(body.addOffers) && body.addOffers.length <= (canAdd(blueprint) ? 1 : 0), REJECTED, 'The AI added more offers than the plan can take.');
  const addOffers = (body.addOffers as unknown[]).map(item => {
    const offer = exactPayload(item, ['name', 'description', 'pricingModel'], ['name', 'description', 'pricingModel'], REJECTED);
    check(isPricingModel(offer.pricingModel), REJECTED, 'The new offer was not charged per month, per project or per hour.');
    return {
      name: words(offer.name, 'new offer name', 60, WORD_CAPS.offerName),
      description: words(offer.description, 'new offer description', 200, WORD_CAPS.offerDescription),
      pricingModel: offer.pricingModel,
    };
  });
  return { oneLiner, customer, offers, addOffers };
}

/**
 * The model task for one suggestion: the owner's screened words, the plan's own words (the offers it may change, and a
 * flagship playbook's offers by name as context only) and the screened file as background, which makes it client data.
 */
export function suggestTask(input: { venture: VentureRecord; blueprint: BlueprintRecord; words: string; file: DroppedFile | null }): ModelTask<SuggestOutput> {
  const { venture, blueprint, words, file } = input;
  const editable = editableOffers(blueprint);
  const allowed = allowedTokens(venture, blueprint, words);
  const task: ModelTask<SuggestOutput> = {
    purpose: 'plan-suggest',
    instructions: `${INSTRUCTIONS}${isComposedRecord(blueprint) ? COMPOSED_LINE : ''}${canAdd(blueprint) ? '' : FULL_LINE}`,
    input: {
      ask: words,
      plan: {
        name: blueprint.name.value, serviceType: blueprint.serviceType, oneLiner: blueprint.oneLiner.value, customer: blueprint.customer.value,
        offers: editable.map(offer => ({ id: offer.id, name: offer.name.value, description: offer.description.value, pricingModel: offer.pricing.model })),
        fixedOffers: blueprint.offers.filter(offer => offer.playbookOffer).map(offer => offer.name.value),
      },
    },
    schemaName: 'venture-plan-suggest',
    schema: schemaFor(editable.map(offer => offer.id)),
    validate: raw => validateSuggestOutput(raw, blueprint, allowed),
    containsClientData: false,
    maxOutputTokens: 1024,
  };
  return withFile(task, file);
}

const PER: Readonly<Record<PricingModel, string>> = Object.freeze({ monthly: 'per month', project: 'per project', hourly: 'per hour' });

/**
 * The patch update takes, with only what changed, and each change in plain words. estimate is always false: the words
 * hold no number.
 */
export function planChanges(blueprint: BlueprintRecord, output: SuggestOutput): { patch: BlueprintPatch; changes: PlanChangeView[] } {
  const patch: BlueprintPatch = {};
  const changes: PlanChangeView[] = [];
  const differs = (before: string, after: string) => before.trim() !== after.trim();
  const change = (field: PlanChangeView['field'], offerId: string | null, before: string, after: string, line: string) =>
    changes.push({ field, offerId, before, after, line, estimate: false });
  if (differs(blueprint.oneLiner.value, output.oneLiner)) {
    patch.oneLiner = output.oneLiner;
    change('oneLiner', null, blueprint.oneLiner.value, output.oneLiner, `Your one line summary becomes: ${output.oneLiner}`);
  }
  if (differs(blueprint.customer.value, output.customer)) {
    patch.customer = output.customer;
    change('customer', null, blueprint.customer.value, output.customer, `Who it is for becomes: ${output.customer}`);
  }
  const offers: NonNullable<BlueprintPatch['offers']> = [];
  for (const offer of output.offers) {
    const current = blueprint.offers.find(item => item.id === offer.id);
    if (!current) continue;
    const entry: NonNullable<BlueprintPatch['offers']>[number] = { id: offer.id };
    if (differs(current.name.value, offer.name)) {
      entry.name = offer.name;
      change('offer-name', offer.id, current.name.value, offer.name, `${current.name.value} is renamed ${offer.name}.`);
    }
    if (differs(current.description.value, offer.description)) {
      entry.description = offer.description;
      change('offer-description', offer.id, current.description.value, offer.description, `${entry.name ?? current.name.value} gets a new description: ${offer.description}`);
    }
    if (Object.keys(entry).length > 1) offers.push(entry);
  }
  if (offers.length) patch.offers = offers;
  const [added] = output.addOffers;
  if (added) {
    patch.addOffer = { name: added.name, description: added.description, pricingModel: added.pricingModel };
    change('offer-added', null, '', added.name, `A new offer, ${added.name}, charged ${PER[added.pricingModel]}: ${added.description} It has no price until you set one.`);
  }
  return { patch, changes };
}

/** One call, and one repair with the engine's own words for what was wrong; a second refusal is said plainly. */
async function sendOnce(deps: VentureDeps, ctx: Context, task: ModelTask<SuggestOutput>): Promise<ModelOutcome<SuggestOutput>> {
  try { return await sendFileDropTask(deps.models, ctx, task); } catch (error: any) {
    if (error?.code !== REJECTED) throw error;
    const problem = typeof error.message === 'string' && error.message ? error.message : "The answer did not pass Chausar's checks.";
    try {
      return await sendFileDropTask(deps.models, ctx, { ...task, instructions: `${task.instructions} Your last answer was refused: ${problem} Answer again, following every rule.` });
    } catch (again: any) {
      if (again?.code === REJECTED) throw new ChausarError(REJECTED, SUGGEST_REFUSED);
      throw again;
    }
  }
}

/**
 * venture.blueprint.suggest { text, attachment? } (level prepare, app only): a suggested change to the open business's
 * plan, as a patch for venture.blueprint.update with the plan it was made from, and plain words for each change.
 * Writes nothing to the plan.
 */
export async function blueprintSuggest(deps: VentureDeps, ctx: Context, payload: unknown): Promise<PlanSuggestionView> {
  requireAppChannel(ctx, 'venture.blueprint.suggest');
  const body = exactPayload(payload, ['text', 'attachment'], ['text']);
  const text = plainText(body.text, 'What you want to add', { min: OPEN_BOX_TEXT.min, max: OPEN_BOX_TEXT.max });
  // Keys, card, Aadhaar, bank account, OTP and PAN never leave the computer in the owner's words.
  const words = screenReadback(text).text;
  const dropped = Object.hasOwn(body, 'attachment') ? screenedFile(droppedFile(body.attachment)) : null;
  authorize(deps.store, ctx, 'prepare');
  const state = deps.store.read();
  const venture = requireVenture(state);
  const blueprint = latestBlueprint(state, venture.id);
  check(blueprint, 'BLUEPRINT_NOT_FOUND', 'Write your plan first.');
  const tier = deps.models.status(ctx).tiers[PURPOSE_TIER['plan-suggest']];
  check(!!tier && tier.presetId !== 'built-in-templates' && tier.usable !== false, 'NO_MODEL_CONNECTED', NO_AI);
  const outcome = await sendOnce(deps, ctx, suggestTask({ venture, blueprint, words, file: dropped?.context ?? null }));
  check(outcome.by === 'model', 'NO_MODEL_CONNECTED', NO_AI);
  const { patch, changes } = planChanges(blueprint, outcome.value);
  const count = changes.length;
  return {
    basedOn: { blueprintId: blueprint.id, digest: blueprint.digest },
    patch: count ? patch : null,
    changes,
    ...(dropped ? { attachment: dropped.note } : {}),
    left: SUGGEST_LEFT,
    line: count ? `${count} ${count === 1 ? 'change' : 'changes'} to your plan. Nothing changes until you apply them.` : 'Your plan already covers this. Nothing to change.',
    callId: outcome.callId ?? null,
  };
}
