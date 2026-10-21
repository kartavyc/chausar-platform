// Chausar venture launcher, delivery package (P5): rehearsal with made-up clients.
// Every model call runs outside any transaction; one transaction stores the run at the end.
// Every outside effect is a record-only mock: what would have been sent is digested, never sent.
// When a practice client sends practice files and an AI serves quick work, the episode runs the agent loop: act turns
// with tools, hand-offs the practice client answers, then the write step with tools off.
import { check, type Context, type State } from '../../contracts.ts';
import { copiedTokens, digest, exactPayload, findRecord, formatMicros, identifier, modelWords, smallInteger, sumMicros, ventureAction } from '../records.ts';
import type {
  BlueprintRecord, ClientSimModelOutput, CountryProfile, Deliverable, Episode, EpisodeTurn, HarnessState, Json, JudgeAnswer, MockEffect, ModelOutcome,
  ModelTask, PlaybookRecord, PriceReceiptRecord, Scenario, ServiceType, SimulationRunRecord, VentureDeps, VentureRecord, WorkReceiptRecord,
  WorkTableRecord,
} from '../contracts.ts';
import { firstFailedCheck, runChecks } from './checks.ts';
import { deliveryTask, draftAllowedTokens, rehearsalRefs, renderDeliverable, renderForJudge, type DraftRefs } from './deliverable.ts';
import { buildToolEnv, fileList, namer } from './harness/env.ts';
import { manifest } from './harness/dictionary.ts';
import {
  actTask, answerHandoff, applyTurn, finishWrite, harnessRefs, newHarnessState, playbookGrant, provenSentences, REPORT_SECTIONS, writeGuidance, writeTask,
} from './harness/loop.ts';
import { practiceFiles } from './harness/practice.ts';
import { judgedAnswers, judgeTask, notJudged } from './judge.ts';
import { ensurePlaybook, playbookLimits } from './playbook.ts';
import { listScenarios, signalScenario } from './scenarios.ts';
import { REQUIRED_SECTIONS } from '../contracts.ts';
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
  /** An AI serves quick work, so the agent loop can take tool turns. */
  agentOn: boolean;
  state: State;
  venture: VentureRecord;
  blueprint: BlueprintRecord;
  playbook: PlaybookRecord;
  serviceType: ServiceType;
  country: CountryProfile;
  refs: DraftRefs;
  receipts: PriceReceiptRecord[];
  offer: { name: string; description: string };
};

type EpisodeResult = { episode: Episode; spend: Spend[]; tables: WorkTableRecord[]; receipts: WorkReceiptRecord[] };

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
    containsClientData: false, templateTotalRef: 'offer_1.total', guidance: writeGuidance(env.playbook),
  });
}

/** Runs one practice conversation: client, agent, an optional follow-up round, the record-only send, checks, then the judge. */
async function runEpisode(env: RehearsalEnv, scenario: Scenario, index: number): Promise<EpisodeResult> {
  const spend: Spend[] = [];
  const turns: EpisodeTurn[] = [];
  const mocks: MockEffect[] = [];
  let deliverable: Deliverable | null = null;
  let renderedText: string | null = null;
  let step = 'practice client';
  const finish = (fields: Pick<Episode, 'checks' | 'judge' | 'passed' | 'firstFailure'>): EpisodeResult => ({
    episode: { scenarioId: scenario.id, index, turns, deliverable, renderedText, mocks, ...fields, costMicros: sumMicros(spend.map(item => item.costMicros)) },
    spend, tables: [], receipts: [],
  });
  try {
    const first = await ask(env, clientSimTask(scenario, env.serviceType, []), spend);
    turns.push({ turn: turns.length + 1, by: 'client', text: first.value.message, author: first.by, callId: first.callId });
    if (first.value.asksForPerson) return finish({ checks: [], judge: notJudged('The episode stopped before a draft.'), passed: false, firstFailure: PERSON_FAILURE });

    if (!env.useTemplate && env.agentOn && practiceFiles(scenario).length && playbookGrant(env.playbook).length) {
      return await runHarnessEpisode(env, scenario, index, first.value.message, { spend, turns, mocks });
    }

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

/**
 * One practice conversation with the agent loop. The practice client answers each hand-off while the scenario's
 * turns allow, then says to go ahead. Tables and receipts the tools made come back for the run to store.
 */
async function runHarnessEpisode(env: RehearsalEnv, scenario: Scenario, index: number, request: string, so: { spend: Spend[]; turns: EpisodeTurn[]; mocks: MockEffect[] }): Promise<EpisodeResult> {
  const { spend, turns, mocks } = so;
  const files = practiceFiles(scenario);
  const answers: string[] = [];
  const toolEnv = buildToolEnv({
    deps: env.deps, ctx: env.ctx, state: env.state, venture: env.venture, playbook: env.playbook, runRef: { kind: 'rehearsal', scenarioId: scenario.id, episode: index }, files,
    allowed: copiedTokens(request, env.venture.idea),
  });
  let state: HarnessState = newHarnessState(playbookGrant(env.playbook), playbookLimits(env.playbook), files.map(file => file.id));
  const loop = {
    serviceType: env.serviceType, offer: env.offer, clientRequest: request, playbook: env.playbook,
    dictionaryManifest: manifest(toolEnv.dictionary), files: fileList(files), containsClientData: false, allowed: toolEnv.allowed, host: env.deps.host,
  };
  let deliverable: Deliverable | null = null;
  let renderedText: string | null = null;
  let step = 'agent turn';
  const result = (fields: Pick<Episode, 'checks' | 'judge' | 'passed' | 'firstFailure'>): EpisodeResult => ({
    episode: { scenarioId: scenario.id, index, turns, deliverable, renderedText, mocks: [...mocks, ...state.mocks], ...fields, costMicros: sumMicros(spend.map(item => item.costMicros)), harness: state },
    spend, tables: toolEnv.tables, receipts: toolEnv.receipts,
  });
  try {
    let clientTurns = 1;
    while (state.phase === 'act' || state.phase === 'needs-answer') {
      if (state.phase === 'needs-answer') {
        const open = state.handoffs[state.handoffs.length - 1];
        turns.push({ turn: turns.length + 1, by: 'agent', text: `Question: ${open.question}`, author: state.turns[state.turns.length - 1].by, callId: state.turns[state.turns.length - 1].callId });
        let answer = TEMPLATE_CLIENT_ANSWER;
        if (clientTurns < scenario.turnLimit) {
          step = 'practice client';
          const reply = await ask(env, clientSimTask(scenario, env.serviceType, [{ from: 'client', text: request }, { from: 'agent', questions: [open.question] }]), spend);
          turns.push({ turn: turns.length + 1, by: 'client', text: reply.value.message, author: reply.by, callId: reply.callId });
          clientTurns += 1;
          if (reply.value.asksForPerson) return result({ checks: [], judge: notJudged('The episode stopped before the last draft.'), passed: false, firstFailure: PERSON_FAILURE });
          answer = reply.value.message;
        }
        answers.push(answer);
        // Words the practice client used may be repeated, like the request's own.
        toolEnv.allowed = copiedTokens(request, env.venture.idea, ...answers);
        loop.allowed = toolEnv.allowed;
        state = answerHandoff(state, answer, 'practice-client');
        continue;
      }
      step = 'agent turn';
      const turn = await ask(env, actTask(loop, state), spend);
      state = await applyTurn(toolEnv, state, turn.value, { by: turn.by, callId: turn.callId, costMicros: turn.costMicros });
    }

    step = 'draft';
    const allowed = copiedTokens(request, env.venture.idea, ...answers);
    const proven = provenSentences(state, toolEnv.receipts, namer(toolEnv));
    const draft = await ask(env, writeTask({ ...loop, idea: env.venture.idea, allowed, priceRefs: env.refs, templateTotalRef: 'offer_1.total', proven }, state, toolEnv.receipts), spend);
    state = finishWrite(state, { by: draft.by, callId: draft.callId, costMicros: draft.costMicros });
    deliverable = draft.value;
    const receipts = [...env.receipts, ...toolEnv.receipts];
    renderedText = renderDeliverable(deliverable, receipts, env.country);
    turns.push({ turn: turns.length + 1, by: 'agent', text: renderedText, author: draft.by, callId: draft.callId });

    mocks.push({ connector: 'mail-app', operation: 'send-deliverable', payloadDigest: digest(renderedText), recordedAt: env.deps.clock().toISOString() });
    const handoffs = state.handoffs.length;
    const checks = runChecks({
      checks: scenario.checks, deliverable, renderedText: renderDeliverable(deliverable, receipts, env.country, { attachments: false }), serviceType: env.serviceType,
      allowed, receipts, ventureId: env.venture.id, mocks: [...mocks, ...state.mocks], mockModes: scenario.mocks,
      agentTurns: 1 + handoffs, turnLimit: scenario.turnLimit, askedQuestions: deliverable.questionsForClient.length > 0 || handoffs > 0,
      sections: state.sections === 'report' ? REPORT_SECTIONS : REQUIRED_SECTIONS[env.serviceType], proofs: state.proofs,
    });

    let judge: JudgeAnswer[];
    if (env.judgeOn) {
      step = 'judge';
      const refs = harnessRefs(env.refs, toolEnv.receipts);
      const verdict = await ask(env, judgeTask({
        expectedOutcome: scenario.expectedOutcome, persona: scenario.persona, draft: renderForJudge(deliverable, receipts),
        figureLabels: refs.figures.map(figure => figure.label), proven,
      }), spend);
      judge = judgedAnswers(verdict.value, verdict.callId);
    } else {
      judge = notJudged();
    }
    const failedCheck = firstFailedCheck(checks);
    const judgedNo = judge.find(answer => answer.answer === 'no')?.question ?? null;
    const firstFailure = failedCheck ?? judgedNo;
    return result({ checks, judge, passed: firstFailure === null, firstFailure });
  } catch (error) {
    if (!BEHAVIOUR_CODES.has(errorCode(error))) throw error;
    const message = error instanceof Error ? error.message : 'The model answer was refused.';
    return result({ checks: [], judge: notJudged('The episode stopped before a draft was judged.'), passed: false, firstFailure: `The ${step} was refused: ${quote(message, 200)}` });
  }
}

function parseScenarioIds(value: unknown): string[] | null {
  if (value === undefined) return null;
  check(Array.isArray(value) && value.length >= 1 && value.length <= MAX_SCENARIOS_PER_RUN, 'INVALID_VENTURE_REQUEST', `Choose between one and ${MAX_SCENARIOS_PER_RUN} practice clients.`);
  const ids = value.map(item => identifier(item, 'Practice client'));
  check(new Set(ids).size === ids.length, 'INVALID_VENTURE_REQUEST', 'Choose each practice client once.');
  return ids;
}

export type RehearsalOutcome = { episodes: Episode[]; spend: Spend[]; tables: WorkTableRecord[]; receipts: WorkReceiptRecord[] };

/**
 * Rehearses the given scenarios with a given playbook, without storing anything. The run handler and the improvement
 * loop's gate both use it, so a candidate playbook is rehearsed exactly as the current one is.
 */
export async function rehearse(deps: VentureDeps, ctx: Context, playbook: PlaybookRecord, scenarios: readonly Scenario[], options: { useTemplate: boolean; episodes: number | null }): Promise<RehearsalOutcome> {
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const blueprint = acceptedBlueprint(state, venture);
  const offer = blueprint.offers.find(item => item.id === 'offer_1') ?? blueprint.offers[0];
  const status = options.useTemplate ? null : deps.models.status(ctx);
  const env: RehearsalEnv = {
    deps, ctx, useTemplate: options.useTemplate,
    judgeOn: !options.useTemplate && status!.tiers.fast.presetId !== 'built-in-templates',
    agentOn: !options.useTemplate && status!.tiers.fast.presetId !== 'built-in-templates',
    state, venture, blueprint, playbook, serviceType: blueprint.serviceType, country: venture.country,
    refs: rehearsalRefs(state, venture.id, blueprint, todayIso(deps, venture)), receipts: ventureReceipts(state, venture.id),
    offer: { name: offer.name.value, description: offer.description.value },
  };
  const outcome: RehearsalOutcome = { episodes: [], spend: [], tables: [], receipts: [] };
  for (const scenario of scenarios) {
    const count = options.episodes ?? scenario.episodes;
    for (let index = 0; index < count; index += 1) {
      const result = await runEpisode(env, scenario, index);
      outcome.episodes.push(result.episode);
      outcome.spend.push(...result.spend);
      outcome.tables.push(...result.tables);
      outcome.receipts.push(...result.receipts);
    }
  }
  return outcome;
}

/** Cost words and the model mode for a list of spends. */
export function spendSummary(spend: readonly Spend[]): { costMicros: string; costDisplay: string; modelMode: SimulationRunRecord['modelMode'] } {
  const costMicros = sumMicros(spend.map(item => item.costMicros));
  const estimate = spend.some(item => !item.priceConfirmed);
  const byModel = spend.some(item => item.by === 'model'), byTemplate = spend.some(item => item.by === 'template');
  return { costMicros, costDisplay: `${formatMicros(costMicros)}${estimate ? ESTIMATE_WORDS : ''}`, modelMode: byModel && byTemplate ? 'mixed' : byModel ? 'model' : 'template' };
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

  const outcome = await rehearse(deps, ctx, playbook, selected, { useTemplate, episodes });
  const results = outcome.episodes;
  const scenarioPassed = selected.map(scenario => results.filter(episode => episode.scenarioId === scenario.id).every(episode => episode.passed));
  const passedCount = scenarioPassed.filter(Boolean).length;
  const { costMicros, costDisplay, modelMode } = spendSummary(outcome.spend);
  const finishedAt = deps.clock().toISOString();

  return ventureAction(deps, ctx, 'prepare', 'simulation.run', tx => {
    for (const table of outcome.tables) tx.put(table);
    for (const receipt of outcome.receipts) tx.put(receipt);
    const run: SimulationRunRecord = {
      ...tx.base('venture-simulation-run'), playbookId: playbook.id, playbookHash: playbook.hash, scenarioIds: selected.map(scenario => scenario.id),
      episodes: results, passed: results.length > 0 && results.every(episode => episode.passed),
      summary: { scenarios: selected.length, passed: passedCount, failed: selected.length - passedCount },
      costMicros, costDisplay, startedAt, finishedAt, modelMode,
    };
    tx.put(run);
    if (tx.venture?.status === 'build') tx.touch({ status: 'rehearsal' });
    tx.emit('simulation-finished', { runId: run.id, passed: run.passed, modelMode, scenarioIds: run.scenarioIds });
    tx.emit('run.done', { runId: run.id });
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
