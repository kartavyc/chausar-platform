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
import { businessToday, codeOf, currentDictionary, identifier, input, namedPeriod, period, text, translate } from './shared.ts';
import { isPeriodId, operationOf, proposalReply, recordAsked } from './menu.ts';

const NOT_BUILT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);

export async function change(ctx: Context, payload: unknown, host: ModuleHost): Promise<UnderstandReply> {
  const request = input(payload, ['operationId', 'period', 'periodId', 'branch', 'change', 'today'], ['operationId', 'change']);
  const dictionary = currentDictionary(host, ctx);
  if (!dictionary) return { kind: 'refused', code: 'ASK_NO_DICTIONARY' };
  const before = operationOf(dictionary, request.operationId);
  check(before, 'ASK_NO_CALCULATION', 'No published calculation has this name.');
  const to = input(request.change, ['operationId', 'period', 'periodId', 'branch']);
  const today = businessToday(host, request.today);
  const operation = to.operationId === undefined ? before : operationOf(dictionary, to.operationId);
  check(operation, 'ASK_NO_CALCULATION', 'No published calculation has this name.');
  const periodId = to.periodId !== undefined ? (check(isPeriodId(to.periodId), 'ASK_INVALID', 'Choose a named period.'), to.periodId) : to.period !== undefined ? null : isPeriodId(request.periodId) ? request.periodId : null;
  const chosen = to.period !== undefined ? period(to.period) : periodId !== null ? namedPeriod(periodId, today) : request.period !== undefined ? period(request.period) : namedPeriod('last-month', today);
  const branch = to.branch !== undefined ? to.branch : request.branch ?? null;
  check(branch === null || identifier(branch), 'ASK_INVALID', 'Choose a branch by its name.');
  // The correction is kept as structure only: which calculation replaced which, and whether the period or group moved.
  await recordAsked(host, ctx.memberId, ctx.role, operation.id, periodId, { operationId: before.id,
    periodChanged: to.period !== undefined || to.periodId !== undefined, groupChanged: to.branch !== undefined });
  return proposalReply(host, ctx, dictionary, operation, chosen, periodId, branch, today);
}

/** Stop requests by member, held in this process only. A long loop checks it between steps. */
const stops = new Map<string, number>();
export function stop(ctx: Context, payload: unknown) {
  input(payload, []);
  stops.set(ctx.memberId, Date.now());
  return { stopped: true as const, at: now() };
}
/** Throws ASK_STOPPED when this member asked to stop after `startedAt`. */
export function checkStop(ctx: Context, startedAt: number) {
  const at = stops.get(ctx.memberId);
  if (at !== undefined && at >= startedAt) throw new ChausarError('ASK_STOPPED', 'Stopped as you asked. Nothing was saved from the unfinished answer.');
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
  for (const name of ['receiptId', 'sourceId'] as const) if (request[name] !== undefined) check(identifier(request[name]), 'ASK_INVALID', 'Choose one item by its identifier.');
  void ctx;
  let reply: { ruleId?: unknown; text?: unknown; changeableBy?: unknown };
  try { reply = await host.call('trust.explain', { ...request }) as typeof reply; }
  catch (error) {
    if (NOT_BUILT.has(codeOf(error))) return { state: 'not-built' as const };
    throw translate(error);
  }
  // The rule's words come from Trust as fixed text; anything else is refused rather than shown.
  check(typeof reply?.ruleId === 'string' && RULE_ID.test(reply.ruleId) && typeof reply.text === 'string' && reply.text.trim().length > 0 && reply.text.length <= 1000
    && (reply.changeableBy === 'owner' || reply.changeableBy === 'owner-or-cofounder'), 'ASK_REFUSED', 'Trust explained the rule in a shape this page does not read.');
  return { state: 'ready' as const, ruleId: reply.ruleId as string, text: reply.text as string, changeableBy: reply.changeableBy as 'owner' | 'owner-or-cofounder' };
}

export const stopError = (error: unknown) => error instanceof ChausarError && error.code === 'ASK_STOPPED';
