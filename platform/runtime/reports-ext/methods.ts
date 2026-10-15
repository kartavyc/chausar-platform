import { rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { authorize, check, newId, now, type Context, type State } from '../contracts.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { validDate } from '../memory.ts';
import { onPurge, onTick } from '../trust-ext/lifecycle.ts';
import { peekLane } from '../trust-ext/lane-state.ts';
import { clock, closed, escapeHtml, indiaDate, language, peekReports, reportsState, stamp, validPeriod, type Language, type Period } from './common.ts';
import { buildPage, findPage, listPacks } from './pages.ts';
import { checkNumberOf, csvFile, exportStores, pageHtml, pageRows, writeOut } from './export-files.ts';
import { xlsxBook } from './xlsx.ts';
import { requireTallyPage, tallyXml } from './tally.ts';
import { friday, mergeRhythm, rhythmSettings, rhythmView, tickBrief, weekAhead } from './briefs.ts';
import { dueDates, dueRequest, validProfile } from './due-dates.ts';
import { openQuestion, questionFiles } from './questions.ts';

/** hosted-link's relay is absent, off in demo, not set up or not paired: each means delivery is not available here. */
const RELAY_ABSENT = new Set(['UNKNOWN_METHOD', 'DEMO_EXTERNAL_DISABLED', 'HOSTED_NOT_CONFIGURED', 'HOSTED_NOT_PAIRED']);

const today = (host: ModuleHost) => indiaDate(clock(host));
/** The default report period: the financial year to date, from the rhythm's financial-year start. */
function defaultPeriod(host: ModuleHost): Period {
  const to = today(host), start = rhythmSettings(host.store.read()).financialYearStart, year = Number(to.slice(0, 4));
  return { from: `${to >= `${year}-${start}` ? year : year - 1}-${start}`, to };
}
const periodOf = (host: ModuleHost, value: unknown) => value === undefined ? defaultPeriod(host) : validPeriod(value);
function briefRequest(host: ModuleHost, payload: unknown, code: string): { onDate: string; language: Language } {
  const input = closed(payload, ['onDate', 'language'], code);
  check(input.onDate === undefined || validDate(input.onDate), code, 'Give a valid date.');
  return { onDate: input.onDate ?? today(host), language: language(input.language) };
}
/** "Export everything" copies the whole vault, so it needs an unrestricted owner, as workspace.export does. */
function requireOwner(host: ModuleHost, ctx: Context) {
  const member = authorize(host.store, ctx, 'admin');
  check(member.role === 'owner' && member.branches.includes('*'), 'FORBIDDEN', 'Only an unrestricted workspace owner can export everything.');
}
type ExportRecord = { id: string; at: string; locked: boolean; encrypted: boolean; folder: string; stores: { name: string; rows: number; checkNumber: string; file: string }[] };
const publicRecord = (item: ExportRecord & Record<string, unknown>): ExportRecord =>
  ({ id: item.id, at: item.at, locked: item.locked, encrypted: item.encrypted, folder: item.folder, stores: structuredClone(item.stores) });

export const reportsMethods: Record<string, MethodSpec> = {
  'reportsx.packs': { permission: 'read', async handler(ctx, payload, host) {
    const input = closed(payload, ['language'], 'INVALID_REPORT_REQUEST'); return listPacks(ctx, host, defaultPeriod(host), language(input.language));
  } },
  'reportsx.page': { permission: 'read', async handler(ctx, payload, host) {
    const input = closed(payload, ['pack', 'page', 'language', 'period'], 'INVALID_REPORT_REQUEST'); findPage(input.pack, input.page);
    const { sourceIds: _sources, rowIds: _rows, ...page } = await buildPage(ctx, host, input.pack, input.page, periodOf(host, input.period), language(input.language));
    return page;
  } },
  'reportsx.export': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = closed(payload, ['pack', 'page', 'format', 'language', 'period'], 'INVALID_REPORT_REQUEST');
    check(input.format !== 'pdf', 'PDF_USES_PRINT', 'Use Print in the app to make a PDF of this page.');
    check(['csv', 'xlsx', 'html', 'tally'].includes(input.format), 'INVALID_EXPORT_FORMAT', 'Choose CSV, Excel, Tally or a print page.');
    const spec = findPage(input.pack, input.page);
    if (input.format === 'tally') requireTallyPage(spec.page);
    const built = await buildPage(ctx, host, input.pack, input.page, periodOf(host, input.period), language(input.language));
    const { sourceIds, rowIds, ...page } = built;
    const tally = input.format === 'tally' ? tallyXml(page) : null;
    const name = `${page.pack}-${page.page}-${page.language}-${page.period!.from}-${page.period!.to}-${stamp(clock(host))}.${tally ? 'xml' : input.format}`;
    const path = join(host.directory, 'exports', 'reports', name);
    const data = tally ? tally.xml : input.format === 'csv' ? csvFile(pageRows(page)) : input.format === 'xlsx' ? new Uint8Array(xlsxBook(page.title, pageRows(page))) : pageHtml(page);
    const file = await writeOut(path, data);
    await host.store.update(state => { (reportsState(state).pageExports ??= []).push({ id: newId('report-export'), at: now(), path, sourceIds, rowIds, receiptIds: page.receiptIds }); });
    return { format: input.format, ...file, encrypted: false, textCellsProtected: true, ...(tally ? { vouchers: tally.vouchers, leftOut: tally.leftOut } : {}) };
  } },
  'reportsx.weekAhead': { permission: 'read', async handler(ctx, payload, host) { const input = briefRequest(host, payload, 'INVALID_BRIEF_REQUEST'); return weekAhead(ctx, host, input.onDate, input.language); } },
  'reportsx.friday': { permission: 'read', async handler(ctx, payload, host) { const input = briefRequest(host, payload, 'INVALID_BRIEF_REQUEST'); return friday(ctx, host, input.onDate, input.language); } },
  'reportsx.rhythm': { permission: 'read', handler(_ctx, payload, host) { const input = closed(payload, ['language'], 'INVALID_RHYTHM'); return rhythmView(host.store.read(), host, language(input.language)); } },
  'reportsx.setRhythm': { permission: 'admin', async handler(_ctx, payload, host) {
    await host.store.update(state => {
      const current = rhythmSettings(state), next = mergeRhythm(current, payload), reports = reportsState(state), verified = (reports.verified ??= {});
      if (next.mail.address !== current.mail.address) verified.mail = false;
      if (next.whatsapp.phone !== current.whatsapp.phone) verified.whatsapp = false;
      reports.rhythm = next;
    });
    return rhythmView(host.store.read(), host);
  } },
  'reportsx.verifyChannel': { permission: 'admin', async handler(_ctx, payload, host) {
    const input = closed(payload, ['channel'], 'INVALID_CHANNEL');
    check(input.channel === 'mail' || input.channel === 'whatsapp', 'INVALID_CHANNEL', 'Choose mail or WhatsApp.');
    const rhythm = rhythmSettings(host.store.read());
    check(input.channel === 'mail' ? rhythm.mail.address : rhythm.whatsapp.phone, 'CHANNEL_ADDRESS_REQUIRED', 'Add the address before verifying it.');
    let reply: unknown;
    try { reply = await host.call('phone.verify', { channel: input.channel }); }
    catch (error) { check(!RELAY_ABSENT.has(String((error as { code?: string }).code)), 'RELAY_NOT_AVAILABLE', 'Delivery by mail and WhatsApp is not available yet.'); throw error; }
    const verified = (reply as { verified?: unknown })?.verified === true;
    await host.store.update(state => { (reportsState(state).verified ??= {})[input.channel] = verified; });
    return { channel: input.channel, verified };
  } },
  'reportsx.due': { permission: 'read', handler(_ctx, payload, host) {
    const request = dueRequest(payload, today(host));
    return dueDates({ from: request.from, days: request.days, profile: request.profile ?? peekReports(host.store.read()).dueProfile ?? null, language: language(request.language) });
  } },
  'reportsx.setDueProfile': { permission: 'admin', async handler(_ctx, payload, host) {
    const profile = validProfile(payload); await host.store.update(state => { reportsState(state).dueProfile = { ...profile }; }); return profile;
  } },
  'reportsx.exports': { permission: 'read', handler(ctx, payload, host) {
    closed(payload, [], 'INVALID_EXPORT_REQUEST');
    // Row counts cover every source and branch, hidden ones included, so only an unrestricted owner sees what each export holds.
    const member = authorize(host.store, ctx); const owner = member.role === 'owner' && member.branches.includes('*');
    const items = [...(peekReports(host.store.read()).exports ?? [])].reverse().map(item => owner ? publicRecord(item) : { ...publicRecord(item), stores: [] });
    return { warning: 'Exported files are not encrypted.', items };
  } },
  'reportsx.exportAll': { permission: 'admin', async handler(ctx, payload, host) {
    const input = closed(payload, ['confirmed', 'locked'], 'INVALID_EXPORT_REQUEST'); requireOwner(host, ctx);
    check(input.confirmed === true, 'CONFIRMATION_REQUIRED', 'Confirm the export in the app.');
    check(input.locked === undefined || typeof input.locked === 'boolean', 'INVALID_EXPORT_REQUEST', 'A locked archive is on or off.');
    const at = now(); let record: ExportRecord & { sourceIds?: string[] };
    if (input.locked) {
      const result = await host.call('workspace.export', { confirmed: true }) as { path: string; encrypted: boolean };
      check(typeof result?.path === 'string' && result.encrypted === true, 'EXPORT_FAILED', 'The locked archive was not written.');
      const state = host.store.read(), rows = Object.values(state).reduce<number>((sum, value) => sum + (Array.isArray(value) ? value.length : 0), 0);
      const { checkNumber } = await checkNumberOf(result.path);
      record = { id: newId('export'), at, locked: true, encrypted: true, folder: dirname(result.path), stores: [{ name: 'workspace', rows, checkNumber, file: basename(result.path) }] };
    } else {
      const state = structuredClone(host.store.read()), folder = join(host.directory, 'exports', `everything-${stamp(clock(host))}`);
      const stores = await exportStores(state, folder);
      record = { id: newId('export'), at, locked: false, encrypted: false, folder, stores, sourceIds: [...new Set(state.facts.map(fact => fact.sourceId))] };
    }
    await host.store.update(state => { (reportsState(state).exports ??= []).push(structuredClone(record)); });
    return publicRecord(record);
  } },
  'reportsx.askPerson': { permission: 'prepare', async handler(ctx, payload, host) {
    const input = closed(payload, ['question', 'reason', 'receiptId'], 'INVALID_QUESTION');
    for (const field of ['question', 'reason'] as const) check(typeof input[field] === 'string' && input[field].trim().length > 0 && input[field].length <= 4000, 'INVALID_QUESTION', 'Write the question and the reason, each in up to 4,000 characters.');
    check(input.receiptId === undefined || (typeof input.receiptId === 'string' && input.receiptId.length <= 200), 'INVALID_QUESTION', 'Choose one receipt.');
    const receipt = input.receiptId === undefined ? null : host.services.calculator.receipt(ctx, input.receiptId);
    const receiptHtml = receipt ? `<h2>Receipt</h2><p>${escapeHtml(receipt.id)}: ${escapeHtml(receipt.operation)}${receipt.period ? `, ${escapeHtml(receipt.period.from)} to ${escapeHtml(receipt.period.to)}` : ''}</p><table>${receipt.figures.map((figure: { label: string; display: string }) => `<tr><td>${escapeHtml(figure.label)}</td><td>${escapeHtml(figure.display)}</td></tr>`).join('')}</table><p>Rows counted: ${escapeHtml(String(receipt.coverage.countedRows))}. Coverage: ${escapeHtml(receipt.coverage.completeness)}.</p>${receipt.coverage.gaps.length ? `<ul>${receipt.coverage.gaps.map((gap: string) => `<li>${escapeHtml(gap)}</li>`).join('')}</ul>` : ''}` : '<p>No receipt is attached.</p>';
    const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>A question for my accountant</title><style>body{font:12pt system-ui;max-width:180mm;margin:auto;color:#15231e}td{padding:4px 8px;border-bottom:1px solid #ccd5cf}</style><h1>A question for my accountant</h1><h2>Question</h2><p>${escapeHtml(input.question.trim())}</p><h2>Why Chausar could not answer</h2><p>${escapeHtml(input.reason.trim())}</p>${receiptHtml}<p><small>Made by Chausar on ${escapeHtml(now())}. Chausar has not sent this file to anyone.</small></p></html>`;
    const file = await writeOut(join(host.directory, 'exports', 'questions', `question-${stamp(clock(host))}.html`), html);
    await host.store.update(state => { (reportsState(state).questions ??= []).push({ id: newId('question'), at: now(), path: file.path, sourceIds: receipt?.sourceIds ?? [], rowIds: receipt?.rowIds ?? [], receiptIds: receipt ? [receipt.id] : [] }); });
    return { file, sent: false };
  } },
  'reportsx.questions': { permission: 'read', async handler(ctx, payload, host) { closed(payload, [], 'INVALID_QUESTION_FILE'); return questionFiles(ctx, host); } },
  'reportsx.openQuestion': { permission: 'read', async handler(ctx, payload, host) { const input = closed(payload, ['name'], 'INVALID_QUESTION_FILE'); return openQuestion(ctx, host, input.name); } },
};

/** A file path an export, question or "export everything" record points at. */
const recordPath = (list: 'pageExports' | 'questions' | 'exports', item: any): unknown => list === 'exports' ? item?.folder : item?.path;
const derivedLists = ['pageExports', 'questions', 'exports'] as const;

/** Paths still on record whose removal failed after the data they came from was deleted, for the deletion report to list as pending. */
export function pendingExportPaths(state: State): string[] {
  const reports = peekLane(state)?.reports; if (!reports) return [];
  const paths: string[] = [];
  for (const list of derivedLists) for (const item of Array.isArray(reports[list]) ? reports[list] : []) {
    const path = recordPath(list, item); if (item?.removalFailed === true && typeof path === 'string') paths.push(path);
  }
  return paths;
}

/**
 * Deleting a source removes every brief and file this part derived from it. A file that cannot be removed keeps its record,
 * marked `removalFailed`, so the deletion report can say it is pending; each later purge tries it again.
 */
onPurge((state: State, reason) => {
  const reports = peekLane(state)?.reports; if (!reports) return 0;
  const sources = new Set(reason.sourceIds);
  const hit = (item: { sourceIds?: string[]; rowIds?: string[]; receiptIds?: string[]; brief?: { receiptIds?: string[] } }) =>
    (item.sourceIds ?? []).some(id => sources.has(id)) || [...(item.rowIds ?? []), ...(item.receiptIds ?? []), ...(item.brief?.receiptIds ?? [])].some(id => reason.removedIds.has(id));
  const remove = (path: unknown): boolean => {
    if (typeof path !== 'string') return true;
    try { rmSync(path, { recursive: true, force: true }); return true; } catch { return false; }
  };
  let removed = 0;
  for (const [key, item] of Object.entries(reports.briefs ?? {})) if (hit(item as any)) { delete reports.briefs[key]; removed++; }
  for (const list of derivedLists) {
    if (!Array.isArray(reports[list])) continue;
    const kept = reports[list].filter((item: any) => {
      if (item.locked || (!hit(item) && item.removalFailed !== true)) return true;
      if (remove(recordPath(list, item))) { removed++; return false; }
      item.removalFailed = true; return true;
    });
    reports[list] = kept;
  }
  return removed;
});
onTick(async (ctx, host) => tickBrief(ctx, host));
