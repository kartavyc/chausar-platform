// Chausar venture launcher, delivery package (P5): what this build can and cannot do, in words.
// Every row's state matches what the code does today. Planned work says planned; nothing is dressed up.
import { authorize, type Context } from '../../contracts.ts';
import { exactPayload } from '../records.ts';
import type { CapabilityState, CapabilityStatus, ModelPreset, ModelStatusView, ModelTier, VentureDeps, VentureStorage } from '../contracts.ts';

export const EXPERIMENTAL_STORAGE_NOTICE = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
export const TEMPLATES_REASON = 'No AI connected; built-in templates write outlines.';

/** Without a preset list, the availability each preset has once it serves a tier (P2's table). */
const SERVING_STATE: Readonly<Record<string, CapabilityState>> = {
  'anthropic-haiku-5-5': 'available', 'anthropic-sonnet-5-5': 'available',
  'openai-gpt-6-luna': 'unverified', 'claude-code-cli': 'unverified', 'codex-cli': 'unverified',
};
const PRESET_STATE: Readonly<Record<ModelPreset['availability'], CapabilityState>> = {
  ready: 'available', unverified: 'unverified', 'needs-setup': 'needs-setup', unavailable: 'unavailable',
};

function modelRow(tier: ModelTier, status: ModelStatusView | undefined, presets: readonly ModelPreset[] | undefined): CapabilityStatus {
  const id = tier === 'fast' ? 'model-fast' : 'model-main';
  const label = tier === 'fast' ? 'AI for quick work' : 'AI for plans and drafts';
  const serving = status?.tiers?.[tier];
  if (!serving || serving.presetId === 'built-in-templates') return { id, group: 'models', label, state: 'needs-setup', reason: TEMPLATES_REASON };
  if (!serving.usable) return { id, group: 'models', label, state: 'needs-setup', reason: serving.reason };
  const preset = presets?.find(item => item.id === serving.presetId);
  if (preset) return { id, group: 'models', label, state: PRESET_STATE[preset.availability], reason: `${preset.label}. ${preset.availabilityReason}` };
  return { id, group: 'models', label, state: SERVING_STATE[serving.presetId] ?? 'unverified', reason: serving.reason };
}

/** The capability list, in a fixed order. Without a model status both model rows say they need setup. */
export function capabilityList(platform: string, modelStatus?: ModelStatusView, storage: VentureStorage = 'experimental-file', presets?: readonly ModelPreset[]): CapabilityStatus[] {
  const row = (id: string, group: CapabilityStatus['group'], label: string, state: CapabilityState, reason: string): CapabilityStatus => ({ id, group, label, state, reason });
  return [
    row('venture-actor', 'runtime', 'One record per business', 'available', 'One durable record per business in your vault. Every change is one committed action.'),
    row('venture-events', 'runtime', 'Event log', 'available', 'The app reads the event log; there is no push yet.'),
    row('schedules', 'runtime', 'Schedules', 'planned', 'Repo checks and briefs run when you click, for now.'),
    row('hosted-actors', 'runtime', 'Hosted business actors', 'planned', 'A hosted web app is not built; Rivet Actors are the candidate runtime.'),
    row('tier-code', 'runtime', 'Code steps', 'available', 'Runs inside Chausar. No tools and no agent-written code. Not a sandbox.'),
    row('tier-actor', 'runtime', 'Agent drafting', 'available', 'Model calls and drafting inside Chausar. No tools and no agent-written code. Not a sandbox.'),
    storage === 'experimental-file'
      ? row('durable-storage', 'storage', 'Durable storage', 'planned', EXPERIMENTAL_STORAGE_NOTICE)
      : row('durable-storage', 'storage', 'Durable storage', 'available', 'PostgreSQL storage.'),
    row('tier-wasm-lite', 'sandbox', 'Light sandbox', 'available', 'The back office plugin sandbox. Delivery agents do not use it yet.'),
    platform === 'win32'
      ? row('tier-wasm', 'sandbox', 'Full sandbox', 'unavailable', 'Not available on Windows yet.')
      : row('tier-wasm', 'sandbox', 'Full sandbox', 'planned', 'Planned: agentOS.'),
    row('tier-container', 'sandbox', 'Containers', 'planned', 'Needs Docker Desktop.'),
    row('tier-hosted', 'sandbox', 'Hosted sandboxes', 'planned', 'Needs your own E2B, Sail or Cloudflare account.'),
    modelRow('fast', modelStatus, presets),
    modelRow('main', modelStatus, presets),
    row('agent-tools', 'connectors', 'Agent tools', 'planned', "Agents can't read files, inboxes or the web yet; they draft from the client's message."),
    row('handoff-links', 'connectors', 'Builder handoffs', 'available', 'Lovable and Replit open with your brief; Bolt and v0 get it copied.'),
    row('github-read', 'connectors', 'GitHub reading', 'available', 'Tested on recordings, not yet on a live account.'),
    row('outside-writes', 'connectors', 'Outside writes', 'planned', 'Payment links, email and posts wait for a later build.'),
  ];
}

export async function capabilitiesHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CapabilityStatus[]> {
  exactPayload(payload, []);
  authorize(deps.store, ctx, 'read');
  let status: ModelStatusView | undefined;
  let presets: ModelPreset[] | undefined;
  try { status = deps.models.status(ctx); } catch { status = undefined; }
  try { presets = deps.models.presets(); } catch { presets = undefined; }
  return capabilityList(process.platform, status, deps.storage, presets);
}
