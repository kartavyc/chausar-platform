/**
 * Round 4 additions to Ask:
 *   askx.change      AS-02: change the calculation, period or group of a proposal from its short lists.
 *   askx.stop        SH-04: stop a long answer (a forecast's months, a plan's steps, a run of checks).
 *   askx.tell        SH-04 / BK-17: a statement typed on the ask line becomes a proposed Memory line
 *                    through the work-books lane's `books.memoryPropose`; it changes nothing until confirmed.
 *   askx.explainRule AS-09: the rule's own words, from the reports-tools-trust lane's `trust.explain`.
 * A method another lane owns that is not there yet gives `{ state: 'not-built' }`, never a guess.
 */
import { ChausarError, check, now, type Context } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { RuleKind, UnderstandReply } from './contracts.ts';
import { businessToday, codeOf, currentDictionary, identifier, input, namedPeriod, openReceipt, period, text, translate } from './shared.ts';
import { canSeeFact } from '../memory.ts';
import { isPeriodId, operationOf, proposalReply } from './menu.ts';

const NOT_BUILT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);

export async function change(ctx: Context, payload: unknown, host: ModuleHost): Promise<UnderstandReply> {
  const request = input(payload, ['operationId', 'period', 'periodId', 'branch', 'change', 'today'], ['operationId', 'change']);
  const dictionary = currentDictionary(host, ctx);
  if (!dictionary) return { kind: 'refused', code: 'ASK_NO_DICTIONARY' };
  const before = operationOf(dictionary, request.operationId);
  check(before, 'ASK_NO_CALCULATION', 'No published calculation has this name.');
  const to = input(request.change, ['operationId', 'period', 'periodId', 'branch']);
  check(!(to.period !== undefined && to.periodId !== undefined) && !(request.period !== undefined && request.periodId !== undefined), 'ASK_INVALID', 'Choose a named period or dates, not both.');
  check(request.periodId === undefined || isPeriodId(request.periodId), 'ASK_INVALID', 'Choose a named period.');
  check(to.periodId === undefined || isPeriodId(to.periodId), 'ASK_INVALID', 'Choose a named period.');
  const today = businessToday(host, request.today);
  const operation = to.operationId === undefined ? before : operationOf(dictionary, to.operationId);
  check(operation, 'ASK_NO_CALCULATION', 'No published calculation has this name.');
  const keepPeriod = to.period === undefined && to.periodId === undefined;
  const periodId = to.periodId ?? (keepPeriod ? request.periodId ?? null : null);
  const chosen = to.period !== undefined ? period(to.period) : periodId !== null ? namedPeriod(periodId, today) : request.period !== undefined ? period(request.period) : namedPeriod('last-month', today);
  const branch = to.branch !== undefined ? to.branch : request.branch ?? null;
  check(branch === null || identifier(branch), 'ASK_INVALID', 'Choose a branch by its name.');
  // Nothing is recorded here: browsing the lists is not a correction. The run that follows sends
  // `correctedFrom`, and that is recorded once, as structure only.
  return proposalReply(host, ctx, dictionary, operation, chosen, periodId, branch, today);
}

/**
 * Stop requests, held in this process only, per workspace, member and permission epoch. A run
 * takes the current count when it starts; a stop raises it, and the run ends at its next step.
 * A count cannot be stale the way a clock can: a stop asked for before a run started never ends it.
 */
const stops = new Map<string, number>();
const stopKey = (ctx: Context, host: ModuleHost) => `${host.store.read().workspace.id}\u0000${ctx.memberId}\u0000${ctx.epoch}`;
export function stop(ctx: Context, payload: unknown, host: ModuleHost) {
  input(payload, []);
  const key = stopKey(ctx, host); stops.set(key, (stops.get(key) ?? 0) + 1);
  return { stopped: true as const, at: now() };
}
/** The token a run takes when it starts. */
export const stopToken = (ctx: Context, host: ModuleHost) => ({ key: stopKey(ctx, host), at: stops.get(stopKey(ctx, host)) ?? 0 });
/** Throws ASK_STOPPED when this member asked to stop after the run took its token. */
export function checkStop(token: { key: string; at: number } | null) {
  if (token !== null && (stops.get(token.key) ?? 0) > token.at) throw new ChausarError('ASK_STOPPED', 'Stopped as you asked. The unfinished answer was not kept.');
}

export async function tell(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['text', 'kind'], ['text', 'kind']);
  check(request.kind === 'preference' || request.kind === 'claim', 'ASK_INVALID', 'A statement is a preference or a claim.');
  const said = text(request.text, 2000);
  try {
    const line = await host.call('books.memoryPropose', { text: said, kind: request.kind }) as { id?: unknown; status?: unknown };
    check(identifier(line?.id), 'ASK_REFUSED', 'Memory did not return the proposed line.');
    return { state: 'proposed' as const, memoryId: line.id as string, status: typeof line.status === 'string' ? line.status : 'proposed' };
  } catch (error) {
    if (NOT_BUILT.has(codeOf(error))) return { state: 'not-built' as const };
    throw translate(error);
  }
}

/** Trust's stable rule ids, e.g. `marking:accountant:personal+confidential`. */
const RULE_ID = /^[A-Za-z0-9][A-Za-z0-9_.:+-]{0,199}$/;
const RULES: readonly RuleKind[] = ['branch', 'source', 'seat', 'access', 'marking'];
export async function explainRule(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['rule', 'receiptId', 'sourceId', 'language'], ['rule']);
  check(request.language === undefined || request.language === 'en' || request.language === 'hi', 'ASK_INVALID', 'Choose English or Hindi.');
  check(RULES.includes(request.rule), 'ASK_INVALID', 'Name the kind of rule.');
  // Trust is told only about a receipt or source this seat can already open, so it cannot be used to probe ids.
  if (request.receiptId !== undefined) await openReceipt(host, ctx, request.receiptId);
  if (request.sourceId !== undefined) {
    check(identifier(request.sourceId), 'ASK_INVALID', 'Choose one item by its identifier.');
    check(host.store.read().facts.some(f => f.sourceId === request.sourceId && !f.deletedAt && canSeeFact(host.store, ctx, f)), 'ASK_NOT_FOUND', 'This item is no longer available.');
  }
  let reply: { ruleId?: unknown; text?: unknown; changeableBy?: unknown };
  try { reply = await host.call('trust.explain', { ...request }) as typeof reply; }
  catch (error) {
    if (NOT_BUILT.has(codeOf(error))) return { state: 'not-built' as const };
    throw translate(error);
  }
  // The rule's words come from Trust as fixed text; anything else is refused rather than shown.
  check(typeof reply?.ruleId === 'string' && RULE_ID.test(reply.ruleId) && typeof reply.text === 'string' && reply.text.trim().length > 0 && reply.text.length <= 1000 && !/[\p{Cc}\p{Cf}]/u.test(reply.text)
    && (reply.changeableBy === 'owner' || reply.changeableBy === 'owner-or-cofounder'), 'ASK_REFUSED', 'Trust explained the rule in a shape this page does not read.');
  return { state: 'ready' as const, ruleId: reply.ruleId as string, text: reply.text as string, changeableBy: reply.changeableBy as 'owner' | 'owner-or-cofounder' };
}

export const stopError = (error: unknown) => error instanceof ChausarError && error.code === 'ASK_STOPPED';
