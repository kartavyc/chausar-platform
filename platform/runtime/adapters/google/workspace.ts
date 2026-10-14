import { check } from '../../contracts.ts';
import type { ApiReadResult, ApiReadSpec, ParsedPage, ReadRequest } from '../read-kit.ts';
import { checkPeriod, nextDay, pageToken, parseSourceJson, scalarText, sourceArray, sourceObject, strictConfig } from './common.ts';

/**
 * Google Workspace reads: Sheets values, Drive file lists and file content, Calendar events.
 *
 * Scopes. Sheets and Drive ask for https://www.googleapis.com/auth/drive.file ONLY. That scope sees
 * only files the person picked for this app (Google Picker) or files this app created; it cannot
 * list or open the rest of the person's Drive. A spreadsheet the person has not picked returns 404.
 * Calendar needs https://www.googleapis.com/auth/calendar.readonly, which is broader than drive.file
 * (it reads every event on calendars the person can see) and is a Google "sensitive" scope: a public
 * app needs Google's OAuth verification before people outside the test-user list can grant it.
 */
export const GOOGLE_DRIVE_FILE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const GOOGLE_CALENDAR_READONLY_SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const SHEETS = 'https://sheets.googleapis.com', DRIVE = 'https://www.googleapis.com';

// ---------------------------------------------------------------- Sheets
export type GoogleSheetsConfig = {
  spreadsheetId: string;
  /** A1 notation, optionally with a sheet name: Sales!A1:E500, 'Day Book'!A:F, A1:E. */
  range: string;
  /** Heading of the column whose cell on the final "Total" row is the sheet's own total. Default "amount". */
  totalColumn?: string;
};
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;
const A1_RANGE = /^(?:(?:'(?:[^'\\/?*[\]:\u0000-\u001f]|''){1,100}'|[A-Za-z0-9_]{1,100})!)?[A-Z]{1,3}(?:[1-9]\d{0,6})?(?::[A-Z]{1,3}(?:[1-9]\d{0,6})?)?$/;
const headingKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

export function sheetsValuesUrl(config: GoogleSheetsConfig): string {
  return `${SHEETS}/v4/spreadsheets/${config.spreadsheetId}/values/${encodeURIComponent(config.range)}?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`;
}
/**
 * values.get returns the whole range in one response (no pages). The first row is the heading row,
 * every other row a record of exact strings. A final row whose first cell is "Total" is the sheet's
 * own total: it is taken out of the records and its amount cell becomes the declared total (major
 * units). A "Total" row anywhere but last is refused, since rows below a total are ambiguous.
 */
export const googleSheetsValuesSpec: ApiReadSpec<GoogleSheetsConfig> = Object.freeze({
  system: 'google-sheets', operation: 'sheet-values', version: '1',
  scopes: Object.freeze([GOOGLE_DRIVE_FILE_SCOPE]), auth: 'bearer',
  origins: () => [SHEETS],
  validate(config: GoogleSheetsConfig) {
    strictConfig(config, ['spreadsheetId', 'range', 'totalColumn'], ['spreadsheetId', 'range']);
    check(typeof config.spreadsheetId === 'string' && SPREADSHEET_ID.test(config.spreadsheetId), 'CONFIG_INVALID', 'The spreadsheet id is not a Google spreadsheet id.');
    check(typeof config.range === 'string' && config.range.length <= 220 && A1_RANGE.test(config.range), 'CONFIG_INVALID', 'The range must be in A1 notation, with an optional sheet name.');
    if (config.totalColumn !== undefined) check(typeof config.totalColumn === 'string' && config.totalColumn.trim().length > 0 && config.totalColumn.length <= 120, 'CONFIG_INVALID', 'Name the total column by its heading.');
    return config;
  },
  first: config => ({ method: 'GET', url: sheetsValuesUrl(config) }),
  parse(body, _response, config): ParsedPage {
    const root = parseSourceJson(body);
    check(root.majorDimension === undefined || root.majorDimension === 'ROWS', 'SHEET_LAYOUT_UNSUPPORTED', 'The sheet values must be read as rows.');
    const rows = root.values === undefined ? [] : sourceArray(root.values).map(row => sourceArray(row).map(scalarText));
    check(rows.length > 0, 'SHEET_EMPTY', 'The chosen range is empty.');
    const headers = rows[0].map(cell => cell.normalize('NFKC').replace(/\s+/g, ' ').trim());
    check(headers.length > 0 && headers.length <= 200 && headers.every(Boolean), 'SHEET_HEADER_INVALID', 'The first row of the range must name every column.');
    check(new Set(headers.map(headingKey)).size === headers.length, 'SHEET_HEADER_INVALID', 'Two columns have the same heading.');
    // Sheets drops trailing empty cells and returns empty rows as []; an empty row carries no data.
    const body_rows = rows.slice(1).filter(row => row.some(cell => cell.trim() !== ''));
    check(body_rows.every(row => row.length <= headers.length), 'SHEET_ROW_TOO_WIDE', 'A row has cells beyond the heading row.');
    const totalAt = body_rows.findIndex(row => headingKey(row[0] ?? '') === 'total');
    let declared: ParsedPage['declared'] = null, data = body_rows;
    if (totalAt >= 0) {
      check(totalAt === body_rows.length - 1, 'SHEET_TOTAL_NOT_LAST', 'A Total row must be the last row of the range.');
      const column = headers.findIndex(h => headingKey(h) === headingKey(config.totalColumn ?? 'amount'));
      const amount = column >= 0 ? (body_rows[totalAt][column] ?? '').trim() : '';
      data = body_rows.slice(0, totalAt);
      if (amount !== '') declared = { amount, amountUnit: 'major', reference: 'sheet-total-row' };
    }
    const records = data.map(row => Object.fromEntries(headers.map((h, i) => [h, row[i] ?? ''])));
    return { records, next: null, declared };
  },
});

// ---------------------------------------------------------------- Drive
export type GoogleDriveListConfig = { mimeType?: 'text/csv' | 'application/vnd.google-apps.spreadsheet' | 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
const DRIVE_MIME = ['text/csv', 'application/vnd.google-apps.spreadsheet', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
export function driveListUrl(config: GoogleDriveListConfig, token?: string): string {
  let url = `${DRIVE}/drive/v3/files?pageSize=100&fields=${encodeURIComponent('nextPageToken,files(id,name,mimeType,modifiedTime,size)')}`;
  if (config.mimeType) url += `&q=${encodeURIComponent(`mimeType='${config.mimeType}' and trashed=false`)}`;
  if (token !== undefined) url += `&pageToken=${encodeURIComponent(token)}`;
  return url;
}
const DRIVE_ID = /^[A-Za-z0-9_-]{10,200}$/;
/** Lists only what drive.file lets this app see: files the person picked, or the app created. */
export const googleDriveFilesSpec: ApiReadSpec<GoogleDriveListConfig> = Object.freeze({
  system: 'google-drive', operation: 'drive-files', version: '1',
  scopes: Object.freeze([GOOGLE_DRIVE_FILE_SCOPE]), auth: 'bearer',
  origins: () => [DRIVE],
  validate(config: GoogleDriveListConfig) {
    strictConfig(config, ['mimeType']);
    if (config.mimeType !== undefined) check(DRIVE_MIME.includes(config.mimeType), 'CONFIG_INVALID', 'Choose a listed file type.');
    return config;
  },
  first: config => ({ method: 'GET', url: driveListUrl(config) }),
  parse(body, _response, config): ParsedPage {
    const root = parseSourceJson(body);
    const records = sourceArray(root.files ?? []).map(entry => {
      const file = sourceObject(entry), id = scalarText(file.id);
      check(DRIVE_ID.test(id), 'SOURCE_ID_INVALID', 'A Drive file has no usable id.');
      // One record is one file: the count field states that, so the count recipe never infers it.
      return { id, name: scalarText(file.name), mimeType: scalarText(file.mimeType), modifiedTime: scalarText(file.modifiedTime), size: scalarText(file.size), count: '1' };
    });
    const next = root.nextPageToken === undefined ? null : { method: 'GET' as const, url: driveListUrl(config, pageToken(root.nextPageToken)) };
    return { records, next };
  },
});

export type GoogleDriveFileConfig = { fileId: string; exportCsv?: boolean };
/**
 * The request for one file's bytes. Uploaded files (an exported CSV) are read with alt=media; a
 * native Google Sheet has no bytes of its own and is exported as CSV (first sheet only) instead.
 * drive.file still applies: the file must be one the person picked or the app created.
 */
export function driveFileContentRequest(fileId: string, options: { exportCsv?: boolean } = {}): ReadRequest {
  check(typeof fileId === 'string' && DRIVE_ID.test(fileId), 'CONFIG_INVALID', 'The Drive file id is not usable.');
  const url = options.exportCsv ? `${DRIVE}/drive/v3/files/${fileId}/export?mimeType=${encodeURIComponent('text/csv')}` : `${DRIVE}/drive/v3/files/${fileId}?alt=media`;
  return { method: 'GET', url, headers: { Accept: 'text/csv, text/plain' } };
}
/** One record, { fileId, text }: hand `text` to a file recipe (csv, tsv ...) with driveFileText. */
export const googleDriveFileContentSpec: ApiReadSpec<GoogleDriveFileConfig> = Object.freeze({
  system: 'google-drive', operation: 'drive-file-content', version: '1',
  scopes: Object.freeze([GOOGLE_DRIVE_FILE_SCOPE]), auth: 'bearer',
  origins: () => [DRIVE],
  validate(config: GoogleDriveFileConfig) {
    strictConfig(config, ['fileId', 'exportCsv'], ['fileId']);
    check(typeof config.fileId === 'string' && DRIVE_ID.test(config.fileId), 'CONFIG_INVALID', 'The Drive file id is not usable.');
    check(config.exportCsv === undefined || typeof config.exportCsv === 'boolean', 'CONFIG_INVALID', 'Export is on or off.');
    return config;
  },
  first: config => driveFileContentRequest(config.fileId, { exportCsv: config.exportCsv }),
  parse(body, response, config): ParsedPage {
    const type = (response.headers['content-type'] ?? '').toLowerCase();
    check(!type || /^(?:text\/(?:csv|plain|tab-separated-values)|application\/(?:csv|octet-stream))(?:;|$)/.test(type), 'SOURCE_FILE_TYPE_UNSUPPORTED', 'The Drive file is not a text export.');
    return { records: [{ fileId: config.fileId, text: body }], next: null };
  },
});
export function driveFileText(result: ApiReadResult): string {
  check(result.system === 'google-drive' && result.operation === 'drive-file-content' && result.records.length === 1 && typeof result.records[0].text === 'string', 'SOURCE_FILE_REQUIRED', 'Read one Drive file first.');
  return result.records[0].text as string;
}

// ---------------------------------------------------------------- Calendar
export type GoogleCalendarConfig = { calendarId: string };
const CALENDAR_ID = /^(?:primary|[A-Za-z0-9._%+-]{1,200}@[A-Za-z0-9.-]{1,200})$/;
export function calendarEventsUrl(config: GoogleCalendarConfig, period: { from: string; to: string }, token?: string): string {
  // The period is India Standard Time calendar days; timeMax is exclusive, so it is the next midnight.
  const timeMin = `${period.from}T00:00:00+05:30`, timeMax = `${nextDay(period.to)}T00:00:00+05:30`;
  let url = `${DRIVE}/calendar/v3/calendars/${encodeURIComponent(config.calendarId)}/events?singleEvents=true&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}&maxResults=250`;
  if (token !== undefined) url += `&pageToken=${encodeURIComponent(token)}`;
  return url;
}
/** The same request with another page token. */
export function withPageToken(url: string, token: string): string {
  return `${url.replace(/&pageToken=[^&]*$/, '')}&pageToken=${encodeURIComponent(pageToken(token))}`;
}
/** Events starting in the period; recurring events expanded (singleEvents). Summaries are data only. */
export const googleCalendarEventsSpec: ApiReadSpec<GoogleCalendarConfig> = Object.freeze({
  system: 'google-calendar', operation: 'calendar-events', version: '1',
  scopes: Object.freeze([GOOGLE_CALENDAR_READONLY_SCOPE]), auth: 'bearer',
  origins: () => [DRIVE],
  validate(config: GoogleCalendarConfig) {
    strictConfig(config, ['calendarId'], ['calendarId']);
    check(typeof config.calendarId === 'string' && CALENDAR_ID.test(config.calendarId), 'CONFIG_INVALID', 'The calendar id is "primary" or a calendar address.');
    return config;
  },
  first: (config, period) => ({ method: 'GET', url: calendarEventsUrl(config, checkPeriod(period, true)!) }),
  parse(body, _response, _config, request): ParsedPage {
    const root = parseSourceJson(body);
    check(root.kind === undefined || root.kind === 'calendar#events', 'SOURCE_SHAPE_INVALID', 'The system returned an unexpected response shape.');
    const records = sourceArray(root.items ?? []).map(entry => {
      const event = sourceObject(entry), start = event.start === undefined ? {} : sourceObject(event.start);
      const id = scalarText(event.id);
      check(id.length > 0 && id.length <= 1024, 'SOURCE_ID_INVALID', 'An event has no id.');
      const date = scalarText(start.date), dateTime = scalarText(start.dateTime);
      check(!(date && dateTime), 'SOURCE_SHAPE_INVALID', 'An event states two different starts.');
      return { id, status: scalarText(event.status), summary: scalarText(event.summary), start: date || dateTime, allDay: date ? 'yes' : 'no', count: '1' };
    });
    const next = root.nextPageToken === undefined ? null : { method: 'GET' as const, url: withPageToken(request.url, root.nextPageToken as string) };
    return { records, next };
  },
});
