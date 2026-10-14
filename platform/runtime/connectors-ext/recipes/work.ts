import { check } from '../../contracts.ts';
import { parseJson, tableFromRecords } from '../decoders.ts';
import { locateTable, norm, parseDelimited } from '../tabular.ts';
import type { Decoder, SourceRecipe } from '../recipe.ts';
import type { DecodedTable, RawRow } from '../types.ts';
import { tabularDecoder } from './operations.ts';

/**
 * Work tools: generic databases and sheets, team chat, messaging, product analytics and code.
 */
const COMMIT_COUNT = '(added) commit count';
const SERIES_LIMIT = 200, DATE_COLUMN_LIMIT = 1000;

/** GitHub's commits API (as saved by `gh api`): a JSON list of commit objects. Each commit counts once. */
const githubCommitsJson: Decoder = {
  id: 'github-commits-json', version: '1', accepts: 'text',
  decode(input): DecodedTable {
    check(typeof input.text === 'string' && input.text.length <= 20 * 1024 * 1024, 'TEXT_REQUIRED', 'This recipe reads a JSON export.');
    const parsed = parseJson(input.text!);
    check(Array.isArray(parsed), 'SOURCE_RECORD_INVALID', 'The commits file must be a list of commits.');
    const table = tableFromRecords(parsed as unknown[], { ...(input.meta ?? {}) });
    check(!table.headers.includes(COMMIT_COUNT), 'DUPLICATE_HEADERS', 'Two columns have the same heading. Rename one in the export before importing.');
    for (const row of table.rows) row.cells[COMMIT_COUNT] = '1';
    table.headers.push(COMMIT_COUNT);
    return table;
  },
};

/**
 * PostHog trends exported as CSV: one row per series, one column per date. Pivoted to one row
 * per series and date; an empty cell stays empty so the recipe refuses it as a missing count.
 */
/* A breakdown value, when present, joins the series name so each series and date is one record. */
const posthogTrendsCsv: Decoder = {
  id: 'posthog-trends-csv', version: '1', accepts: 'text',
  decode(input): DecodedTable {
    check(typeof input.text === 'string', 'TEXT_REQUIRED', 'This recipe reads a text export.');
    const table = locateTable(parseDelimited(input.text!, ','), [['Series']]);
    const seriesAt = table.headers.findIndex(h => norm(h) === 'series');
    const labelHeaders = table.headers.filter((h, i) => i !== seriesAt && ['breakdown value', 'breakdown'].includes(norm(h)));
    const dateHeaders = table.headers.filter((h, i) => i !== seriesAt && !labelHeaders.includes(h));
    check(dateHeaders.length > 0 && dateHeaders.length <= DATE_COLUMN_LIMIT && table.body.length <= SERIES_LIMIT, 'SOURCE_STRUCTURE_LIMIT', 'The trend export has more dates or series than one import accepts.');
    check(!dateHeaders.some(h => norm(h) === 'total'), 'SOURCE_LAYOUT_UNKNOWN', 'This trend export has a layout the recipe does not read.');
    const rows: RawRow[] = [];
    for (const line of table.body) {
      const series = (line.cells[seriesAt] ?? '').trim();
      const breakdown = labelHeaders.map(h => (line.cells[table.headers.indexOf(h)] ?? '').trim()).filter(Boolean).join(' / ');
      for (const header of dateHeaders) {
        rows.push({ line: line.line, cells: { Series: breakdown ? `${series} / ${breakdown}` : series, Date: header, Count: (line.cells[table.headers.indexOf(header)] ?? '').trim() } });
      }
    }
    return { headers: ['Series', 'Date', 'Count'], rows, footers: [], declared: null, meta: { ...(input.meta ?? {}) } };
  },
};

export const DECODERS: readonly Decoder[] = [
  githubCommitsJson,
  posthogTrendsCsv,
  tabularDecoder({ id: 'csv-commit-count', added: { '(added) commit count': '1' } }),
];

export const RECIPES: readonly SourceRecipe[] = [
  {
    id: 'notion.expense-database', version: '1', group: 'notion', operation: 'expense-database', title: 'Notion expense tracker database export', decoder: 'csv',
    fields: {
      name: { from: ['Name'], type: 'text', required: true },
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['DMY'] },
      amount: { from: ['Amount'], type: 'money', required: true },
      category: { from: ['Category'], type: 'text' },
      status: { from: ['Status'], type: 'text', required: true },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['name', 'date', 'amount'], kind: { constant: 'cost' },
    status: { field: 'status', values: { Paid: 'paid', Pending: 'pending', Reimbursed: 'reimbursed' } },
    outputs: { description: 'name', costType: 'category', status: 'status' },
    totals: { kind: 'report' },
    ignored: ['Paid by', 'Receipt', 'Created time'],
    notices: ['Notion databases have no ids in CSV exports. Two rows with the same name, date and amount are treated as one expense.',
      'Dates are read as day/month/year, Notion\'s Day/Month/Year date setting. The export has no total, so enter the sum Notion shows for this view.'],
    sensitivity: 'financial',
  },
  {
    id: 'slack.workspace-analytics', version: '1', group: 'slack', operation: 'workspace-analytics', title: 'Slack workspace analytics (overview) export', decoder: 'csv',
    fields: {
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['ISO'] },
      messages: { from: ['Messages posted'], type: 'integer', required: true },
      activeMembers: { from: ['Daily active members'], type: 'integer' },
    },
    measure: { type: 'count', field: 'messages', unit: 'messages' },
    identity: ['date'], kind: { constant: 'message' },
    totals: { kind: 'report' },
    ignored: ['Total enabled membership', 'Daily members posting messages', 'Weekly active members', 'Messages posted by members', 'Messages in public channels', 'Messages in private channels', 'Messages in DMs'],
    notices: ['Messages posted includes messages from apps and bots; Slack counts members\' own messages in a separate column.',
      'Active members are not added up across days.'],
    sensitivity: 'operational',
  },
  {
    id: 'microsoft-365.canonical-sheet', version: '1', group: 'microsoft-365', operation: 'canonical-sheet', title: 'Excel or OneDrive sheet in the Chausar canonical layout', decoder: 'worksheet',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      kind: { from: ['kind'], type: 'text', required: true },
      date: { from: ['date'], type: 'date', required: true, dateFormats: ['ISO'] },
      amount: { from: ['amount'], type: 'money', required: true },
      currency: { from: ['currency'], type: 'text', required: true },
      customer: { from: ['customer'], type: 'text' },
      description: { from: ['description'], type: 'text' },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['id'], kind: { field: 'kind', values: { invoice: 'invoice', payment: 'payment', sale: 'sale', refund: 'refund', cost: 'cost', purchase: 'purchase' } },
    outputs: { customerName: 'customer', description: 'description' },
    totals: { kind: 'footer-row', labelField: 'id', labels: ['Total'], amountFields: ['amount'] },
    notices: ['The sheet must hold one record per row with the columns id, kind, date, amount and currency, and a Total row the sheet itself calculates.',
      'The Total row adds every kind together; it checks the file is complete, not what any measure means.'],
    sensitivity: 'financial',
  },
  {
    id: 'whatsapp-api.campaign-report', version: '1', group: 'whatsapp-api', operation: 'campaign-report', title: 'WhatsApp Business API campaign report (WATI or Interakt)', decoder: 'csv',
    fields: {
      campaign: { from: ['Broadcast Name', 'Campaign Name'], type: 'text', required: true },
      date: { from: ['Date', 'Scheduled At', 'Sent On'], type: 'date', required: true, dateFormats: ['DMY'] },
      template: { from: ['Template', 'Template Name'], type: 'text' },
      sent: { from: ['Sent', 'Total Sent'], type: 'integer', required: true },
      delivered: { from: ['Delivered'], type: 'integer' },
      read: { from: ['Read'], type: 'integer' },
    },
    measure: { type: 'count', field: 'sent', unit: 'messages' },
    identity: ['campaign', 'date'], kind: { constant: 'message' },
    outputs: { description: 'template' },
    totals: { kind: 'report' },
    ignored: ['Failed', 'Replied', 'Clicked', 'Status'],
    notices: ['Sent counts messages handed to WhatsApp. Delivered and read counts are lower, and read counts miss people who turned read receipts off.',
      'Message charges are billed by the provider separately and are not in this count.'],
    sensitivity: 'operational',
  },
  {
    id: 'posthog.event-trend', version: '1', group: 'posthog', operation: 'event-trend', title: 'PostHog trends insight CSV export', decoder: 'posthog-trends-csv',
    fields: {
      series: { from: ['Series'], type: 'text', required: true },
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['DMY-MON', 'ISO'] },
      count: { from: ['Count'], type: 'integer', required: true },
    },
    measure: { type: 'count', field: 'count', unit: 'events' },
    identity: ['series', 'date'], kind: { constant: 'event' },
    outputs: { description: 'series' },
    totals: { kind: 'report' },
    notices: ['Counts are as the PostHog insight computed them, with its own filters and test-account exclusion.',
      'The export has no total, so enter the total PostHog shows for the same insight and dates.'],
    sensitivity: 'operational',
  },
  {
    id: 'github.commits-json', version: '1', group: 'github', operation: 'commits', title: 'GitHub repository commits (API JSON)', decoder: 'github-commits-json',
    fields: {
      sha: { from: ['sha'], type: 'text', required: true },
      date: { from: ['commit.author.date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      message: { from: ['commit.message'], type: 'text' },
      count: { from: [COMMIT_COUNT], type: 'integer' },
    },
    measure: { type: 'count', field: 'count', unit: 'commits' },
    identity: ['sha'], kind: { constant: 'commit' },
    outputs: { description: 'message' },
    totals: { kind: 'report' },
    ignored: ['node_id', 'url', 'html_url', 'comments_url', 'commit.author.name', 'commit.author.email', 'commit.committer.name', 'commit.committer.email', 'commit.committer.date',
      'commit.tree.sha', 'commit.tree.url', 'commit.url', 'commit.comment_count', 'author.login', 'author.id', 'committer.login', 'committer.id', 'parents.length', 'parents.0.sha', 'parents.0.url', 'parents.1.sha', 'parents.1.url'],
    notices: ['Each commit counts once on its author date in UTC. Commit authors\' names and emails are not imported.',
      'The commit list has no total, so enter the commit count GitHub or git shows for the same branch and dates.'],
    sensitivity: 'personal',
  },
  {
    id: 'github.commits-csv', version: '1', group: 'github', operation: 'commits', title: 'GitHub repository commits (git log CSV)', decoder: 'csv-commit-count',
    fields: {
      sha: { from: ['sha', 'Commit', 'Hash'], type: 'text', required: true },
      date: { from: ['author date', 'Date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      message: { from: ['message', 'Subject'], type: 'text' },
      count: { from: [COMMIT_COUNT], type: 'integer' },
    },
    measure: { type: 'count', field: 'count', unit: 'commits' },
    identity: ['sha'], kind: { constant: 'commit' },
    outputs: { description: 'message' },
    totals: { kind: 'report' },
    ignored: ['author name', 'author email'],
    notices: ['Each commit counts once on its author date. Commit authors\' names and emails are not imported.',
      'The commit list has no total, so enter the commit count git shows for the same branch and dates.'],
    sensitivity: 'personal',
  },
];
