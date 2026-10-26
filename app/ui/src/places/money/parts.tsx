/**
 * Small pieces the Money place shares. Nothing here reads, parses or changes an amount: a figure is shown exactly as
 * the engine wrote it, through the shared Figure part with its receipt (or the "model estimate" label), and an amount
 * that comes with no receipt of its own is shown only as the engine's own words.
 */

import { useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import { cx } from '../../parts/cx';
import { Count, Figure, proofOf, type FigureProof, type FigureSize } from '../../parts/Figure';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import { SectionHead, Tile, type TileSpan } from '../../parts/Tile';
import type { EngineError, MoneyOverviewLine } from '../../engine/types';
import s from './Money.module.css';

/**
 * The proof of a Money at a glance line, or null when it has none (then the figure is left out, never shown bare).
 * Spend counts calls not settled yet at their estimate, and the engine says so in the figure ("includes estimates"):
 * that is a cost worked out by code, not a number a model wrote, so its proof is its receipt. On the other lines
 * `estimate` means a model wrote the figure, and it then carries the "model estimate" label and no receipt.
 */
export function lineProof(line: MoneyOverviewLine | undefined): FigureProof | null {
  if (!line) return null;
  return line.id === 'spent' ? proofOf({ receiptId: line.receiptId }) : proofOf(line);
}

/**
 * A figure with its proof, and the engine's rupee view of it beside it when there is one ("₹20.88 at ₹83.50 per $1
 * (your rate, set 23 Oct 2026)"): the rupees are the same amount at the owner's own rate, so the figure's own receipt
 * covers both (one `data-figure-group`).
 */
export function ProvedFigure({ value, proof, size, rupees, className }: { value: string; proof: FigureProof; size?: FigureSize | undefined; rupees?: string | undefined; className?: string | undefined }) {
  if (!rupees) return <Figure {...proof} value={value} size={size} className={className} />;
  return (
    <span className={cx(s.withRupees, className)} data-figure-group="">
      <Figure {...proof} value={value} size={size} />
      <span className={s.rupees}>{rupees}</span>
    </span>
  );
}

/**
 * Words the engine composed that may hold an amount it sends with no receipt of its own: a paid call still held at its
 * estimate, a tax line, a journal line, a refusal, a limit in rupees at the owner's rate. They are the engine's text,
 * shown as written and never set as a figure. Marked `data-engine-line`, the stopgap tests/helpers/ink-rules.ts keeps
 * until W4 4J1 sends these amounts with their receipts.
 */
export function EngineWords({ children, className }: { children: ReactNode; className?: string | undefined }) {
  return <span className={className} data-engine-line="">{children}</span>;
}

/**
 * Whether the engine wrote words rather than an amount alone: "No price", "₹60.10, includes estimates", "USD 0.2500 this
 * month (includes estimates)". A currency code in front of the amount ("USD 0.2500") is not words. Only the text is
 * looked at; nothing is parsed.
 */
export function isPhrase(text: string): boolean {
  return /[A-Za-zऀ-ॿ]{3}/.test(text.replace(/^[A-Z]{3}\s+/, ''));
}

/**
 * An amount as the engine wrote it, in DM Mono; a phrase the engine wrote instead stays in the body face, so words never
 * set in a typewriter face (`isPhrase`).
 */
export function Amount({ text }: { text: string }) {
  return <span className={isPhrase(text) ? undefined : 'mono'}>{text}</span>;
}

/**
 * A line from the catalogue with a count in it ("3 open invoices"), the count set as a Count (DM Mono, no proof). The
 * count is found as text where it first stands as a whole number; a line that does not hold it is shown plain.
 */
export function Counted({ text, count }: { text: string; count: number }) {
  const digits = String(count);
  const found = new RegExp(`(?<!\\d)${digits}(?!\\d)`).exec(text);
  if (!found) return <>{text}</>;
  return <>{text.slice(0, found.index)}<Count value={digits} />{text.slice(found.index + digits.length)}</>;
}

/**
 * The engine's rupee view beside a dollar figure, as it wrote it with the owner's own rate. Nothing when the owner set
 * no rate: then spend is in dollars only.
 */
export function Rupees({ text }: { text?: string | undefined }) {
  return text ? <> · <EngineWords className={s.note}>{text}</EngineWords></> : null;
}

/** An invoice number that opens the invoice beside the list, where each of its figures sits with its receipt. */
export function InvoiceRef({ id, number }: { id: string; number: string }) {
  const t = useT();
  return (
    <button type="button" className={cx(s.ref, 'mono')} data-invoice={id} aria-label={t('money.invoiceRef', { number })} onClick={(event) => openSheet('invoice', id, event.currentTarget)}>
      {number}
    </button>
  );
}

/** The engine could not answer: its own words, which may name an amount. */
export function Failed({ error }: { error: EngineError }) {
  const t = useT();
  return <p className={s.failed} role="status" data-engine-line="">{t('money.failed', { message: error.message })}</p>;
}

/**
 * A titled part of a page (D's `.shead` over a tile): the section heading, anything at its end, and the tile it holds.
 * `tile={false}` when the content brings its own tiles.
 */
export function Section({ title, end, tile = true, children }: { title: string; end?: ReactNode; tile?: boolean; children: ReactNode }) {
  const id = useId();
  return (
    <section className={s.section} aria-labelledby={id}>
      <SectionHead id={id} title={title} end={end} />
      {tile ? <Tile className={s.sectionTile}>{children}</Tile> : children}
    </section>
  );
}

/**
 * One of Money's figure tiles (D-Money `.mt`, `.m-lab`, `.s-row`, `.s-sub`): a small label with its icon, then what
 * the tile holds. The tile is a region named by its label. The receipt of the figure inside sits at the top right, as
 * on the board.
 */
export function MoneyTile({ label, icon, span, children, className }: { label: string; icon: IconName; span: TileSpan; children?: ReactNode; className?: string | undefined }) {
  const id = useId();
  return (
    <Tile as="section" labelledBy={id} span={span} pad="compact" className={cx(s.moneyTile, className)}>
      <p className={s.tileLabel}>
        <Icon name={icon} size={14} />
        <span id={id}>{label}</span>
      </p>
      {children}
    </Tile>
  );
}
