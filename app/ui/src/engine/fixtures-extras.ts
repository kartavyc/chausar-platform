/**
 * Sample data for the last screens: Money at a glance, the tax working, spend settings, the CA firm page, leads,
 * website edits and preview links. Every figure is written as the engine would format it; the UI never computes one.
 */

import type { CaReceiptView, CaView, LeadView, MoneyOverviewLine, SpendPolicyView, TaxWorking } from './types';

/** Money at a glance per business, except "Clients owe you", which the money desk reads from its open invoices. */
export const OVERVIEW: Record<string, MoneyOverviewLine[]> = {
  lumen: [
    { id: 'received', label: 'Came in this month', value: '₹86,200.00', receiptId: 'R-0402' },
    { id: 'spent', label: 'AI and tools this month', value: '₹60.10, includes estimates', receiptId: 'R-0431', estimate: true },
  ],
  ledgerline: [
    { id: 'received', label: 'Came in this month', value: '₹0.00', receiptId: 'R-0402' },
    { id: 'spent', label: 'AI and tools this month', value: '₹33.50', receiptId: 'R-0412' },
  ],
};

/** The tax working per business, as the calculator wrote it. Lumen is not registered for GST. */
export const TAX_WORKINGS: Record<string, TaxWorking> = {
  lumen: {
    period: 'October 2026', needsCaConfirmation: false,
    // The shape the real engine's plain working sends (money/tax-working.ts plainWorking): one 'tax' section.
    sections: [{
      id: 'tax', title: 'GST',
      lines: [{ label: 'What your plan says', value: 'You do not charge GST' }, { label: 'GST on invoices issued in October 2026', value: 'No invoices issued' }],
      note: 'Billed and earned leave out tax. Received is the cash that came in, tax included.',
    }],
  },
  ledgerline: {
    period: 'September 2026', needsCaConfirmation: true,
    sections: [
      {
        id: 'output', title: 'GST on your sales',
        lines: [
          { label: 'Taxable value', value: '₹16,000.00', receiptId: 'R-0419' },
          { label: 'CGST at 9%', value: '₹1,440.00', receiptId: 'R-0419' },
          { label: 'SGST at 9%', value: '₹1,440.00', receiptId: 'R-0419' },
        ],
      },
      { id: 'input', title: 'GST you paid on purchases', lines: [{ label: 'Input credit', value: '₹0.00' }], note: 'No purchase bills were uploaded for September.' },
      {
        id: 'payable', title: 'To pay',
        lines: [{ label: 'CGST', value: '₹1,440.00', receiptId: 'R-0419' }, { label: 'SGST', value: '₹1,440.00', receiptId: 'R-0419' }],
        note: 'Rates from the GST table version 3. Your CA confirms it before anything is filed.',
      },
    ],
  },
};

/** The owner's spend settings. Lumen has a monthly limit and an ask-first figure; Ledgerline has neither. */
export const SPEND_POLICIES: Record<string, SpendPolicyView> = {
  lumen: {
    capMicros: '20000000', askFirstMicros: '2000000', capUsd: '20.00', askFirstUsd: '2.00', cap: 'USD 20.0000 a month', askFirst: 'Asks you first above USD 2.0000', setAt: '2026-10-14T10:00:00.000Z',
    inrPerUsd: null, rupeeRate: null,
    rates: [
      {
        item: 'model:anthropic-api', unit: 'per-million-tokens', inputMicrosPerMillion: '3000000', outputMicrosPerMillion: '15000000', microsPerCall: null,
        inputUsdPerMillion: '3.00', outputUsdPerMillion: '15.00', usdPerCall: null,
        source: 'Anthropic pricing page', checkedOn: '2026-10-14', confirmed: true, by: 'owner', price: 'USD 3.0000 in and USD 15.0000 out, per million tokens',
      },
    ],
  },
  ledgerline: { capMicros: null, askFirstMicros: null, capUsd: null, askFirstUsd: null, cap: 'No monthly limit', askFirst: 'Never asks first', rates: [], setAt: null, inrPerUsd: null, rupeeRate: null },
};

/** The CA firm page for Ledgerline. Requests appear here once sent to the CA (from Today's sign-off row). */
export const CA_VIEWS: Record<string, CaView> = {
  ledgerline: {
    ca: { name: 'Meera Joshi', membershipNo: '412345' },
    pendingRates: [
      {
        tableId: 'gst-services', title: 'GST rates for services', version: '3', validFrom: '2025-09-22', validTo: null,
        citations: ['CBIC rate notification for services, September 2025'],
      },
      {
        tableId: 'tds-2026', title: 'TDS rates, 2026-27', version: '1', validFrom: '2026-04-01', validTo: '2027-03-31',
        citations: ['Income-tax Act, 2025, TDS rate table', 'Section numbers changed in April 2026: your CA confirms them'],
      },
    ],
    requests: [
      { id: 'ca-req-tds-q2', deliveryId: 'd-mehta-sep', title: 'TDS working, July to September', state: 'signed', at: '2026-10-18T11:00:00.000Z' },
    ],
    latestPapers: { deliveryId: 'd-mehta-sep', title: 'GST working papers for Mehta Traders', receiptIds: ['w-gst-sep', 'w-portal-sep'] },
  },
};

/** Stored CA receipts (venture.ca.receipt), as the engine works each one again: one the same, one that differs. */
export const CA_RECEIPTS: Record<string, Record<string, CaReceiptView>> = {
  ledgerline: {
    'w-gst-sep': {
      id: 'w-gst-sep', runId: 'd-mehta-sep', engine: 'gst-working',
      figures: [{ key: 'output-igst', label: 'Output IGST', display: 'INR 900.00' }, { key: 'net-payable', label: 'Net payable', display: 'INR 2,825.00' }],
      steps: [{ key: 'net-payable', label: 'Net payable', display: 'INR 2,825.00', section: '49' }],
      tables: [{ id: 'in-gst-rates', version: 2, title: 'GST rates and the GSTR-1 large invoice threshold', validFrom: '2025-09-22', validTo: null, confirmed: true, confirmedBy: 'Meera Joshi (ICAI 412345)' }],
      assumptions: [], openQuestions: [], rederived: 'same', differs: null, explanations: [],
    },
    'w-portal-sep': {
      id: 'w-portal-sep', runId: 'd-mehta-sep', engine: 'portal-diff',
      figures: [{ key: 'net-payable', label: 'Net payable: the portal less ours', display: 'INR 80.00' }],
      steps: [{ key: 'net-payable', label: 'Net payable: the portal less ours', display: 'INR 80.00', section: null }],
      tables: [], assumptions: ['Figures are compared by key, to the paisa.'], openQuestions: [], rederived: 'differs',
      // Worked again from its inputs, the stored difference was changed after it was made: the engine's own line.
      differs: { key: 'net-payable', line: 'Net payable: the portal less ours: the stored receipt has INR 80.00; worked again it is INR 75.00.' }, explanations: [],
      portalDifferences: [{ key: 'net-payable', label: 'Net payable', state: 'differs', ours: 'INR 2,825.00', portal: 'INR 2,900.00', explanation: null }],
    },
  },
};

/** The sign-off requests Today's rows point at (venture.queue.view kind 'file'), by request id. */
export const CA_REQUEST_TITLES: Record<string, { deliveryId: string; title: string }> = {
  'ca-req-gst-sep': { deliveryId: 'd-mehta-sep', title: 'GST working for September' },
};

/** Leads per business. An email counts once a mail server answered for its domain. */
export const LEADS: Record<string, LeadView[]> = {
  lumen: [
    {
      id: 'lead-kite', name: 'Kabir Shah', company: 'Studio Kite', email: 'kabir@studiokite.co', emailDomain: 'studiokite.co', sourceUrl: 'https://studiokite.co/team',
      emailCheck: { status: 'unverified', at: null, line: 'Not checked yet: no mail server answered for studiokite.co.' },
      status: 'new', drafts: [], sends: [], moves: [], addedBy: 'owner', addedAt: '2026-10-20T15:00:00.000Z',
    },
    {
      id: 'lead-pocket', name: 'Asha Rao', company: 'Pocket Audio', email: 'asha@pocketaudio.in', emailDomain: 'pocketaudio.in', sourceUrl: 'https://pocketaudio.in/about',
      emailCheck: { status: 'verified', at: '2026-10-19T10:00:00.000Z', line: 'A mail server answers for pocketaudio.in.' },
      status: 'new', drafts: [], sends: [], moves: [], addedBy: 'owner', addedAt: '2026-10-19T10:00:00.000Z',
    },
  ],
  ledgerline: [],
};

/** The postal address each business's outreach carries, set by the owner. */
export const POSTAL_ADDRESSES: Record<string, string | null> = {
  lumen: 'Lumen Studio, 14 Lane 5, Koregaon Park, Pune 411001',
  ledgerline: null,
};

/** Website files the sample site holds, for staged edits (venture.site.stage reads the current text as "before"). */
export const SITE_FILES: Record<string, Record<string, string>> = {
  lumen: {
    'index.html': '<h1>Lumen Studio</h1>\n<p>Budget gear, tested honestly.</p>\n<p>New episodes every Friday.</p>',
    'sponsor.html': '<h1>Sponsor with us</h1>\n<p>Two mentions per episode.</p>\n<p>Write to partners@lumenstudio.in</p>',
  },
  ledgerline: {},
};
