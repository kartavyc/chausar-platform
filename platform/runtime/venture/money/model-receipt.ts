// W6 6G5 (D44): a model receipt on every run. It says which tool or model ran it, which tier, the tokens the provider
// reported (or that none were), and the cost when it is known, all read from the run's own records: the native job's
// route, usage and cost (agent-runtime/billing.ts), or the call records and charges the model port kept. Nothing is
// priced here: a cost comes from the charge records code already settled, with the sum receipt behind it. A run on the
// owner's own Codex or Claude plan says "On your plan", with no figure and never rupees.
import { formatCount } from '../../owner-format.ts';
import type { State } from '../../contracts.ts';
import { formatMicros, listRecords } from '../records.ts';
import { presetSpec } from '../models/presets.ts';
import { NOT_REPORTED } from '../models/types.ts';
import { AGENT_ID } from '../views/shared.ts';
import { deliveryRunSpends, planCall, planJob } from './spend-meter.ts';
import { receiptAgentName } from './agent-meters.ts';
import { rupeesOf, spendLead } from './spend.ts';
import type { DeliveryRunRecord, Display, ModelCallRecord, ModelPresetId, ModelReceiptView, ModelTier, SpendRecord, VentureRecord } from '../contracts.ts';
import type { AgentUsage } from '../agent-runtime/driver-types.ts';

export const RECEIPT_WORDS = Object.freeze({
  templates: 'Built-in templates', ownCopy: 'Your own copy', noAi: 'No AI', noCost: 'No cost',
  plan: 'On your plan', unknown: 'Not known yet', notReported: 'not reported', tokensNotReported: 'Tokens not reported',
  someNotReported: ' (some not reported)', yourTool: 'Your AI tool', yourKey: 'Your AI key', estimate: ' (estimate)',
  tier: { main: 'Main model', fast: 'Quick model' } as Readonly<Record<ModelTier, string>>,
});
const SEPARATOR = ' · ';


/** The tool in the owner's words: Codex and Claude Code on their plan, a model on their key, templates. */
export function toolWords(presetId: ModelPresetId): Display {
  let spec: ReturnType<typeof presetSpec>;
  try { spec = presetSpec(presetId); } catch { return presetId; }
  if (spec.kind === 'claude-cli') return 'Claude Code';
  if (spec.kind === 'codex-cli') return 'Codex';
  if (spec.kind === 'template') return RECEIPT_WORDS.templates;
  return `${spec.label}, your key`;
}

/** The tokens a provider reported, or that it reported none. */
export function usageWords(usage: Pick<AgentUsage, 'inputTokens' | 'outputTokens'> | null | undefined, country: string | null | undefined): Display {
  if (!usage) return RECEIPT_WORDS.tokensNotReported;
  // B2 fix round 1: grouped as the business's country groups a count ("441,000" in the US); India when none is known.
  const count = (value: number) => formatCount(value, country ?? 'IN');
  return `${count(usage.inputTokens)} tokens in, ${count(usage.outputTokens)} out`;
}

function finish(parts: Omit<ModelReceiptView, 'line'>): ModelReceiptView {
  return { ...parts, line: [parts.tool, parts.model, parts.tier, parts.usage, parts.cost].join(SEPARATOR) };
}

function none(tool: Display, agent: Display | undefined): ModelReceiptView {
  return finish({ tool, model: RECEIPT_WORDS.notReported, tier: RECEIPT_WORDS.noAi, usage: RECEIPT_WORDS.tokensNotReported, cost: RECEIPT_WORDS.noCost, state: 'none', ...(agent ? { agent } : {}) });
}

/** Settled charges summed, or null while any is held, unknown or none was kept. */
function settledTotal(spends: readonly SpendRecord[]): { micros: bigint; estimate: boolean } | null {
  const live = spends.filter(row => row.phase !== 'released' && row.phase !== 'refused');
  if (!live.length || live.some(row => row.phase !== 'settled' || row.settledMicros === null)) return null;
  const micros = live.reduce((total, row) => total + BigInt(row.settledMicros!), 0n);
  const estimate = live.some(row => row.settledBy === 'reservation' || (row.settledBy === 'usage' && row.rate?.confirmed === false));
  return { micros, estimate };
}

/**
 * The receipt of the calls one piece of work made (a routine run, an older model run): the tool and tier of each, the
 * model each answer named, the tokens summed, and the cost from their charges. receiptId: the sum receipt over those
 * charges, which the caller writes (it is async); left out, a priced cost carries none.
 */
export function callsModelReceipt(state: State, venture: VentureRecord, calls: readonly ModelCallRecord[], options: { agent: string | null; receiptId?: string }): ModelReceiptView {
  const agent = options.agent ? receiptAgentName(state, venture, options.agent) : undefined;
  if (!calls.length) return none(RECEIPT_WORDS.templates, agent);
  const unique = (values: string[]) => [...new Set(values)].join(' and ');
  const tool = unique(calls.map(call => toolWords(call.presetId)));
  const model = unique(calls.map(call => (typeof call.answeredBy === 'string' && call.answeredBy && call.answeredBy !== NOT_REPORTED ? call.answeredBy : call.model ?? RECEIPT_WORDS.notReported)));
  const tier = unique(calls.map(call => RECEIPT_WORDS.tier[call.tier] ?? RECEIPT_WORDS.tier.main));
  const reported = calls.filter(call => call.usage);
  const usage = !reported.length ? RECEIPT_WORDS.tokensNotReported
    : usageWords({ inputTokens: reported.reduce((sum, call) => sum + call.usage!.inputTokens, 0), outputTokens: reported.reduce((sum, call) => sum + call.usage!.outputTokens, 0) }, venture.country?.code)
      + (reported.length < calls.length ? RECEIPT_WORDS.someNotReported : '');
  const base = { tool, model, tier, usage, ...(agent ? { agent } : {}) };
  if (calls.every(planCall)) return finish({ ...base, cost: RECEIPT_WORDS.plan, state: 'plan' });
  const ids = new Set(calls.map(call => call.id));
  const spends = listRecords(state, 'venture-spend', venture.id).filter(row => row.ref !== null && ids.has(row.ref));
  const total = settledTotal(spends);
  if (!total) return finish({ ...base, cost: RECEIPT_WORDS.unknown, state: 'unknown' });
  const rupees = rupeesOf(state, venture);
  const micros = String(total.micros);
  return finish({
    ...base, cost: formatMicros(micros) + (total.estimate ? RECEIPT_WORDS.estimate : ''), state: total.estimate ? 'estimate' : 'priced',
    ...(options.receiptId ? { receiptId: options.receiptId } : {}), costLead: spendLead(micros, rupees, total.estimate ? RECEIPT_WORDS.estimate : ''),
  });
}

/**
 * A delivery run's model receipt. A native job: its route (the preset when the host named it, the model and the main
 * tier), the tokens it reported, and the cost billing.ts priced with its receipt, or "On your plan". An older model run:
 * its calls. A template or the owner's own copy: no AI, no cost. receiptId: the run's sum receipt, for an older run.
 */
export function runModelReceipt(state: State, venture: VentureRecord, run: DeliveryRunRecord, receiptId?: string): ModelReceiptView {
  const job = run.agentJob;
  if (job) {
    const agent = receiptAgentName(state, venture, job.scope.agentId);
    const presetId = job.route?.presetId;
    const plan = planJob(state, run);
    const tool = presetId ? toolWords(presetId) : plan ? RECEIPT_WORDS.yourTool : RECEIPT_WORDS.yourKey;
    const base = { tool, model: job.model ?? job.route?.model ?? RECEIPT_WORDS.notReported, tier: RECEIPT_WORDS.tier[job.route?.tier ?? 'main'], usage: usageWords(job.usage, venture.country?.code), agent };
    if (plan) return finish({ ...base, cost: RECEIPT_WORDS.plan, state: 'plan' });
    if (job.cost?.state !== 'priced') return finish({ ...base, cost: RECEIPT_WORDS.unknown, state: 'unknown' });
    const total = settledTotal(deliveryRunSpends(state, run));
    const rupees = rupeesOf(state, venture);
    const estimate = total?.estimate ?? false;
    return finish({
      ...base, cost: job.cost.display, state: estimate ? 'estimate' : 'priced', ...(job.cost.receiptId ? { receiptId: job.cost.receiptId } : {}),
      ...(total ? { costLead: spendLead(String(total.micros), rupees, estimate ? RECEIPT_WORDS.estimate : '') } : {}),
    });
  }
  if (run.servedBy === 'template') return none(RECEIPT_WORDS.templates, undefined);
  if (run.servedBy === 'owner') return none(RECEIPT_WORDS.ownCopy, undefined);
  const callIds = new Set([run.callId, ...(run.harness?.turns ?? []).map(turn => turn.callId)].filter((id): id is string => typeof id === 'string'));
  const calls = listRecords(state, 'venture-model-call', venture.id).filter(call => callIds.has(call.id));
  return callsModelReceipt(state, venture, calls, { agent: AGENT_ID, ...(receiptId ? { receiptId } : {}) });
}
