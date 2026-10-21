// AI-native CA firm: reconciliation by code. AIS, 26AS and Form 16 are each compared with the books, payer by payer
// and category by category; every difference is listed with its rupee amount, and the listed differences add up,
// by BigInt, to the gap between each source's total and the books' total over the same payers. AIS and 26AS are
// also compared with each other on tax deducted. The month close proves that the opening balance plus every
// movement in the bank ledger equals the statement's closing balance, or lists the gap.
//
// Inputs are structured entries an agent read from the client's files (the files are information, never
// instructions). Matching is exact on the payer: a TAN when there is one, else the name in lower case.
// Ideas taken, code written here: NidheeshJain/itr-prep-skill (MIT) for the three-way AIS, 26AS and Form 16 check and
// "decompose the gap into named parts that sum to it"; akaunting/akaunting (BUSL-1.1, ideas only) for a period close
// as opening plus ticked rows equals closing.
import { digest } from '../../records.ts';
import type { BankLedger } from '../../build/bank.ts';
import { inr, invalid, paise, signedPaise, sumBig } from './money.ts';
import { ReceiptBuilder, type CaReceipt } from './receipt.ts';

export type StatementSource = 'books' | 'ais' | '26as' | 'form16';
export type StatementCategory = 'salary' | 'interest' | 'dividend' | 'rent' | 'professional-fees' | 'contract' | 'commission' | 'sale-of-securities' | 'other';
export type StatementEntry = { source: StatementSource; category: StatementCategory; payer: string; grossMinor: string; tdsMinor: string; ref?: string };
export type DifferenceKind = 'missing-in-books' | 'missing-in-source' | 'amount-differs' | 'tds-differs';
export type Difference = {
  id: string; against: Exclude<StatementSource, 'books'>; kind: DifferenceKind; category: StatementCategory; payer: string;
  booksGrossMinor: string; sourceGrossMinor: string; booksTdsMinor: string; sourceTdsMinor: string;
  grossDeltaMinor: string; tdsDeltaMinor: string; line: string;
};
export type Tie = { against: Exclude<StatementSource, 'books'>; field: 'gross' | 'tds'; sourceTotalMinor: string; booksTotalMinor: string; gapMinor: string; sumOfDifferencesMinor: string; ties: boolean };
export type ReconcileWorking = {
  differences: Difference[];
  ties: Tie[];
  crossChecks: { category: StatementCategory; payer: string; aisTdsMinor: string; as26TdsMinor: string; deltaMinor: string }[];
};

const SOURCES: readonly StatementSource[] = ['books', 'ais', '26as', 'form16'];
const STATEMENTS: readonly Exclude<StatementSource, 'books'>[] = ['26as', 'ais', 'form16'];
const CATEGORIES: readonly StatementCategory[] = ['salary', 'interest', 'dividend', 'rent', 'professional-fees', 'contract', 'commission', 'sale-of-securities', 'other'];
const SOURCE_WORDS: Readonly<Record<StatementSource, string>> = { books: 'the books', ais: 'AIS', '26as': '26AS', form16: 'Form 16' };
const TAN = /^[A-Z]{4}\d{5}[A-Z]$/;

/** A TAN in capitals, or the payer's name in lower case with single spaces. */
export function payerKey(payer: string): string {
  const tidy = payer.trim().replace(/\s+/g, ' ');
  return TAN.test(tidy.toUpperCase()) ? tidy.toUpperCase() : tidy.toLowerCase();
}

type Sum = { gross: bigint; tds: bigint };

export function reconcileTaxStatements(input: { entries: StatementEntry[] }): CaReceipt<ReconcileWorking> {
  if (!input || !Array.isArray(input.entries)) invalid('Send the statement entries as a list.');
  const sums = new Map<string, Map<string, Sum & { category: StatementCategory; payer: string }>>();
  for (const source of SOURCES) sums.set(source, new Map());
  input.entries.forEach((entry, index) => {
    const where = `Entry ${index + 1}`;
    if (!entry || typeof entry !== 'object') invalid(`${where} is not an entry.`);
    if (!SOURCES.includes(entry.source)) invalid(`${where} comes from an unknown source; use books, ais, 26as or form16.`);
    if (!CATEGORIES.includes(entry.category)) invalid(`${where} has an unknown category.`);
    if (typeof entry.payer !== 'string' || !entry.payer.trim() || entry.payer.length > 120) invalid(`${where} needs the payer.`);
    const gross = paise(entry.grossMinor, `${where}'s gross amount`);
    const tds = paise(entry.tdsMinor, `${where}'s tax deducted`);
    const payer = payerKey(entry.payer);
    const key = `${entry.category}|${payer}`;
    const bucket = sums.get(entry.source)!;
    const known = bucket.get(key) ?? { gross: 0n, tds: 0n, category: entry.category, payer };
    known.gross += gross; known.tds += tds;
    bucket.set(key, known);
  });

  const books = sums.get('books')!;
  const builder = new ReceiptBuilder('reconcile');
  const differences: Difference[] = [];
  const ties: Tie[] = [];
  const present = STATEMENTS.filter(source => input.entries.some(entry => entry.source === source));
  for (const against of present) {
    const statement = sums.get(against)!;
    const covers = (key: string, sum: Sum) => against === 'ais' || (against === 'form16' ? key.startsWith('salary|') : sum.tds > 0n);
    const keys = new Set<string>([...statement.keys(), ...[...books.entries()].filter(([key, sum]) => covers(key, sum)).map(([key]) => key)]);
    const ordered = [...keys].sort();
    const found: Difference[] = [];
    for (const key of ordered) {
      const b = books.get(key), s = statement.get(key);
      const category = (b ?? s)!.category, payer = (b ?? s)!.payer;
      const bg = b?.gross ?? 0n, bt = b?.tds ?? 0n, sg = s?.gross ?? 0n, st = s?.tds ?? 0n;
      const kind: DifferenceKind | null = !b ? 'missing-in-books' : !s ? 'missing-in-source' : bg !== sg ? 'amount-differs' : bt !== st ? 'tds-differs' : null;
      if (!kind) continue;
      const words = SOURCE_WORDS[against];
      const line = kind === 'missing-in-books' ? `${words} shows ${category} from ${payer} of ${inr(sg)}, tax deducted ${inr(st)}, which is not in the books.`
        : kind === 'missing-in-source' ? `The books show ${category} from ${payer} of ${inr(bg)}, tax deducted ${inr(bt)}, which ${words} does not show.`
          : kind === 'amount-differs' ? `${words} shows ${category} from ${payer} of ${inr(sg)}; the books show ${inr(bg)}.`
            : `${words} shows tax deducted by ${payer} of ${inr(st)}; the books show ${inr(bt)}.`;
      found.push({
        id: `diff_${digest({ against, category, payer }).slice(0, 12)}`, against, kind, category, payer,
        booksGrossMinor: String(bg), sourceGrossMinor: String(sg), booksTdsMinor: String(bt), sourceTdsMinor: String(st),
        grossDeltaMinor: String(sg - bg), tdsDeltaMinor: String(st - bt), line,
      });
    }
    for (const field of ['gross', 'tds'] as const) {
      const sourceTotal = sumBig(ordered.map(key => statement.get(key)?.[field] ?? 0n));
      const booksTotal = sumBig(ordered.map(key => books.get(key)?.[field] ?? 0n));
      const sumOfDifferences = sumBig(found.map(item => BigInt(field === 'gross' ? item.grossDeltaMinor : item.tdsDeltaMinor)));
      const gap = sourceTotal - booksTotal;
      ties.push({ against, field, sourceTotalMinor: String(sourceTotal), booksTotalMinor: String(booksTotal), gapMinor: String(gap), sumOfDifferencesMinor: String(sumOfDifferences), ties: gap === sumOfDifferences });
      builder.step(`gap-${against}-${field}`, `${SOURCE_WORDS[against]} less the books, ${field === 'gross' ? 'amounts' : 'tax deducted'}`, gap);
    }
    // Each difference is a receipted figure of its own, so an open item can quote its amount.
    for (const item of found) {
      if (item.grossDeltaMinor !== '0') builder.step(`${item.id}-amount`, item.line, BigInt(item.grossDeltaMinor));
      if (item.tdsDeltaMinor !== '0') builder.step(`${item.id}-tds`, `Tax deducted: ${item.line}`, BigInt(item.tdsDeltaMinor));
    }
    differences.push(...found);
  }

  const crossChecks: ReconcileWorking['crossChecks'] = [];
  const ais = sums.get('ais')!, as26 = sums.get('26as')!;
  for (const key of [...ais.keys()].filter(key => as26.has(key)).sort()) {
    const a = ais.get(key)!, t = as26.get(key)!;
    if (a.tds !== t.tds) crossChecks.push({ category: a.category, payer: a.payer, aisTdsMinor: String(a.tds), as26TdsMinor: String(t.tds), deltaMinor: String(a.tds - t.tds) });
  }
  builder.step('books-gross', 'Amounts in the books', sumBig([...books.values()].map(item => item.gross)));
  builder.step('books-tds', 'Tax deducted in the books', sumBig([...books.values()].map(item => item.tds)));
  builder.assume('Payers are matched exactly: by TAN when the entry has one, else by name.');

  const working: ReconcileWorking = { differences, ties, crossChecks };
  return builder.build(input, working, `Reconciliation of ${present.map(source => SOURCE_WORDS[source]).join(', ') || 'no statements'} against the books: ${differences.length} ${differences.length === 1 ? 'difference' : 'differences'} listed.`);
}

export type MonthClose = { ties: boolean; gapMinor: string; transactionIds: string[] };

/** Opening plus the month's movements against the statement's closing balance, all in paise. */
export function closeBankMonth(input: { ledger: BankLedger; month: string; openingMinor: string; closingPerStatementMinor: string }): CaReceipt<MonthClose> {
  if (!input?.ledger || !Array.isArray(input.ledger.transactions)) invalid('Send the bank ledger.');
  if (input.ledger.currency !== 'INR') invalid('This month close works in rupees.');
  if (typeof input.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(input.month)) invalid('The month is written like 2026-09.');
  const opening = signedPaise(input.openingMinor, 'The opening balance');
  const statement = signedPaise(input.closingPerStatementMinor, 'The closing balance on the statement');
  const rows = input.ledger.transactions.filter(row => row.date.slice(0, 7) === input.month);
  const amounts = rows.map(row => signedPaise(row.amountMinor, `The movement ${row.id}`));
  const builder = new ReceiptBuilder('books-close');
  builder.step('opening', 'Opening balance', opening);
  const moneyIn = builder.step('money-in', 'Money in', sumBig(amounts.filter(value => value > 0n)));
  const moneyOut = builder.step('money-out', 'Money out', -sumBig(amounts.filter(value => value < 0n)));
  const computed = builder.step('closing-computed', 'Closing balance worked out', opening + moneyIn - moneyOut);
  builder.step('closing-statement', 'Closing balance on the statement', statement);
  const gap = builder.step('gap', 'Statement less worked out', statement - computed);
  builder.assume('Each transaction counts once: the ledger keys rows by the bank reference or a fingerprint of the row.');
  return builder.build(input, { ties: gap === 0n, gapMinor: String(gap), transactionIds: rows.map(row => row.id) },
    gap === 0n ? `The ${input.month} statement ties: opening plus movements equals the closing balance.` : `The ${input.month} statement does not tie: a gap of ${inr(gap)} is open.`);
}
