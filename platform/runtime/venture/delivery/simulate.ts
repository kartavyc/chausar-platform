// Chausar venture launcher, delivery package (P5): rehearsal with made-up clients.
// Every model call runs outside any transaction; one transaction stores the run at the end.
// Every outside effect is a record-only mock: what would have been sent is digested, never sent.
import { check, type Context } from '../../contracts.ts';
import { digest, exactPayload, findRecord, formatMicros, identifier, modelWords, smallInteger, sumMicros, ventureAction } from '../records.ts';
import type {
  BlueprintRecord, ClientSimModelOutput, CountryProfile, Deliverable, Episode, EpisodeTurn, Json, JudgeAnswer, MockEffect, ModelOutcome,
  ModelTask, PlaybookRecord, PriceReceiptRecord, Scenario, ServiceType, SimulationRunRecord, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { firstFailedCheck, runChecks } from './checks.ts';
import { deliveryTask, draftAllowedTokens, rehearsalRefs, renderDeliverable, renderForJudge, type DraftRefs } from './deliverable.ts';
import { judgedAnswers, judgeTask, notJudged } from './judge.ts';
import { ensurePlaybook } from './playbook.ts';
import { listScenarios, signalScenario } from './scenarios.ts';
import { acceptedBlueprint, errorCode, optionalFlag, quote, readAs, serviceTypeOf, todayIso, ventureReceipts } from './shared.ts';

export const CLIENT_SIM_INSTRUCTIONS = 'You play a made-up client of a small service business, for a practice run. '
  + 'Write the client\'s next message as that person would, following the persona and the brief, and answer any questions in the history. '
  + 'Set asksForPerson to true only when the client insists on talking to a person. '
  + 'Never write digits, prices, dates as numbers or amounts. Plain words, no dashes.';
/** What the template practice client says when asked a follow-up question. */
export const TEMPLATE_CLIENT_ANSWER = 'That is all I can share for now. Please go ahead with what you have.';
export const PERSON_FAILURE = 'The practice client asked for a person.';
const ESTIMATE_WORDS = ' (estimate, price unconfirmed)';
/** Model errors that describe how the model behaved; a rehearsal records them as a failed episode instead of stopping. */
const BEHAVIOUR_CODES = new Set(['MODEL_OUTPUT_REJECTED', 'MODEL_REFUSAL', 'MODEL_INCOMPLETE']);
const MAX_SCENARIOS_PER_RUN = 12;

const CLIENT_SIM_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['message', 'asksForPerson'],
  properties: {
    message: { type: 'string', description: 'What the client writes next. No digits.' },
    asksForPerson: { type: 'boolean', description: 'True only when the client insists on a person.' },
  },
};

type HistoryEntry = { from: 'client'; text: string } | { from: 'agent'; questions: string[] };

export function validateClientSim(raw: unknown): ClientSimModelOutput {
  check(raw !== null && typeof raw === 'object' && !Array.isArray(raw), 'MODEL_OUTPUT_REJECTED', 'The practice client did not answer in the expected shape.');
  const record = raw as Record<string, unknown>;
  check(Object.keys(record).length === 2 && Object.hasOwn(record, 'message') && typeof record.asksForPerson === 'boolean', 'MODEL_OUTPUT_REJECTED', 'The practice client did not answer in the expected shape.');
  return { message: modelWords(record.message, 'practice client message', 1200), asksForPerson: record.asksForPerson as boolean };
}

export function clientSimTask(scenario: Scenario, serviceType: ServiceType, history: HistoryEntry[]): ModelTask<ClientSimModelOutput> {
  return {
    purpose: 'client-sim',
    instructions: CLIENT_SIM_INSTRUCTIONS,
    input: { persona: scenario.persona, brief: scenario.brief, serviceType, history: history as unknown as Json },
    schemaName: 'venture-client-sim',
    schema: CLIENT_SIM_SCHEMA,
    validate: validateClientSim,
    template: () => ({ message: history.length ? TEMPLATE_CLIENT_ANSWER : scenario.brief, asksForPerson: false }),
    containsClientData: false,
    maxOutputTokens: 1024,
  };
}

type Spend = { by: 'model' | 'template'; costMicros: string; priceConfirmed: boolean };

type RehearsalEnv = {
  deps: VentureDeps;
  ctx: Context;
  useTemplate: boolean;
  judgeOn: boolean;
  venture: VentureRecord;
  blueprint: BlueprintRecord;
  serviceType: ServiceType;
  country: CountryProfile;
  refs: DraftRefs;
  receipts: PriceReceiptRecord[];
  offer: { name: string; description: string };
};

async function ask<T>(env: RehearsalEnv, task: ModelTask<T>, spend: Spend[]): Promise<ModelOutcome<T>> {
  let outcome: ModelOutcome<T>;
  if (env.useTemplate) {
    check(task.template, 'NO_MODEL_CONNECTED', 'Connect an AI first, or use built-in templates.');
    outcome = { value: task.template(), by: 'template', callId: null, presetId: 'built-in-templates', model: null, costMicros: '0', priceConfirmed: true };
  } else {
    outcome = await env.deps.models.generate(env.ctx, task);
  }
  spend.push({ by: outcome.by, costMicros: outcome.costMicros, priceConfirmed: outcome.priceConfirmed });
  return outcome;
}

function draftTask(env: RehearsalEnv, clientRequest: string): ModelTask<Deliverable> {
  return deliveryTask({
    serviceType: env.serviceType, offer: env.offer, clientRequest, idea: env.venture.idea, refs: env.refs,
    containsClientData: false, templateTotalRef: 'offer_1.total',
  });
}

/** Runs one practice conversation: client, agent, an optional follow-up round, the record-only send, checks, then the judge. */
async function runEpisode(env: RehearsalEnv, scenario: Scenario, index: number): Promise<{ episode: Episode; spend: Spend[] }> {
  const spend: Spend[] = [];
  const turns: EpisodeTurn[] = [];
  const mocks: MockEffect[] = [];
  let deliverable: Deliverable | null = null;
  let renderedText: string | null = null;
  let step = 'practice client';
  const finish = (fields: Pick<Episode, 'checks' | 'judge' | 'passed' | 'firstFailure'>): { episode: Episode; spend: Spend[] } => ({
    episode: { scenarioId: scenario.id, index, turns, deliverable, renderedText, mocks, ...fields, costMicros: sumMicros(spend.map(item => item.costMicros)) },
    spend,
  });
  try {
    const first = await ask(env, clientSimTask(scenario, env.serviceType, []), spend);
    turns.push({ turn: turns.length + 1, by: 'client', text: first.value.message, author: first.by, callId: first.callId });
    if (first.value.asksForPerson) return finish({ checks: [], judge: notJudged('The episode stopped before a draft.'), passed: false, firstFailure: PERSON_FAILURE });

    let request = first.value.message;
    step = 'draft';
    let draft = await ask(env, draftTask(env, request), spend);
    deliverable = draft.value;
    renderedText = renderDeliverable(deliverable, env.receipts, env.country);
    turns.push({ turn: turns.length + 1, by: 'agent', text: renderedText, author: draft.by, callId: draft.callId });
    let agentTurns = 1;
    let askedQuestions = deliverable.questionsForClient.length > 0;

    if (askedQuestions && scenario.turnLimit >= 2) {
      step = 'practice client';
      const history: HistoryEntry[] = [{ from: 'client', text: request }, { from: 'agent', questions: [...deliverable.questionsForClient] }];
      const reply = await ask(env, clientSimTask(scenario, env.serviceType, history), spend);
      turns.push({ turn: turns.length + 1, by: 'client', text: reply.value.message, author: reply.by, callId: reply.callId });
      if (reply.value.asksForPerson) return finish({ checks: [], judge: notJudged('The episode stopped before the last draft.'), passed: false, firstFailure: PERSON_FAILURE });
      request = `${request}\n\nAnswers: ${reply.value.message}`;
      step = 'draft';
      draft = await ask(env, draftTask(env, request), spend);
      deliverable = draft.value;
      renderedText = renderDeliverable(deliverable, env.receipts, env.country);
      turns.push({ turn: turns.length + 1, by: 'agent', text: renderedText, author: draft.by, callId: draft.callId });
      agentTurns += 1;
      askedQuestions = askedQuestions || deliverable.questionsForClient.length > 0;
    }

    mocks.push({ connector: 'mail-app', operation: 'send-deliverable', payloadDigest: digest(renderedText), recordedAt: env.deps.clock().toISOString() });
    const checks = runChecks({
      checks: scenario.checks, deliverable, renderedText, serviceType: env.serviceType,
      allowed: draftAllowedTokens(request, env.venture.idea), receipts: env.receipts, ventureId: env.venture.id,
      mocks, mockModes: scenario.mocks, agentTurns, turnLimit: scenario.turnLimit, askedQuestions,
    });

    let judge: JudgeAnswer[];
    if (env.judgeOn) {
      step = 'judge';
      const verdict = await ask(env, judgeTask({
        expectedOutcome: scenario.expectedOutcome, persona: scenario.persona,
        draft: renderForJudge(deliverable, env.receipts), figureLabels: env.refs.figures.map(figure => figure.label),
      }), spend);
      judge = judgedAnswers(verdict.value, verdict.callId);
    } else {
      judge = notJudged();
    }
    const failedCheck = firstFailedCheck(checks);
    const judgedNo = judge.find(answer => answer.answer === 'no')?.question ?? null;
    const firstFailure = failedCheck ?? judgedNo;
    return finish({ checks, judge, passed: firstFailure === null, firstFailure });
  } catch (error) {
    if (!BEHAVIOUR_CODES.has(errorCode(error))) throw error;
    const message = error instanceof Error ? error.message : 'The model answer was refused.';
    return finish({ checks: [], judge: notJudged('The episode stopped before a draft was judged.'), passed: false, firstFailure: `The ${step} was refused: ${quote(message, 200)}` });
  }
}

function parseScenarioIds(value: unknown): string[] | null {
  if (value === undefined) return null;
  check(Array.isArray(value) && value.length >= 1 && value.length <= MAX_SCENARIOS_PER_RUN, 'INVALID_VENTURE_REQUEST', `Choose between one and ${MAX_SCENARIOS_PER_RUN} practice clients.`);
  const ids = value.map(item => identifier(item, 'Practice client'));
  check(new Set(ids).size === ids.length, 'INVALID_VENTURE_REQUEST', 'Choose each practice client once.');
  return ids;
}

/** venture.simulation.run: practise on made-up clients with the current playbook. */
export async function simulationRunHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SimulationRunRecord> {
  const body = exactPayload(payload, ['scenarioIds', 'episodes', 'useTemplate']);
  const scenarioIds = parseScenarioIds(body.scenarioIds);
  const episodes = body.episodes === undefined ? null : smallInteger(body.episodes, 'Episodes', 1, 3);
  const useTemplate = optionalFlag(body.useTemplate, 'useTemplate');
  readAs(deps, ctx, 'prepare');
  const startedAt = deps.clock().toISOString();
  const playbook: PlaybookRecord = await ensurePlaybook(deps, ctx);

  const { state, venture } = readAs(deps, ctx, 'prepare');
  const blueprint = acceptedBlueprint(state, venture);
  const available = listScenarios(state, venture.id, blueprint.serviceType);
  const selected = scenarioIds
    ? scenarioIds.map(id => { const found = available.find(scenario => scenario.id === id); check(found, 'SCENARIO_NOT_FOUND', 'That practice client is not in this business.'); return found; })
    : available.filter(scenario => scenario.source === 'template');
  const offer = blueprint.offers.find(item => item.id === 'offer_1') ?? blueprint.offers[0];
  const env: RehearsalEnv = {
    deps, ctx, useTemplate,
    judgeOn: !useTemplate && deps.models.status(ctx).tiers.fast.presetId !== 'built-in-templates',
    venture, blueprint, serviceType: blueprint.serviceType, country: venture.country,
    refs: rehearsalRefs(state, venture.id, blueprint, todayIso(deps, venture)), receipts: ventureReceipts(state, venture.id),
    offer: { name: offer.name.value, description: offer.description.value },
  };

  const results: Episode[] = [];
  const spend: Spend[] = [];
  for (const scenario of selected) {
    const count = episodes ?? scenario.episodes;
    for (let index = 0; index < count; index += 1) {
      const outcome = await runEpisode(env, scenario, index);
      results.push(outcome.episode);
      spend.push(...outcome.spend);
    }
  }

  const scenarioPassed = selected.map(scenario => results.filter(episode => episode.scenarioId === scenario.id).every(episode => episode.passed));
  const passedCount = scenarioPassed.filter(Boolean).length;
  const costMicros = sumMicros(spend.map(item => item.costMicros));
  const estimate = spend.some(item => !item.priceConfirmed);
  const byModel = spend.some(item => item.by === 'model'), byTemplate = spend.some(item => item.by === 'template');
  const modelMode: SimulationRunRecord['modelMode'] = byModel && byTemplate ? 'mixed' : byModel ? 'model' : 'template';
  const finishedAt = deps.clock().toISOString();

  return ventureAction(deps, ctx, 'prepare', 'simulation.run', tx => {
    const run: SimulationRunRecord = {
      ...tx.base('venture-simulation-run'), playbookId: playbook.id, playbookHash: playbook.hash, scenarioIds: selected.map(scenario => scenario.id),
      episodes: results, passed: results.length > 0 && results.every(episode => episode.passed),
      summary: { scenarios: selected.length, passed: passedCount, failed: selected.length - passedCount },
      costMicros, costDisplay: `${formatMicros(costMicros)}${estimate ? ESTIMATE_WORDS : ''}`, startedAt, finishedAt, modelMode,
    };
    tx.put(run);
    if (tx.venture?.status === 'build') tx.touch({ status: 'rehearsal' });
    tx.emit('simulation-finished', { runId: run.id, passed: run.passed, modelMode, scenarioIds: run.scenarioIds });
    return run;
  });
}

export async function simulationGetHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SimulationRunRecord> {
  const body = exactPayload(payload, ['runId'], ['runId']);
  const runId = identifier(body.runId, 'Run');
  const { state, venture } = readAs(deps, ctx, 'read');
  const run = findRecord(state, 'venture-simulation-run', runId);
  check(run && run.ventureId === venture.id, 'SIMULATION_NOT_FOUND', 'That rehearsal was not found.');
  return run;
}

export async function simulationScenariosHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<Scenario[]> {
  exactPayload(payload, []);
  const { state, venture } = readAs(deps, ctx, 'read');
  return listScenarios(state, venture.id, serviceTypeOf(state, venture));
}

/** venture.simulation.fromSignal: turns a rejection, an edit or a failed check into a rehearsal case, without the client's words. */
export async function simulationFromSignalHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<Scenario> {
  const body = exactPayload(payload, ['signalId'], ['signalId']);
  const signalId = identifier(body.signalId, 'Signal');
  readAs(deps, ctx, 'prepare');
  return ventureAction(deps, ctx, 'prepare', 'simulation.fromSignal', tx => {
    const signal = tx.find('venture-signal', signalId);
    check(signal, 'SIGNAL_NOT_FOUND', 'That signal was not found.');
    const type = serviceTypeOf(tx.state, tx.venture!);
    const scenario = signalScenario(signal, type);
    if (signal.scenarioId !== scenario.id) tx.replace({ ...signal, scenarioId: scenario.id });
    return scenario;
  });
}
