import type { Decoder, SourceRecipe } from '../recipe.ts';

/**
 * CRM deal recipes over records from adapters/crm. A won deal is a sales commitment, not earned
 * revenue: it maps to 'deal_won', never to 'sale' or 'invoice'. Open stages map to 'deal_open' and
 * lost stages to 'deal_lost'. A custom stage the recipe does not know is asked about, not guessed.
 */
const NOT_REVENUE = 'A won deal is not revenue until it is invoiced. Deals are kept as deal_won, deal_open or deal_lost, never as sales.';
const NO_AMOUNT = 'Deals without an amount are left out and counted as excluded; they are not counted as zero.';
export const RECIPES: readonly SourceRecipe[] = [
  {
    id: 'zoho-crm.deals', version: '1', group: 'zoho-crm', operation: 'deals', title: 'Zoho CRM deals', decoder: 'api-records',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      name: { from: ['Deal_Name'], type: 'text' },
      amount: { from: ['Amount'], type: 'money', required: true },
      amountState: { from: ['amountState'], type: 'text', required: true },
      stage: { from: ['Stage'], type: 'text', required: true },
      date: { from: ['Closing_Date'], type: 'date', required: true, dateFormats: ['ISO'] },
      currency: { from: ['Currency'], type: 'text', required: true },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['id'],
    kind: { field: 'stage', values: {
      Qualification: 'deal_open', 'Needs Analysis': 'deal_open', 'Value Proposition': 'deal_open', 'Identify Decision Makers': 'deal_open',
      'Id. Decision Makers': 'deal_open', 'Perception Analysis': 'deal_open', 'Proposal/Price Quote': 'deal_open', 'Negotiation/Review': 'deal_open',
      'Closed Won': 'deal_won', 'Closed Lost': 'deal_lost', 'Closed-Lost to Competition': 'deal_lost' } },
    exclude: { field: 'amountState', values: ['missing'] },
    outputs: { description: 'name' },
    totals: { kind: 'report' },
    notices: [NOT_REVENUE, NO_AMOUNT, 'The date is the deal\'s closing date. Zoho CRM does not state a deal total; enter the total from a Zoho CRM report.'],
    sensitivity: 'financial',
  },
  {
    id: 'hubspot.deals', version: '1', group: 'hubspot', operation: 'deals', title: 'HubSpot deals closing in a period', decoder: 'api-records',
    fields: {
      id: { from: ['id'], type: 'text', required: true },
      name: { from: ['dealname'], type: 'text' },
      amount: { from: ['amount'], type: 'money', required: true },
      amountState: { from: ['amountState'], type: 'text', required: true },
      stage: { from: ['dealstage'], type: 'text', required: true },
      date: { from: ['closeDateMs'], type: 'date', required: true, dateFormats: ['EPOCH-MS-IST'] },
      currency: { from: ['currency'], type: 'text', required: true },
    },
    measure: { type: 'money', amount: { field: 'amount' }, currency: { field: 'currency' }, unit: 'major' },
    identity: ['id'],
    kind: { field: 'stage', values: {
      appointmentscheduled: 'deal_open', qualifiedtobuy: 'deal_open', presentationscheduled: 'deal_open', decisionmakerboughtin: 'deal_open',
      contractsent: 'deal_open', closedwon: 'deal_won', closedlost: 'deal_lost' } },
    exclude: { field: 'amountState', values: ['missing'] },
    outputs: { description: 'name' },
    ignored: ['closedate'],
    // The search `total` is HubSpot's count of deals matching exactly the filter read.
    totals: { kind: 'report', declaredCount: 'accepts' },
    notices: [NOT_REVENUE, NO_AMOUNT, 'HubSpot states how many deals matched, and a read that returns a different number is refused; it does not state their total, so enter it from a HubSpot report to check the amount as well.',
      'Close dates are read as India Standard Time calendar days.'],
    sensitivity: 'financial',
  },
];
export const DECODERS: readonly Decoder[] = [];
