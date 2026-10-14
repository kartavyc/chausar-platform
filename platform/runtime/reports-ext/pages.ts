/** Pack page states and the page as it will print. Every number comes from the calculator; nothing is added up here. */
import { check, now, type Context } from '../contracts.ts';
import type { CalculationReceipt } from '../calculator.ts';
import type { ModuleHost } from '../modules/types.ts';
import { addDays, daysBetween, lastTwelveMonths, monthLabel, record, type EngineFigure, type Language, type Missing, type Period, type Words } from './common.ts';
import { notRegistered, notes, packs, reasons, words, type PackSpec, type PageSpec, type SectionSpec } from './packs.ts';
import { connectorPage, type ConnectorPage, type ConnectorPageId } from './connector-pages.ts';
import { hiddenKinds, markingsForSources, markKinds, withheldFigure, withheldGap, withheldKinds, type MarkKind } from './withhold.ts';

export type PageState = 'ready-tested' | 'ready-untested' | 'not-started';
type OpResult = { receipt?: CalculationReceipt; state: PageState; reason?: Words; missing?: Missing };
export type ReportLine = { id: string; label: string; figure: EngineFigure; side?: 'Dr' | 'Cr' };
export type ReportSection = { id: string; title: string; projection: boolean; lines: ReportLine[]; gaps: string[] };
export type ReportPage = { pack: string; page: string; title: string; language: Language; period: Period | null; generatedAt: string; state: PageState;
  sections: ReportSection[]; notes: { id: string; text: string; source?: { title: string; url: string; checkedOn: string }; notLegalAdvice: boolean }[];
  disclaimer: string | null; gaps: string[]; markings: ('personal' | 'financial' | 'confidential')[]; footer: { checkCode: string | null; at: string | null }; receiptIds: string[] };

const rank: Record<PageState, number> = { 'ready-tested': 0, 'ready-untested': 1, 'not-started': 2 };
const worst = (states: PageState[]): PageState => states.reduce<PageState>((a, b) => rank[b] > rank[a] ? b : a, 'ready-tested');

export function findPage(packId: unknown, pageId: unknown): { pack: PackSpec; page: PageSpec } {
  const pack = packs.find(item => item.id === packId); check(pack, 'UNKNOWN_REPORT_PAGE', 'Choose one of the lender, CA or investor packs.');
  const page = pack.pages.find(item => item.id === pageId); check(page, 'UNKNOWN_REPORT_PAGE', 'Choose a page of this pack.');
  return { pack, page };
}

/** Runs registered calculations once per request for one page or pack listing. */
export class Calculations {
  private cache = new Map<string, Promise<OpResult>>();
  private pages = new Map<string, Promise<ConnectorPage>>();
  private catalog: Set<string> | null | undefined;
  private readonly ctx: Context;
  private readonly host: ModuleHost;
  constructor(ctx: Context, host: ModuleHost) { this.ctx = ctx; this.host = host; }
  private registered(): Set<string> | null {
    if (this.catalog === undefined) {
      try { this.catalog = new Set((this.host.services.calculator.catalog(this.ctx) as { id: string }[]).map(op => op.id)); } catch { this.catalog = null; }
    }
    return this.catalog;
  }
  /** One registered calculation over the period, over every source the caller sees or only over `sourceIds`. */
  run(op: string, period: Period, sourceIds?: string[]): Promise<OpResult> {
    const request: Record<string, unknown> = op === 'aging' ? { operation: op, onDate: period.to }
      : op === 'change' ? { operation: op, period, comparePeriod: { from: addDays(period.from, -daysBetween(period.from, period.to) - 1), to: addDays(period.from, -1) } }
      : { operation: op, period };
    if (sourceIds) request.sourceIds = [...sourceIds];
    const key = JSON.stringify(request);
    if (!this.cache.has(key)) this.cache.set(key, this.calculate(op, request));
    return this.cache.get(key)!;
  }
  /** A page over the connector part, built once per request and language. */
  connector(id: ConnectorPageId, period: Period, lang: Language): Promise<ConnectorPage> {
    const key = JSON.stringify([id, period, lang]);
    if (!this.pages.has(key)) this.pages.set(key, connectorPage(this.ctx, this.host, this, id, period, lang));
    return this.pages.get(key)!;
  }
  private async calculate(op: string, request: Record<string, unknown>): Promise<OpResult> {
    const catalog = this.registered();
    if (!catalog) return { state: 'not-started', reason: reasons.dictionary, missing: 'not-loaded-yet' };
    if (!catalog.has(op)) return { state: 'not-started', reason: notRegistered(op), missing: 'not-loaded-yet' };
    try {
      const receipt: CalculationReceipt = await this.host.services.calculator.calculate(this.ctx, request);
      if (receipt.coverage.completeness === 'empty') return { receipt, state: 'not-started', reason: reasons.empty, missing: 'absent' };
      return { receipt, state: receipt.coverage.completeness === 'reconciled-imports' && !receipt.stale ? 'ready-tested' : 'ready-untested' };
    } catch (error) {
      if ((error as { code?: string }).code === 'ACCESS_REVOKED') throw error;
      return { state: 'not-started', reason: reasons.refused, missing: 'unknown' };
    }
  }
}

export async function pageState(calc: Calculations, page: PageSpec, period: Period, lang: Language = 'en'): Promise<{ state: PageState; reason?: string }> {
  if (page.connector) { const built = await calc.connector(page.connector, period, lang); return { state: built.state, ...(built.reason ? { reason: built.reason[lang] } : {}) }; }
  const results: OpResult[] = [];
  for (const op of page.needs) results.push(await calc.run(op, period));
  const blocked = results.find(result => result.state === 'not-started');
  return { state: worst(results.map(result => result.state)), ...(blocked?.reason ? { reason: blocked.reason[lang] } : {}) };
}

function figureOf(result: OpResult, key: string): EngineFigure {
  const receipt = result.receipt;
  if (!receipt || receipt.coverage.completeness === 'empty') return { kind: 'missing', missing: result.missing ?? 'unknown' };
  const figure = receipt.figures.find(item => item.key === key);
  if (!figure) return { kind: 'missing', missing: 'not-applicable' };
  return { kind: figure.unit === 'money' ? 'money' : 'percent', exact: figure.minor, receiptId: receipt.id, labels: receipt.stale ? ['stale'] : [], measure: { operation: receipt.operation, key: figure.key } };
}

async function section(calc: Calculations, host: ModuleHost, ctx: Context, spec: SectionSpec, period: Period, lang: Language, receipts: Map<string, CalculationReceipt>): Promise<ReportSection> {
  const lines: ReportLine[] = [], gaps: string[] = [];
  const take = (result: OpResult, label: string) => {
    if (result.receipt) { receipts.set(result.receipt.id, result.receipt); gaps.push(...result.receipt.coverage.gaps); }
    if (result.state === 'not-started' && result.reason) gaps.push(`${label}: ${result.reason[lang]}`);
  };
  for (const spec_ of spec.lines ?? []) {
    const result = await calc.run(spec_.op, period); take(result, spec_.label[lang]);
    lines.push({ id: spec_.id, label: spec_.label[lang], figure: figureOf(result, spec_.figure), ...(spec_.side ? { side: spec_.side } : {}) });
  }
  if (spec.monthly) for (const month of lastTwelveMonths(period.to)) {
    const label = monthLabel(month.from, lang), result = await calc.run(spec.monthly.op, month);
    if (result.receipt) receipts.set(result.receipt.id, result.receipt);
    if (result.receipt && result.receipt.coverage.completeness !== 'empty') gaps.push(...result.receipt.coverage.gaps);
    else if (result.reason) gaps.push(result.receipt ? words.emptyMonths[lang] : result.reason[lang]);
    lines.push({ id: month.from.slice(0, 7), label, figure: figureOf(result, spec.monthly.figure) });
  }
  if (spec.forecast) {
    const history: CalculationReceipt[] = [];
    for (const month of lastTwelveMonths(period.to)) { const result = await calc.run('revenue', month); if (result.receipt) history.push(result.receipt); }
    const figure: EngineFigure = { kind: 'missing', missing: 'not-counted' };
    try {
      const forecast = await host.services.reports.forecast(ctx, { receiptIds: history.map(receipt => receipt.id) });
      // A forecast is kept with Ask's answers, not as a calculation receipt, so its amount cannot be opened from this page: the line stays not counted.
      gaps.push(forecast.status === 'passed-local-baseline-gate' && typeof forecast.forecastMinor === 'string' ? words.forecastInAsk[lang] : words.forecastRefused[lang]);
    } catch (error) {
      if ((error as { code?: string }).code === 'ACCESS_REVOKED') throw error;
      gaps.push(words.forecastRefused[lang]);
    }
    lines.push({ id: 'forecast', label: words.forecastLine[lang], figure });
  }
  return { id: spec.id, title: spec.title[lang], projection: spec.forecast === true, lines, gaps: [...new Set(gaps)] };
}

export async function buildPage(ctx: Context, host: ModuleHost, packId: string, pageId: string, period: Period, lang: Language): Promise<ReportPage & { sourceIds: string[]; rowIds: string[] }> {
  const { pack, page } = findPage(packId, pageId); const calc = new Calculations(ctx, host); const receipts = new Map<string, CalculationReceipt>();
  let { state } = await pageState(calc, page, period);
  const sections: ReportSection[] = [];
  if (page.connector) {
    const built = await calc.connector(page.connector, period, lang);
    state = built.state; sections.push(...built.sections); for (const receipt of built.receipts) receipts.set(receipt.id, receipt);
    if (built.reason) sections.push({ id: 'not-started', title: words.notStarted[lang], projection: false, lines: [], gaps: [built.reason[lang]] });
  }
  for (const spec of page.sections) sections.push(await section(calc, host, ctx, spec, period, lang, receipts));
  const sourceIds = [...new Set([...receipts.values()].flatMap(receipt => receipt.sourceIds))];
  let footer: ReportPage['footer'] = { checkCode: null, at: null };
  try {
    const verified = await host.call('trustx.verifyRecord', {}) as { head?: { short?: unknown; at?: unknown } };
    if (record(verified?.head) && typeof verified.head.short === 'string') footer = { checkCode: verified.head.short, at: typeof verified.head.at === 'string' ? verified.head.at : null };
  } catch { /* The record helper is not available: the footer says so with nulls. */ }
  const data = host.store.read();
  const hidden = hiddenKinds(data, ctx);
  // The engine leaves data marked away from this seat out of its calculations. When the workspace holds such
  // data, a line left with nothing is withheld rather than absent, and every section says what is not counted.
  const workspaceSources = [...new Set(data.facts.filter(fact => !fact.deletedAt).map(fact => fact.sourceId))];
  const hiddenHere = withheldKinds(data, workspaceSources, hidden);
  const shown = markingsForSources(data, sourceIds);
  const markings: ReportPage['markings'] = markKinds.filter(kind => shown.includes(kind) || hiddenHere.includes(kind));
  const withheldReceipts = new Set([...receipts.values()].filter(receipt => withheldKinds(data, receipt.sourceIds, hidden).length
    || (hiddenHere.length > 0 && receipt.coverage.completeness === 'empty')).map(receipt => receipt.id));
  for (const item of sections) {
    const kinds = new Set<MarkKind>(item.lines.length ? hiddenHere : []);
    item.lines = item.lines.map(line => {
      if (line.figure.kind === 'missing') return hiddenHere.length && line.figure.missing === 'absent' ? { ...line, figure: withheldFigure() } : line;
      const receipt = receipts.get(line.figure.receiptId), found = withheldKinds(data, receipt?.sourceIds ?? [], hidden);
      if (!found.length) return line;
      for (const kind of found) kinds.add(kind);
      return { ...line, figure: withheldFigure() };
    });
    item.gaps = [...new Set([...item.gaps, ...markKinds.filter(kind => kinds.has(kind)).map(kind => withheldGap(kind, lang))])];
  }
  const pageNotes: ReportPage['notes'] = (page.notes ?? []).map(id => ({ id, text: notes[id].text[lang], source: { ...notes[id].source }, notLegalAdvice: true }));
  if (pack.id === 'investor' && page.id === 'notes') pageNotes.push({ id: 'imported-only', text: words.investorNote[lang], notLegalAdvice: false });
  return { pack: pack.id, page: page.id, title: page.title[lang], language: lang, period, generatedAt: now(), state, sections,
    notes: pageNotes, disclaimer: page.disclaimer ? words.disclaimer[lang] : null, gaps: [...new Set(sections.flatMap(item => item.gaps))], markings, footer,
    receiptIds: [...receipts.keys()].filter(id => !withheldReceipts.has(id)), sourceIds, rowIds: [...new Set([...receipts.values()].flatMap(receipt => receipt.rowIds))] };
}

/** The packs with each page's state; titles and reasons are written in the language asked for. */
export async function listPacks(ctx: Context, host: ModuleHost, period: Period, lang: Language = 'en') {
  const calc = new Calculations(ctx, host); const result = [];
  for (const pack of packs) {
    const pages = [];
    for (const page of pack.pages) pages.push({ id: page.id, title: page.title[lang], ...await pageState(calc, page, period, lang) });
    result.push({ id: pack.id, title: pack.title[lang], gstModes: [...pack.gstModes], pages });
  }
  return { packs: result, checkedAt: now(), language: lang };
}
