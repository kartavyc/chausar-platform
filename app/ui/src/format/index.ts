import type { Figure, MissingState } from '../bridge/presentation.ts';
import { validateFigure } from '../bridge/validate.ts';
import { money } from './money.ts';
import { count, percent } from './counts.ts';
export { money, moneyShort, moneySpoken } from './money.ts';
export type { ShortMoneyWords, SpokenMoneyWords } from './money.ts';
export { count, percent, points } from './counts.ts';
export { date, time, age, year } from './dates.ts';
export type { DateForm } from './dates.ts';
export type MissingWords = Readonly<Record<MissingState, string>>;
/** Catalog words ensure all seven missing categories are visible and translated. */
export function missing(state: MissingState, words: MissingWords): string {
  validateFigure({ kind: 'missing', state });
  if (typeof words[state] !== 'string' || words[state].trim().length === 0) throw new TypeError('MISSING_FORMAT_WORD');
  return words[state];
}
export function figureText(value: Figure, words: MissingWords): string {
  const checked = validateFigure(value);
  switch (checked.kind) {
    case 'money': return money(checked.paise);
    case 'count': return count(checked.count);
    case 'percent': return percent(checked.basisPoints);
    case 'missing': return missing(checked.state, words);
  }
}
