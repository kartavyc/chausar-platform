// Chausar venture launcher, the draft desk: the methods answered before the vault check (onboarding v2).
// venture.ai.* connect an AI on the desk's memory-only shelf and store, and venture.about.* and venture.country.suggest
// read the owner's own words with it. They write the in-memory draft store, never the vault. On venture.create the
// connections and the records of the calls made here move into the business.
import { check } from '../../contracts.ts';
import { exactPayload } from '../records.ts';
import type { ModelPreset, ModelPresetId, ModelStatusView, VentureDeps } from '../contracts.ts';
import { AI_OPTION_IDS, AI_OPTION_WORDS, AI_STATUS_ORDER } from '../onboarding-contracts.ts';
import type { AiOption, AiOptionId, AiOptionStatus, AiOptionsView, AiReuseView, AiStatusView } from '../onboarding-contracts.ts';
import { countrySuggest } from '../core/country-suggestion.ts';
import { connectModel, disconnect as modelDisconnect } from '../models/handlers.ts';
import { DESK_CONTEXT } from './store.ts';
import { aboutFamilies, aboutPick, aboutRead } from '../core/about.ts';
import type { LoginDesk } from '../models/login.ts';
import { putReusedConnections, reusableSetup, type AiSetupNote, type AiSetupPort } from '../models/ai-setup.ts';
import { credentialChange } from '../models/credential-state.ts';
import { listRecords, ventureAction } from '../records.ts';

/** What a draft handler sees of the desk. */
export type DeskHandle = {
  deps: VentureDeps;
  now(): Date;
  /** When the idle timer wipes the draft, or null while paused or with nothing connected. */
  idleUntil(): string | null;
  /** Wave 6 (6C1): the tools' own logins in flight, stopped when the desk clears. */
  login(): LoginDesk;
  /** Where the newest AI setup on this computer is kept (the host's), or null where there is none. */
  aiSetup: AiSetupPort | null;
  /** The setup venture.ai.reuse connected in this draft, or null; noteReused keeps it with the draft. */
  reused(): AiSetupNote | null;
  noteReused(note: AiSetupNote): void;
};

/** venture.ai.login.start and .cancel take { cli } only. */
function loginCli(payload: unknown): 'codex' | 'claude-code' {
  const body = exactPayload(payload, ['cli'], ['cli']);
  check(body.cli === 'codex' || body.cli === 'claude-code', 'INVALID_VENTURE_REQUEST', 'Choose Codex or Claude Code.');
  return body.cli;
}

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
  const options: AiOption[] = AI_OPTION_IDS.filter(id => id !== 'claude-code' || claudeTermsAccepted).map(id => {
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
  return { options, presets: presets.filter(preset => preset.id !== 'claude-code-cli' || claudeTermsAccepted).map(preset => structuredClone(preset)), status, unchecked };
}

export function aiStatus(desk: DeskHandle): AiStatusView {
  const status: ModelStatusView = desk.deps.models.status(DESK_CONTEXT);
  return { ...status, scope: 'before-vault', idleUntil: desk.idleUntil() };
}

export async function aiOptions(desk: DeskHandle, payload: unknown): Promise<AiOptionsView> {
  exactPayload(payload, []);
  return aiOptionsView(desk.deps.models.presets(), aiStatus(desk), desk.deps.claudeCodeTerms !== 'pending');
}

export async function aiConnect(desk: DeskHandle, payload: unknown): Promise<AiStatusView> {
  await connectModel(desk.deps, DESK_CONTEXT, payload, { draft: true });
  return aiStatus(desk);
}

export async function aiDisconnect(desk: DeskHandle, payload: unknown): Promise<AiStatusView> {
  await modelDisconnect(desk.deps, DESK_CONTEXT, payload);
  return aiStatus(desk);
}

/**
 * venture.ai.reuse {} (a later business on this computer): connects, in this draft, the Codex or Claude Code the owner
 * already connected in another business, from the newest setup kept on this computer (models/ai-setup.ts). It passes
 * every gate venture.ai.connect runs, the tool's own fresh check included, and carries the agreement the owner gave
 * there and when. A key never carries over: it stays in its own business's vault. With an AI already connected in the
 * draft, or nothing that can be reused, it connects nothing and says so (reused null). Asked again it answers the same.
 */
export function aiReuse(desk: DeskHandle, payload: unknown): Promise<AiReuseView> {
  exactPayload(payload, []);
  return credentialChange(desk.deps, async () => {
    const before = desk.reused();
    const connected = listRecords(desk.deps.store.read(), 'venture-model-connection').some(connection => connection.status === 'connected');
    if (connected) return { ...aiStatus(desk), reused: before ? { from: before.from.name } : null };
    const note = await reusableSetup(desk.deps, desk.aiSetup ?? undefined);
    if (!note) return { ...aiStatus(desk), reused: null };
    await ventureAction(desk.deps, DESK_CONTEXT, 'admin', 'models.connect', tx => { putReusedConnections(tx, note); });
    desk.noteReused(note);
    return { ...aiStatus(desk), reused: { from: note.from.name } };
  });
}

export async function aiStatusHandler(desk: DeskHandle, payload: unknown): Promise<AiStatusView> {
  exactPayload(payload, []);
  return aiStatus(desk);
}

export const DRAFT_HANDLERS: Readonly<Record<string, (desk: DeskHandle, payload: unknown) => Promise<unknown>>> = Object.freeze({
  'venture.country.suggest': (desk, payload) => countrySuggest(desk.deps, DESK_CONTEXT, payload),
  'venture.ai.options': aiOptions,
  'venture.ai.connect': aiConnect,
  'venture.ai.disconnect': aiDisconnect,
  'venture.ai.status': aiStatusHandler,
  // Wave 6 (6C1): each tool's own sign-in; (6C2) About you.
  'venture.ai.tools': (desk, payload) => { exactPayload(payload, []); return desk.login().tools(); },
  'venture.ai.login.start': (desk, payload) => desk.login().start(loginCli(payload)),
  'venture.ai.login.cancel': (desk, payload) => desk.login().cancel(loginCli(payload)),
  'venture.about.read': (desk, payload) => aboutRead(desk.deps, DESK_CONTEXT, payload),
  'venture.about.pick': (desk, payload) => aboutPick(desk.deps, DESK_CONTEXT, payload),
  'venture.about.families': (desk, payload) => aboutFamilies(desk.deps, DESK_CONTEXT, payload),
  'venture.ai.reuse': aiReuse,
});
