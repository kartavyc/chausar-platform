// Chausar venture launcher, chief (Ink v2 wave 4, package 4C1): "Good fit for you" on Start. The owner's AI picks one
// way to earn from the ways Chausar lists (venture.playbooks.list, 4J8) and the kinds of business the owner already
// runs; it is the AI's judgement, so it always comes labelled a model estimate. Only the ways and the business kinds
// are sent, never client data or a business name. With templates only there is no fit to show (null).
import { authorize, ChausarError, type Context } from '../../contracts.ts';
import { PURPOSE_TIER } from '../contracts.ts';
import type { ChiefFit, Json, ModelTask, VentureDeps, WaysView } from '../contracts.ts';
import { currentVenture, exactPayload, houseStyleFindings, tidyWords } from '../records.ts';
import { statesMoney } from '../delivery/harness/patches.ts';
import { PACKAGE_LOADERS } from '../host.ts';

/** The line shown when the AI's own words do not pass: the fit still stands, said plainly. */
export const FIT_LINE = 'Good fit for you, as your AI judges it.';
const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const SHAPE_ERRORS: ReadonlySet<string> = new Set(['MODEL_OUTPUT_REJECTED', 'MODEL_REFUSAL', 'MODEL_INCOMPLETE']);

type FitOutput = { wayId: string; line: string };

function validateFit(raw: unknown): FitOutput {
  const value = raw as Record<string, unknown> | null;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== 2) throw new ChausarError('MODEL_OUTPUT_REJECTED', 'The fit was not a way and a line.');
  if (typeof value.wayId !== 'string' || value.wayId.length > 80 || typeof value.line !== 'string' || value.line.length > 300 || HIDDEN.test(value.line)) {
    throw new ChausarError('MODEL_OUTPUT_REJECTED', 'The fit was not a way and a short plain line.');
  }
  return { wayId: value.wayId, line: value.line };
}

const SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['wayId', 'line'],
  properties: { wayId: { type: 'string', description: 'The id of one way from the list.' }, line: { type: 'string', description: 'One short sentence on why it fits.' } },
};
const INSTRUCTIONS = 'Pick the one way to earn from the list that fits this owner best, given the kinds of business they already run. Say why in one short plain sentence, with no prices or amounts of money. Give the way\'s id exactly as listed.';

/** The AI's line as shown: tidy, short, no money and in house style, else the plain fit line. */
function fitLine(words: string): string {
  const line = tidyWords(words);
  if (line.length < 3 || line.length > 200 || statesMoney(line, '') || houseStyleFindings(line).length) return FIT_LINE;
  return line;
}

/** Whether an AI serves the fit's tier now; with templates only there is no judgement to give. */
function aiServes(deps: VentureDeps, ctx: Context): boolean {
  try {
    const tier = deps.models.status(ctx).tiers[PURPOSE_TIER['chief-fit']];
    return !!tier && tier.presetId !== 'built-in-templates' && tier.usable;
  } catch {
    return false;
  }
}

/**
 * The fit from these ways: the AI's pick, if it names a way on the list, with its line, labelled a model estimate.
 * Null with templates only, with no ways, when the pick is not on the list, or when the AI's answer does not pass.
 */
export async function chiefFit(deps: VentureDeps, ctx: Context, ways: WaysView): Promise<ChiefFit | null> {
  if (!aiServes(deps, ctx) || !ways.ways.length) return null;
  const task: ModelTask<FitOutput> = {
    purpose: 'chief-fit', instructions: INSTRUCTIONS,
    input: {
      ways: ways.ways.map(way => ({ id: way.id, label: way.label, category: way.category, hours: way.hours, team: way.team.map(member => member.role) })),
      yours: ways.ways.filter(way => way.yours.length > 0).map(way => way.label),
    },
    schemaName: 'venture-chief-fit', schema: SCHEMA, validate: validateFit, containsClientData: false, maxOutputTokens: 300,
  };
  let picked: FitOutput;
  try {
    const outcome = await deps.models.generate(ctx, task);
    if (outcome.by !== 'model') return null;
    picked = outcome.value;
  } catch (error) {
    if (SHAPE_ERRORS.has((error as { code?: string } | null)?.code ?? '')) return null;
    throw error;
  }
  const way = ways.ways.find(item => item.id === picked.wayId);
  return way ? { wayId: way.id, line: fitLine(picked.line), estimate: true } : null;
}

/**
 * The ways to earn, from core's listWays (4J8), with the open business on its way's list of businesses the owner runs
 * (core's openWayBusiness: its kind, from its idea); null when core does not list ways.
 */
export async function listedWays(deps: VentureDeps): Promise<WaysView | null> {
  const core = await PACKAGE_LOADERS.core();
  const list = core.listWays, open = core.openWayBusiness;
  if (typeof list !== 'function') return null;
  const state = deps.store.read();
  const businessId = deps.workspace?.current().id ?? currentVenture(state)?.id ?? 'open';
  const business = typeof open === 'function' ? (open as (state: unknown, businessId: string) => unknown)(state, businessId) : null;
  return await (list as (payload: unknown, businesses: unknown[]) => WaysView | Promise<WaysView>)({}, business ? [business] : []);
}

/** venture.chief.fit {} (prepare): one way to earn that fits, labelled a model estimate, or null with no AI or no ways listed yet. */
export async function chiefFitHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ChiefFit | null> {
  exactPayload(payload, []);
  authorize(deps.store, ctx, 'prepare');
  if (!aiServes(deps, ctx)) return null;
  const ways = await listedWays(deps);
  return ways ? chiefFit(deps, ctx, ways) : null;
}
