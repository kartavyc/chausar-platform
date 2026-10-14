import { check } from '../../contracts.ts';
import { norm } from '../tabular.ts';
import type { Decoder, SourceRecipe } from '../recipe.ts';
import type { DecodedTable, RawRow } from '../types.ts';
import { UNCONFIRMED, checkedAgainst, tabularDecoder } from './operations.ts';

/**
 * Marketing exports: ad spend and audience counts. Spend is money; reach, sessions, views and
 * emails are counts with a stated unit, never money.
 */

/** Heading of the column the ad decoders add: the source's own total label on total rows, empty on records. */
export const ROW_LABEL_HEADING = '(added) row label';
const META_SUMMARY = 'Summary';
const COST_TYPE = { '(added) cost type': 'advertising' } as const;

const columnOf = (recipe: SourceRecipe, field: string, headers: readonly string[]): string | null => {
  const aliases = new Set((recipe.fields[field]?.from ?? []).map(norm));
  return headers.find(h => aliases.has(norm(h))) ?? null;
};
const withRowLabel = (table: DecodedTable): DecodedTable => {
  check(!table.headers.some(h => norm(h) === norm(ROW_LABEL_HEADING)), 'DUPLICATE_HEADERS', 'Two columns have the same heading. Rename one in the export before importing.');
  return { ...table, headers: [...table.headers, ROW_LABEL_HEADING] };
};

/**
 * Meta Ads Manager exports. With "Include summary row" on, the first data row has no campaign
 * name and carries the export's own sums; it becomes the total row (labelled "Summary") and is
 * never read as a campaign. Without it every row is a record.
 */
const metaBase = tabularDecoder({ id: 'meta-ads-base', added: COST_TYPE });
const metaAdsDecoder: Decoder = {
  id: 'meta-ads-export', version: '1', accepts: 'text',
  decode(input, recipe): DecodedTable {
    const table = metaBase.decode(input, recipe), campaign = columnOf(recipe, 'campaign', table.headers);
    check(campaign !== null, 'REQUIRED_COLUMN_MISSING', 'A column this recipe needs is missing. The export may be from another report or version.');
    const rows = [...table.rows], footers: RawRow[] = [];
    if (rows.length && (rows[0].cells[campaign!] ?? '') === '') {
      const summary = rows.shift()!;
      footers.push({ line: summary.line, cells: { ...summary.cells, [ROW_LABEL_HEADING]: META_SUMMARY } });
    }
    for (const row of rows) row.cells[ROW_LABEL_HEADING] = '';
    return withRowLabel({ ...table, rows, footers });
  },
};

/**
 * Google Ads report downloads: two title lines, the table, then "Total: ..." rows. The label sits in
 * the first column after the segment column, and a segmented report (by Day) repeats every total
 * once per day. Only the overall rows (no segment value, or "--") are the report's own totals; the
 * per-day subtotals are dropped, never read as campaigns.
 */
const googleAdsBase = tabularDecoder({ id: 'google-ads-base', added: COST_TYPE });
const googleAdsDecoder: Decoder = {
  id: 'google-ads-report', version: '2', accepts: 'text',
  decode(input, recipe): DecodedTable {
    const table = googleAdsBase.decode(input, recipe), segment = columnOf(recipe, 'date', table.headers);
    check(segment !== null, 'REQUIRED_COLUMN_MISSING', 'A column this recipe needs is missing. The export may be from another report or version.');
    const rows: RawRow[] = [], footers: RawRow[] = [];
    for (const row of table.rows) {
      const label = table.headers.map(h => row.cells[h] ?? '').find(value => norm(value).startsWith('total:'));
      if (label === undefined) { row.cells[ROW_LABEL_HEADING] = ''; rows.push(row); continue; }
      const day = (row.cells[segment!] ?? '').trim();
      if (day === '' || /^-+$/.test(day)) footers.push({ line: row.line, cells: { ...row.cells, [ROW_LABEL_HEADING]: label } });
    }
    return withRowLabel({ ...table, rows, footers: [...footers, ...table.footers] });
  },
};

export const DECODERS: readonly Decoder[] = [
  metaAdsDecoder,
  googleAdsDecoder,
  /** GA4 exports: "#" comment lines around the table; a "Grand total" row when the export has one. */
  tabularDecoder({ id: 'ga4-csv', commentPrefix: '#', totalsAnywhere: true }),
  /** Exports whose total row can sit anywhere in the table (YouTube Studio puts it first). */
  tabularDecoder({ id: 'csv-totals-anywhere', totalsAnywhere: true }),
  /** Mailchimp writes Send Date as "Mar 20, 2020 01:00 pm"; it is normalised to an ISO date in the decoder. */
  tabularDecoder({ id: 'mailchimp-csv', monthNameDates: ['Send Date'] }),
];

const META_FIELDS = {
  campaign: { from: ['Campaign name'], type: 'text', required: true },
  date: { from: ['Day'], type: 'date', required: true, dateFormats: ['ISO'] },
  spend: { from: ['Amount spent (INR)'], type: 'money', required: true },
  impressions: { from: ['Impressions'], type: 'integer' },
  results: { from: ['Results'], type: 'integer' },
  costType: { from: ['(added) cost type'], type: 'text' },
  rowLabel: { from: [ROW_LABEL_HEADING], type: 'text' },
} as const;
const META_IGNORED = ['Reporting starts', 'Reporting ends', 'Campaign delivery', 'Result indicator', 'Cost per result', 'Cost per results', 'Ends', 'Attribution setting',
  'Ad set budget', 'Ad set budget type', 'Results (initial)', 'Results (initial) indicator', 'Frequency'];
const META_SOURCE = checkedAgainst('https://github.com/daaronr/eamt_data_analysis/blob/5c97d539590e08cc5d3a8f3e10a270eb7f00e611/gwwc/gg_raw_data_shareable/Giving-What-We-Can-Ads-New-Campaigns-Nov-15-2021-Jan-31-2022.csv');
const META_NOTICES = ['Ad spend is the platform\'s reported spend, not the invoiced amount. GST on Meta invoices is not included.',
  'Results mean different actions for different campaign objectives and are not imported as one count.',
  'The Day column is the date breakdown ("Breakdown > By time > Day"); campaign-level rows only, one per campaign and day.'];
const metaRecipe = (summary: boolean): SourceRecipe => ({
  id: summary ? 'meta-ads.campaign-daily' : 'meta-ads.campaign-daily-report', version: '2', group: 'meta-ads', operation: 'campaign-daily',
  title: summary ? 'Meta Ads Manager campaign report by day (with summary row)' : 'Meta Ads Manager campaign report by day (no summary row)', decoder: 'meta-ads-export',
  fields: META_FIELDS,
  measure: { type: 'money', amount: { field: 'spend' }, currency: { constant: 'INR' }, unit: 'major' },
  identity: ['campaign', 'date'], kind: { constant: 'cost' },
  outputs: { costType: 'costType', description: 'campaign', marketingMinor: 'spend' },
  totals: summary ? { kind: 'footer-row', labelField: 'rowLabel', labels: [META_SUMMARY], amountFields: ['spend'] } : { kind: 'report' },
  ignored: META_IGNORED,
  notices: [...META_NOTICES,
    summary ? 'Checked against the export\'s own summary row (the first row, with no campaign name). Export with "Include summary row" on, or use the no-summary recipe.'
      : 'This export has no summary row, so enter the total spend Ads Manager shows for the same dates.',
    META_SOURCE],
  sensitivity: 'financial',
});

const GA4_SOURCE = 'https://github.com/DewSam/H1-B-data-Analytics/blob/4750de6632641e56ce86d34745e939f54332239c/data-export.csv';
const ga4Recipe = (grandTotal: boolean): SourceRecipe => ({
  id: grandTotal ? 'google-analytics.sessions-daily' : 'google-analytics.sessions-daily-report', version: '2', group: 'google-analytics', operation: 'sessions-daily',
  title: grandTotal ? 'Google Analytics 4 sessions by date (with Grand total row)' : 'Google Analytics 4 sessions by date (report download)', decoder: 'ga4-csv',
  fields: {
    date: { from: ['Date'], type: 'date', required: true, dateFormats: ['YMD8', 'ISO'] },
    sessions: { from: ['Sessions'], type: 'integer', required: true },
    users: { from: ['Total users', 'Users', 'Active users'], type: 'integer' },
  },
  measure: { type: 'count', field: 'sessions', unit: 'sessions' },
  identity: ['date'], kind: { constant: 'session' },
  totals: grandTotal ? { kind: 'footer-row', labelField: 'date', labels: ['Grand total'], amountFields: ['sessions'] } : { kind: 'report' },
  ...(grandTotal ? {} : { exclude: { field: 'date', values: ['Grand total', 'Total'] } }),
  ignored: ['New users', 'Engaged sessions', 'Engagement rate', 'Average engagement time per session', 'Engaged sessions per user', 'Events per session', 'Event count',
    'Key events', 'Conversions', 'Total revenue'],
  notices: ['Sessions are as GA4 reports them, after its own sampling and consent rules. They are visits, not people.',
    'Users are not added up across days, because one person can visit on many days.',
    ...(grandTotal
      ? ['Checked against the file\'s "Grand total" row. The public GA4 report downloads seen carry no such row; for those use the report-download recipe.',
        `Layout still unconfirmed: no public sample with a Grand total row found (the "#" comment header was checked against ${GA4_SOURCE}).`]
      : ['GA4 report downloads carry no total row, so enter the sessions total GA4 shows for the same dates and filters.', checkedAgainst(GA4_SOURCE)]),
  ],
  sensitivity: 'operational',
});

export const RECIPES: readonly SourceRecipe[] = [
  metaRecipe(true),
  metaRecipe(false),
  {
    id: 'google-ads.campaign-daily', version: '2', group: 'google-ads', operation: 'campaign-daily', title: 'Google Ads campaign report by day', decoder: 'google-ads-report',
    fields: {
      date: { from: ['Day'], type: 'date', required: true, dateFormats: ['ISO'] },
      campaign: { from: ['Campaign'], type: 'text', required: true },
      currency: { from: ['Currency code', 'Currency'], type: 'text' },
      cost: { from: ['Cost'], type: 'money', required: true },
      impressions: { from: ['Impr.', 'Impressions'], type: 'integer' },
      clicks: { from: ['Clicks'], type: 'integer' },
      costType: { from: ['(added) cost type'], type: 'text' },
      rowLabel: { from: [ROW_LABEL_HEADING], type: 'text' },
    },
    measure: { type: 'money', amount: { field: 'cost' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['campaign', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType', description: 'campaign', marketingMinor: 'cost' },
    totals: { kind: 'footer-row', labelField: 'rowLabel', labels: ['Total: Account'], amountFields: ['cost'] },
    ignored: ['Campaign status', 'Campaign type', 'Campaign state', 'Budget', 'Budget name', 'Budget type', 'Status', 'Status reasons', 'Optimization score', 'Bid strategy type',
      'Avg. CPC', 'CTR', 'Interactions', 'Interaction rate', 'Avg. cost', 'Conversions', 'Cost / conv.', 'Conv. rate', 'Conv. value', 'Conv. value / cost', 'All conv.'],
    notices: ['Ad spend is the platform\'s reported cost, not the invoiced amount. GST and invalid-click credits are not included.',
      'The report is checked against its overall "Total: Account" row. Per-day and per-channel total rows are subtotals: they are never read as campaigns.',
      checkedAgainst('https://github.com/dwolfe1966/pds/blob/69b248766e2c68297309c78758f30ee8b3fe8911/docs/reporting/Campaign%20report.csv')],
    sensitivity: 'financial',
  },
  ga4Recipe(true),
  ga4Recipe(false),
  {
    id: 'youtube-analytics.views-daily', version: '1', group: 'youtube-analytics', operation: 'views-daily', title: 'YouTube Studio views by date', decoder: 'csv-totals-anywhere',
    fields: {
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['ISO'] },
      views: { from: ['Views'], type: 'integer', required: true },
    },
    measure: { type: 'count', field: 'views', unit: 'views' },
    identity: ['date'], kind: { constant: 'view' },
    totals: { kind: 'footer-row', labelField: 'date', labels: ['Total'], amountFields: ['views'] },
    ignored: ['Watch time (hours)', 'Subscribers', 'Impressions', 'Average view duration'],
    notices: ['Views are as YouTube Studio reports them and can be revised for a few days after the date.',
      'Estimated revenue in this export is not imported: it is an estimate, not a payment.',
      'The "Table data.csv" of an Advanced mode report by Date puts its Total row first and lists days newest first.',
      checkedAgainst('https://github.com/billmengg/YTAnalytics/blob/f3ad2bf243419bb9fcaf4c39e78a60cafc4bcf9c/Date.csv')],
    sensitivity: 'operational',
  },
  {
    id: 'instagram-insights.reach-daily', version: '1', group: 'instagram-insights', operation: 'reach-daily', title: 'Instagram reach by date (Meta Business Suite)', decoder: 'csv',
    fields: {
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME', 'ISO'] },
      reach: { from: ['Primary', 'Reach', 'Instagram reach'], type: 'integer', required: true },
    },
    measure: { type: 'count', field: 'reach', unit: 'accounts_reached' },
    identity: ['date'], kind: { constant: 'reach' },
    totals: { kind: 'report' },
    notices: ['Daily reach counts unique accounts each day. Adding days together counts the same person more than once.',
      'The export has no total, so enter the reach Meta Business Suite shows for the same dates.', UNCONFIRMED],
    sensitivity: 'operational',
  },
  {
    id: 'mailchimp.campaigns', version: '2', group: 'mailchimp', operation: 'campaigns', title: 'Mailchimp campaign reports export', decoder: 'mailchimp-csv',
    fields: {
      uniqueId: { from: ['Unique Id'], type: 'text', required: true },
      title: { from: ['Title', 'Campaign'], type: 'text', required: true },
      date: { from: ['Send Date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME', 'ISO'] },
      recipients: { from: ['Total Recipients', 'Emails sent'], type: 'integer', required: true },
      opens: { from: ['Unique Opens'], type: 'integer' },
      clicks: { from: ['Unique Clicks'], type: 'integer' },
    },
    measure: { type: 'count', field: 'recipients', unit: 'emails' },
    identity: ['uniqueId'], kind: { constant: 'email_campaign' },
    outputs: { description: 'title' },
    totals: { kind: 'report' },
    ignored: ['Subject', 'List', 'Audience', 'Send Weekday', 'Successful Deliveries', 'Soft Bounces', 'Hard Bounces', 'Total Bounces', 'Times Forwarded', 'Forwarded Opens',
      'Open Rate', 'Total Opens', 'Click Rate', 'Total Clicks', 'Unsubscribes', 'Abuse Complaints', 'Times Liked on Facebook', 'Folder Id', 'Total Orders', 'Total Gross Sales', 'Total Revenue'],
    notices: ['Emails sent counts every recipient a campaign was sent to, including later bounces.',
      'Opens are not a reliable count because mail apps preload images; they are carried as campaign detail only.',
      'Each campaign is identified by Mailchimp\'s own Unique Id. Send Date ("Mar 20, 2020 01:00 pm", in the account\'s time zone) is read as its calendar date by the decoder.',
      checkedAgainst('https://github.com/oscarotero/oscarotero.gal/blob/21ddf7ae2d66455d50059bd912f6ee6959a0a969/_conxeito/campaigns.csv')],
    sensitivity: 'operational',
  },
];
