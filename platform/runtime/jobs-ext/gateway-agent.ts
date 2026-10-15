/**
 * The live agent for jobs, over the core ModelGateway and the routes the owner configured.
 *
 * With the gateway's "decide" purpose (core-gateway-auth), a receivables case may get a model's proposal to
 * remind, which still waits for your yes; any other answer goes to you. Without that purpose the gateway accepts
 * only an analytical plan that names a published calculation, so the agent is a lookup step:
 *   1. it previews a request made of fixed words and typed case codes (no outside text), under the
 *      trust panel's send level;
 *   2. an outside send waits until the owner approves that exact payload (`models.approve`);
 *   3. the gateway dispatches it once, keeps its receipt and charges the route's own rupee budget;
 *   4. software runs the calculation the model chose and keeps its receipt;
 *   5. the case goes to the owner with that receipt: the decision stays with a person.
 * The executor charges the call's cost against the job step's reservation.
 */
import { ChausarError, check, hash } from '../contracts.ts';
import type { Context, StateStore } from '../contracts.ts';
import { trustFingerprint, visibleFacts } from '../trust.ts';
import type { AgentDecision, AgentPort, WorkCase } from '../procedures/types.ts';

type Gateway = {
  store: StateStore;
  listRoutes(context: Context): any[];
  preview(context: Context, request: Record<string, unknown>): Promise<any>;
  execute(context: Context, request: Record<string, unknown>): Promise<any>;
};
type Calculate = (context: Context, request: Record<string, unknown>) => Promise<{ id: string }>;

const CODE = /^[a-z0-9-]{1,32}$/;
/** The gateway's refusals of the "decide" purpose while core-gateway-auth has not added it: fall back to a lookup. */
export const DECIDE_UNAVAILABLE = new Set(['INVALID_CONVERSATION_PURPOSE', 'DECIDE_PURPOSE_UNAVAILABLE', 'UNKNOWN_PURPOSE']);
/** Refusals that mean "no model can help now" rather than a failed step. */
export const AGENT_UNAVAILABLE = new Set(['SEND_DISABLED', 'DEMO_PROVIDER_DISABLED', 'ROUTE_REVOKED', 'ROUTE_DISABLED', 'MODEL_ROUTE_REQUIRED', 'CREDENTIAL_REQUIRED', 'MANAGED_UNAVAILABLE', 'BUDGET_EXCEEDED', 'NO_APPROVED_OPERATIONS', 'ROUTE_NOT_FOUND', 'CLI_CAPABILITY_REQUIRED']);

/** The request words: fixed text and typed codes only. Values chosen by software, never read from a file. */
export function lookupQuestion(item: Pick<WorkCase, 'template' | 'fields'>): string {
  const bucket = typeof item.fields.bucket === 'string' && CODE.test(item.fields.bucket) ? item.fields.bucket : 'unknown';
  return item.template === 'receivables-week'
    ? `Which published calculation should be checked for an unpaid invoice that is overdue (aging bucket ${bucket}) before its owner decides the next step?`
    : 'Which published calculation should be checked before the owner decides the next step of this job?';
}

/** The first enabled route the owner configured, in the gateway's own priority order. */
export function chooseRoute(gateway: Gateway, context: Context, routeId?: string): any | undefined {
  const routes = gateway.listRoutes(context).filter(route => route.enabled !== false);
  return routeId ? routes.find(route => route.id === routeId) : routes[0];
}

export class GatewayAgent implements AgentPort {
  readonly routeId: string; readonly synthetic?: boolean;
  readonly #gateway: Gateway; readonly #calculate: Calculate; readonly #clock: () => number;
  constructor(input: { gateway: Gateway; routeId: string; calculate: Calculate; clock?: () => number; synthetic?: boolean }) {
    this.#gateway = input.gateway; this.routeId = input.routeId; this.#calculate = input.calculate; this.#clock = input.clock ?? Date.now;
    if (input.synthetic) this.synthetic = true;
  }
  /** The most one call may cost: the route's own per-call reservation, in paise. */
  maxCallCostMinor(context: Context): string {
    const route = chooseRoute(this.#gateway, context, this.routeId); check(route, 'ROUTE_NOT_FOUND', 'The job’s model route is not configured.');
    // A local model is priced at zero; its minutes are shown instead.
    return route.kind === 'ollama' ? '0' : String(route.maxCostMinor ?? '0');
  }
  async decide(item: WorkCase, options: readonly string[], signal: AbortSignal, context?: Context): Promise<AgentDecision> {
    check(context, 'AGENT_CONTEXT_REQUIRED', 'The model route runs as the job’s owner.');
    const started = this.#clock(); const question = lookupQuestion(item);
    // Prefer the gateway's "decide" purpose (core-gateway-auth): the model picks one of the offered options.
    // While the gateway refuses that purpose, the agent stays a lookup and the decision stays with a person.
    // Only the receivables job asks the model to decide; a job in your own words stays a lookup until its question can carry the goal.
    const offered = item.template === 'receivables-week' ? options.filter(option => CODE.test(option)).slice(0, 10) : [];
    const deciding = offered.length >= 2;
    // An unused preview for this exact request is reused, so one approval covers exactly one send.
    const receipts = this.#gateway.store.read().modelReceipts;
    // Candidates: an unused preview of this exact request, either a decide preview with the same options or a lookup.
    // One that already has your unused approval comes first, so a newer unapproved preview never hides it.
    const candidates = [...receipts].reverse().filter(r => r.kind === 'model-preview' && r.status === 'preview' && r.memberId === context.memberId && r.epoch === context.epoch
      && r.routeId === this.routeId && r.questionHash === hash(question) && JSON.stringify(r.sourceIds) === JSON.stringify([...item.sourceIds].sort())
      && (r.purpose === 'decide' ? deciding && Array.isArray(r.options) && JSON.stringify([...r.options].sort()) === JSON.stringify([...offered].sort()) : true));
    const approved = (r: any) => receipts.some(a => a.kind === 'outbound-approval' && a.previewId === r.id && !a.used && Date.parse(a.expiresAt) > Date.now());
    let preview = candidates.find(approved) ?? candidates[0];
    // Reuse only a preview that is still current: the same facts, privacy settings and route revision. Otherwise make a fresh one.
    if (preview) {
      const state = this.#gateway.store.read(); const route = state.routes.find((r: any) => r.id === this.routeId);
      let current = false;
      try { current = preview.trustFingerprint === trustFingerprint(state, context, preview.sourceIds) && preview.factDigest === hash(visibleFacts(this.#gateway.store, context, preview.sourceIds)) && route?.revision === preview.routeRevision; } catch { current = false; }
      if (!current) preview = undefined;
    }
    // No automatic sample rows: only what the send level allows beyond them reaches the preview you review.
    // A refusal at the preview stage sent nothing, so it is never charged.
    const unsent = (error: unknown) => Object.assign(error as object, { dispatched: false });
    if (!preview && deciding) {
      try { preview = await this.#gateway.preview(context, { purpose: 'decide', options: [...offered], question, routeId: this.routeId, sourceIds: [...item.sourceIds], samples: [] }); }
      catch (error) { if (!DECIDE_UNAVAILABLE.has((error as { code?: string }).code ?? '')) throw unsent(error); }
    }
    if (!preview) { try { preview = await this.#gateway.preview(context, { question, routeId: this.routeId, sourceIds: [...item.sourceIds], samples: [] }); } catch (error) { throw unsent(error); } }
    let approvalId: string | undefined;
    if (preview.approvalRequired) {
      const approval = this.#gateway.store.read().modelReceipts.find(r => r.kind === 'outbound-approval' && r.previewId === preview.id && !r.used && Date.parse(r.expiresAt) > Date.now());
      if (!approval) throw Object.assign(new ChausarError('AGENT_APPROVAL_REQUIRED', 'A model request waits for your approval of its exact payload.'), { previewId: preview.id });
      approvalId = approval.id;
    }
    check(!signal.aborted, 'AGENT_TIMEOUT', 'The agent did not answer in time.');
    let result: any;
    try { result = await this.#gateway.execute(context, { previewId: preview.id, ...(approvalId ? { approvalId } : {}) }); }
    catch (error) {
      // Whether the request left this machine decides whether it is charged: the receipt says, not the error.
      const receipt = this.#gateway.store.read().modelReceipts.find(r => r.id === preview.id);
      throw Object.assign(error as object, { dispatched: receipt?.attempts === 1 });
    }
    const local = chooseRoute(this.#gateway, context, this.routeId)?.kind === 'ollama';
    // A measured cost when the route has token rates; otherwise the route's reserved per-call estimate. Local is zero.
    const costMinor = local ? '0' : String(result.receipt?.actualCostMinor ?? result.receipt?.costReservedMinor ?? '0');
    check(/^(0|[1-9]\d{0,17})$/.test(costMinor), 'INVALID_PROVIDER_RESULT', 'The model receipt has no usable cost.');
    if (result?.kind === 'decision') {
      // Only an offered option counts; anything else, or no confidence, goes to a person.
      const option = result.decision?.option; const confidence = result.decision?.confidence;
      // A model may only propose a reminder, which still waits for your yes. Waiting, stopping or closing a case is a person's call.
      const chosen = option === 'remind' && offered.includes(option) ? option : 'ask-owner';
      const sure = chosen !== 'ask-owner' && typeof confidence === 'number' && Number.isFinite(confidence) && confidence >= 0 && confidence <= 1 ? confidence : 0;
      return { decision: chosen, confidence: sure, steps: [{ kind: 'question', tool: 'question.model-decision', outcome: chosen === 'ask-owner' ? 'refused' : 'ok', durationMs: 0, units: 0 }],
        units: 0, durationMs: Math.max(0, this.#clock() - started), costMinor, receiptIds: [], modelReceiptId: result.receipt?.id,
        note: chosen === 'ask-owner' ? 'The model did not propose a reminder. The decision is yours.' : 'The model proposed a reminder. It waits for your yes.' };
    }
    const plan = result.plan as { operation: string; period?: { from: string; to: string }; branch?: string; customerId?: string };
    const steps: AgentDecision['steps'] = [{ kind: 'lookup', tool: 'lookup.model-plan', outcome: 'ok', durationMs: 0, units: 0 }];
    const receiptIds: string[] = [];
    try {
      // The model only chose the calculation; software runs it and keeps the receipt.
      const receipt = await this.#calculate(context, { operation: plan.operation, ...(plan.period ? { period: plan.period } : {}), ...(plan.branch ? { branch: plan.branch } : {}),
        ...(plan.customerId ? { customerId: plan.customerId } : {}), ...(item.sourceIds.length ? { sourceIds: [...item.sourceIds] } : {}) });
      receiptIds.push(receipt.id); steps.push({ kind: 'calculate', tool: `calculator.${plan.operation.replace(/[^a-z0-9_-]/gi, '')}`, outcome: 'ok', durationMs: 0, units: 0 });
    } catch { steps.push({ kind: 'calculate', tool: 'calculator.refused', outcome: 'refused', durationMs: 0, units: 0 }); }
    return { decision: 'ask-owner', confidence: 0, steps, units: 0, durationMs: Math.max(0, this.#clock() - started), costMinor, receiptIds, modelReceiptId: result.receipt?.id,
      note: receiptIds.length ? 'The model chose a calculation to check. Its receipt is attached; the decision is yours.' : 'The model chose a calculation that could not run. The decision is yours.' };
  }
}
