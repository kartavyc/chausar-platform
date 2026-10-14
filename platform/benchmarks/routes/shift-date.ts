/**
 * Test preload that moves the process clock, to prove the route bench never depends on the real date:
 *   CHAUSAR_SHIFT_DAYS=-200 node --import ./platform/benchmarks/routes/shift-date.ts --test platform/tests/models-ext-bench*.test.ts
 * `new Date()` and `Date.now()` read the shifted clock; dates built from explicit values are unchanged.
 */
import process from 'node:process';

const days = Number(process.env.CHAUSAR_SHIFT_DAYS ?? '0');
if (!Number.isInteger(days)) throw new Error('CHAUSAR_SHIFT_DAYS must be a whole number of days.');
const offset = days * 86400000;
const RealDate: DateConstructor = Date;

function ShiftedDate(...args: unknown[]) {
  if (!new.target) return new RealDate(RealDate.now() + offset).toString();
  return Reflect.construct(RealDate, args.length ? args : [RealDate.now() + offset], new.target);
}
Object.setPrototypeOf(ShiftedDate, RealDate);
ShiftedDate.prototype = RealDate.prototype;
ShiftedDate.now = () => RealDate.now() + offset;
globalThis.Date = ShiftedDate as unknown as DateConstructor;
