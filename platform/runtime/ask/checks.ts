/**
 * AS-16: checks. Your own questions with known answers, kept as a standing test of everything
 * that changes. Each check holds its calculation request, the figure it watches and the value
 * you accepted, with the receipt it came from. A run works each request out again as known now
 * and says same, moved, or cannot run, with the new receipt.
 *
 * Checks run again when the model route, the meanings, a recipe or the app version changes:
 * on the scheduler tick while autonomy is on, and whenever a person presses Run all.
 * Their values stay in the vault and are never shared.
 */
import { check, hash, newId, now, type Context, type State } from '../contracts.ts';
import type { ModuleHost } from '../modules/types.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { CheckItem, CheckReply, ChecksReply, Fingerprint } from './contracts.ts';
import { askState, codeOf, core, headlineKey, input, peekAsk, requireId, text, translate } from './shared.ts';

export function fingerprint(state: State, host: ModuleHost): Fingerprint {
  const dictionary = state.ontology?.current ?? (state.ontology?.operations ? state.ontology : null);
  const recipes = state.imports.filter(record => typeof record?.recipeHash === 'string').map(record => `${record.sourceId}:${record.recipeHash}`).sort();
  const routes = state.routes.filter(route => route && typeof route.id === 'string').map(route => `${route.id}:${route.revision ?? ''}:${route.selected === true ? 1 : 0}`).sort();
  return { dictionaryHash: typeof dictionary?.hash === 'string' ? dictionary.hash : null, recipes: hash(recipes), route: routes.length ? hash(routes) : null,
    app: typeof host.options.appVersion === 'string' ? host.options.appVersion : null };
}
export function changedParts(before: Fingerprint | null, after: Fingerprint): string[] {
  if (!before) return [];
  const out: string[] = [];
  if (before.dictionaryHash !== after.dictionaryHash) out.push('meaning');
  if (before.recipes !== after.recipes) out.push('recipe');
  if (before.route !== after.route) out.push('model-route');
  if (before.app !== after.app) out.push('app-version');
  return out;
}

const CHECKS_PER_MEMBER = 200;

export async function saveCheck(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['receiptId', 'question', 'figureKey'], ['receiptId']);
  const receipt = await core<CalculationReceipt>(host, 'receipts.get', { id: requireId(request.receiptId) });
  const figureKey = request.figureKey === undefined ? headlineKey(receipt) : String(request.figureKey);
  const figure = receipt.figures.find(f => f.key === figureKey);
  check(figure, 'ASK_INVALID', 'Choose a figure that is on this receipt.');
  const answer = host.store.read().answers.find(a => a?.receiptId === receipt.id && a.request);
  check(answer, 'ASK_NOT_FOUND', 'This answer has no saved request to check against.');
  const question = request.question === undefined || request.question === null ? `${receipt.operation}` : text(request.question, 500);
  return host.store.update(state => {
    const own = askState(state);
    const item: CheckItem = { id: newId('check'), memberId: ctx.memberId, question, operationId: receipt.operation, request: structuredClone(answer.request),
      figureKey, expectedMinor: figure.minor, expectedReceiptId: receipt.id, createdAt: now(), results: [], sourceIds: [...receipt.sourceIds], fingerprint: fingerprint(state, host) };
    check(own.checks.filter(c => c.memberId === ctx.memberId).length < CHECKS_PER_MEMBER, 'ASK_INVALID', 'Remove some checks before adding more.');
    own.checks.push(item);
    return { id: item.id };
  });
}

function shown(item: CheckItem): ChecksReply['items'][number] {
  return { id: item.id, question: item.question, operationId: item.operationId, figureKey: item.figureKey,
    expected: { minor: item.expectedMinor, receiptId: item.expectedReceiptId }, last: item.results.at(-1) ?? null };
}

export function listChecks(ctx: Context, payload: unknown, host: ModuleHost): ChecksReply {
  input(payload, []);
  const state = host.store.read(), own = peekAsk(state), current = fingerprint(state, host);
  const mine = own.checks.filter(c => c.memberId === ctx.memberId);
  const changed = [...new Set(mine.flatMap(c => changedParts(c.fingerprint, current)))];
  const lastRunAt = mine.flatMap(c => c.results.map(r => r.at)).sort().at(-1) ?? null;
  return { items: mine.map(shown), due: changed.length > 0 && mine.length > 0, changed, lastRunAt };
}

/** Works every check of this member out again as known now. */
type Calculate = (request: Record<string, unknown>) => Promise<CalculationReceipt>;

/** Works every check of this member out again as known now, as that member. */
export async function runChecks(ctx: Context, host: ModuleHost, calculate: Calculate = request => host.call('calculation.run', request) as Promise<CalculationReceipt>): Promise<ChecksReply> {
  await runFor(ctx, host, calculate, () => true);
  return listChecks(ctx, {}, host);
}

async function runFor(ctx: Context, host: ModuleHost, calculate: Calculate, due: (item: CheckItem, current: Fingerprint) => boolean) {
  const before = host.store.read(), own = peekAsk(before), current = fingerprint(before, host);
  const results = new Map<string, CheckItem['results'][number]>();
  for (const item of own.checks.filter(c => c.memberId === ctx.memberId && due(c, current))) {
    const at = now(), because = changedParts(item.fingerprint, current), { asOf: _asOf, ...again } = item.request;
    try {
      const receipt = await calculate(again);
      const figure = receipt.figures.find(f => f.key === item.figureKey);
      results.set(item.id, figure ? { at, result: figure.minor === item.expectedMinor ? 'same' : 'moved', minor: figure.minor, receiptId: receipt.id, code: null, because }
        : { at, result: 'cannot-run', minor: null, receiptId: receipt.id, code: 'ASK_FIGURE_GONE', because });
    } catch (error) {
      results.set(item.id, { at, result: 'cannot-run', minor: null, receiptId: null, code: translate(error).code, because });
    }
  }
  await host.store.update(state => {
    const mine = askState(state);
    const after = fingerprint(state, host);
    for (const item of mine.checks) { const result = results.get(item.id); if (result) { item.results.push(result); item.fingerprint = after; if (item.results.length > 50) item.results.splice(0, item.results.length - 50); } }
  });
  return results.size;
}

export function getCheck(ctx: Context, payload: unknown, host: ModuleHost): CheckReply {
  const request = input(payload, ['checkId'], ['checkId']), id = requireId(request.checkId);
  const item = peekAsk(host.store.read()).checks.find(c => c.id === id && c.memberId === ctx.memberId);
  check(item, 'ASK_NOT_FOUND', 'This check is no longer available.');
  return { id: item.id, question: item.question, operationId: item.operationId, figureKey: item.figureKey, createdAt: item.createdAt,
    expected: { minor: item.expectedMinor, receiptId: item.expectedReceiptId }, results: structuredClone(item.results) };
}

export async function removeCheck(ctx: Context, payload: unknown, host: ModuleHost) {
  const request = input(payload, ['checkId'], ['checkId']), id = requireId(request.checkId);
  return host.store.update(state => {
    const own = askState(state), index = own.checks.findIndex(c => c.id === id && c.memberId === ctx.memberId);
    check(index >= 0, 'ASK_NOT_FOUND', 'This check is no longer available.');
    own.checks.splice(index, 1); return { removed: true as const };
  });
}

/**
 * Scheduler: run every member's due checks, each as that member with that member's current
 * authority. The engine calls this once per owner or cofounder; a check's fingerprint moves when
 * it runs, so a second call in the same tick finds nothing due. A member whose access is gone
 * (revoked, or a changed epoch) is skipped: nothing runs without current authority.
 */
export async function tickChecks(_ctx: Context, host: ModuleHost): Promise<unknown[]> {
  const state = host.store.read(), own = peekAsk(state), current = fingerprint(state, host), out: unknown[] = [];
  const due = (item: CheckItem, now: Fingerprint) => changedParts(item.fingerprint, now).length > 0;
  for (const member of state.members.filter(m => m.active && own.checks.some(c => c.memberId === m.id && due(c, current)))) {
    const seat: Context = { memberId: member.id, role: member.role, epoch: member.epoch, channel: 'desktop' };
    const because = [...new Set(own.checks.filter(c => c.memberId === member.id).flatMap(c => changedParts(c.fingerprint, current)))];
    try {
      const ran = await runFor(seat, host, request => host.services.calculator.calculate(seat, request) as Promise<CalculationReceipt>, due);
      const after = peekAsk(host.store.read()).checks.filter(c => c.memberId === member.id);
      out.push({ module: 'ask', job: 'checks', member: member.id, ran, moved: after.filter(c => c.results.at(-1)?.result === 'moved').length, because });
    } catch (error) { out.push({ module: 'ask', job: 'checks', member: member.id, error: { code: codeOf(error) } }); }
  }
  return out;
}
