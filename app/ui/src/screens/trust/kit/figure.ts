/**
 * Engine figures to presentation figures. The engine sends exact integer strings with a
 * calculation receipt id; the display string comes only from the shared format module.
 */
import type { FigureLabel, FigureOrMissing } from '../../../app/presentation.ts';
import type { MissingState } from '../../../bridge/presentation.ts';
import { count, money, percent } from '../../../format/index.ts';
import { ShapeError, digits, list, oneOf, rec, str } from './validate.ts';

const MISSING: readonly MissingState[] = ['absent', 'null', 'unknown', 'withheld', 'not-applicable', 'not-loaded-yet', 'not-counted'];
const LABELS: readonly FigureLabel[] = ['seed', 'what-if', 'projection', 'from-outside', 'approximate', 'demo-clock', 'stale'];

export function figure(value: unknown, path: string): FigureOrMissing {
  const f = rec(value, path);
  const kind = oneOf(f['kind'], `${path}.kind`, ['money', 'count', 'percent', 'missing'] as const);
  if (kind === 'missing') return { kind: 'missing', missing: oneOf(f['missing'], `${path}.missing`, MISSING) };
  const exact = digits(f['exact'], `${path}.exact`, kind !== 'count');
  const receiptId = str(f['receiptId'], `${path}.receiptId`, 200);
  if (receiptId.length === 0) throw new ShapeError(`${path}.receiptId`);
  const labels = list(f['labels'] ?? [], `${path}.labels`, (v, p) => oneOf(v, p, LABELS), 7);
  const display = kind === 'money' ? money(exact) : kind === 'count' ? count(exact) : percent(exact);
  return { kind, exact, display, receiptId, labels };
}

/** Whole paise as text, for values that carry no calculation receipt (a cost, a cap). */
export function rupees(paise: string): string { return money(paise); }
