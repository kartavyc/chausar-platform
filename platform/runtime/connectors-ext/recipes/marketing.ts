import type { Decoder, SourceRecipe } from '../recipe.ts';
import { tabularDecoder } from './operations.ts';

/**
 * Marketing exports: ad spend and audience counts. Spend is money; reach, sessions, views and
 * emails are counts with a stated unit, never money.
 */
export const DECODERS: readonly Decoder[] = [
  /** Ads Manager and similar spend exports: every row is advertising cost. */
  tabularDecoder({ id: 'csv-ad-spend', added: { '(added) cost type': 'advertising' } }),
  /** Google Ads reports: title lines, then the table, then several "Total: ..." rows. */
  tabularDecoder({ id: 'google-ads-report', totalsAnywhere: true, added: { '(added) cost type': 'advertising' } }),
  /** GA4 exports: "#" comment lines around the table and a "Grand total" row. */
  tabularDecoder({ id: 'ga4-csv', commentPrefix: '#', totalsAnywhere: true }),
  /** Exports whose total row can sit anywhere in the table (YouTube Studio puts it first). */
  tabularDecoder({ id: 'csv-totals-anywhere', totalsAnywhere: true }),
];

export const RECIPES: readonly SourceRecipe[] = [
  {
    id: 'meta-ads.campaign-daily', version: '1', group: 'meta-ads', operation: 'campaign-daily', title: 'Meta Ads Manager campaign report by day', decoder: 'csv-ad-spend',
    fields: {
      campaign: { from: ['Campaign name'], type: 'text', required: true },
      date: { from: ['Day'], type: 'date', required: true, dateFormats: ['ISO'] },
      spend: { from: ['Amount spent (INR)'], type: 'money', required: true },
      impressions: { from: ['Impressions'], type: 'integer' },
      results: { from: ['Results'], type: 'integer' },
      costType: { from: ['(added) cost type'], type: 'text' },
    },
    measure: { type: 'money', amount: { field: 'spend' }, currency: { constant: 'INR' }, unit: 'major' },
    identity: ['campaign', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType', description: 'campaign', marketingMinor: 'spend' },
    totals: { kind: 'report' },
    ignored: ['Reporting starts', 'Reporting ends', 'Campaign delivery', 'Result indicator', 'Cost per result', 'Ends'],
    notices: ['Ad spend is the platform\'s reported spend, not the invoiced amount. GST on Meta invoices is not included.',
      'This export is read without its summary row, so enter the total spend Ads Manager shows for the same dates.',
      'Results mean different actions for different campaign objectives and are not imported as one count.'],
    sensitivity: 'financial',
  },
  {
    id: 'google-ads.campaign-daily', version: '1', group: 'google-ads', operation: 'campaign-daily', title: 'Google Ads campaign report by day', decoder: 'google-ads-report',
    fields: {
      date: { from: ['Day'], type: 'date', required: true, dateFormats: ['ISO'] },
      campaign: { from: ['Campaign'], type: 'text', required: true },
      currency: { from: ['Currency code', 'Currency'], type: 'text' },
      cost: { from: ['Cost'], type: 'money', required: true },
      impressions: { from: ['Impr.', 'Impressions'], type: 'integer' },
      clicks: { from: ['Clicks'], type: 'integer' },
      costType: { from: ['(added) cost type'], type: 'text' },
    },
    measure: { type: 'money', amount: { field: 'cost' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['campaign', 'date'], kind: { constant: 'cost' },
    outputs: { costType: 'costType', description: 'campaign', marketingMinor: 'cost' },
    totals: { kind: 'footer-row', labelField: 'date', labels: ['Total: Account'], amountFields: ['cost'] },
    ignored: ['Campaign type', 'Campaign state', 'Avg. CPC', 'CTR'],
    notices: ['Ad spend is the platform\'s reported cost, not the invoiced amount. GST and invalid-click credits are not included.',
      'The report is checked against its "Total: Account" row; per-channel total rows are read as totals, never as campaigns.'],
    sensitivity: 'financial',
  },
  {
    id: 'google-analytics.sessions-daily', version: '1', group: 'google-analytics', operation: 'sessions-daily', title: 'Google Analytics 4 sessions by date', decoder: 'ga4-csv',
    fields: {
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['YMD8', 'ISO'] },
      sessions: { from: ['Sessions'], type: 'integer', required: true },
      users: { from: ['Total users', 'Users', 'Active users'], type: 'integer' },
    },
    measure: { type: 'count', field: 'sessions', unit: 'sessions' },
    identity: ['date'], kind: { constant: 'session' },
    totals: { kind: 'footer-row', labelField: 'date', labels: ['Grand total'], amountFields: ['sessions'] },
    ignored: ['New users', 'Engaged sessions', 'Engagement rate'],
    notices: ['Sessions are as GA4 reports them, after its own sampling and consent rules. They are visits, not people.',
      'Users are not added up across days, because one person can visit on many days.'],
    sensitivity: 'operational',
  },
  {
    id: 'youtube-analytics.views-daily', version: '1', group: 'youtube-analytics', operation: 'views-daily', title: 'YouTube Studio views by date', decoder: 'csv-totals-anywhere',
    fields: {
      date: { from: ['Date'], type: 'date', required: true, dateFormats: ['ISO'] },
      views: { from: ['Views'], type: 'integer', required: true },
    },
    measure: { type: 'count', field: 'views', unit: 'views' },
    identity: ['date'], kind: { constant: 'view' },
    totals: { kind: 'footer-row', labelField: 'date', labels: ['Total'], amountFields: ['views'] },
    ignored: ['Watch time (hours)', 'Subscribers', 'Impressions'],
    notices: ['Views are as YouTube Studio reports them and can be revised for a few days after the date.',
      'Estimated revenue in this export is not imported: it is an estimate, not a payment.'],
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
      'The export has no total, so enter the reach Meta Business Suite shows for the same dates.'],
    sensitivity: 'operational',
  },
  {
    id: 'mailchimp.campaigns', version: '1', group: 'mailchimp', operation: 'campaigns', title: 'Mailchimp campaign reports export', decoder: 'csv',
    fields: {
      title: { from: ['Title', 'Campaign'], type: 'text', required: true },
      date: { from: ['Send Date'], type: 'date', required: true, dateFormats: ['ISO-DATETIME'] },
      recipients: { from: ['Total Recipients', 'Emails sent'], type: 'integer', required: true },
      opens: { from: ['Unique Opens'], type: 'integer' },
      clicks: { from: ['Unique Clicks'], type: 'integer' },
    },
    measure: { type: 'count', field: 'recipients', unit: 'emails' },
    identity: ['title', 'date'], kind: { constant: 'email_campaign' },
    outputs: { description: 'title' },
    totals: { kind: 'report' },
    ignored: ['Subject', 'List', 'Send Weekday', 'Successful Deliveries', 'Soft Bounces', 'Hard Bounces', 'Open Rate', 'Click Rate', 'Unsubscribes'],
    notices: ['Emails sent counts every recipient a campaign was sent to, including later bounces.',
      'Opens are not a reliable count because mail apps preload images; they are carried as campaign detail only.'],
    sensitivity: 'operational',
  },
];
