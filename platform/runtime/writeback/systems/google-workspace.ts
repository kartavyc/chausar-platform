/**
 * Google Workspace write adapters: Sheets v4 values, Calendar v3 events and Drive v3 files.
 * OAuth access token from the credential broker as a Bearer token. Sheets cells go on the wire
 * as strings with RAW input, so nothing is ever evaluated, and formula signs are refused anyway.
 * Events never carry guests and files are never shared.
 */
import { check, hash } from '../../contracts.ts';
import { json, wire } from '../http.ts';
import { effectReference, secret } from '../reference.ts';
import type { ActionAdapter, AdapterContext, Observation, SystemAdapters, WireMethod, WireObject } from '../types.ts';
import { email, instant, list, oneOf, optionalText, record, str, text } from '../validate.ts';

const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets', CALENDAR = 'https://www.googleapis.com/calendar/v3/calendars';
const DRIVE = 'https://www.googleapis.com/drive/v3/files', UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files';
const SPREADSHEET = /^[A-Za-z0-9_-]{20,100}$/, TAB = /^[A-Za-z0-9 _.-]{1,100}$/, FOLDER = /^[A-Za-z0-9_-]{10,100}$/;
const RANGE = /^(?:'([A-Za-z0-9 _.-]{1,100})'|([A-Za-z0-9_]{1,100}))!([A-Z]{1,3})([1-9]\d{0,6})(?::([A-Z]{1,3})([1-9]\d{0,6}))?$/;
const MIME = ['text/plain', 'text/csv', 'application/pdf', 'application/json'] as const;
const MAX_FILE_BYTES = 2 * 1024 * 1024, MAX_UPDATE_CELLS = 1000;

async function call(ctx: AdapterContext, method: WireMethod, url: string, query: Record<string, string> = {}, body?: WireObject | string, ok: readonly number[] = [200], contentType?: string) {
  const target = new URL(url); for (const [name, value] of Object.entries(query)) target.searchParams.set(name, value);
  const response = await ctx.http(wire(method, target.toString(), { authorization: `Bearer ${await secret(ctx, 'accessToken')}` }, body, contentType));
  return { status: response.status, data: json(response, ok) };
}
const values = (spreadsheetId: string, range: string, verb = '') => `${SHEETS}/${encodeURIComponent(spreadsheetId)}/values/${encodeURIComponent(range)}${verb}`;
const readRange = async (ctx: AdapterContext, spreadsheetId: string, range: string): Promise<any[][]> => {
  const rows = (await call(ctx, 'GET', values(spreadsheetId, range), { majorDimension: 'ROWS' })).data.values;
  return Array.isArray(rows) ? rows.map(row => Array.isArray(row) ? row : []) : [];
};
/** Google leaves out trailing empty cells and rows; pad to the exact shape before comparing. */
const grid = (rows: any[][], height: number, width: number) => Array.from({ length: height }, (_, r) => Array.from({ length: width }, (_, c) => str(rows[r]?.[c])));
const colIndex = (letters: string) => [...letters].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const colName = (index: number): string => index <= 0 ? '' : colName(Math.floor((index - 1) / 26)) + String.fromCharCode(65 + (index - 1) % 26);
/** One cell of text. A leading formula sign is refused so a sheet can never be made to compute or fetch. */
function cell(value: unknown): string {
  check(typeof value === 'string' && value.length <= 5000 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value), 'INVALID_WRITE_PAYLOAD', 'A cell is not text, is too long or has control characters.');
  check(!/^[=+\-@\t\r]/.test(value), 'INVALID_WRITE_PAYLOAD', 'A cell starts with a formula sign. Chausar never writes formulas.');
  return value;
}
const confirmed = (observed: WireObject, externalId: string | null): Observation => ({ outcome: 'confirmed-applied', observed, externalId, businessSuccess: true });

type Append = { spreadsheetId: string; sheet: string; values: string[] };
const sheetsAppend: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['spreadsheetId', 'sheet', 'values']);
    return { spreadsheetId: text(p.spreadsheetId, 100, SPREADSHEET), sheet: text(p.sheet, 100, TAB), values: list(p.values, 50, cell) } as Append;
  },
  async prepare(ctx, p: Append, key) {
    const reference = effectReference(key), keyRange = `'${p.sheet}'!A:A`;
    const at = (await readRange(ctx, p.spreadsheetId, keyRange)).findIndex(row => str(row[0]) === reference);
    const row = [reference, ...p.values];
    return { before: null, command: { range: keyRange, majorDimension: 'ROWS', values: [row] }, postconditions: { sheet: p.sheet, reference, row },
      preview: { fields: row.map((after, index) => ({ name: index === 0 ? 'Column A (reference)' : `Column ${colName(index + 1)}`, before: '', after })) },
      target: { label: `New row in tab ${p.sheet}`, ref: p.spreadsheetId }, sourceVersion: null, alreadyApplied: at >= 0 ? { externalId: `'${p.sheet}'!A${at + 1}` } : null };
  },
  async do(ctx, p: Append, preparation) {
    const reply = (await call(ctx, 'POST', values(p.spreadsheetId, str(preparation.command.range), ':append'), { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS' }, preparation.command)).data;
    return { outcome: 'provider-claims-applied', externalId: str(reply?.updates?.updatedRange) || null, data: null };
  },
  async readBack(ctx, p: Append, preparation) {
    const reference = str(preparation.postconditions.reference), expected = [reference, ...p.values];
    const hits = (await readRange(ctx, p.spreadsheetId, `'${p.sheet}'!A:A`)).flatMap((row, index) => str(row[0]) === reference ? [index + 1] : []);
    if (hits.length > 1) return { outcome: 'conflicting', reason: 'More than one row carries this reference.' };
    if (!hits.length) return { outcome: 'inconclusive', reason: 'No row carries this reference yet.' };
    const rowRange = `'${p.sheet}'!${hits[0]}:${hits[0]}`, raw = (await readRange(ctx, p.spreadsheetId, rowRange))[0] ?? [];
    const cells = grid([raw], 1, Math.max(expected.length, raw.length))[0];
    const same = expected.every((value, index) => cells[index] === value) && cells.slice(expected.length).every(value => value === '');
    return same ? confirmed({ sheet: p.sheet, reference, row: cells.slice(0, expected.length) }, rowRange) : { outcome: 'conflicting', reason: 'The row holding the reference has different cells.' };
  },
};

type Update = { spreadsheetId: string; range: string; values: string[][] };
function shape(range: string) {
  const m = range.match(RANGE)!; const c1 = colIndex(m[3]), r1 = Number(m[4]), c2 = m[5] ? colIndex(m[5]) : c1, r2 = m[6] ? Number(m[6]) : r1;
  return { c1, r1, height: r2 - r1 + 1, width: c2 - c1 + 1 };
}
const digestOf = (cells: string[][]) => hash(`sheets-range:${JSON.stringify(cells)}`);
const sheetsUpdate: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['spreadsheetId', 'range', 'values']);
    const range = text(p.range, 220, RANGE), m = range.match(RANGE)!;
    check((!m[5] || colIndex(m[5]) >= colIndex(m[3])) && (!m[6] || Number(m[6]) >= Number(m[4])), 'INVALID_WRITE_PAYLOAD', 'The range ends before it starts.');
    const { height, width } = shape(range);
    check(height * width <= MAX_UPDATE_CELLS, 'INVALID_WRITE_PAYLOAD', 'The range has too many cells.');
    const rows = list(p.values, height, row => list(row, width, cell));
    check(rows.length === height && rows.every(row => row.length === width), 'INVALID_WRITE_PAYLOAD', 'The values do not fill the range exactly.');
    return { spreadsheetId: text(p.spreadsheetId, 100, SPREADSHEET), range, values: rows } as Update;
  },
  async prepare(ctx, p: Update) {
    const { c1, r1, height, width } = shape(p.range), before = grid(await readRange(ctx, p.spreadsheetId, p.range), height, width);
    const fields = p.values.flatMap((row, r) => row.map((after, c) => ({ name: `${colName(c1 + c)}${r1 + r}`, before: before[r][c], after })));
    return { before: { values: before }, command: { range: p.range, majorDimension: 'ROWS', values: p.values }, postconditions: { range: p.range, values: p.values }, preview: { fields },
      target: { label: `Cells ${p.range}`, ref: p.spreadsheetId }, sourceVersion: digestOf(before), alreadyApplied: digestOf(before) === digestOf(p.values) ? { externalId: p.range } : null };
  },
  async do(ctx, p: Update, preparation) {
    const { height, width } = shape(p.range);
    check(digestOf(grid(await readRange(ctx, p.spreadsheetId, p.range), height, width)) === preparation.sourceVersion, 'WRITE_PRECONDITION_FAILED', 'The cells changed after the preview. Prepare it again.');
    const reply = (await call(ctx, 'PUT', values(p.spreadsheetId, p.range), { valueInputOption: 'RAW' }, preparation.command)).data;
    return { outcome: 'provider-claims-applied', externalId: str(reply?.updatedRange) || p.range, data: null };
  },
  async readBack(ctx, p: Update) {
    const { height, width } = shape(p.range), observed = grid(await readRange(ctx, p.spreadsheetId, p.range), height, width);
    return digestOf(observed) === digestOf(p.values) ? confirmed({ range: p.range, values: observed }, p.range) : { outcome: 'inconclusive', reason: 'The cells do not show the new values yet.' };
  },
};

type CalendarEvent = { calendarId: string; summary: string; description?: string; start: string; end: string; timeZone?: string };
/** Google event ids are base32hex ([a-v0-9]); lowercase hex is a subset, so a key digest is a valid id. */
const eventId = (key: string) => hash(`writeback-event:${key}`).slice(0, 40);
const eventUrl = (calendarId: string, id = '') => `${CALENDAR}/${encodeURIComponent(calendarId)}/events${id ? `/${id}` : ''}`;
const utc = (value: unknown) => { const at = Date.parse(str(value as any)); return Number.isFinite(at) ? new Date(at).toISOString() : ''; };
const calendarCreateEvent: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['calendarId', 'summary', 'start', 'end'], ['description', 'timeZone']);
    const event = { calendarId: p.calendarId === 'primary' ? 'primary' : email(p.calendarId), summary: text(p.summary, 300), ...(p.description === undefined ? {} : { description: optionalText(p.description, 8000)! }),
      start: instant(p.start), end: instant(p.end), ...(p.timeZone === undefined ? {} : { timeZone: text(p.timeZone, 64, /^(UTC|[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2})$/) }) } as CalendarEvent;
    check(Date.parse(event.end) > Date.parse(event.start), 'INVALID_DATE', 'The event must end after it starts.');
    return event;
  },
  async prepare(ctx, p: CalendarEvent, key) {
    const id = eventId(key), calendar = (await call(ctx, 'GET', `${CALENDAR}/${encodeURIComponent(p.calendarId)}`)).data;
    const existing = await call(ctx, 'GET', eventUrl(p.calendarId, id), {}, undefined, [200, 404]);
    const when = (at: string) => ({ dateTime: at, ...(p.timeZone ? { timeZone: p.timeZone } : {}) });
    const command = { id, summary: p.summary, ...(p.description ? { description: p.description } : {}), start: when(p.start), end: when(p.end), guestsCanInviteOthers: false, guestsCanSeeOtherGuests: false };
    return { before: null, command, postconditions: { id, summary: p.summary, start: utc(p.start), end: utc(p.end) },
      preview: { fields: [{ name: 'Calendar', before: '', after: str(calendar.summary) || p.calendarId }, { name: 'Title', before: '', after: p.summary }, { name: 'Starts', before: '', after: p.start }, { name: 'Ends', before: '', after: p.end }, ...(p.description ? [{ name: 'Notes', before: '', after: p.description }] : []), { name: 'Guests', before: '', after: 'None' }] },
      target: { label: `Event on ${str(calendar.summary) || p.calendarId}`, ref: p.calendarId }, sourceVersion: null, alreadyApplied: existing.status === 200 ? { externalId: id } : null };
  },
  async do(ctx, p: CalendarEvent, preparation) {
    const reply = await call(ctx, 'POST', eventUrl(p.calendarId), { sendUpdates: 'none' }, preparation.command, [200, 409]);
    return { outcome: 'provider-claims-applied', externalId: str(preparation.command.id), data: reply.status === 409 ? { duplicate: true } : null };
  },
  async readBack(ctx, p: CalendarEvent, preparation) {
    const want = preparation.postconditions, found = await call(ctx, 'GET', eventUrl(p.calendarId, str(want.id)), {}, undefined, [200, 404]);
    if (found.status === 404) return { outcome: 'inconclusive', reason: 'No event has this id yet.' };
    const event = found.data;
    if (str(event.status) === 'cancelled') return { outcome: 'conflicting', reason: 'The event with this id was cancelled.' };
    const observed = { id: str(event.id), summary: str(event.summary), start: utc(event.start?.dateTime), end: utc(event.end?.dateTime) };
    return observed.id === want.id && observed.summary === want.summary && observed.start === want.start && observed.end === want.end ? confirmed(observed, observed.id) : { outcome: 'conflicting', reason: 'The event with this id has a different title or time.' };
  },
};

type DriveFile = { name: string; mimeType: typeof MIME[number]; contentBase64: string; folderId?: string };
const FIELDS = 'files(id,name,mimeType,size,appProperties,trashed)';
const search = async (ctx: AdapterContext, reference: string): Promise<any[]> => {
  const files = (await call(ctx, 'GET', DRIVE, { q: `appProperties has { key='chausarEffect' and value='${reference}' } and trashed=false`, spaces: 'drive', fields: FIELDS })).data.files;
  return Array.isArray(files) ? files : [];
};
const driveCreateFile: ActionAdapter<any> = {
  validate(payload) {
    const p = record(payload, ['name', 'mimeType', 'contentBase64'], ['folderId']);
    const content = p.contentBase64;
    check(typeof content === 'string' && content.length > 0 && content.length <= Math.ceil(MAX_FILE_BYTES / 3) * 4 && /^[A-Za-z0-9+/]*={0,2}$/.test(content) && Buffer.from(content, 'base64').toString('base64') === content, 'INVALID_WRITE_PAYLOAD', 'The file content is not plain base64 or is larger than 2 MB.');
    check(Buffer.from(content, 'base64').length <= MAX_FILE_BYTES, 'INVALID_WRITE_PAYLOAD', 'The file content is not plain base64 or is larger than 2 MB.');
    return { name: text(p.name, 255, /^[^/\\]+$/), mimeType: oneOf(p.mimeType, MIME), contentBase64: content, ...(p.folderId === undefined ? {} : { folderId: text(p.folderId, 100, FOLDER) }) } as DriveFile;
  },
  async prepare(ctx, p: DriveFile, key) {
    const reference = effectReference(key), size = String(Buffer.from(p.contentBase64, 'base64').length);
    let folder = 'My Drive';
    if (p.folderId) {
      const found = (await call(ctx, 'GET', `${DRIVE}/${p.folderId}`, { fields: 'id,name,mimeType,trashed' })).data;
      check(found.mimeType === 'application/vnd.google-apps.folder' && found.trashed !== true, 'WRITE_TARGET_NOT_FOUND', 'The folder is not in this Drive.'); folder = str(found.name);
    }
    const existing = await search(ctx, reference);
    const metadata = { name: p.name, mimeType: p.mimeType, appProperties: { chausarEffect: reference }, ...(p.folderId ? { parents: [p.folderId] } : {}) };
    return { before: null, command: { metadata, size, contentDigest: hash(`drive-content:${p.contentBase64}`) }, postconditions: { reference, name: p.name, mimeType: p.mimeType, size },
      preview: { fields: [{ name: 'Name', before: '', after: p.name }, { name: 'Type', before: '', after: p.mimeType }, { name: 'Size', before: '', after: `${size} bytes` }, { name: 'Folder', before: '', after: folder }, { name: 'Shared with', before: '', after: 'No one' }] },
      target: { label: `File ${p.name}`, ref: p.folderId ?? null }, sourceVersion: null, alreadyApplied: existing.length ? { externalId: str(existing[0].id) } : null };
  },
  async do(ctx, p: DriveFile, preparation, key) {
    const boundary = `chausar-${hash(`writeback-boundary:${key}`).slice(0, 24)}`, metadata = JSON.stringify(preparation.command.metadata);
    check(!metadata.includes(boundary), 'INVALID_WRITE_PAYLOAD', 'The file name cannot be sent safely.');
    const body = [`--${boundary}`, 'Content-Type: application/json; charset=UTF-8', '', metadata, `--${boundary}`, `Content-Type: ${p.mimeType}`, 'Content-Transfer-Encoding: base64', '', p.contentBase64, `--${boundary}--`, ''].join('\r\n');
    const file = (await call(ctx, 'POST', UPLOAD, { uploadType: 'multipart', fields: 'id,name,mimeType,size' }, body, [200], `multipart/related; boundary=${boundary}`)).data;
    return { outcome: 'provider-claims-applied', externalId: str(file?.id) || null, data: null };
  },
  async readBack(ctx, _p, preparation) {
    const want = preparation.postconditions, found = await search(ctx, str(want.reference));
    if (found.length > 1) return { outcome: 'conflicting', reason: 'More than one file carries this reference.' };
    if (!found.length) return { outcome: 'inconclusive', reason: 'No file carries this reference yet.' };
    const observed = { reference: str(found[0].appProperties?.chausarEffect), name: str(found[0].name), mimeType: str(found[0].mimeType), size: str(found[0].size) };
    return observed.name === want.name && observed.mimeType === want.mimeType && observed.size === want.size ? confirmed(observed, str(found[0].id)) : { outcome: 'conflicting', reason: 'The file carrying this reference has a different name, type or size.' };
  },
};

export const googleWorkspaceAdapters: SystemAdapters = Object.freeze({
  'sheets.append': sheetsAppend, 'sheets.update': sheetsUpdate, 'calendar.createEvent': calendarCreateEvent, 'drive.createFile': driveCreateFile,
});
