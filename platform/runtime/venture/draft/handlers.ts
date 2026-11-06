// Chausar venture launcher, the draft desk: the nine methods answered before the vault check (onboarding v2).
// venture.ai.* connect an AI on the desk's memory-only shelf and store; venture.compose.* run the composer and
// hold one plan. They write the in-memory draft store, never the vault, and never take a plan from the renderer.
// Ink v2 wave 4 (4J8, the file drop): compose.decide may carry one file of text the owner dropped. It passes the
// untrusted screen in enforce mode first (core/attachment.ts, shared with the plan suggestion); a held file is left out
// with a plain line, and a clean one goes with the sentence to both calls as background only, as client data: each
// call is previewed and recorded as 'owner-file-drop', the owner's own words with their file, never as an approval.
// The session holds the file for this plan's calls, and each call's record keeps what was sent, file text included;
// on venture.create those records move into the business.
import { check, newId } from '../../contracts.ts';
import { exactPayload, plainText, smallInteger } from '../records.ts';
import type { ModelOutcome, ModelPreset, ModelPresetId, ModelStatusView, VentureDeps } from '../contracts.ts';
import {
  AI_OPTION_IDS, AI_OPTION_WORDS, AI_STATUS_ORDER, NOT_A_SERVICE_WORDS, OPEN_BOX_TEXT,
} from '../onboarding-contracts.ts';
import type {
  AiOption, AiOptionId, AiOptionStatus, AiOptionsView, AiStatusView, ComposeDecision, ComposedPlan, ComposeModelOutput,
  ComposeState, DecideModelOutput, WrittenBy,
} from '../onboarding-contracts.ts';
import { applyComposePatch, assembleComposed, composeTask, decideTask, makeDecision, withRepair } from '../core/compose.ts';
import { countryProfile } from '../core/countries.ts';
import { calls as modelCalls, connectModel, disconnect as modelDisconnect } from '../models/handlers.ts';
import { droppedFile, screenedFile, sendFileDropTask, withFile, type DroppedFile } from '../core/attachment.ts';
import { DESK_CONTEXT } from './store.ts';

export { ATTACHMENT_LEFT_OUT, ATTACHMENT_MAX_BYTES, type DroppedFile } from '../core/attachment.ts';

/**
 * One compose session at a time: the decision, then the plan once fill answers. context: the screened file that goes
 * with this plan's calls, or none.
 */
export type ComposeSession = {
  decision: ComposeDecision; decideOutput: DecideModelOutput; output: ComposeModelOutput | null; plan: ComposedPlan | null;
  context?: DroppedFile | null;
};

/** What a draft handler sees of the desk. */
export type DeskHandle = {
  deps: VentureDeps;
  now(): Date;
  /** When the idle timer wipes the draft, or null while paused or with nothing connected. */
  idleUntil(): string | null;
  session(): ComposeSession | null;
  /** Stores the session unless the desk was cleared while the request ran (a cleared desk never comes back). */
  keep(session: ComposeSession | null): void;
};

// ---------------------------------------------------------------------------
// Connect an AI
// ---------------------------------------------------------------------------

const ROW_PRESETS: Readonly<Record<AiOptionId, readonly ModelPresetId[]>> = Object.freeze({
  'api-key': Object.freeze(['anthropic-haiku-5-5', 'anthropic-sonnet-5-5', 'openai-gpt-6-luna'] as const),
  'claude-code': Object.freeze(['claude-code-cli'] as const),
  codex: Object.freeze(['codex-cli'] as const),
  'chatgpt-sign-in': Object.freeze([] as const),
});

/** The weakest status among a row's presets, by AI_STATUS_ORDER (ready is the strongest). */
export function weakestStatus(statuses: readonly AiOptionStatus[]): AiOptionStatus {
  return statuses.reduce<AiOptionStatus>((weakest, status) => (AI_STATUS_ORDER.indexOf(status) > AI_STATUS_ORDER.indexOf(weakest) ? status : weakest), 'ready');
}

/**
 * The four Connect rows, in AI_OPTION_IDS order, with honest statuses: each row is the weakest of its presets, the
 * ChatGPT row is never open and has no presets, Claude Code can connect only once the terms gate is open, and
 * Codex only when its reviewed profile is present. unchecked is computed: true when any row that can connect holds
 * a preset not yet checked with a live account.
 */
export function aiOptionsView(presets: readonly ModelPreset[], status: AiStatusView, claudeTermsAccepted: boolean): AiOptionsView {
  const byId = new Map(presets.map(preset => [preset.id, preset]));
  const options: AiOption[] = AI_OPTION_IDS.map(id => {
    const words = AI_OPTION_WORDS[id];
    const presetIds = [...ROW_PRESETS[id]].filter(presetId => byId.has(presetId));
    if (id === 'chatgpt-sign-in') {
      return { id, label: words.label, line: words.line, why: words.why, status: 'not-open', canConnect: false, presetIds: [], recommended: null };
    }
    const rowStatus = presetIds.length ? weakestStatus(presetIds.map(presetId => byId.get(presetId)!.availability)) : 'unavailable';
    let canConnect = rowStatus === 'ready' || rowStatus === 'unverified';
    if (id === 'claude-code') canConnect = claudeTermsAccepted && rowStatus !== 'unavailable';
    if (id === 'codex') canConnect = rowStatus === 'ready' || rowStatus === 'unverified';
    return {
      id, label: words.label, line: words.line, why: words.why, status: rowStatus, canConnect, presetIds,
      recommended: id === 'api-key' ? { fast: 'anthropic-haiku-5-5', main: 'anthropic-sonnet-5-5' } : null,
    };
  });
  const unchecked = options.some(option => option.canConnect && option.presetIds.some(presetId => byId.get(presetId)?.verification === 'not-live-verified'));
  return { options, presets: presets.map(preset => structuredClone(preset)), status, unchecked };
}

export function aiStatus(desk: DeskHandle): AiStatusView {
  const status: ModelStatusView = desk.deps.models.status(DESK_CONTEXT);
  return { ...status, scope: 'before-vault', idleUntil: desk.idleUntil() };
}

export async function aiOptions(desk: DeskHandle, payload: unknown): Promise<AiOptionsView> {
  exactPayload(payload, []);
  return aiOptionsView(desk.deps.models.presets(), aiStatus(desk), desk.deps.claudeCodeTerms === 'accepted');
}

export async function aiConnect(desk: DeskHandle, payload: unknown): Promise<AiStatusView> {
  await connectModel(desk.deps, DESK_CONTEXT, payload, { draft: true });
  return aiStatus(desk);
}

export async function aiDisconnect(desk: DeskHandle, payload: unknown): Promise<AiStatusView> {
  await modelDisconnect(desk.deps, DESK_CONTEXT, payload);
  return aiStatus(desk);
}

export async function aiStatusHandler(desk: DeskHandle, payload: unknown): Promise<AiStatusView> {
  exactPayload(payload, []);
  return aiStatus(desk);
}

/** The draft "What was sent" list, newest first, with the stored payload text (never a key). */
export async function aiCalls(desk: DeskHandle, payload: unknown) {
  const input = exactPayload(payload, ['limit']);
  if (input.limit !== undefined) smallInteger(input.limit, 'limit', 1, 100);
  return modelCalls(desk.deps, DESK_CONTEXT, input);
}

// ---------------------------------------------------------------------------
// Compose
// ---------------------------------------------------------------------------

/** Call ids the draft store recorded since the snapshot, in the order they were stored (failed ones included). */
function callsSince(deps: VentureDeps, before: ReadonlySet<string>, purposes: readonly string[]): string[] {
  return deps.store.read().conversations
    .filter(record => record?.kind === 'venture-model-call' && purposes.includes(record.purpose) && !before.has(record.id))
    .map(record => record.id as string);
}
function callIds(deps: VentureDeps): Set<string> {
  return new Set(deps.store.read().conversations.filter(record => record?.kind === 'venture-model-call').map(record => record.id as string));
}

function writtenBy(deps: VentureDeps, outcome: ModelOutcome<unknown>): WrittenBy {
  return { presetId: outcome.presetId, model: outcome.model, replay: deps.models.status(DESK_CONTEXT).replay.active };
}

/**
 * venture.compose.decide { text, countryCode, attachment? }: the cheap model reads the sentence (and the screened file,
 * as background) and picks views. Replaces any earlier session, and its file with it.
 */
export async function composeDecide(desk: DeskHandle, payload: unknown): Promise<ComposeDecision> {
  const body = exactPayload(payload, ['text', 'countryCode', 'attachment'], ['text', 'countryCode']);
  const text = plainText(body.text, 'What you want to do', { min: OPEN_BOX_TEXT.min, max: OPEN_BOX_TEXT.max });
  const country = countryProfile(body.countryCode);
  const dropped = Object.hasOwn(body, 'attachment') ? screenedFile(droppedFile(body.attachment)) : null;
  const context = dropped?.context ?? null;
  const deps = desk.deps;
  const before = callIds(deps);
  // A refused decide throws here and stores no decision: the session stays as it was.
  const outcome: ModelOutcome<DecideModelOutput> = await withRepair(problem => sendFileDropTask(deps.models, DESK_CONTEXT, withFile(decideTask(text, country, problem), context)));
  const decision: ComposeDecision = {
    ...makeDecision({
      composeId: newId('compose'), text, country, output: outcome.value, callIds: callsSince(deps, before, ['decide']),
      writtenBy: writtenBy(deps, outcome), at: desk.now().toISOString(),
    }),
    ...(dropped ? { attachment: dropped.note } : {}),
  };
  desk.keep({ decision, decideOutput: outcome.value, output: null, plan: null, context });
  return structuredClone(decision);
}

function heldSession(desk: DeskHandle, composeId: unknown): ComposeSession {
  check(typeof composeId === 'string' && composeId.length <= 100, 'INVALID_VENTURE_REQUEST', 'Send the id of your plan.');
  const session = desk.session();
  check(session && session.decision.composeId === composeId, 'COMPOSE_NOT_FOUND', 'Your plan was only kept in memory, and it is gone. Make it again.');
  return session;
}

/** venture.compose.fill { composeId }: the main model fills the decided views from the block library, with the session's file as background. */
export async function composeFill(desk: DeskHandle, payload: unknown): Promise<ComposedPlan> {
  const body = exactPayload(payload, ['composeId'], ['composeId']);
  const session = heldSession(desk, body.composeId);
  check(session.decision.kind !== 'not-a-service', 'COMPOSE_NOT_A_SERVICE', NOT_A_SERVICE_WORDS);
  if (session.plan) return structuredClone(session.plan);
  const deps = desk.deps;
  const before = callIds(deps);
  // A refused fill throws here: the session keeps its decision and no plan, so Try again calls fill again.
  const outcome: ModelOutcome<ComposeModelOutput> = await withRepair(problem => sendFileDropTask(deps.models, DESK_CONTEXT, withFile(composeTask(session.decision, problem), session.context)));
  const plan = assembleComposed(session.decision, outcome.value, session.decision.country, {
    writtenBy: writtenBy(deps, outcome), composeCallIds: callsSince(deps, before, ['compose']),
  });
  const current = desk.session();
  check(current && current.decision.composeId === session.decision.composeId, 'COMPOSE_NOT_FOUND', 'Your plan was replaced while it was being written. Make it again.');
  desk.keep({ ...current, output: outcome.value, plan });
  return structuredClone(plan);
}

export async function composeGet(desk: DeskHandle, payload: unknown): Promise<ComposeState | null> {
  exactPayload(payload, []);
  const session = desk.session();
  return session ? structuredClone({ decision: session.decision, plan: session.plan }) : null;
}

/** venture.compose.update { composeId, patch }: the owner's prices, pricing, tax and answers. No model call. */
export async function composeUpdate(desk: DeskHandle, payload: unknown): Promise<ComposedPlan> {
  const body = exactPayload(payload, ['composeId', 'patch'], ['composeId', 'patch']);
  const session = heldSession(desk, body.composeId);
  check(session.plan, 'COMPOSE_NOT_FOUND', 'Make your plan first.');
  const plan = applyComposePatch(session.plan, body.patch);
  desk.keep({ ...session, plan });
  return structuredClone(plan);
}

export const DRAFT_HANDLERS: Readonly<Record<string, (desk: DeskHandle, payload: unknown) => Promise<unknown>>> = Object.freeze({
  'venture.ai.options': aiOptions,
  'venture.ai.connect': aiConnect,
  'venture.ai.disconnect': aiDisconnect,
  'venture.ai.status': aiStatusHandler,
  'venture.ai.calls': aiCalls,
  'venture.compose.decide': composeDecide,
  'venture.compose.fill': composeFill,
  'venture.compose.get': composeGet,
  'venture.compose.update': composeUpdate,
});
