// Chausar venture launcher, package P2 (models), Ink v2 wave 4 (4H1, U17): the line that names the engine that wrote a
// draft. It reads the draft's own model call record: the model the provider's answer named (H36, kept as answeredBy),
// the command-line tool it ran through, or plain words when the answer named none. A template outline says it is the
// template's, not the owner's AI. Nothing is claimed before an answer came. A leaf module: records and presets only.
import type { State } from '../../contracts.ts';
import type { DeliveryRunRecord, Display, ModelRouteKind } from '../contracts.ts';
import { findRecord } from '../records.ts';
import { CLI_LABELS, PRESETS } from './presets.ts';
import { NOT_REPORTED } from './types.ts';
import { DECIDED } from '../delivery/run-machine.ts';
import { CARD_FIXED_WORDS as CARD, CARD_TEMPLATE_WORDS as CARD_T, fillWords } from '../views/card-words.ts';

export const TEMPLATE_WROTE = CARD.templateWrote;

/** A model id in words: the label of a model a key preset lists, the bare id or its dated form; else the id as given. */
export function modelLabel(id: string): string {
  const listed = PRESETS.find(preset => (preset.kind === 'anthropic-messages' || preset.kind === 'openai-responses') && preset.model !== null
    && (id === preset.model || new RegExp(`^${preset.model.replace(/[.]/g, '\\.')}-(?:\\d{8}|\\d{4}-\\d{2}-\\d{2})$`).test(id)));
  return listed ? listed.label : id;
}

const CLI_OF: Partial<Record<ModelRouteKind, keyof typeof CLI_LABELS>> = { 'claude-cli': 'claude-code', 'codex-cli': 'codex' };
/** "Written by <model>", through the tool it ran in when it ran in one (views/card-words.ts, which the app says in the owner's language). */
const writtenWords = (model: string, cli: keyof typeof CLI_LABELS | undefined): Display => (cli ? fillWords(CARD_T.writtenThrough, { model, tool: CLI_LABELS[cli] }) : fillWords(CARD_T.writtenBy, { model }));

/**
 * "Written by Claude Sonnet 5.5" (through Claude Code, when it ran there), "Written by Codex on this computer. It did not
 * report the model.", or the template's words. Null while the draft's call has not answered, or when it has no call.
 */
export function writtenByLine(state: State, run: Pick<DeliveryRunRecord, 'servedBy' | 'callId'> & Partial<Pick<DeliveryRunRecord, 'agentJob' | 'status'>>): Display | null {
  if (run.servedBy === 'template') return TEMPLATE_WROTE;
  // One-shot A4 (A3 leftover): a native agent job writes no model call record; its route names the AI it ran on, and the
  // model is the one the tool reported, else the one asked for. Said only once the job handed its draft over.
  if (!run.callId && run.agentJob) return agentJobLine(run, run.agentJob);
  if (!run.callId) return null;
  const call = findRecord(state, 'venture-model-call', run.callId);
  if (!call || call.status !== 'completed') return null;
  // A record without a listed preset (older or partial) still reads: never a throw inside a run view.
  const preset = PRESETS.find(item => item.id === call.presetId)?.label ?? 'your AI';
  if (call.answeredBy === undefined) return fillWords(CARD_T.writtenUnrecorded, { model: preset });
  if (call.answeredBy === NOT_REPORTED) return fillWords(CARD_T.writtenUnreported, { model: preset });
  const cli = CLI_OF[call.routeKind];
  return writtenWords(modelLabel(call.answeredBy), cli);
}

/** The line for a native agent job's draft, from its route; null before its job is done or without a known preset. */
function agentJobLine(run: Partial<Pick<DeliveryRunRecord, 'status'>>, job: NonNullable<DeliveryRunRecord['agentJob']>): Display | null {
  if (!(run.status === 'ready-for-review' || (run.status && DECIDED.includes(run.status))) || !job.route?.presetId) return null;
  const preset = PRESETS.find(item => item.id === job.route!.presetId);
  if (!preset) return null;
  const model = (job.model ?? '').trim() || job.route.model.trim();
  if (!model) return fillWords(CARD_T.writtenUnreported, { model: preset.label });
  const cli = CLI_OF[preset.kind as ModelRouteKind];
  return writtenWords(modelLabel(model), cli);
}
