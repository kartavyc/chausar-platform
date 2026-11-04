// A4 fix round (founder, 4 Nov): a business made from the Start gallery reuses the AI the owner already set up in another
// business on this computer. Only the AI setup carries over: the Codex or Claude Code connection (its preset, route,
// model and jobs) and the models chosen for the agents. Nothing else does: no keys (a command-line AI has none), no
// client, note, memory, file, call, chat consent or client consent, no Gmail connection and no outside tools. The new
// business keeps its own folder and vault.
//
// The newest setup is kept per computer, beside the business folders (the host's AiSetupPort, custody/ai-setup.json),
// whenever a business connects Codex or Claude Code or saves its agents' models, so "the most recent one" is simply the
// last written. Reading it back is checked field by field; anything else in the file is refused.
import { listRecords } from '../records.ts';
import type { ModelConnectionRecord, ModelPresetId, ModelTier, VentureDeps } from '../contracts.ts';
import { defaultAiSettings, type AiSettings, type AiTaskSettings } from '../agent-runtime/settings.ts';

/** The setup kept per computer. */
export type AiSetupNote = {
  format: 'chausar.ai-setup.v1';
  from: { workspaceId: string; name: string };
  at: string;
  connections: { presetId: ModelPresetId; routeKind: ModelConnectionRecord['routeKind']; model: string | null; tiers: ModelTier[] }[];
  models: { codex: { quick: AiTaskSettings; main: AiTaskSettings }; claude: { quick: AiTaskSettings; main: AiTaskSettings; fallbackModel?: string } };
};
/** Where the host keeps it (the desktop and the local server); absent on the hosted app and in most tests. */
export type AiSetupPort = { read(): Promise<unknown>; write(note: AiSetupNote): Promise<void> };

/** The AI apps on this computer: the only setups that carry over, since they hold no key. */
const CARRIED: Readonly<Record<string, ModelConnectionRecord['routeKind']>> = Object.freeze({ 'codex-cli': 'codex-cli', 'claude-code-cli': 'claude-cli' });
const MODEL = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,79}$/;
const EFFORTS = ['low', 'medium', 'high', 'max'];
const ID = /^[A-Za-z0-9_.:-]{1,120}$/;

/** This business's setup, or null when it has no Codex or Claude Code connected. */
export function aiSetupOf(deps: VentureDeps): AiSetupNote | null {
  const state = deps.store.read();
  const venture = listRecords(state, 'venture-record')[0];
  if (!venture) return null;
  const connections = listRecords(state, 'venture-model-connection', venture.id)
    .filter(connection => connection.status === 'connected' && CARRIED[connection.presetId] === connection.routeKind)
    .map(connection => ({ presetId: connection.presetId, routeKind: connection.routeKind, model: connection.model, tiers: [...connection.tiers] }));
  if (!connections.length) return null;
  const settings: AiSettings = venture.aiSettings ?? defaultAiSettings();
  return {
    format: 'chausar.ai-setup.v1', from: { workspaceId: state.workspace.id, name: venture.workingName }, at: deps.clock().toISOString(), connections,
    models: {
      codex: { quick: { ...settings.codex.quick }, main: { ...settings.codex.main } },
      claude: { quick: { ...settings.claude.quick }, main: { ...settings.claude.main }, ...(settings.claude.fallbackModel ? { fallbackModel: settings.claude.fallbackModel } : {}) },
    },
  };
}

/** Keeps this business's setup as the newest, when it has one. Never throws: the note is a help, never a gate. */
export async function rememberAiSetup(deps: VentureDeps): Promise<void> {
  if (!deps.aiSetup) return;
  try { const note = aiSetupOf(deps); if (note) await deps.aiSetup.write(note); } catch { /* the next connect writes it again */ }
}

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const keysAre = (value: Record<string, unknown>, required: string[], optional: string[] = []) => required.every(key => Object.hasOwn(value, key)) && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
const task = (value: unknown): AiTaskSettings | null => (plainObject(value) && keysAre(value, ['model', 'effort']) && typeof value.model === 'string' && MODEL.test(value.model) && EFFORTS.includes(value.effort as string) ? { model: value.model, effort: value.effort as AiTaskSettings['effort'] } : null);

/** The note read back, checked field by field: the setup, or null for anything else. */
export function readAiSetup(raw: unknown): AiSetupNote | null {
  if (!plainObject(raw) || !keysAre(raw, ['format', 'from', 'at', 'connections', 'models']) || raw.format !== 'chausar.ai-setup.v1') return null;
  const from = raw.from, models = raw.models;
  if (!plainObject(from) || !keysAre(from, ['workspaceId', 'name']) || typeof from.workspaceId !== 'string' || !ID.test(from.workspaceId) || typeof from.name !== 'string' || !from.name.trim() || from.name.length > 80) return null;
  if (typeof raw.at !== 'string' || Number.isNaN(Date.parse(raw.at)) || !Array.isArray(raw.connections) || !raw.connections.length || raw.connections.length > 2) return null;
  const connections: AiSetupNote['connections'] = [];
  for (const item of raw.connections) {
    if (!plainObject(item) || !keysAre(item, ['presetId', 'routeKind', 'model', 'tiers'])) return null;
    if (typeof item.presetId !== 'string' || CARRIED[item.presetId] === undefined || CARRIED[item.presetId] !== item.routeKind) return null;
    if (!(item.model === null || (typeof item.model === 'string' && MODEL.test(item.model)))) return null;
    if (!Array.isArray(item.tiers) || !item.tiers.length || item.tiers.some(tier => tier !== 'fast' && tier !== 'main')) return null;
    connections.push({ presetId: item.presetId as ModelPresetId, routeKind: item.routeKind as ModelConnectionRecord['routeKind'], model: item.model as string | null, tiers: [...new Set(item.tiers as ModelTier[])] });
  }
  if (!plainObject(models) || !keysAre(models, ['codex', 'claude']) || !plainObject(models.codex) || !plainObject(models.claude)) return null;
  if (!keysAre(models.codex, ['quick', 'main']) || !keysAre(models.claude, ['quick', 'main'], ['fallbackModel'])) return null;
  const codex = { quick: task(models.codex.quick), main: task(models.codex.main) };
  const claude = { quick: task(models.claude.quick), main: task(models.claude.main) };
  const fallback = models.claude.fallbackModel;
  if (!codex.quick || !codex.main || !claude.quick || !claude.main || (fallback !== undefined && (typeof fallback !== 'string' || !MODEL.test(fallback)))) return null;
  return {
    format: 'chausar.ai-setup.v1', from: { workspaceId: from.workspaceId, name: from.name.trim() }, at: raw.at, connections,
    models: { codex: { quick: codex.quick, main: codex.main }, claude: { quick: claude.quick, main: claude.main, ...(typeof fallback === 'string' ? { fallbackModel: fallback } : {}) } },
  };
}

/** The agent settings a reused setup gives a new business: the defaults, with the chosen models only. */
export function settingsFrom(note: AiSetupNote): AiSettings {
  const base = defaultAiSettings();
  const claude = { ...base.claude, quick: { ...note.models.claude.quick }, main: { ...note.models.claude.main } };
  if (note.models.claude.fallbackModel) claude.fallbackModel = note.models.claude.fallbackModel; else delete claude.fallbackModel;
  return { ...base, codex: { ...base.codex, quick: { ...note.models.codex.quick }, main: { ...note.models.codex.main } }, claude };
}
