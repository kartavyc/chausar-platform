/** Files written by reports: page exports, "Export everything" and question files. Text cells are always written as text. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import type { State } from '../contracts.ts';
import { escapeHtml, percentText, rupees, type EngineFigure, type FileRef } from './common.ts';
import type { ReportPage } from './pages.ts';
import { xlsxBook, type Cell } from './xlsx.ts';

/** A spreadsheet runs a cell that starts with one of these as a formula; an apostrophe keeps it text. */
export function safeText(value: string): string { return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; }
export function csvFile(rows: Cell[][]): string {
  const quote = (value: string) => /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return rows.map(row => row.map(cell => typeof cell === 'string' ? quote(safeText(cell)) : cell.amount).join(',')).join('\r\n') + '\r\n';
}
export const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
export async function writeOut(path: string, data: Uint8Array | string): Promise<FileRef> {
  await mkdir(dirname(path), { recursive: true }); await writeFile(path, data, { flag: 'wx' });
  const bytes = typeof data === 'string' ? Buffer.byteLength(data) : data.length;
  return { name: basename(path), path, bytes, sha256: sha256(data) };
}

function amountCell(figure: EngineFigure): Cell {
  if (figure.kind === 'missing') return `Missing: ${figure.missing}`;
  if (figure.kind === 'money') return { amount: rupees(figure.exact) };
  if (figure.kind === 'percent') return `${percentText(figure.exact)}%`;
  return { amount: figure.exact };
}
/** The page as rows: header, every line with its receipt, gaps beside their section, notes, disclaimer and footer. */
export function pageRows(page: ReportPage): Cell[][] {
  const hi = page.language === 'hi';
  const rows: Cell[][] = [[page.title], [hi ? 'अवधि' : 'Period', page.period ? `${page.period.from} – ${page.period.to}` : ''], [hi ? 'स्थिति' : 'State', page.state], [],
    [hi ? 'खंड' : 'Section', hi ? 'पंक्ति' : 'Line', 'Dr/Cr', hi ? 'राशि (₹)' : 'Amount (₹)', hi ? 'रसीद' : 'Receipt']];
  for (const section of page.sections) {
    for (const line of section.lines) rows.push([section.projection ? `${section.title} (projection)` : section.title, line.label, line.side ?? '', amountCell(line.figure), line.figure.kind === 'missing' ? '' : line.figure.receiptId]);
    for (const gap of section.gaps) rows.push([section.title, hi ? 'कमी' : 'Gap', '', gap, '']);
  }
  rows.push([]);
  for (const note of page.notes) rows.push([hi ? 'टिप्पणी' : 'Note', note.text, note.source ? `${note.source.title} ${note.source.url} (checked ${note.source.checkedOn})` : '', note.notLegalAdvice ? 'Not legal advice' : '']);
  if (page.disclaimer) rows.push([page.disclaimer]);
  rows.push([hi ? 'जाँच कोड' : 'Check code', page.footer.checkCode ?? 'not available', page.footer.at ?? '']);
  return rows;
}
function figureHtml(figure: EngineFigure): string {
  if (figure.kind === 'missing') return `<em>Missing: ${escapeHtml(figure.missing)}</em>`;
  const shown = figure.kind === 'money' ? `₹${rupees(figure.exact)}` : figure.kind === 'percent' ? `${percentText(figure.exact)}%` : figure.exact;
  return `${escapeHtml(shown)} <small>${escapeHtml(figure.receiptId)}</small>`;
}
export function pageHtml(page: ReportPage): string {
  const sections = page.sections.map(section => `<section${section.projection ? ' class="projection"' : ''}><h2>${escapeHtml(section.title)}${section.projection ? ' <span>(projection)</span>' : ''}</h2><table><tbody>${section.lines.map(line => `<tr><td>${escapeHtml(line.label)}</td><td class="side">${escapeHtml(line.side ?? '')}</td><td class="amount">${figureHtml(line.figure)}</td></tr>`).join('')}</tbody></table>${section.gaps.length ? `<ul class="gaps">${section.gaps.map(gap => `<li>${escapeHtml(gap)}</li>`).join('')}</ul>` : ''}</section>`).join('');
  const notes = page.notes.map(note => `<p class="note">${escapeHtml(note.text)}${note.source ? ` <a href="${escapeHtml(note.source.url)}">${escapeHtml(note.source.title)}</a>, checked ${escapeHtml(note.source.checkedOn)}.` : ''}${note.notLegalAdvice ? ' <strong>Not legal advice.</strong>' : ''}</p>`).join('');
  return `<!doctype html><html lang="${page.language}"><meta charset="utf-8"><title>${escapeHtml(page.title)}</title><style>@page{size:A4;margin:16mm}body{font:12pt system-ui;color:#15231e;max-width:180mm;margin:auto}table{border-collapse:collapse;width:100%}td{padding:4px 6px;border-bottom:1px solid #ccd5cf}.amount{text-align:right}.side{width:3em}.projection{border:1px dashed #53645a;padding:6px}.gaps{color:#7a4b00}small{color:#53645a}footer{margin-top:24px;font-size:10pt;color:#53645a}</style><h1>${escapeHtml(page.title)}</h1><p>${page.period ? `${escapeHtml(page.period.from)} – ${escapeHtml(page.period.to)}` : ''}</p>${sections}${notes}${page.disclaimer ? `<p><strong>${escapeHtml(page.disclaimer)}</strong></p>` : ''}<footer>Check code ${escapeHtml(page.footer.checkCode ?? 'not available')}${page.footer.at ? `, ${escapeHtml(page.footer.at)}` : ''}</footer></html>`;
}

/** Workspace stores written by "Export everything". Sign-in sessions are credentials, and engine-module namespaces may hold other lanes' tokens; both stay out. */
const skipped = new Set(['sessions', 'extensions', 'schemaVersion', 'revision']);
export type StoreFile = { name: string; rows: number; checkNumber: string; file: string };
export async function exportStores(state: State, folder: string): Promise<StoreFile[]> {
  const stores: StoreFile[] = [];
  const facts = state.facts.filter(fact => !fact.deletedAt), fields = [...new Set(facts.flatMap(fact => Object.keys(fact.fields)))].sort();
  const head = ['id', 'entityId', 'sourceId', 'sourceRow', 'kind', 'validFrom', 'validTo', 'learnedAt', 'supersededAt', 'branch', ...fields];
  const text = (value: unknown) => value === undefined || value === null ? '' : typeof value === 'string' ? value : JSON.stringify(value);
  const csv = csvFile([head, ...facts.map(fact => [fact.id, fact.entityId, fact.sourceId, String(fact.sourceRow), fact.kind, fact.validFrom, text(fact.validTo), fact.learnedAt, text(fact.supersededAt), text(fact.branch), ...fields.map(field => text(fact.fields[field]))])]);
  const written = await writeOut(join(folder, 'facts.csv'), csv);
  stores.push({ name: 'facts', rows: facts.length, checkNumber: written.sha256.slice(0, 16), file: written.name });
  for (const [name, value] of Object.entries(state)) {
    if (name === 'facts' || skipped.has(name) || value === undefined) continue;
    const file = await writeOut(join(folder, `${name}.json`), JSON.stringify(value, null, 2));
    stores.push({ name, rows: Array.isArray(value) ? value.length : value === null ? 0 : 1, checkNumber: file.sha256.slice(0, 16), file: file.name });
  }
  return stores;
}
export async function checkNumberOf(path: string): Promise<{ checkNumber: string; bytes: number }> {
  const bytes = await readFile(path); return { checkNumber: sha256(bytes).slice(0, 16), bytes: bytes.length };
}
