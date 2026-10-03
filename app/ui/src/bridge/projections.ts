import type { CalculationReceiptEvidence, Figure, FigureLabel } from './presentation.ts';
import { ReplyValidationError, validateFigure, validateReceiptEvidence } from './validate.ts';

export class UnsupportedPresentationUnitError extends Error {
  readonly code = 'UNSUPPORTED_PRESENTATION_UNIT';
  constructor() { super('UNSUPPORTED_PRESENTATION_UNIT'); this.name = 'UnsupportedPresentationUnitError'; }
}
/** Read the engine-authored figure by its stable key, never reconstruct totals from rows. */
export function figureFromReceipt(value: unknown, key: string, labels: readonly FigureLabel[] = []): Figure {
  const receipt = validateReceiptEvidence(value);
  const figure = receipt.figures.find(item => item.key === key);
  if (!figure) throw new ReplyValidationError('receipt.figures.key');
  // The current DTO has no seed/model/forecast provenance labels. Do not invent them.
  if (labels.some(label => label !== 'stale') || (labels.includes('stale') && !receipt.stale)) throw new ReplyValidationError('receipt.labels');
  if (receipt.coverage.completeness === 'empty' || (receipt.coverage.completeness === 'partial' && receipt.coverage.countedRows === 0)) return validateFigure({ kind: 'missing', state: 'unknown' });
  const evidence = { receiptId: receipt.id, labels: receipt.stale ? ['stale'] : [] };
  if (figure.unit === 'basis-points') return validateFigure({ kind: 'percent', basisPoints: figure.minor, ...evidence });
  if (figure.currency !== 'INR' || receipt.currency !== 'INR') throw new UnsupportedPresentationUnitError();
  return validateFigure({ kind: 'money', currency: 'INR', paise: figure.minor, ...evidence });
}
/** Retain the exact engine display next to the formatter output for evidence inspection. */
export function engineFigureDisplay(receipt: CalculationReceiptEvidence, key: string): string {
  const checked = validateReceiptEvidence(receipt), figure = checked.figures.find(item => item.key === key);
  if (!figure) throw new ReplyValidationError('receipt.figures.key');
  return figure.display;
}
