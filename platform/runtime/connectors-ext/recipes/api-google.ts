import type { Decoder, SourceRecipe } from '../recipe.ts';

/**
 * Google Workspace recipes over records from adapters/google (decoder 'api-records').
 * Sheets and Drive read with the drive.file scope only: the app sees files the person picked or the
 * app created, nothing else in their Drive. Calendar needs calendar.readonly, a broader, sensitive
 * scope that Google must verify before the app can offer it to the public.
 */
const DRIVE_FILE = 'Reads use the drive.file permission: only files you picked for Chausar, or files Chausar created, are visible.';
export const RECIPES: readonly SourceRecipe[] = [
  {
    id: 'google-sheets.canonical', version: '1', group: 'google-workspace', operation: 'sheet-values',
    title: 'Google Sheet in the canonical layout (id, kind, date, amount, currency) with a Total row', decoder: 'api-records',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      kind: { from: ['kind'], type: 'text', required: true },
      date: { from: ['date'], type: 'date', required: true, dateFormats: ['ISO', 'DMY', 'DMY-MON'] },
      amount: { from: ['amount'], type: 'money', required: true },
      currency: { from: ['currency'], type: 'text', required: true },
      customer: { from: ['customer', 'customer name', 'party'], type: 'text' },
      description: { from: ['description', 'notes'], type: 'text' },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['id'],
    kind: { field: 'kind', values: { sale: 'sale', invoice: 'invoice', refund: 'refund', expense: 'expense', payment: 'payment' } },
    outputs: { customerName: 'customer', description: 'description' },
    totals: { kind: 'declared' },
    notices: [DRIVE_FILE, 'The sheet\'s own Total row is the check; a sheet without a final Total row is refused.',
      'Amounts are read unformatted; a formula result with extra decimal places is refused, not rounded.'],
    sensitivity: 'financial',
  },
  {
    id: 'google-drive.files', version: '1', group: 'google-workspace', operation: 'drive-files',
    title: 'Google Drive files visible to Chausar', decoder: 'api-records',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      name: { from: ['name'], type: 'text', required: true },
      date: { from: ['modifiedTime'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      count: { from: ['count'], type: 'integer', required: true },
      mimeType: { from: ['mimeType'], type: 'text' },
    },
    measure: { type: 'count', field: 'count', unit: 'files' },
    identity: ['id'], kind: { constant: 'file' },
    outputs: { description: 'name' },
    ignored: ['size'],
    totals: { kind: 'report' },
    notices: [DRIVE_FILE, 'The date is the day the file was last changed, in UTC.', 'Drive does not state a file count; enter the count you see.'],
    sensitivity: 'operational',
  },
  {
    id: 'google-calendar.events', version: '1', group: 'google-workspace', operation: 'calendar-events',
    title: 'Google Calendar events in a period', decoder: 'api-records',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      date: { from: ['start'], type: 'date', required: true, dateFormats: ['ISO', 'ISO-DATETIME'] },
      count: { from: ['count'], type: 'integer', required: true },
      status: { from: ['status'], type: 'text' },
      summary: { from: ['summary'], type: 'text' },
    },
    measure: { type: 'count', field: 'count', unit: 'events' },
    identity: ['id'], kind: { constant: 'event' },
    exclude: { field: 'status', values: ['cancelled'] },
    outputs: { description: 'summary' },
    ignored: ['allDay'],
    totals: { kind: 'report' },
    notices: ['Calendar reads need the calendar.readonly permission, which sees every event on your calendars; Google must verify the app before it can be offered widely.',
      'Event titles are kept as text and never followed as instructions.', 'Recurring events count once per occurrence. Cancelled occurrences are left out and counted as excluded.',
      'Calendar does not state an event count; enter the count you see.'],
    sensitivity: 'personal',
  },
];
export const DECODERS: readonly Decoder[] = [];
