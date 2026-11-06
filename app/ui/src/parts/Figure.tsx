import { cx } from './cx';
import { ModelEstimate } from './ModelEstimate';
import { Receipt } from './Receipt';
import s from './Figure.module.css';

/**
 * How a figure is proved: a receipt from code, or the "model estimate" label. Exactly one, never both and never
 * neither; the type makes both and neither a compile error.
 */
export type FigureProof = { receiptId: string; estimate?: never } | { estimate: true; receiptId?: never };

/** D's figure sizes (DM Mono 500): goal 40, goal on phone 30, goal percent 32, stat 30, hero 24, tile 20,
 *  department stat 17. Left out, the figure takes the size of the text around it. */
export type FigureSize = 'goal' | 'goal-phone' | 'pct' | 'stat' | 'hero' | 'tile' | 'dept';

export type FigureProps = FigureProof & {
  /** The engine's own formatted text ("₹18,880"). The UI never computes it. */
  value: string;
  onReceipt?: ((id: string) => void) | undefined;
  size?: FigureSize | undefined;
  /** `dark`: on the dark goal card (light figures, the receipt as an underlined light link). */
  tone?: 'dark' | undefined;
  className?: string | undefined;
};

/**
 * The proof an engine record carries, as a FigureProof, or null when it carries none (then show no figure).
 * A model estimate wins over a receipt id: a model-written number never carries a receipt, even when one is sent.
 * A blank receipt id is no receipt.
 */
export function proofOf(source: { receiptId?: string | undefined; estimate?: boolean | undefined }): FigureProof | null {
  if (source.estimate) return { estimate: true };
  if (source.receiptId && source.receiptId.trim() !== '') return { receiptId: source.receiptId };
  return null;
}

/**
 * Every money figure Ink shows: the engine's value in DM Mono (`data-ui-number`) with its proof beside it, a
 * receipt that opens the receipt sheet or the "model estimate" chip, inside one `data-figure`
 * (tests/helpers/ink-rules.ts `assertFiguresProved` holds every place to it). Counts of steps, people and runs
 * use `Count`, which carries no proof.
 *
 * The type takes a receipt or the estimate, but engine data can arrive untyped: a figure that turns out to have no
 * proof (no receipt id, or a blank one) throws in development and renders nothing in production, so a bare amount
 * or a dead receipt button never reaches the owner.
 */
/**
 * The engine's figure split where it wrote words after the amount ("₹60.10, includes estimates"): the amount is the
 * figure, set in DM Mono, and the words stay in the body face beside it (w3 3I). Nothing is parsed or worked out: the
 * text is cut once, after the first amount, only when a currency sign or code starts it and words follow.
 */
const AMOUNT_THEN_WORDS = /^((?:[₹$€]\s?|(?:INR|USD|EUR|GBP|AED|SGD|AUD|CAD)\s)\d[\d,]*(?:\.\d+)?)([,;]?\s+\D.*)$/s;

/** An amount anywhere in a text (the same test as tests/helpers/ink-rules.ts MONEY). */
const HOLDS_AMOUNT = /(?:[₹$€]\s?|\b(?:INR|USD|EUR|GBP|AED|SGD|AUD|CAD)\s?)\d/;

export function splitFigure(value: string): { amount: string; words?: string | undefined } {
  const found = AMOUNT_THEN_WORDS.exec(value);
  // Words that hold a second amount (", plus ₹18.00 held") are never split off: that amount would sit outside the
  // figure with no proof of its own, so the whole value stays the one figure its receipt proves.
  if (!found || HOLDS_AMOUNT.test(found[2]!)) return { amount: value };
  return { amount: found[1]!, words: found[2]! };
}

export function Figure(props: FigureProps) {
  const { value, onReceipt, size, tone, className } = props;
  const proof = proofOf(props);
  const { amount, words } = splitFigure(value);
  if (!proof) {
    if (import.meta.env.DEV) throw new Error(`Figure "${value}" has no proof: give it a receipt id, or estimate when a model wrote it.`);
    return null;
  }
  return (
    <span className={cx(s.figure, className)} data-figure="" data-size={size} data-tone={tone}>
      <span className={cx(s.value, 'mono')} data-ui-number="">{amount}</span>
      {/* Words that open with a comma or semicolon sit right against the amount: no gap before the comma. */}
      {words && <span className={s.words} data-figure-words="" data-lead={/^[,;]/.test(words) ? 'punct' : undefined}>{words}</span>}
      {proof.estimate ? <ModelEstimate tone={tone} /> : <Receipt id={proof.receiptId} amount={amount} onOpen={onReceipt} tone={tone} />}
    </span>
  );
}

/** A count (steps, people, runs, things waiting): DM Mono, no proof, and no `data-ui-number`, since it is not money. */
export function Count({ value, className }: { value: number | string; className?: string | undefined }) {
  return <span className={cx(s.count, 'mono', className)} data-count="">{value}</span>;
}
