// Chausar venture launcher, package P2 (models), Ink v2 wave 4 (4H1, U17): the line that names the engine that wrote a
// draft. It reads the draft's own model call record: the model the provider's answer named (H36, kept as answeredBy),
// the command-line tool it ran through, or plain words when the answer named none. A template outline says it is the
// template's, not the owner's AI. Nothing is claimed before an answer came. A leaf module: records and presets only.
import type { State } from '../../contracts.ts';
import type { DeliveryRunRecord, Display, ModelRouteKind } from '../contracts.ts';
import { findRecord } from '../records.ts';
import { CLI_LABELS, PRESETS } from './presets.ts';
import { NOT_REPORTED } from './types.ts';

export const TEMPLATE_WROTE = "Written by Chausar's template, not your AI";

/** A model id in words: the label of a model a key preset lists, the bare id or its dated form; else the id as given. */
export function modelLabel(id: string): string {
  const listed = PRESETS.find(preset => (preset.kind === 'anthropic-messages' || preset.kind === 'openai-responses') && preset.model !== null
    && (id === preset.model || new RegExp(`^${preset.model.replace(/[.]/g, '\\.')}-(?:\\d{8}|\\d{4}-\\d{2}-\\d{2})$`).test(id)));
  return listed ? listed.label : id;
}

const CLI_OF: Partial<Record<ModelRouteKind, keyof typeof CLI_LABELS>> = { 'claude-cli': 'claude-code', 'codex-cli': 'codex' };

/**
 * "Written by Claude Sonnet 5.5" (through Claude Code, when it ran there), "Written by Codex on this computer. It did not
 * report the model.", or the template's words. Null while the draft's call has not answered, or when it has no call.
 */
export function writtenByLine(state: State, run: Pick<DeliveryRunRecord, 'servedBy' | 'callId'>): Display | null {
  if (run.servedBy === 'template') return TEMPLATE_WROTE;
  if (!run.callId) return null;
  const call = findRecord(state, 'venture-model-call', run.callId);
  if (!call || call.status !== 'completed') return null;
  // A record without a listed preset (older or partial) still reads: never a throw inside a run view.
  const preset = PRESETS.find(item => item.id === call.presetId)?.label ?? 'your AI';
  if (call.answeredBy === undefined) return `Written by ${preset}. The model was not recorded.`;
  if (call.answeredBy === NOT_REPORTED) return `Written by ${preset}. It did not report the model.`;
  const cli = CLI_OF[call.routeKind];
  return cli ? `Written by ${modelLabel(call.answeredBy)} through ${CLI_LABELS[cli]}` : `Written by ${modelLabel(call.answeredBy)}`;
}
