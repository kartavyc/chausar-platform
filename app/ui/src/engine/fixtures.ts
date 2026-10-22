/**
 * Sample data for the fake engine: two businesses on this computer, "Lumen Studio" (a YouTube channel) and
 * "Ledgerline" (a CA firm), plus "Sitara Events", which needs its passphrase and so shows as a locked row.
 * Every figure is written here as the engine would format it; the UI never computes one.
 */

import type { AgentView, BooksSummaryLite, BusinessOnComputer, ClientLite, ConnectorCardLite, DeliveryLite, EvidenceItem, JournalEntry, OrderLite, QueueRow, ReceiptLite, RunDetail, ServiceType, SpendRow, UploadLite } from './types';

import type { CountryLite } from './types';

export interface FakeBusiness { id: string; name: string; serviceType: ServiceType; opens: BusinessOnComputer['opens'] }

export const BUSINESSES: FakeBusiness[] = [
  { id: 'lumen', name: 'Lumen Studio', serviceType: 'content', opens: 'with-this-computer' },
  { id: 'ledgerline', name: 'Ledgerline', serviceType: 'bookkeeping', opens: 'with-this-computer' },
  { id: 'sitara', name: 'Sitara Events', serviceType: 'agency', opens: 'needs-passphrase' },
];

/**
 * Onboarding sample data, copied from the engine (platform/runtime/venture/core/countries.ts, service-types.ts and
 * contracts.ts SERVICE_TYPE_LABELS), so the fake answers venture.countries and venture.preview the way the engine does.
 */
export const COUNTRIES: CountryLite[] = [
  { code: 'IN', name: 'India', currency: 'INR' }, { code: 'US', name: 'United States', currency: 'USD' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP' }, { code: 'CA', name: 'Canada', currency: 'CAD' },
  { code: 'AU', name: 'Australia', currency: 'AUD' }, { code: 'NZ', name: 'New Zealand', currency: 'NZD' },
  { code: 'SG', name: 'Singapore', currency: 'SGD' }, { code: 'AE', name: 'United Arab Emirates', currency: 'AED' },
  { code: 'DE', name: 'Germany', currency: 'EUR' }, { code: 'FR', name: 'France', currency: 'EUR' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR' }, { code: 'IE', name: 'Ireland', currency: 'EUR' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR' }, { code: 'JP', name: 'Japan', currency: 'JPY' },
  { code: 'XX', name: 'Another country (prices in US dollars)', currency: 'USD' },
];
export const SERVICE_LABELS: Readonly<Record<ServiceType, string>> = {
  agency: 'Marketing agency', studio: 'Creative studio', consulting: 'Consulting practice', bookkeeping: 'Bookkeeping studio',
  research: 'Research desk', content: 'Content shop', support: 'Support team for hire', other: 'Service business',
};
export const SERVICE_KEYWORDS: Readonly<Record<Exclude<ServiceType, 'other'>, readonly string[]>> = {
  agency: ['marketing', 'ads', 'advert', 'social media', 'agency', 'leads', 'outreach', 'growth', 'campaign'],
  studio: ['podcast', 'video', 'design', 'edit', 'photo', 'logo', 'brand', 'studio', 'animation'],
  consulting: ['consult', 'advis', 'coach', 'strategy', 'audit', 'mentor'],
  bookkeeping: ['bookkeep', 'accounts', 'accounting', 'gst', 'tax', 'ledger', 'payroll', 'invoice', 'books'],
  research: ['research', 'lead list', 'market', 'report', 'analysis', 'data', 'survey'],
  content: ['blog', 'newsletter', 'copy', 'writing', 'seo', 'article', 'content', 'script'],
  support: ['support', 'customer service', 'inbox', 'helpdesk', 'help desk', 'chat', 'tickets'],
};
/** The words the engine's queue view uses for a new business (platform/runtime/venture/views/queue.ts). */
export const NEW_BUSINESS_ROWS = {
  plan: { title: 'Your plan is ready. Read it.', read: 'Read', accept: 'Accept' },
  ai: { title: 'Connect your AI', line: 'Templates work without one. Your agents draft with your AI once it is connected.', action: 'Connect' },
  // The prices row has three wordings: no price yet, tax assumed by Chausar, or both (views/queue.ts setupRows).
  prices: {
    set: { title: 'Set your prices', action: 'Set prices' },
    tax: { title: 'Confirm your tax', action: 'Confirm tax' },
    both: { title: 'Confirm your prices and tax', action: 'Confirm' },
  },
  keep: { title: 'Keep this business', line: 'Make a recovery code so you can open it if this computer is lost.', action: 'Keep it' },
} as const;
/** The recovery code the fake hands out once, with a passphrase or on hosted. Sample only. */
export const SAMPLE_RECOVERY_CODE = 'K7QM4X2D9PLR8T3WNB6Y5HJC';
/** Sitara Events' passphrase in the sample. Sample only; the real engine never holds one in the clear. */
export const SAMPLE_PASSPHRASE = 'sitara keeps every booking';
/** A move code with the engine's shape: CHT- and 24 characters from its alphabet. Sample only. */
export const SAMPLE_MOVE_CODE = 'CHT-7QM4X2D9PLR8T3WNB6Y5HJ';
/** CUSTODY_WORDS in platform/runtime/workspace-custody-contracts.ts: the engine's words for its custody refusals. */
export const CUSTODY_ERROR_WORDS = {
  PASSPHRASE_REQUIRED: 'This business is locked with a passphrase. Type it to open.',
  DEVICE_KEY_FAILED: "This computer's key didn't open your business. Use your recovery code, or a backup with it.",
  PASSPHRASE_WRONG: "That passphrase doesn't match.",
  TRANSFER_CODE_WRONG: "That code doesn't open this file. Check it and try again.",
  TRANSFER_INVALID: "This isn't a Chausar move file.",
  TRANSFER_TOO_LARGE: 'This file is bigger than Chausar can take in one go.',
  TRANSFER_SAME_BUSINESS: 'This business is already on this computer. Open it from the list.',
  BACKUP_NOT_FOUND: 'That backup is not in the backups folder.',
  BACKUP_OTHER_BUSINESS: 'This backup belongs to another business.',
} as const;

type RowSeed = Omit<QueueRow, 'digest'>;

export const QUEUE: RowSeed[] = [
  {
    id: 'q-setup-ai', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'setup', createdAt: '2026-10-21T08:00:00.000Z',
    title: 'Connect your AI', line: 'Templates work now. Agents start once an AI is connected.',
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'connect', label: 'Connect', primary: true }],
  },
  {
    id: 'q-plan', businessId: 'ledgerline', businessName: 'Ledgerline', kind: 'plan', createdAt: '2026-10-21T08:05:00.000Z',
    title: 'Your plan is ready. Read it.', line: 'Monthly books, GST working, ITR and TDS preparation. Audit work stays with your CA.',
    viewRef: { kind: 'plan', id: 'plan-ledgerline-1' },
    actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }],
  },
  {
    id: 'q-draft-ep14', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:40:00.000Z',
    title: 'Episode 14 is cut', line: '11 min 42 s. Watch it before approving.',
    viewRef: { kind: 'draft', id: 'draft-ep14' },
    actions: [{ id: 'watch', label: 'Watch', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
  },
  {
    id: 'q-price-sponsor', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'price', createdAt: '2026-10-21T08:52:00.000Z',
    title: 'Sponsor slot price', line: 'The sponsor asked for two mentions in one episode.',
    change: { label: 'Sponsor slot', before: '₹25,000', after: '₹30,000', receiptId: 'R-0415' },
    actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
  },
  {
    // The engine's CA firm row (playbooks/ca-firm/signoff.ts): read the papers, then send them to the CA of record.
    id: 'q-signoff-gst', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Bookkeeper', kind: 'signoff', createdAt: '2026-10-21T09:10:00.000Z',
    title: 'GST working for September', line: "Needs your CA's sign-off. Nothing regulated leaves Chausar until Meera Joshi signs it.",
    viewRef: { kind: 'file', id: 'ca-req-gst-sep' },
    actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'send-to-ca', label: 'Send to CA', primary: true, requiresView: true }],
  },
  {
    id: 'q-invoice-mehta', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Billing', kind: 'invoice', createdAt: '2026-10-21T09:20:00.000Z',
    title: 'Invoice INV-0042 to Mehta Traders', line: 'Monthly books for September, due in 15 days.',
    change: { label: 'Total', after: '₹18,880.00', receiptId: 'R-0419' },
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'issue', label: 'Issue', primary: true, secondAsk: true }],
  },
  {
    id: 'q-quote-iyer', businessId: 'ledgerline', businessName: 'Ledgerline', agent: 'Billing', kind: 'quote', createdAt: '2026-10-21T09:31:00.000Z',
    title: 'Quote for Iyer & Co, monthly books', line: 'Held for one hour once you approve it.',
    change: { label: 'Monthly fee', before: '₹10,000', after: '₹12,000', receiptId: 'R-0420' },
    actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
  },
  {
    id: 'q-question-title', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Researcher', kind: 'question', createdAt: '2026-10-21T09:45:00.000Z',
    title: 'Which title for episode 15?', line: 'A: "I tried every budget mic". B: "The ₹2,000 mic that beat my ₹20,000 one".',
    change: { label: 'Views in 30 days, option B', before: '12,000', after: '18,000', estimate: true },
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }],
  },
  {
    id: 'q-question-preview', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Producer', kind: 'question', createdAt: '2026-10-21T09:58:00.000Z',
    title: 'The sponsor wants to see the video before it goes up', line: 'Share a private preview link with them?',
    viewRef: { kind: 'run', id: '29' },
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'answer', label: 'Answer', primary: true }],
  },
  {
    // The engine's connector row (posting.ts connectorQueueRows). LinkedIn, not Instagram: posting a picture or video
    // through the browser is not built, so the engine never proposes an Instagram post; a text post is.
    id: 'q-connector-linkedin', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Publisher', kind: 'connector', createdAt: '2026-10-21T10:02:00.000Z',
    title: 'Post to LinkedIn', line: 'From your own browser on this computer. The platform may restrict this account.',
    viewRef: { kind: 'draft', id: 'post-linkedin-ep13' },
    actions: [{ id: 'deny', label: 'Do not post', primary: false }, { id: 'approve', label: 'Approve and post', primary: true, secondAsk: true, requiresView: true }],
  },
  {
    id: 'q-run-again-thumbs', businessId: 'lumen', businessName: 'Lumen Studio', agent: 'Editor', kind: 'question', createdAt: '2026-10-21T10:06:00.000Z',
    title: 'Thumbnail set stopped', line: 'ffmpeg was not found on this computer.',
    viewRef: { kind: 'run', id: '28' },
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'run-again', label: 'Run again', primary: true }],
  },
  {
    id: 'q-locked-sitara', businessId: 'sitara', businessName: 'Sitara Events', kind: 'locked', createdAt: '2026-10-21T10:10:00.000Z',
    title: 'Sitara Events is locked. Open to see what needs you.',
    actions: [{ id: 'open', label: 'Open', primary: true }],
  },
];

/** The other two setup rows a new business gets. Kept out of QUEUE so its counts stay as the shell tests pin them;
 *  pass them with `new FakeEngine({ queue: [...QUEUE, ...SETUP_ROWS] })`. */
export const SETUP_ROWS: RowSeed[] = [
  {
    id: 'q-setup-prices', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'setup', createdAt: '2026-10-21T08:01:00.000Z',
    title: 'Set your prices', line: 'The episode package and the sponsor slot have no price yet.',
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'set-prices', label: 'Set prices', primary: true }],
  },
  {
    id: 'q-setup-keep', businessId: 'lumen', businessName: 'Lumen Studio', kind: 'setup', createdAt: '2026-10-21T08:02:00.000Z',
    title: 'Keep this business', line: 'Make a recovery code so you can open it if this computer is lost.',
    actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'keep', label: 'Keep it', primary: true }],
  },
];

/** What the queue rows' viewRefs open (`venture.queue.view`): the draft to watch, the plan to read, the post to approve. */
export const QUEUE_VIEWS: import('./types').QueueItemView[] = [
  {
    kind: 'draft', id: 'draft-ep14', businessName: 'Lumen Studio', agent: 'Editor', title: 'Episode 14', line: '11 min 42 s, cut from the 52 min recording',
    sections: [
      { heading: 'Chapters', lines: ['00:00 Cold open', '00:48 Why budget mics fail', '04:10 Five mics, one room', '09:30 The winner', '11:05 What to buy'] },
      { heading: 'Checks', lines: ['No black, silent or frozen frames', 'Captions stay clear of faces', 'AI voice: none used'] },
    ],
  },
  {
    kind: 'plan', id: 'plan-ledgerline-1', businessName: 'Ledgerline', title: 'Ledgerline plan', line: 'A CA practice for small traders in Pune',
    sections: [
      { heading: 'Offers', lines: ['Monthly books', 'GST working', 'ITR preparation', 'TDS working'] },
      { heading: 'Stays with your CA', lines: ['Audit and notices', 'Filing or signing on any government portal'] },
    ],
  },
  {
    kind: 'file', id: 'ca-req-gst-sep', businessName: 'Ledgerline', agent: 'Bookkeeper', title: 'GST working for September', line: 'Mehta Traders, worked by the calculator',
    sections: [
      { heading: 'GST on sales', lines: ['Taxable value ₹16,000.00 (R-0419)', 'CGST at 9% ₹1,440.00 (R-0419)', 'SGST at 9% ₹1,440.00 (R-0419)'] },
      { heading: 'Checks', lines: ['The sales register matches the invoices issued', 'Rates from GST table version 3, waiting for your CA'] },
    ],
  },
  {
    kind: 'draft', id: 'post-linkedin-ep13', businessName: 'Lumen Studio', agent: 'Publisher', title: 'LinkedIn post for episode 13', line: 'Posts from your own account, after you approve',
    sections: [
      { heading: 'Post', lines: ['We tested five budget mics in one room. The ₹2,000 one surprised us.', 'Full episode on the channel, link in the comments.'] },
      { heading: 'Attached', lines: ['Short 1 from episode 13, 48 s, 1080 x 1920'] },
    ],
  },
];

const editorSteps =(): RunDetail['steps'] => [
  { id: 's1', purpose: 'Read the transcript', state: 'done', elapsed: '12s', audited: true, tools: [{ name: 'files.read', line: 'episode-13.transcript.txt, 9,412 words' }], evidence: [{ kind: 'file', id: 'f-transcript-13', label: 'transcript' }] },
  { id: 's2', purpose: 'Picked 6 moments, each with a timestamp', state: 'done', elapsed: '48s', audited: true, tools: [{ name: 'model.main', line: 'Asked for moments under 60 s with a clear hook' }, { name: 'check.timestamps', line: '6 of 6 timestamps found in the transcript' }], evidence: [{ kind: 'check', id: 'c-moments-13', label: '6 moments' }] },
  { id: 's3', purpose: 'Checked: no black, silent or frozen frames', state: 'done', elapsed: '20s', audited: true, tools: [{ name: 'ffmpeg.blackdetect', line: 'No black frames' }, { name: 'ffmpeg.silencedetect', line: 'No silence over 2 s' }], evidence: [{ kind: 'check', id: 'c-frames-13', label: 'frame check' }] },
  { id: 's4', purpose: 'Rendering 3 of 6', state: 'current', elapsed: 'now', tools: [{ name: 'ffmpeg.render', line: 'short-3.mp4, 1080 x 1920' }] },
  { id: 's5', purpose: 'Send drafts to you', state: 'pending' },
];

export const RUNS: RunDetail[] = [
  {
    runId: '31', businessId: 'lumen', agent: 'Editor', purpose: 'Cutting shorts from episode 13', state: 'active', startedAt: '2026-10-21T10:20:00.000Z', elapsed: '4m',
    progress: { done: 3, total: 5 }, steps: editorSteps(),
  },
  {
    runId: '30', businessId: 'lumen', agent: 'Researcher', purpose: 'Checking titles against the last 30 videos', state: 'active', startedAt: '2026-10-21T10:23:00.000Z', elapsed: '1m',
    progress: 'indeterminate',
    steps: [
      { id: 's1', purpose: 'Read the last 30 titles and their views', state: 'done', elapsed: '18s', tools: [{ name: 'youtube.read', line: '30 videos, from the channel export you uploaded' }], evidence: [{ kind: 'file', id: 'f-export-oct', label: 'channel export' }] },
      { id: 's2', purpose: 'Comparing the two new titles', state: 'current', elapsed: 'now' },
    ],
  },
  {
    runId: '29', businessId: 'lumen', agent: 'Producer', purpose: 'Pricing the sponsor slot', state: 'waiting', startedAt: '2026-10-21T10:01:00.000Z', elapsed: '6m',
    progress: { done: 2, total: 3 },
    question: { id: 'q-29', text: 'The sponsor wants to see the video before it goes up. Share a private preview link with them?', choices: ['Yes, share a private link', 'No, they see it when it is public'] },
    steps: [
      { id: 's1', purpose: 'Read the sponsor brief', state: 'done', elapsed: '9s', evidence: [{ kind: 'file', id: 'f-brief-sponsor', label: 'sponsor brief' }] },
      { id: 's2', purpose: 'Priced two mentions with the calculator', state: 'done', elapsed: '3s', evidence: [{ kind: 'receipt', id: 'R-0415', label: 'R-0415' }] },
      { id: 's3', purpose: 'Asking you about a preview for the sponsor', state: 'waiting' },
    ],
  },
  {
    runId: '28', businessId: 'lumen', agent: 'Editor', purpose: 'Rendering the thumbnail set', state: 'failed', startedAt: '2026-10-21T09:58:00.000Z', elapsed: '40s',
    progress: { done: 1, total: 3 }, result: 'Stopped: ffmpeg was not found on this computer.',
    error: 'The renderer stopped: ffmpeg was not found on this computer. Install ffmpeg, or turn off the finishing check, then run again.',
    steps: [
      { id: 's1', purpose: 'Picked 3 frames for thumbnails', state: 'done', elapsed: '22s' },
      { id: 's2', purpose: 'Render the thumbnails', state: 'failed', elapsed: '18s', error: 'ffmpeg was not found on this computer.' },
      { id: 's3', purpose: 'Send drafts to you', state: 'pending' },
    ],
  },
  {
    runId: '27', businessId: 'ledgerline', agent: 'Bookkeeper', purpose: 'Matched September bank lines to invoices', state: 'done', startedAt: '2026-10-21T07:30:00.000Z', elapsed: '4m',
    progress: { done: 3, total: 3 }, result: 'Matched 212 of 214 lines. 2 need your data.', receiptId: 'R-0412',
    steps: [
      { id: 's1', purpose: 'Read the bank statement you uploaded', state: 'done', elapsed: '31s', audited: true, evidence: [{ kind: 'file', id: 'f-bank-sep', label: 'bank statement' }] },
      { id: 's2', purpose: 'Matched lines to invoices', state: 'done', elapsed: '3m', audited: true, tools: [{ name: 'books.match', line: '212 matched, 2 left' }] },
      {
        id: 's3', purpose: 'Wrote the reconciliation', state: 'done', elapsed: '20s', audited: true,
        evidence: [
          { kind: 'receipt', id: 'R-0412', label: 'R-0412' },
          // The engine's words for a rules judge that settled nothing (views/runs.ts, delivery/checks.ts rulesJudge).
          { kind: 'check', id: 'rules-judge', label: 'Failed: Not settled: cites-source. A vote without checked evidence never counts as a pass.' },
        ],
      },
    ],
  },
  {
    runId: '26', businessId: 'lumen', agent: 'Researcher', purpose: 'Estimated reach for episode 14', state: 'done', startedAt: '2026-10-21T07:10:00.000Z', elapsed: '2m',
    progress: { done: 2, total: 2 }, result: 'About 18,000 views in 30 days', estimate: true,
    steps: [
      { id: 's1', purpose: 'Read views for the last 30 videos', state: 'done', elapsed: '40s' },
      { id: 's2', purpose: 'Wrote an estimate', state: 'done', elapsed: '1m' },
    ],
  },
];

export const AGENTS: Record<string, AgentView[]> = {
  lumen: [
    {
      id: 'editor', name: 'Editor', role: 'Cuts episodes and shorts', now: 'Cutting shorts from episode 13', posture: 'approve-each', spend: '₹42.10 this month',
      last: { line: 'Episode 14 cut, 11 min 42 s' },
      steps: [
        { id: 'cut', purpose: 'Cut the episode', gate: 'auto', floor: false },
        { id: 'shorts', purpose: 'Cut shorts from the episode', gate: 'auto', floor: false },
        { id: 'finish', purpose: 'Finishing check', gate: 'hold', floor: false },
        { id: 'publish', purpose: 'Publish to YouTube', gate: 'hold', floor: true },
      ],
    },
    {
      id: 'researcher', name: 'Researcher', role: 'Titles, hooks and thumbnails', now: 'Checking titles against the last 30 videos', posture: 'shadow', spend: '₹18.00 reserved',
      last: { line: 'About 18,000 views in 30 days', estimate: true },
      steps: [
        { id: 'titles', purpose: 'Suggest titles', gate: 'auto', floor: false },
        { id: 'thumbs', purpose: 'Pair titles and thumbnails', gate: 'hold', floor: false },
      ],
    },
    {
      id: 'producer', name: 'Producer', role: 'Sponsors and prices', now: 'Waiting on you', posture: 'approve-each', spend: '₹0.00 this month',
      last: { line: 'Priced the sponsor slot', receiptId: 'R-0415' },
      steps: [
        { id: 'brief', purpose: 'Read sponsor briefs', gate: 'auto', floor: false },
        { id: 'price', purpose: 'Change prices', gate: 'hold', floor: true },
        { id: 'send', purpose: 'Send a quote to the sponsor', gate: 'hold', floor: true },
      ],
    },
    {
      id: 'publisher', name: 'Publisher', role: 'Posts to your channels', now: 'Idle', posture: 'rehearsal', spend: '₹0.00 this month',
      steps: [{ id: 'post', purpose: 'Post to Instagram', gate: 'hold', floor: true }],
    },
  ],
  ledgerline: [
    {
      id: 'bookkeeper', name: 'Bookkeeper', role: 'Monthly books and GST working', now: 'Idle', posture: 'approve-each', spend: '₹31.40 this month',
      last: { line: 'Matched 212 of 214 lines', receiptId: 'R-0412' },
      steps: [
        { id: 'match', purpose: 'Match bank lines to invoices', gate: 'auto', floor: false },
        { id: 'gst', purpose: 'Prepare the GST working', gate: 'hold', floor: false },
        { id: 'portal', purpose: 'Anything on the GST portal', gate: 'hold', floor: true },
      ],
    },
    {
      id: 'billing', name: 'Billing', role: 'Invoices and quotes', now: 'Idle', posture: 'approve-each', spend: '₹2.10 this month',
      steps: [
        { id: 'draft', purpose: 'Draft invoices', gate: 'auto', floor: false },
        { id: 'issue', purpose: 'Issue an invoice to a client', gate: 'hold', floor: true },
      ],
    },
  ],
};

export const RECEIPTS: ReceiptLite[] = [
  { id: 'R-0412', at: '2026-10-21T07:34:00.000Z', explanation: 'Bank lines matched to issued invoices by amount, date and reference.', stale: false, figures: [{ key: 'total', label: 'Lines matched', display: '212 of 214' }] },
  {
    id: 'R-0415', at: '2026-10-21T10:04:00.000Z', explanation: 'Two mentions at ₹15,000 each, no discount, priced before tax.', stale: false,
    figures: [{ key: 'unit', label: 'Per mention', display: '₹15,000.00' }, { key: 'subtotal', label: 'Two mentions', display: '₹30,000.00' }, { key: 'total', label: 'Total before tax', display: '₹30,000.00' }],
  },
  {
    id: 'R-0419', at: '2026-10-21T09:20:00.000Z', explanation: 'Monthly books at ₹16,000, GST at 18% split as CGST and SGST.', stale: false,
    figures: [{ key: 'subtotal', label: 'Monthly books', display: '₹16,000.00' }, { key: 'cgst', label: 'CGST at 9%', display: '₹1,440.00' }, { key: 'sgst', label: 'SGST at 9%', display: '₹1,440.00' }, { key: 'total', label: 'Total', display: '₹18,880.00' }],
  },
  { id: 'R-0420', at: '2026-10-21T09:31:00.000Z', explanation: 'Monthly fee for books up to 300 bank lines.', stale: true, figures: [{ key: 'total', label: 'Monthly fee', display: '₹12,000.00' }] },
  {
    id: 'R-0416', at: '2026-10-02T11:00:00.000Z', explanation: 'Two mentions at ₹13,100.00 each, no discount, priced before tax.', stale: false,
    figures: [{ key: 'unit', label: 'Per mention', display: '₹13,100.00' }, { key: 'subtotal', label: 'Two mentions', display: '₹26,200.00' }, { key: 'total', label: 'Total before tax', display: '₹26,200.00' }],
  },
  { id: 'R-0401', at: '2026-10-01T00:00:00.000Z', explanation: 'Invoices issued in October.', stale: false, figures: [{ key: 'total', label: 'Billed', display: '₹1,12,400.00' }] },
  { id: 'R-0402', at: '2026-10-01T00:00:00.000Z', explanation: 'Payments recorded in October.', stale: false, figures: [{ key: 'total', label: 'Received', display: '₹86,200.00' }] },
  { id: 'R-0403', at: '2026-10-01T00:00:00.000Z', explanation: 'Billed less tax for October.', stale: false, figures: [{ key: 'total', label: 'Earned', display: '₹95,254.24' }] },
];

export const BOOKS: Record<string, BooksSummaryLite> = {
  lumen: {
    currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' },
    figures: [
      { operation: 'billed', label: 'Billed', receiptId: 'R-0401', display: '₹1,12,400.00', stale: false },
      { operation: 'received', label: 'Received', receiptId: 'R-0402', display: '₹86,200.00', stale: false },
      { operation: 'earned', label: 'Earned', receiptId: 'R-0403', display: '₹95,254.24', stale: false },
    ],
    openInvoices: [{ invoiceId: 'inv-0039', number: 'INV-0039', clientName: 'Boat Audio', balanceDisplay: '₹26,200.00', dueDate: '2026-10-28' }],
    notes: ['Sample data. Clients pay through links on your site, and you record each payment here.'],
  },
  ledgerline: {
    currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' },
    figures: [
      { operation: 'billed', label: 'Billed', receiptId: 'R-0401', display: '₹1,12,400.00', stale: false },
      { operation: 'received', label: 'Received', receiptId: 'R-0402', display: '₹86,200.00', stale: false },
      { operation: 'earned', label: 'Earned', receiptId: 'R-0403', display: '₹95,254.24', stale: false },
    ],
    openInvoices: [{ invoiceId: 'inv-0041', number: 'INV-0041', clientName: 'Mehta Traders', balanceDisplay: '₹18,880.00', dueDate: '2026-11-05' }],
    notes: ['Sample data. Tax figures come from the calculator and need your CA before filing.'],
  },
};

export const SPEND: SpendRow[] = [
  { id: 'sp1', agent: 'Editor', label: 'Model calls for episode 14', reserved: '₹45.00', settled: '₹42.10', kind: 'billed', receiptId: 'R-0412' },
  { id: 'sp2', agent: 'Researcher', label: 'Title comparison, running', reserved: '₹18.00', kind: 'estimate' },
  { id: 'sp3', connector: 'Instagram', label: 'Paid boost for the short', reserved: 'No price', kind: 'refused', reason: 'Instagram has no price on your rate card, so the call was refused.' },
];

export const JOURNAL: JournalEntry[] = [
  { id: 'j1', action: 'Send invoice', target: 'Mehta Traders', state: 'described', at: '2026-10-21T09:20:00.000Z', line: 'Waiting for your approval' },
  { id: 'j2', action: 'Hold quote', target: 'Iyer & Co', state: 'approved', at: '2026-10-21T09:31:00.000Z', line: 'Approved, held for one hour', receiptId: 'R-0420' },
  { id: 'j3', action: 'Record payment', target: 'Boat Audio', state: 'applied', at: '2026-10-20T16:00:00.000Z', line: 'Recorded ₹86,200.00', receiptId: 'R-0402' },
  { id: 'j4', action: 'Post', target: 'LinkedIn', state: 'rejected', at: '2026-10-19T12:00:00.000Z', line: 'You said no' },
  { id: 'j5', action: 'Send email', target: 'Iyer & Co', state: 'outcome_unknown', at: '2026-10-18T18:00:00.000Z', line: 'The send timed out.' },
];

/**
 * The evidence ledger, newest first, in the engine's shape: subject 'client:<id>', field names as on the client
 * record, types and source lines as platform/runtime/venture/evidence writes them. Only verified evidence is applied
 * on its own; the rest waits as a suggestion. A needs-your-data item has no value: Chausar cannot see it.
 */
export const EVIDENCE: EvidenceItem[] = [
  // Lumen Studio
  { id: 'ev-n3', subject: 'client:c-nimbus', field: 'taxId', value: '', type: 'model-inferred', strength: 'weak', claim: 'needs-your-data', source: 'The AI wrote this, and no tool checked it: ask them for their GSTIN before the first invoice', applied: false },
  { id: 'ev-n2', subject: 'client:c-nimbus', field: 'email', value: 'hello@nimbusmics.in', type: 'model-inferred', strength: 'weak', claim: 'inferred', source: 'Unchecked: the AI said a web page shows this, but Chausar has no web tool yet.', applied: false },
  { id: 'ev-n1', subject: 'client:c-nimbus', field: 'name', value: 'Nimbus Mics', type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true },
  { id: 'ev-b5', subject: 'client:c-boat', field: 'note', value: 'Sponsors two episodes a month.', type: 'model-inferred', strength: 'weak', claim: 'inferred', source: 'The AI wrote this, and no tool checked it: from the sponsor brief', applied: true },
  { id: 'ev-b3', subject: 'client:c-boat', field: 'email', value: 'sponsorships@boataudio.in', type: 'document', strength: 'strong', claim: 'observed', source: 'Read from a file in the run (tc-31-2): signature on the sponsor brief', applied: false },
  { id: 'ev-b4', subject: 'client:c-boat', field: 'taxId', value: '27AABCB4321K1Z3', type: 'document', strength: 'verified', claim: 'observed', source: 'Read from a file in the run (tc-29-1): GST certificate and their invoice header', applied: true },
  { id: 'ev-b2', subject: 'client:c-boat', field: 'email', value: 'partners@boataudio.in', type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true },
  { id: 'ev-b1', subject: 'client:c-boat', field: 'name', value: 'Boat Audio', type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true },
  // Ledgerline
  { id: 'ev3', subject: 'client:c-iyer', field: 'note', value: '', type: 'model-inferred', strength: 'weak', claim: 'needs-your-data', source: 'The AI wrote this, and no tool checked it: how many bank lines a month; their 12 Oct message gives no number', applied: false },
  { id: 'ev2', subject: 'client:c-mehta', field: 'email', value: 'billing@mehtatraders.in', type: 'document', strength: 'strong', claim: 'observed', source: 'Read from a file in the run (tc-27-1): signature in their 14 Oct email', applied: false },
  { id: 'ev1', subject: 'client:c-mehta', field: 'taxId', value: '27AAACM1234F1Z5', type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true },
  { id: 'ev-m1', subject: 'client:c-mehta', field: 'email', value: 'accounts@mehtatraders.in', type: 'owner-entered', strength: 'verified', claim: 'observed', source: 'You entered this.', applied: true },
];

/** Clients per business, newest first, as `venture.client.list` sends them. `owed` is the Ink view field (types.ts). */
export const CLIENTS: Record<string, ClientLite[]> = {
  lumen: [
    { id: 'c-nimbus', at: '2026-10-19T12:00:00.000Z', name: 'Nimbus Mics', email: null, countryCode: 'IN', taxId: null, stateCode: null, note: null },
    {
      id: 'c-boat', at: '2026-09-02T10:00:00.000Z', name: 'Boat Audio', email: 'partners@boataudio.in', countryCode: 'IN', taxId: '27AABCB4321K1Z3', stateCode: '27',
      note: 'Sponsors two episodes a month.', owed: { display: '₹26,200.00', receiptId: 'R-0416' },
    },
  ],
  ledgerline: [
    { id: 'c-iyer', at: '2026-10-12T09:00:00.000Z', name: 'Iyer & Co', email: null, countryCode: 'IN', taxId: null, stateCode: null, note: null },
    {
      id: 'c-mehta', at: '2026-08-01T09:00:00.000Z', name: 'Mehta Traders', email: 'accounts@mehtatraders.in', countryCode: 'IN', taxId: '27AAACM1234F1Z5', stateCode: '27',
      note: null, owed: { display: '₹18,880.00', receiptId: 'R-0419' },
    },
  ],
};

/** Orders per business, newest first. */
export const ORDERS: Record<string, OrderLite[]> = {
  lumen: [
    { id: 'o-boat-14', at: '2026-10-20T09:00:00.000Z', clientId: 'c-boat', offerId: 'offer_sponsor', quantity: '2', request: 'Two mentions in episode 14', status: 'open', priceReceiptId: 'R-0415', deliveredOn: null },
    { id: 'o-boat-12', at: '2026-10-02T11:00:00.000Z', clientId: 'c-boat', offerId: 'offer_sponsor', quantity: '2', request: 'Two mentions in episode 12', status: 'invoiced', priceReceiptId: 'R-0416', deliveredOn: null },
  ],
  ledgerline: [
    { id: 'o-iyer-oct', at: '2026-10-21T09:31:00.000Z', clientId: 'c-iyer', offerId: 'offer_books', quantity: '1', request: 'Monthly books from October', status: 'open', priceReceiptId: 'R-0420', deliveredOn: null },
    { id: 'o-mehta-sep', at: '2026-10-01T09:00:00.000Z', clientId: 'c-mehta', offerId: 'offer_books', quantity: '1', request: 'Monthly books for September', status: 'invoiced', priceReceiptId: 'R-0419', deliveredOn: null },
  ],
};

/** Files clients sent, per business. Practice files belong to rehearsals, not to a client. */
export const UPLOADS: Record<string, UploadLite[]> = {
  lumen: [
    { id: 'u-brief-boat-14', at: '2026-10-20T09:05:00.000Z', name: 'boat-audio-brief-ep14.pdf', format: 'pdf', bytes: 182340, scope: { kind: 'order', orderId: 'o-boat-14' }, clientData: true },
    { id: 'u-practice-1', at: '2026-10-15T09:00:00.000Z', name: 'practice-sponsor-brief.pdf', format: 'pdf', bytes: 40210, scope: { kind: 'practice', scenarioId: 'sc-sponsor-1' }, clientData: false },
  ],
  ledgerline: [
    { id: 'u-bank-mehta-sep', at: '2026-10-02T10:00:00.000Z', name: 'mehta-bank-september.csv', format: 'csv', bytes: 48211, scope: { kind: 'order', orderId: 'o-mehta-sep' }, clientData: true },
    { id: 'u-sales-mehta-sep', at: '2026-10-02T10:01:00.000Z', name: 'mehta-sales-register-september.xlsx', format: 'xlsx', bytes: 91022, scope: { kind: 'order', orderId: 'o-mehta-sep' }, clientData: true },
  ],
};

/** Delivery drafts per business, newest first. Practice drafts are never shown as a client's. */
export const DELIVERIES: Record<string, DeliveryLite[]> = {
  lumen: [
    { id: 'd-ep14-script', at: '2026-10-21T08:30:00.000Z', orderId: 'o-boat-14', status: 'ready-for-review', practice: false, deliverable: { title: 'Sponsor script for episode 14' }, verdict: null },
    { id: 'd-practice-1', at: '2026-10-15T09:10:00.000Z', orderId: 'o-boat-14', status: 'accepted', practice: true, deliverable: { title: 'Practice sponsor script' }, verdict: { choice: 'accepted', at: '2026-10-15T09:20:00.000Z' } },
    { id: 'd-ep12-script', at: '2026-10-03T10:00:00.000Z', orderId: 'o-boat-12', status: 'accepted', practice: false, deliverable: { title: 'Sponsor script for episode 12' }, verdict: { choice: 'accepted', at: '2026-10-03T12:00:00.000Z' } },
  ],
  ledgerline: [
    { id: 'd-mehta-sep', at: '2026-10-05T10:00:00.000Z', orderId: 'o-mehta-sep', status: 'edited', practice: false, deliverable: { title: 'Books for September' }, verdict: { choice: 'edited', at: '2026-10-05T15:00:00.000Z' } },
  ],
};

/** Connectors in the engine's real shape, and the plan, AI and build samples, live in fixtures-business.ts. */
export { CONNECTORS } from './fixtures-business';
