// AI-native CA firm: the receipt every engine returns. Each figure is BigInt paise written as text with its display,
// each step names the section it rests on, and the receipt names the exact rate-table versions it used, whether the
// CA confirmed them, the defaults it assumed and the questions still open. The receipt id is a digest of all that,
// so the same inputs always give the same receipt, and a draft can only quote figures a receipt holds.
import { digest } from '../../records.ts';
import { inr } from './money.ts';
import type { RateTable, SectionRef, TableStamp } from './rates.ts';

/** 'portal-diff': the portal's figures against the receipts (portal.ts portalDiffReceipt). */
export type CaEngine = 'advance-tax' | 'income-tax' | 'interest-234' | 'gst-working' | 'tds-working' | 'reconcile' | 'books-close' | 'portal-diff';
export type CaFigure = { key: string; label: string; minor: string; display: string };
export type CaReceiptStep = CaFigure & { section: string | null };
export type CaReceipt<W = unknown> = {
  id: string;
  engine: CaEngine;
  /** The main table used, or null for work that uses none (a reconciliation). */
  table: TableStamp | null;
  /** Every table version consulted, in version order. */
  tables: TableStamp[];
  inputsDigest: string;
  steps: CaReceiptStep[];
  figures: CaFigure[];
  working: W;
  assumptions: string[];
  sections: SectionRef[];
  openQuestions: string[];
  explanation: string;
};

/** Collects steps in order. A step key is used once; its figure is the step itself. */
export class ReceiptBuilder {
  readonly steps: CaReceiptStep[] = [];
  readonly assumptions: string[] = [];
  private readonly sections = new Map<string, SectionRef>();
  private readonly stamps = new Map<string, TableStamp>();
  private readonly questions: string[] = [];
  readonly engine: CaEngine;
  constructor(engine: CaEngine) { this.engine = engine; }

  useTable(table: RateTable, stamp: TableStamp): void {
    this.stamps.set(`${stamp.id}@${stamp.version}`, stamp);
    for (const question of table.openQuestions) if (!this.questions.includes(question)) this.questions.push(question);
  }

  cite(section: SectionRef | null): void {
    if (section) this.sections.set(`${section.act}|${section.section}`, section);
  }

  step(key: string, label: string, minor: bigint, section: SectionRef | null = null): bigint {
    if (this.steps.some(step => step.key === key)) throw new Error(`The receipt already has a step ${key}.`);
    this.cite(section);
    this.steps.push({ key, label, minor: String(minor), display: inr(minor), section: section ? section.section : null });
    return minor;
  }

  assume(line: string): void {
    if (!this.assumptions.includes(line)) this.assumptions.push(line);
  }

  build<W>(inputs: unknown, working: W, explanation: string, main: TableStamp | null = null): CaReceipt<W> {
    const tables = [...this.stamps.values()].sort((a, b) => a.id.localeCompare(b.id) || a.version - b.version);
    const body = {
      engine: this.engine,
      table: main ?? tables[0] ?? null,
      tables,
      inputsDigest: digest(inputs),
      steps: this.steps.map(step => ({ ...step })),
      figures: this.steps.map(({ key, label, minor, display }) => ({ key, label, minor, display })),
      working,
      assumptions: [...this.assumptions],
      sections: [...this.sections.values()],
      openQuestions: [...this.questions],
      explanation,
    };
    return { id: `ca_${digest(body).slice(0, 24)}`, ...body };
  }
}

/** A figure from a receipt by key; throws when the engine did not produce it. */
export function receiptFigure(receipt: Pick<CaReceipt, 'figures' | 'engine'>, key: string): CaFigure {
  const found = receipt.figures.find(item => item.key === key);
  if (!found) throw new Error(`The ${receipt.engine} receipt has no figure ${key}.`);
  return found;
}
