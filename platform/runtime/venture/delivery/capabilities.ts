// Chausar venture launcher, delivery package (P5): what this build can and cannot do, in words.
// Every row's state matches what the code does today. Planned work says planned; nothing is dressed up.
import { authorize, type Context } from '../../contracts.ts';
import { exactPayload, listRecords } from '../records.ts';
import type { CapabilityState, CapabilityStatus, DelegateCli, ModelPreset, ModelStatusView, ModelTier, VentureDeps, VentureHostKind, VentureStorage } from '../contracts.ts';
import { cachedDelegateAvailability, DELEGATE_LABELS, DELEGATE_NOT_CHECKED, delegatePorts, type DelegateAvailability } from './harness/delegate.ts';
import { cachedContainerAvailability, HOSTED_NO_AGENT_CODE, HOSTED_NO_CONTAINERS, HOSTED_NO_OWNER_CLI, WASM_LITE_REASON, type TierAvailability } from './harness/sandbox.ts';
import { readAs } from './shared.ts';

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

export const CONTAINER_NOT_CHECKED = 'Chausar has not checked this computer for Docker yet.';

/** Heavy work, per tool: what the check found, and whether a run on a real order here finished. */
export type DelegateCapability = { availability: DelegateAvailability; realRun: boolean };

/**
 * One heavy-work row. Available only when the tool is found, passes its version check and has finished a run on a
 * real order here; found and checked but never run is unverified; anything else needs setup. Never on the hosted server.
 */
function delegateRow(cli: DelegateCli, found: DelegateCapability | undefined, hosted: boolean): CapabilityStatus {
  const id = cli === 'claude-code' ? 'tier-owner-claude' : 'tier-owner-codex';
  const label = `Heavy work: ${DELEGATE_LABELS[cli]}`;
  if (hosted) return { id, group: 'sandbox', label, state: 'unavailable', reason: HOSTED_NO_OWNER_CLI };
  if (!found) return { id, group: 'sandbox', label, state: 'needs-setup', reason: DELEGATE_NOT_CHECKED };
  const { availability, realRun } = found;
  if (availability.state === 'needs-setup' || !availability.version) return { id, group: 'sandbox', label, state: 'needs-setup', reason: availability.reason };
  if (realRun) {
    return { id, group: 'sandbox', label, state: 'available', reason: `${DELEGATE_LABELS[cli]} ${availability.version} is on this computer and finished a job on a real order here. Each job still waits for you to approve its brief.` };
  }
  return { id, group: 'sandbox', label, state: 'unverified', reason: availability.reason };
}

/**
 * The capability list, in a fixed order. Without a model status both model rows say they need setup. Without a
 * container check the container row says it was not checked; the handler always checks, except on the hosted web
 * server. There ('hosted-web') the hosted rows say experimental, and what never runs on a shared server says so: no
 * containers, no agent-written code, no plugins and no PDF reading.
 */
export function capabilityList(platform: string, modelStatus?: ModelStatusView, storage: VentureStorage = 'experimental-file', presets?: readonly ModelPreset[], container?: TierAvailability, host: VentureHostKind = 'desktop', delegate?: Partial<Record<DelegateCli, DelegateCapability>>): CapabilityStatus[] {
  const row = (id: string, group: CapabilityStatus['group'], label: string, state: CapabilityState, reason: string): CapabilityStatus => ({ id, group, label, state, reason });
  const hosted = host === 'hosted-web';
  return [
    row('venture-actor', 'runtime', 'One record per business', 'available', 'One durable record per business in your vault. Every change is one committed action.'),
    hosted
      ? row('venture-events', 'runtime', 'Event log', 'unverified', 'The hosted server sends new events to the page after each action. Experimental.')
      : row('venture-events', 'runtime', 'Event log', 'available', 'The app reads the event log; there is no push yet.'),
    row('schedules', 'runtime', 'Schedules', 'planned', 'Repo checks and briefs run when you click, for now.'),
    hosted
      ? row('hosted-actors', 'runtime', 'Hosted business actors', 'unverified', 'Experimental: one actor per business on this server. Not yet tested on a real deploy.')
      : row('hosted-actors', 'runtime', 'Hosted business actors', 'planned', 'The hosted web tier is written but not deployed; Rivet Actors are the candidate runtime.'),
    row('tier-code', 'runtime', 'Code steps', 'available', 'The calculator, the checks and the agent loop run inside Chausar. Not a sandbox.'),
    row('tier-actor', 'runtime', 'Agent turns', 'available', 'Agents call tools in a loop with limits on turns, tool calls and spend. On a real order each turn waits for you to approve its exact text. Not a sandbox.'),
    row('improvement-loop', 'runtime', 'Improvement loop', 'available', 'Tries one playbook change at a time on your held-back cases and practice clients, and keeps it only if it wins. You adopt each change.'),
    storage === 'experimental-file'
      ? row('durable-storage', 'storage', 'Durable storage', 'planned', EXPERIMENTAL_STORAGE_NOTICE)
      : hosted
        ? row('durable-storage', 'storage', 'Durable storage', 'unverified', "Experimental: PostgreSQL on this server, not yet tested on a real deploy. Practise here; don't issue real invoices yet.")
        : row('durable-storage', 'storage', 'Durable storage', 'available', 'PostgreSQL storage.'),
    hosted
      ? row('tier-wasm-lite', 'sandbox', 'Light sandbox', 'unavailable', HOSTED_NO_AGENT_CODE)
      : row('tier-wasm-lite', 'sandbox', 'Light sandbox', 'available', WASM_LITE_REASON),
    platform === 'win32'
      ? row('tier-wasm', 'sandbox', 'Full sandbox', 'unavailable', 'Not available on Windows yet.')
      : row('tier-wasm', 'sandbox', 'Full sandbox', 'planned', 'Planned: agentOS.'),
    hosted
      ? row('tier-container', 'sandbox', 'Containers', 'unavailable', HOSTED_NO_CONTAINERS)
      : row('tier-container', 'sandbox', 'Containers', container?.state ?? 'unverified', container?.reason ?? CONTAINER_NOT_CHECKED),
    delegateRow('claude-code', delegate?.['claude-code'], hosted),
    delegateRow('codex', delegate?.codex, hosted),
    row('tier-hosted', 'sandbox', 'Hosted sandboxes', 'planned', 'Needs your own E2B, Sail or Cloudflare account.'),
    modelRow('fast', modelStatus, presets),
    modelRow('main', modelStatus, presets),
    hosted
      ? row('agent-tools', 'connectors', 'Agent tools', 'available', "Agents read the CSV and XLSX files you add to an order, search your business dictionary, use the calculator and hand questions back to you. On this server they can't read PDFs or run code they write, and they can't read inboxes or the web.")
      : row('agent-tools', 'connectors', 'Agent tools', 'available', "Agents read the files you add to an order (CSV and XLSX; PDF text through Chausar's Python helper), search your business dictionary, use the calculator and hand questions back to you. They can't read inboxes or the web."),
    hosted
      ? row('work-products', 'connectors', 'Work products', 'available', 'Bookkeeping: a reconciled month from a bank statement and bills in CSV or XLSX, with receipts. Other service types get replies; their hands-on work stays with you.')
      : row('work-products', 'connectors', 'Work products', 'available', 'Bookkeeping: a reconciled month from a bank statement and bills, with receipts. Other service types get replies; their hands-on work stays with you.'),
    row('handoff-links', 'connectors', 'Builder handoffs', 'available', 'Lovable and Replit open with your brief; Bolt and v0 get it copied.'),
    row('github-read', 'connectors', 'GitHub reading', 'available', 'Tested on recordings, not yet on a live account.'),
    row('outside-writes', 'connectors', 'Outside writes', 'planned', 'Payment links, email and posts wait for a later build. Agents never hold them.'),
  ];
}

export async function capabilitiesHandler(deps: VentureDeps, ctx: Context, payload: unknown): Promise<CapabilityStatus[]> {
  exactPayload(payload, []);
  authorize(deps.store, ctx, 'read');
  let status: ModelStatusView | undefined;
  let presets: ModelPreset[] | undefined;
  try { status = deps.models.status(ctx); } catch { status = undefined; }
  try { presets = deps.models.presets(); } catch { presets = undefined; }
  // The hosted server never checks for Docker: containers never run there, so there is nothing to look for.
  const container = deps.host === 'hosted-web' ? undefined : await cachedContainerAvailability(deps.sandbox, deps.clock().getTime());
  // Nor does it look for the owner's command-line tools: they never start there.
  const delegate = deps.host === 'hosted-web' ? undefined : await delegateCapabilities(deps, ctx);
  return capabilityList(process.platform, status, deps.storage, presets, container, deps.host, delegate);
}

/** Each tool's check, and whether this business has a finished run of it on a real order. Works before a business exists. */
async function delegateCapabilities(deps: VentureDeps, ctx: Context): Promise<Partial<Record<DelegateCli, DelegateCapability>> | undefined> {
  const ports = delegatePorts(deps);
  if (!ports) return undefined;
  let finished: Set<DelegateCli>;
  try {
    const { state, venture } = readAs(deps, ctx, 'read');
    finished = new Set(listRecords(state, 'venture-delegate-run', venture.id).filter(record => record.outcome === 'succeeded').map(record => record.cli));
  } catch {
    finished = new Set();
  }
  const nowMs = deps.clock().getTime();
  const result: Partial<Record<DelegateCli, DelegateCapability>> = {};
  for (const cli of ['claude-code', 'codex'] as const) result[cli] = { availability: await cachedDelegateAvailability(ports, cli, nowMs), realRun: finished.has(cli) };
  return result;
}
