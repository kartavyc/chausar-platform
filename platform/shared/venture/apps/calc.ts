// Chausar venture launcher, mini apps (wave 6 package 6H1, D39): the calculator a mini app asks for amounts. A mini app
// never does money arithmetic itself: it sends the amounts the owner typed (exact decimal text in the business's
// currency) and an operation, and code works the figure out in BigInt minor units, with a sum receipt whose subject
// holds the inputs, so the same question always opens the same receipt. The app gets the display and the receipt id
// only, never raw minor units to add up on its own. Nothing here is a model number.
import { formatMoney } from '../../owner-format.ts';
import { check } from '../../portable.ts';
import { decimalMinor } from '../../currency.ts';

/** The 'app-calc' sum receipt subject (contracts.ts SumReceiptSubject), spelled here so the browser can load this file. */
export type AppCalcSubject = { type: 'app-calc'; appId: string; operation: 'add' | 'times' | 'percent-off'; amounts: string[]; count: string | null; percentBps: string | null; currency: string };
/** The shape of money/sums.ts SumPlan this file makes. */
export type AppCalcPlan = {
  subject: AppCalcSubject; currency: string; unit: 'minor';
  addends: { recordId: string; label: string; amount: string; display: string; estimate: boolean }[];
  words: { label: string; one: string; many: string; none: string };
};
export const APP_CALC_OPERATIONS = ['add', 'times', 'percent-off'] as const;
const AMOUNT = /^\d{1,13}(?:\.\d{1,4})?$/;
const COUNT = /^[1-9]\d{0,5}$/;
const PERCENT = /^\d{1,3}(?:\.\d{1,2})?$/;
const BAD = 'Send amounts as plain numbers like 1500 or 499.50, and the operation add, times or percent-off.';

/** A mini app's calculate arguments, checked to the letter, as a receipt subject in minor units. */
export function appCalcSubject(appId: string, currency: string, args: Record<string, unknown>): AppCalcSubject {
  const operation = args.operation;
  check(typeof operation === 'string' && (APP_CALC_OPERATIONS as readonly string[]).includes(operation), 'INVALID_VENTURE_REQUEST', BAD);
  const allowed = operation === 'add' ? ['operation', 'amounts'] : operation === 'times' ? ['operation', 'amounts', 'count'] : ['operation', 'amounts', 'percent'];
  check(Object.keys(args).every(key => allowed.includes(key)) && allowed.every(key => Object.hasOwn(args, key)), 'INVALID_VENTURE_REQUEST', BAD);
  const amounts = args.amounts;
  const most = operation === 'add' ? 50 : 1;
  check(Array.isArray(amounts) && amounts.length >= 1 && amounts.length <= most && amounts.every(item => typeof item === 'string' && AMOUNT.test(item)), 'INVALID_VENTURE_REQUEST', BAD);
  let minor: string[];
  try { minor = (amounts as string[]).map(item => decimalMinor(item, currency)); } catch { check(false, 'INVALID_VENTURE_REQUEST', BAD); throw new Error('unreachable'); }
  let count: string | null = null, percentBps: string | null = null;
  if (operation === 'times') {
    check(typeof args.count === 'string' && COUNT.test(args.count), 'INVALID_VENTURE_REQUEST', 'count is a whole number from 1.');
    count = args.count;
  }
  if (operation === 'percent-off') {
    check(typeof args.percent === 'string' && PERCENT.test(args.percent), 'INVALID_VENTURE_REQUEST', 'percent is a number from 0 to 100, with up to two decimals.');
    const [whole, fraction = ''] = args.percent.split('.');
    const bps = BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
    check(bps <= 10000n, 'INVALID_VENTURE_REQUEST', 'percent is a number from 0 to 100, with up to two decimals.');
    percentBps = String(bps);
  }
  return { type: 'app-calc', appId, operation: operation as AppCalcSubject['operation'], amounts: minor, count, percentBps, currency };
}

const percentWords = (bps: bigint): string => (bps % 100n === 0n ? String(bps / 100n) : `${bps / 100n}.${String(bps % 100n).padStart(2, '0').replace(/0$/, '')}`);

/** The plan behind an app's figure, worked out again from its subject alone. Discounts round half up to a minor unit. */
export function appCalcPlan(subject: AppCalcSubject): AppCalcPlan {
  const { currency } = subject;
  const show = (amount: bigint) => formatMoney(amount, currency);
  const line = (index: number, label: string, amount: bigint) => ({ recordId: `${subject.appId}:${index}`, label, amount: String(amount), display: show(amount), estimate: false });
  let addends: AppCalcPlan['addends'];
  if (subject.operation === 'add') {
    addends = subject.amounts.map((amount, index) => line(index, `Amount ${index + 1}`, BigInt(amount)));
  } else if (subject.operation === 'times') {
    const amount = BigInt(subject.amounts[0]!), count = BigInt(subject.count ?? '1');
    addends = [line(0, `${show(amount)} times ${count}`, amount * count)];
  } else {
    const amount = BigInt(subject.amounts[0]!), bps = BigInt(subject.percentBps ?? '0');
    const off = (amount * bps + 5000n) / 10000n;
    addends = [line(0, 'Amount', amount), line(1, `Less ${percentWords(bps)}%, rounded to the nearest minor unit`, -off)];
  }
  return { subject, currency, unit: 'minor', addends, words: { label: 'Worked out for an app', one: 'amount', many: 'amounts', none: 'Nothing to work out.' } };
}
