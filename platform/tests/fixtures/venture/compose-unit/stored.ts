// A composed plan as a vault may still hold one. The plan composer is gone, so nothing writes these records any more;
// the code that reads them stays (the structure from a composition, a rewrite that keeps the composed parts, the brief
// from the plan's own pages). These helpers write the records straight into the vault, in the shape venture.create
// wrote them: the venture-composition record, and blueprint version 1 with its blocks, pages, tools and notes.
import type { Engine } from '../../../../runtime/engine.ts';
import type { BlueprintRecord, BlueprintView, InterviewRecord, VentureRecord } from '../../../../runtime/venture/contracts.ts';
import type { ComposeModelOutput, CompositionRecord } from '../../../../runtime/venture/onboarding-contracts.ts';
import { copiedTokens, digest } from '../../../../runtime/venture/records.ts';
import { APPROVAL_BLOCKS } from '../../../../runtime/venture/core/blocks.ts';
import { blueprintDigest, structureFromBlueprint, structureOf } from '../../../../runtime/venture/core/blueprint.ts';
import { labelled, modelLine } from '../../../../runtime/venture/core/words.ts';
import { flagshipPlan } from '../../../../runtime/venture/playbooks/plan.ts';
import { answerInterview, PASSPHRASE } from './harness.ts';
import type { DecideModelOutput } from './plans.ts';

export type StoredPlan = {
  text: string;
  decide: DecideModelOutput;
  output: ComposeModelOutput;
  /** The owner's price for an offer before the vault, in minor units, by offer id; offer_1's comes from the interview. */
  prices?: Record<string, string>;
};

/**
 * The venture-composition record venture.create wrote for a kept plan, for this venture. For a flagship idea the kept
 * plan's offers were the playbook's, so the stored pricing is theirs.
 */
export function storedComposition(venture: VentureRecord, plan: StoredPlan): CompositionRecord {
  const { decide, output } = plan;
  const offers = flagshipPlan(plan.text)?.offers.map(offer => offer.model) ?? output.offers.map(offer => offer.pricingModel);
  return {
    id: 'composition_stored', kind: 'venture-composition', ventureId: venture.id, memberId: venture.memberId, epoch: venture.epoch, at: venture.at,
    composeId: 'compose_stored',
    text: plan.text,
    textDigest: digest(plan.text),
    planKind: decide.kind,
    family: decide.family,
    reading: decide.reading,
    views: decide.views.map(id => {
      const slot = output.views[id];
      return 'lead' in slot ? { id: id as 'pages', lead: [...slot.lead] } : { id: 'audience-first' as const, who: labelled(slot.who, 'assumption', 'model'), pain: labelled(slot.pain, 'assumption', 'model') };
    }),
    output: structuredClone(output),
    pricing: offers.map((model, index) => {
      const id = `offer_${index + 1}` as CompositionRecord['pricing'][number]['id'];
      return { id, model, unitPriceMinor: plan.prices?.[id] ?? null };
    }),
    answers: [],
    decideCallIds: [],
    composeCallIds: [],
    writtenBy: { presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', replay: true },
    planDigest: digest(output),
  };
}

/**
 * A business whose vault holds a composed plan: made as today (the vault, venture.create, the built-in interview with
 * offer_1's way to charge and its price), then the composition and blueprint version 1 written into the vault. Not for
 * a flagship idea: its offers come from the playbook, never from the composed words.
 */
export async function storedComposedBusiness(engine: Engine, input: StoredPlan & { name: string; countryCode: string; price?: string }): Promise<BlueprintView> {
  await engine.request('workspace.create', { name: input.name, passphrase: PASSPHRASE, pack: 'services' });
  await engine.request('venture.create', { idea: input.text, countryCode: input.countryCode, workingName: input.name });
  await answerInterview(engine, {
    q_pricing_model: { choiceId: input.output.offers[0].pricingModel },
    ...(input.price ? { q_price: { amount: input.price } } : {}),
  });
  await engine.vault!.update(state => {
    const venture = state.conversations.find((record: any) => record.kind === 'venture-record') as VentureRecord;
    const interview = state.conversations.find((record: any) => record.kind === 'venture-interview') as InterviewRecord;
    venture.serviceType = input.decide.family;
    const composition = storedComposition(venture, input);
    const structure = structureOf(venture, interview, composition);
    const blocks = structure.blocks!;
    const say = (value: string) => modelLine(value, copiedTokens(input.text));
    const { output } = input;
    const blueprint: BlueprintRecord = {
      id: 'blueprint_stored', kind: 'venture-blueprint', ventureId: venture.id, memberId: venture.memberId, epoch: venture.epoch, at: venture.at,
      country: structuredClone(venture.country),
      version: 1,
      status: 'draft',
      source: 'model',
      structureHash: '',
      digest: '',
      modelCallIds: [],
      serviceType: structure.serviceType,
      name: say(output.name),
      oneLiner: say(output.oneLiner),
      customer: say(output.customer),
      offers: structure.offers.map((offer, index) => ({
        id: offer.id, block: blocks.offers[index], name: say(output.offers[index].name), description: say(output.offers[index].description), pricing: structuredClone(offer.pricing),
      })),
      deliverySteps: structure.steps.map((step, index) => ({
        id: step.id, block: blocks.steps[index], title: say(output.steps[index].title), doneBy: step.doneBy, capability: step.capability, note: step.note,
      })),
      approvals: blocks.approvals.map(block => labelled(APPROVAL_BLOCKS[block].words, 'assumption', 'engine')),
      backOffice: structuredClone(structure.backOffice),
      starterConnectorIds: [...structure.starterConnectorIds],
      composition: { id: composition.id, composeId: composition.composeId, kind: composition.planKind, views: structuredClone(composition.views) },
      approvalBlocks: [...blocks.approvals],
      pages: output.pages.map((page, index) => ({ id: `page_${index + 1}` as 'page_1', block: page.block, title: say(page.title), purpose: say(page.purpose) })),
      tools: output.tools.map(tool => ({ block: tool.block, reason: say(tool.reason) })),
      notes: output.notes.map(block => ({ block, text: `Check before you start: ${block}.` })),
    };
    blueprint.structureHash = digest(structureFromBlueprint(blueprint));
    blueprint.digest = blueprintDigest(blueprint);
    venture.blueprintId = blueprint.id;
    venture.status = 'blueprint';
    state.conversations.push(composition, blueprint);
  });
  return await engine.request('venture.blueprint.get', {}) as BlueprintView;
}
