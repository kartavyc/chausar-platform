// Chausar playbook kit (Ink v2 wave 5, package 5A5, P11): a client report's typed blocks. A metric block, and every
// bar of a bars block, cannot exist without a source: each names a receipt the run has and one of its figures, and
// shows that figure as the receipt wrote it (REPORT_BLOCK_UNSOURCED otherwise; nothing is rendered). Prose that holds
// a number no receipt backs is labelled a model estimate (1G); a quote is shown as written. Each block knows the
// channel and the days it covers, so a share link shows only what is inside its scope. The idea of blocks that cannot
// exist without a source comes from beyondseo's report renderer (MIT), catalogue row P11; no code of it was read or
// copied. Written for Chausar.
import { ChausarError } from '../../../../contracts.ts';
import { redactSecrets } from '../../../core/secrets.ts';
import type { Deliverable, IsoDate, PriceReceiptRecord, WorkReceiptRecord } from '../../../contracts.ts';
import { modelNumbers } from '../../../records.ts';
import type { BlockScope, ReportBar, ReportBlock } from '../records-report.ts';

/** A receipt as blocks read it: its id, and each figure with the scope it belongs to. */
export type SourceReceipt = {
  id: string;
  figures: readonly { key: string; label: string; display: string; minor: string; unit: string; scope: BlockScope }[];
};
type Ref = { receiptId?: string | null; key?: string | null };
type Scoped = { channel?: string | null; from?: IsoDate | null; to?: IsoDate | null };
/** A block as a caller asks for it, before its sources are checked. numbersIn: the model's own words in prose, when
 * code put other text (a date it worked out) beside them; absent, the whole text is the model's. */
export type ReportBlockInput =
  | { kind: 'heading'; text: string }
  | ({ kind: 'prose'; text: string; numbersIn?: string } & Scoped)
  | ({ kind: 'metric'; label: string } & Ref & Scoped)
  | ({ kind: 'bars'; label: string; bars: readonly ({ label: string } & Ref)[] } & Scoped)
  | { kind: 'quote'; text: string; by?: string | null };

export const UNSOURCED_WORDS = 'A figure in this report has no receipt, so the report was not made. Every number a report shows comes from a receipt.';
const NO_SCOPE: BlockScope = Object.freeze({ channel: null, from: null, to: null });
/** The most blocks one report holds. */
const MAX_BLOCKS = 500;

function unsourced(): never {
  throw new ChausarError('REPORT_BLOCK_UNSOURCED', UNSOURCED_WORDS);
}

function words(value: unknown, max: number): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ChausarError('INVALID_VENTURE_REQUEST', 'A report block needs its words, not too long.');
  return redactSecrets(value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim());
}

/** The figure a reference names, among the run's receipts, or a refusal. */
function figureOf(ref: Ref, receipts: readonly SourceReceipt[]) {
  if (typeof ref.receiptId !== 'string' || typeof ref.key !== 'string') unsourced();
  const figure = receipts.find(receipt => receipt.id === ref.receiptId)?.figures.find(item => item.key === ref.key);
  return figure ?? unsourced();
}

function scopeOf(given: Scoped, fallback: BlockScope = NO_SCOPE): BlockScope {
  return { channel: given.channel ?? fallback.channel, from: given.from ?? fallback.from, to: given.to ?? fallback.to };
}

/** The widest of several scopes: one channel when all share it, the earliest from and the latest to when all have them. */
function joinScopes(scopes: readonly BlockScope[]): BlockScope {
  const channels = new Set(scopes.map(scope => scope.channel));
  const dated = scopes.every(scope => scope.from && scope.to);
  return {
    channel: channels.size === 1 ? [...channels][0] : null,
    from: dated ? scopes.map(scope => scope.from!).sort()[0] : null,
    to: dated ? scopes.map(scope => scope.to!).sort().at(-1)! : null,
  };
}

/** Hindi number words (a few dozen, a hundred, a lakh, twice): एक alone is left out, as it is also the word "a". */
const HINDI_NUMBERS = new Set([
  'दो', 'तीन', 'चार', 'पांच', 'पाँच', 'छह', 'छः', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'पंद्रह', 'बीस', 'पच्चीस', 'तीस', 'चालीस',
  'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे', 'सौ', 'हज़ार', 'हजार', 'लाख', 'करोड़', 'करोड', 'प्रतिशत', 'फ़ीसदी', 'फीसदी', 'दर्जन', 'आधा',
  'आधे', 'डेढ़', 'ढाई', 'दुगुना', 'दोगुना', 'दोगुनी', 'तिगुना', 'गुना', 'गुनी',
]);
/** Whether words hold a number written as a Hindi word ("तीन गुना", "दो सौ"). */
export function hindiNumberWords(text: string): boolean {
  return text.split(/[\s,.;:!?।॥()"'\-]+/u).some(word => HINDI_NUMBERS.has(word));
}

/** Whether model words hold a number the owner did not write: digits, a number in English words, or in Hindi words. */
function numbersIn(text: string, allowed: readonly string[]): boolean {
  return modelNumbers(text, allowed) || hindiNumberWords(text);
}

/** The most words a report keeps, all its blocks together. */
const MAX_REPORT_CHARS = 200_000;

/**
 * The blocks with their sources checked, in order. A metric or a bar whose receipt is not among the run's, or whose
 * figure the receipt lacks, refuses (REPORT_BLOCK_UNSOURCED). A heading or prose holding a number the owner did not
 * write (allowed: the owner's own tokens) is estimate: true.
 */
export function resolveBlocks(inputs: readonly ReportBlockInput[], receipts: readonly SourceReceipt[], allowed: readonly string[] = []): ReportBlock[] {
  if (!Array.isArray(inputs) || inputs.length > MAX_BLOCKS) throw new ChausarError('INVALID_VENTURE_REQUEST', 'A report holds at most 500 blocks.');
  const total = inputs.reduce((sum, input) => sum + JSON.stringify(input).length, 0);
  if (total > MAX_REPORT_CHARS) throw new ChausarError('REPORT_TOO_LARGE', 'This report is too large to keep. Make it with fewer files.');
  return inputs.map((input): ReportBlock => {
    switch (input.kind) {
      case 'heading': { const text = words(input.text, 200); return { kind: 'heading', text, estimate: numbersIn(text, allowed) }; }
      case 'prose': {
        const text = words(input.text, 20_000);
        return { kind: 'prose', text, estimate: numbersIn(input.numbersIn ?? text, allowed), ...scopeOf(input) };
      }
      case 'metric': {
        const figure = figureOf(input, receipts);
        return { kind: 'metric', label: words(input.label, 200), display: redactSecrets(figure.display), unit: figure.unit, receiptId: input.receiptId!, key: input.key!, ...scopeOf(input, figure.scope) };
      }
      case 'bars': {
        const given: readonly ({ label: string } & Ref)[] = input.bars;
        if (!Array.isArray(given) || !given.length || given.length > 50) throw new ChausarError('INVALID_VENTURE_REQUEST', 'A bars block has 1 to 50 bars.');
        const found = given.map(bar => ({ bar, figure: figureOf(bar, receipts) }));
        const size = (minor: string) => { const value = /^-?\d+$/.test(minor) ? BigInt(minor) : 0n; return value < 0n ? -value : value; };
        const longest = found.reduce((max, item) => (size(item.figure.minor) > max ? size(item.figure.minor) : max), 0n);
        const bars: ReportBar[] = found.map(({ bar, figure }) => ({
          label: words(bar.label, 200), display: redactSecrets(figure.display), receiptId: bar.receiptId!, key: bar.key!,
          width: longest === 0n ? 0 : Number((size(figure.minor) * 100n) / longest),
        }));
        return { kind: 'bars', label: words(input.label, 200), bars, ...scopeOf(input, joinScopes(found.map(item => item.figure.scope))) };
      }
      case 'quote': return { kind: 'quote', text: words(input.text, 5000), by: input.by ? words(input.by, 200) : null };
      default: throw new ChausarError('INVALID_VENTURE_REQUEST', 'A report block is a heading, prose, a metric, bars or a quote.');
    }
  });
}

/** The last day of a month like '2026-02', by calendar arithmetic on the numbers alone. */
function monthEnd(month: string): IsoDate {
  const [year, number] = month.split('-').map(Number);
  const days = [31, year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][number - 1];
  return `${month}-${String(days).padStart(2, '0')}` as IsoDate;
}

/**
 * The run's receipts as blocks read them: its own work receipts (a social report's figures each carry their platform
 * as the channel and their month as the days) and the business's price receipts (no channel, no days).
 */
export function sourcesOf(work: readonly WorkReceiptRecord[], prices: readonly PriceReceiptRecord[]): SourceReceipt[] {
  return [
    ...work.map(receipt => ({
      id: receipt.id,
      figures: receipt.figures.map((figure, index) => {
        const made = receipt.operation === 'social.report' ? receipt.report?.[index] : undefined;
        const scope: BlockScope = made && /^\d{4}-(0[1-9]|1[0-2])$/.test(made.month)
          ? { channel: made.platform, from: `${made.month}-01` as IsoDate, to: monthEnd(made.month) } : NO_SCOPE;
        return { key: figure.key, label: figure.label, display: figure.display, minor: figure.minor, unit: figure.unit, scope };
      }),
    })),
    ...prices.map(receipt => ({
      id: receipt.id,
      figures: receipt.figures.map(figure => ({ key: figure.key, label: figure.label, display: figure.display, minor: figure.minor, unit: 'money', scope: NO_SCOPE })),
    })),
  ];
}

/**
 * A run's draft as report blocks: the title is the report's, each section a heading, its words prose (a date code
 * worked out is the draft's own, not a model number), each figure a metric labelled as its receipt labels it.
 */
export function blocksOfDraft(deliverable: Deliverable, receipts: readonly SourceReceipt[], allowed: readonly string[] = []): ReportBlock[] {
  const inputs: ReportBlockInput[] = [];
  for (const section of deliverable.sections) {
    if (section.heading.trim()) inputs.push({ kind: 'heading', text: section.heading });
    let prose = '', model = '';
    const flush = () => { if (prose.trim()) inputs.push({ kind: 'prose', text: prose.trim(), numbersIn: model }); prose = ''; model = ''; };
    for (const part of section.parts) {
      if (part.kind === 'text') { prose += part.text; model += part.text; }
      else if (part.kind === 'date') prose += part.iso;
      else {
        flush();
        const figure = receipts.find(receipt => receipt.id === part.receiptId)?.figures.find(item => item.key === part.figureKey);
        inputs.push({ kind: 'metric', label: figure?.label ?? 'Figure', receiptId: part.receiptId, key: part.figureKey });
      }
    }
    flush();
  }
  return resolveBlocks(inputs, receipts, allowed);
}

/** Whether a report's title holds a number the owner did not write: shown as a model estimate. */
export function titleEstimate(title: string, allowed: readonly string[] = []): boolean {
  return numbersIn(title, allowed);
}

/** The channels and the days a report's blocks cover, for the share screen. */
export function coverageOf(blocks: readonly ReportBlock[]): { channels: string[]; period: { from: IsoDate; to: IsoDate } | null } {
  const scoped = blocks.filter((block): block is Extract<ReportBlock, BlockScope> => 'channel' in block);
  const channels = [...new Set(scoped.map(block => block.channel).filter((channel): channel is string => channel !== null))].sort();
  const froms = scoped.map(block => block.from).filter((day): day is IsoDate => day !== null).sort();
  const tos = scoped.map(block => block.to).filter((day): day is IsoDate => day !== null).sort();
  return { channels, period: froms.length && tos.length ? { from: froms[0], to: tos.at(-1)! } : null };
}

/**
 * The blocks a share link shows: those inside its days (a block's days wholly between from and to) and channels (a
 * block about another channel is left out); a block with no channel or no days is never outside. A heading whose
 * section kept nothing is left out too.
 */
export function blocksInScope(blocks: readonly ReportBlock[], scope: { from: IsoDate; to: IsoDate; channels: readonly string[] }): ReportBlock[] {
  const inside = (block: ReportBlock) => {
    if (!('channel' in block)) return true;
    if (block.channel !== null && !scope.channels.includes(block.channel)) return false;
    if (block.from !== null && block.from < scope.from) return false;
    if (block.to !== null && block.to > scope.to) return false;
    return true;
  };
  const kept = blocks.filter(inside);
  return kept.filter((block, index) => block.kind !== 'heading' || (index + 1 < kept.length && kept[index + 1].kind !== 'heading'));
}
