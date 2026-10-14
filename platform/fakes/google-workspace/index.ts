/**
 * A stateful Google Workspace account in memory: Sheets v4 values (spreadsheets with tabs as 2D
 * string arrays), Calendar v3 events and Drive v3 files with app properties. Three hosts share
 * one fake, so every route matches a distinct path prefix.
 */
import { readFileSync } from 'node:fs';
import { HttpFake, body, reply, type Route } from '../http-fake.ts';
import type { WireObject, WireRequest } from '../../runtime/writeback/types.ts';

type Rec = Record<string, any>;
export type Spreadsheet = { title: string; tabs: Record<string, string[][]> };
export type Calendar = { summary: string; timeZone: string; events: Rec[] };
export type GoogleSeed = { token: string; spreadsheets: Record<string, Spreadsheet>; calendars: Record<string, Calendar>; files: Rec[] };
export const googleSeed: GoogleSeed = JSON.parse(readFileSync(new URL('../../../fixtures/writeback/google-workspace.json', import.meta.url), 'utf8'));
export const practiceSpreadsheetId = Object.keys(googleSeed.spreadsheets)[0];

type A1 = { name: string; tab: string[][]; c1: number; r1: number; c2: number; r2: number; raw: string };
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const colIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colName = (index: number): string => index <= 0 ? '' : colName(Math.floor((index - 1) / 26)) + String.fromCharCode(65 + (index - 1) % 26);
const badRequest = (message: string) => reply(400, { error: { code: 400, message, status: 'INVALID_ARGUMENT' } });
const notFound = () => reply(404, { error: { code: 404, message: 'Not Found', status: 'NOT_FOUND' } });

export class GoogleWorkspaceFake extends HttpFake {
  readonly system = 'google-workspace' as const;
  readonly token: string;
  spreadsheets: Record<string, Spreadsheet>; calendars: Record<string, Calendar>; files: Rec[];
  #next = 1; #clock: () => string;
  constructor(seed: GoogleSeed = googleSeed, clock: () => string = () => new Date().toISOString()) {
    super(); this.token = seed.token; this.#clock = clock;
    this.spreadsheets = structuredClone(seed.spreadsheets); this.calendars = structuredClone(seed.calendars); this.files = structuredClone(seed.files);
  }
  protected authorized(request: WireRequest) { return request.headers.authorization === `Bearer ${this.token}`; }
  /** A1 range: Tab!A:A, Tab!5:5, Tab!B2:D3 or Tab!B2; a quoted tab name may hold spaces. Open ends run to the sheet edge. */
  #range(spreadsheetId: string, encoded: string): A1 | null {
    const raw = decodeURIComponent(encoded), m = raw.match(/^(?:'([^']+)'|([^'!]+))!([A-Z]*)(\d*)(?::([A-Z]*)(\d*))?$/);
    const tab = m ? this.spreadsheets[spreadsheetId]?.tabs[m[1] ?? m[2]] : undefined;
    if (!m || !tab || (!m[3] && !m[4])) return null;
    const c1 = m[3] ? colIndex(m[3]) : 1, r1 = m[4] ? Number(m[4]) : 1;
    const c2 = m[5] !== undefined ? (m[5] ? colIndex(m[5]) : Infinity) : (m[3] ? c1 : Infinity), r2 = m[6] !== undefined ? (m[6] ? Number(m[6]) : Infinity) : (m[4] ? r1 : Infinity);
    return { name: m[1] ?? m[2], tab, c1, r1, c2, r2, raw };
  }
  /** Google leaves out trailing empty cells and trailing empty rows. */
  #read(range: A1) {
    const rows = range.tab.slice(range.r1 - 1, range.r2 === Infinity ? undefined : range.r2).map(row => {
      const cells = row.slice(range.c1 - 1, range.c2 === Infinity ? undefined : range.c2); while (cells.length && cells[cells.length - 1] === '') cells.pop(); return cells;
    });
    while (rows.length && !rows[rows.length - 1].length) rows.pop();
    return rows;
  }
  #write(tab: string[][], r1: number, c1: number, values: string[][]) {
    while (tab.length < r1 - 1 + values.length) tab.push([]);
    values.forEach((row, r) => { const line = tab[r1 - 1 + r]; while (line.length < c1 - 1 + row.length) line.push(''); row.forEach((v, c) => { line[c1 - 1 + c] = String(v); }); });
  }
  #calendar(calendarId: string) { return this.calendars[decodeURIComponent(calendarId)]; }
  #fileView(file: Rec) { const { content: _content, ...meta } = file; return meta.mimeType === FOLDER_MIME ? meta : { ...meta, size: String(Buffer.from(file.content, 'base64').length) }; }
  /** The one query form Chausar sends: appProperties has { key='K' and value='V' } and trashed=false. */
  #query(q: string | null) {
    if (q === null) return (file: Rec) => !file.trashed;
    const m = q.match(/^appProperties has \{ key='([^'\\]+)' and value='([^'\\]+)' \} and trashed=false$/);
    return m ? (file: Rec) => !file.trashed && file.appProperties?.[m[1]] === m[2] : null;
  }
  #multipart(request: WireRequest) {
    const boundary = (request.headers['content-type'] ?? '').match(/^multipart\/related; boundary=([A-Za-z0-9_.-]{1,70})$/)?.[1];
    if (!boundary || !request.body) return null;
    const parts = request.body.split(`--${boundary}`); if (parts.length !== 4 || !parts[3].startsWith('--')) return null;
    const [meta, media] = parts.slice(1, 3).map(part => { const at = part.indexOf('\r\n\r\n'); return { headers: part.slice(0, at).trim().toLowerCase(), content: part.slice(at + 4).replace(/\r\n$/, '') }; });
    if (!meta.headers.includes('application/json')) return null;
    try { return { metadata: JSON.parse(meta.content), content: media.headers.includes('content-transfer-encoding: base64') ? media.content : Buffer.from(media.content, 'utf8').toString('base64') }; } catch { return null; }
  }
  protected routes(): Route[] {
    return [
      { method: 'GET', path: /^\/v4\/spreadsheets\/([^/]+)\/values\/([^/:]+)$/, write: false, handle: (_r, m) => {
        if (!this.spreadsheets[m[1]]) return notFound();
        const range = this.#range(m[1], m[2]); if (!range) return badRequest('Unable to parse range.');
        const rows = this.#read(range); return reply(200, { range: range.raw, majorDimension: 'ROWS', ...(rows.length ? { values: rows } : {}) });
      } },
      { method: 'POST', path: /^\/v4\/spreadsheets\/([^/]+)\/values\/([^/:]+):append$/, write: true, handle: (request, m, url) => {
        if (!this.spreadsheets[m[1]]) return notFound();
        if (url.searchParams.get('valueInputOption') !== 'RAW' || url.searchParams.get('insertDataOption') !== 'INSERT_ROWS') return badRequest('Unsupported value input or insert option.');
        const range = this.#range(m[1], m[2]), b = body(request); if (!range) return badRequest('Unable to parse range.');
        if (!Array.isArray(b.values) || !b.values.every((row: unknown) => Array.isArray(row) && row.every(v => typeof v === 'string'))) return badRequest('Invalid values.');
        let last = range.tab.length; while (last > 0 && !range.tab[last - 1].some(v => v !== '')) last--;
        range.tab.splice(last, 0, ...b.values.map(() => [] as string[])); this.#write(range.tab, last + 1, range.c1, b.values);
        const width = Math.max(...b.values.map((row: string[]) => row.length)), updatedRange = `'${range.name}'!${colName(range.c1)}${last + 1}:${colName(range.c1 + width - 1)}${last + b.values.length}`;
        return reply(200, { spreadsheetId: m[1], updates: { spreadsheetId: m[1], updatedRange, updatedRows: b.values.length, updatedColumns: width, updatedCells: b.values.flat().length } });
      } },
      { method: 'PUT', path: /^\/v4\/spreadsheets\/([^/]+)\/values\/([^/:]+)$/, write: true, handle: (request, m, url) => {
        if (!this.spreadsheets[m[1]]) return notFound();
        if (url.searchParams.get('valueInputOption') !== 'RAW') return badRequest('Unsupported value input option.');
        const range = this.#range(m[1], m[2]), b = body(request); if (!range) return badRequest('Unable to parse range.');
        if (!Array.isArray(b.values) || b.values.length > range.r2 - range.r1 + 1 || b.values.some((row: unknown) => !Array.isArray(row) || row.length > range.c2 - range.c1 + 1 || row.some(v => typeof v !== 'string'))) return badRequest('Requested writing within range, but tried writing outside it.');
        this.#write(range.tab, range.r1, range.c1, b.values);
        return reply(200, { spreadsheetId: m[1], updatedRange: range.raw, updatedRows: b.values.length, updatedColumns: Math.max(0, ...b.values.map((row: string[]) => row.length)), updatedCells: b.values.flat().length });
      } },
      { method: 'GET', path: /^\/calendar\/v3\/calendars\/([^/]+)$/, write: false, handle: (_r, m) => {
        const calendar = this.#calendar(m[1]); return calendar ? reply(200, { kind: 'calendar#calendar', id: decodeURIComponent(m[1]), summary: calendar.summary, timeZone: calendar.timeZone }) : notFound();
      } },
      { method: 'GET', path: /^\/calendar\/v3\/calendars\/([^/]+)\/events\/([^/]+)$/, write: false, handle: (_r, m) => {
        const event = this.#calendar(m[1])?.events.find(e => e.id === m[2]); return event ? reply(200, event) : notFound();
      } },
      { method: 'POST', path: /^\/calendar\/v3\/calendars\/([^/]+)\/events$/, write: true, handle: (request, m) => {
        const calendar = this.#calendar(m[1]), b = body(request); if (!calendar) return notFound();
        if (b.id !== undefined && !/^[a-v0-9]{5,1024}$/.test(String(b.id))) return badRequest('Invalid resource id value.');
        if (!b.summary || !b.start?.dateTime || !b.end?.dateTime) return badRequest('Missing start or end.');
        if (b.id && calendar.events.some(e => e.id === b.id)) return reply(409, { error: { code: 409, message: 'The requested identifier already exists.', status: 'ALREADY_EXISTS' } });
        const now = this.#clock(), id = b.id ?? `fakeevent${this.#next++}`;
        const event = { kind: 'calendar#event', id, status: 'confirmed', summary: b.summary, ...(b.description ? { description: b.description } : {}), start: b.start, end: b.end, attendees: b.attendees ?? [], created: now, updated: now, htmlLink: `https://calendar.google.com/calendar/event?eid=${id}` };
        calendar.events.push(event); return reply(200, event);
      } },
      { method: 'GET', path: /^\/drive\/v3\/files$/, write: false, handle: (_r, _m, url) => {
        const match = this.#query(url.searchParams.get('q')); if (!match) return badRequest('Invalid Value');
        return reply(200, { kind: 'drive#fileList', files: this.files.filter(match).map(f => this.#fileView(f)) });
      } },
      { method: 'GET', path: /^\/drive\/v3\/files\/([A-Za-z0-9_-]+)$/, write: false, handle: (_r, m) => {
        const file = this.files.find(f => f.id === m[1]); return file ? reply(200, this.#fileView(file)) : notFound();
      } },
      { method: 'POST', path: /^\/upload\/drive\/v3\/files$/, write: true, handle: (request, _m, url) => {
        if (url.searchParams.get('uploadType') !== 'multipart') return badRequest('Unsupported upload type.');
        const upload = this.#multipart(request); if (!upload || typeof upload.metadata.name !== 'string') return badRequest('Malformed multipart body.');
        const parents: string[] = upload.metadata.parents ?? [];
        if (parents.some(id => !this.files.some(f => f.id === id && f.mimeType === FOLDER_MIME))) return notFound();
        const file = { id: `1PracticeFile${String(this.#next++).padStart(16, '0')}`, name: upload.metadata.name, mimeType: upload.metadata.mimeType ?? 'application/octet-stream', appProperties: upload.metadata.appProperties ?? {}, parents, trashed: false, permissions: [], content: upload.content, createdTime: this.#clock() };
        this.files.push(file); return reply(200, this.#fileView(file));
      } },
    ];
  }
  prime(payload: WireObject, before: WireObject | null) {
    const p = payload as Rec;
    if (typeof p.spreadsheetId === 'string') {
      const sheet = this.spreadsheets[p.spreadsheetId] ??= { title: 'Practice sheet', tabs: {} };
      const range = typeof p.range === 'string' ? p.range.match(/^(?:'([^']+)'|([^'!]+))!([A-Z]+)(\d+)/) : null, name = p.sheet ?? range?.[1] ?? range?.[2];
      if (typeof name === 'string') sheet.tabs[name] ??= [];
      if (range && Array.isArray((before as Rec | null)?.values)) this.#write(sheet.tabs[range[1] ?? range[2]], Number(range[4]), colIndex(range[3]), (before as Rec).values);
    }
    if (typeof p.calendarId === 'string') this.calendars[p.calendarId] ??= { summary: 'Practice calendar', timeZone: 'UTC', events: [] };
    if (typeof p.folderId === 'string' && !this.files.some(f => f.id === p.folderId)) this.files.push({ id: p.folderId, name: 'Practice folder', mimeType: FOLDER_MIME, appProperties: {}, parents: [], trashed: false, content: '' });
  }
  snapshot(): WireObject { return structuredClone({ spreadsheets: this.spreadsheets, calendars: this.calendars, files: this.files.map(f => this.#fileView(f)) }) as WireObject; }
}
