/**
 * Sample data for Connections and the business menu: connectors, Your AI, plan and playbook, prices and website build.
 * Every shape and every sentence is the engine's (platform/runtime/venture/build/connectors.ts, posting.ts, catalogue.ts,
 * models/presets.ts, models/port.ts, build/handoff.ts, build/github.ts). Figures are written as the engine formats them.
 */

import type { BlueprintViewLite, BuildStatusView, ConnectorCardLite, ModelPresetLite, ModelStatusLite, PlaybookPick, PostingOptionLite, ReceiptLite } from './types';

// ---------------------------------------------------------------------------------------------------------------
// Connectors: a representative subset of the catalogue cards, in the engine's order (starters first, then by category, then by name).
// The posting environment is a desktop with Playwright and Chromium present and no app review recorded: a text post
// on X can go through the owner's own browser; Instagram and YouTube stay planned because picture and video
// upload is not built; every API mode and every posting handoff is planned.
// ---------------------------------------------------------------------------------------------------------------

const GI: ('global' | 'india')[] = ['global', 'india'];
const PLANNED_HANDOFF = { mode: 'handoff', status: 'planned', qualification: 'unqualified', what: 'Planned: Chausar will prepare what to paste there. For now, Visit site opens it.' } as const;
const plannedRead = (name: string) => ({ mode: 'read', status: 'planned', qualification: 'unqualified', what: `Planned: reading from ${name}. Not in this build.` } as const);
const plannedWrite = (name: string) => ({ mode: 'write', status: 'planned', qualification: 'unqualified', what: `Planned: writing to ${name}. Not in this build.` } as const);
export const OWNER_SESSION_RISK = 'The platform may restrict this account.';

function postingOptionsFor(name: string, apiRequires: string[], media: boolean, handoffWhat: string): PostingOptionLite[] {
  return [
    { mode: 'api', status: 'planned', qualification: 'unqualified', what: `Posts through the ${name} API after you approve each post.`, risk: null, requires: apiRequires, reason: "Planned until the platform's review of the app is done." },
    {
      mode: 'owner-browser-session', status: media ? 'planned' : 'available', qualification: 'unqualified',
      what: `Posts approved text through your signed-in ${name} browser. Not yet checked against the live site.`,
      risk: OWNER_SESSION_RISK, requires: ['Playwright with Chromium on this computer', `You sign in to ${name} yourself, once, in the Chausar browser window`],
      reason: media ? 'Posting a picture or video through the browser is not built yet.' : null,
    },
    { mode: 'handoff', status: 'planned', qualification: 'unqualified', what: handoffWhat, risk: null, requires: [], reason: 'The engine prepares it, but no screen opens it yet.' },
  ];
}
/** The engine's summary: the first available posting mode, else the owner-browser-session one. */
function posting(options: PostingOptionLite[]): Pick<ConnectorCardLite, 'posting' | 'postingOptions'> {
  const summary = options.find((o) => o.status === 'available') ?? options.find((o) => o.mode === 'owner-browser-session');
  return summary ? { posting: summary, postingOptions: options } : { postingOptions: options };
}

export const CONNECTORS: ConnectorCardLite[] = [
  {
    id: 'github', name: 'GitHub', category: 'build', categoryLabel: 'Build',
    modes: [PLANNED_HANDOFF, { mode: 'read', status: 'available', qualification: 'fixture-tested', what: 'Reads commits, files and checks of one repo. Never writes.' }, { mode: 'write', status: 'planned', qualification: 'unqualified', what: 'Planned: edits you review, applied to your repo only after you grant write access. Chausar only reads today.' }],
    chips: ['read', 'planned: handoff', 'planned: write'], regions: GI, regionNote: null, auth: 'A fine-grained token for one repo, read only', vendorUrl: 'https://github.com/',
    note: 'Where your builder keeps the code. Chausar reads one repo and never pushes to it.', starter: true, postingOptions: [],
  },
  {
    id: 'lovable', name: 'Lovable', category: 'build', categoryLabel: 'Build',
    modes: [{ mode: 'handoff', status: 'available', qualification: 'fixture-tested', what: 'Opens Lovable with your brief filled in. You press send there.' }, plannedRead('Lovable'), plannedWrite('Lovable')],
    chips: ['handoff', 'planned: read', 'planned: write'], regions: GI, regionNote: null, auth: 'None for the brief link', vendorUrl: 'https://lovable.dev/',
    note: 'Builds your website and client area from the brief. Turn on GitHub sync in Lovable so Chausar can follow the code.', starter: true, postingOptions: [],
  },
  {
    id: 'razorpay', name: 'Razorpay', category: 'payments', categoryLabel: 'Payments',
    modes: [PLANNED_HANDOFF, plannedRead('Razorpay'), plannedWrite('Razorpay')],
    chips: ['planned: handoff', 'planned: read', 'planned: write'], regions: ['india'], regionNote: 'Also Malaysia and Singapore, through Curlec.', auth: 'Key id and secret', vendorUrl: 'https://razorpay.com/',
    note: 'The default for businesses in India. International cards need extra approval and Terms, Privacy, Refund and Shipping pages.', starter: true, postingOptions: [],
  },
  {
    id: 'mail-app', name: 'Your own mail app', category: 'email', categoryLabel: 'Email and inbox',
    modes: [{ mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Chausar drafts a reply or an invoice; you send it from your own mail app.' }],
    chips: ['handoff'], regions: GI, regionNote: null, auth: 'None', vendorUrl: null,
    note: 'Chausar drafts the message and you send it from your own mailbox.', starter: true, postingOptions: [],
  },
  {
    id: 'cal-com', name: 'Cal.com', category: 'booking', categoryLabel: 'Booking and calendar',
    modes: [PLANNED_HANDOFF, plannedRead('Cal.com')],
    chips: ['planned: handoff', 'planned: read'], regions: GI, regionNote: null, auth: 'API key', vendorUrl: 'https://cal.com/',
    note: 'A booking page for calls. You can put its link on your site yourself; adding it through the brief is planned.', starter: true, postingOptions: [],
  },
  {
    id: 'chausar-books', name: 'Chausar back office', category: 'books-tax', categoryLabel: 'Books, tax and invoicing',
    modes: [{ mode: 'read', status: 'available', qualification: 'built-in', what: 'Shows invoices, payments and the books inside Chausar, each number with a receipt.' }, { mode: 'write', status: 'available', qualification: 'built-in', what: 'Issues invoices and records payments inside Chausar, each number with a receipt.' }],
    chips: ['read', 'write'], regions: GI, regionNote: null, auth: 'None, it is inside Chausar', vendorUrl: null,
    note: "Invoices, payments and books. Every number comes from Chausar's calculator with a receipt.", starter: true, postingOptions: [],
  },
  {
    id: 'bolt', name: 'Bolt', category: 'build', categoryLabel: 'Build',
    modes: [{ mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Copies your brief. Paste it into Bolt.' }],
    chips: ['handoff'], regions: GI, regionNote: null, auth: 'None', vendorUrl: 'https://bolt.new/',
    note: 'Builds from the brief you paste. Its GitHub sync commits on its own and keeps its own version when there is a conflict.', starter: false, postingOptions: [],
  },
  {
    id: 'replit', name: 'Replit', category: 'build', categoryLabel: 'Build',
    modes: [{ mode: 'handoff', status: 'available', qualification: 'fixture-tested', what: 'Opens Replit with your brief filled in. You press send there.' }],
    chips: ['handoff'], regions: GI, regionNote: null, auth: 'None for the brief link', vendorUrl: 'https://replit.com/',
    note: 'Builds your website and client area from the brief. Connect GitHub in Replit so Chausar can follow the code.', starter: false, postingOptions: [],
  },
  {
    id: 'vercel', name: 'Vercel', category: 'site-domain', categoryLabel: 'Site and domain',
    modes: [PLANNED_HANDOFF, plannedRead('Vercel')],
    chips: ['planned: handoff', 'planned: read'], regions: GI, regionNote: null, auth: 'Sign-in or access token', vendorUrl: 'https://vercel.com/',
    note: 'The free Hobby plan is for personal, non-commercial sites, so a business site needs a paid plan.', starter: false, postingOptions: [],
  },
  {
    id: 'chausar-crm', name: 'Chausar CRM (built-in)', category: 'customers', categoryLabel: 'Customers and CRM',
    modes: [{ mode: 'read', status: 'available', qualification: 'built-in', what: 'Shows your clients and orders inside Chausar.' }, { mode: 'write', status: 'available', qualification: 'built-in', what: 'Adds clients and orders inside Chausar.' }],
    chips: ['read', 'write'], regions: GI, regionNote: null, auth: 'None, it is inside Chausar', vendorUrl: null,
    note: 'Clients and orders, kept next to your books in your encrypted workspace.', starter: false, postingOptions: [],
  },
  {
    id: 'instagram', name: 'Instagram', category: 'marketing', categoryLabel: 'Marketing and social',
    modes: [PLANNED_HANDOFF, plannedWrite('Instagram')],
    chips: ['planned: handoff', 'planned: write'], regions: GI, regionNote: null, auth: 'Instagram sign-in', vendorUrl: 'https://www.instagram.com/',
    note: "Posting needs a professional account and Meta's app review. Planned.", starter: false,
    ...posting(postingOptionsFor('Instagram', ['Meta app review', 'An Instagram professional account'], true, 'Copies your caption and opens Instagram. You add the picture and post there.')),
  },
  {
    id: 'linkedin', name: 'LinkedIn', category: 'marketing', categoryLabel: 'Marketing and social',
    modes: [PLANNED_HANDOFF, plannedWrite('LinkedIn')],
    chips: ['planned: handoff', 'planned: write'], regions: GI, regionNote: null, auth: 'LinkedIn sign-in', vendorUrl: 'https://www.linkedin.com/',
    note: 'Copy approved posts; open LinkedIn yourself.', starter: false,
    ...posting(postingOptionsFor('LinkedIn', ['LinkedIn app review for posting'], false, 'Copies your post and opens LinkedIn. You paste it and press Post there.').map(option=>option.mode==='handoff'?option:{...option,status:'planned' as const,what:'LinkedIn is copy-and-open only.',risk:null,requires:[],reason:'LinkedIn is copy-and-open only.'})),
  },
  {
    id:'x',name:'X',category:'marketing',categoryLabel:'Marketing and social',modes:[PLANNED_HANDOFF,plannedWrite('X')],chips:['planned: handoff','planned: write'],regions:GI,regionNote:null,auth:'X sign-in',vendorUrl:'https://x.com/',note:'Posts approved text through your signed-in browser.',starter:false,
    ...posting(postingOptionsFor('X',['An X API client, which this build does not ship'],false,'Copies your approved post and opens X. You post there.')),
  },
  {
    id: 'youtube', name: 'YouTube', category: 'marketing', categoryLabel: 'Marketing and social',
    modes: [PLANNED_HANDOFF, plannedWrite('YouTube')],
    chips: ['planned: handoff', 'planned: write'], regions: GI, regionNote: null, auth: 'Google sign-in', vendorUrl: 'https://www.youtube.com/',
    note: 'Google no longer locks API uploads from unverified apps to private. You publish in YouTube Studio: it stays private until you choose; an AI voice or presenter needs the altered or synthetic setting.', starter: false,
    ...posting(postingOptionsFor('YouTube', ['Google sign-in verification for the YouTube upload scope', 'A YouTube upload client, which this build does not ship'], true, 'Copies the title and description and opens YouTube Studio, where you publish. It stays private until you choose; tick the altered or synthetic content setting for an AI voice or presenter.')),
  },
  {
    id: 'bank-account', name: 'Bank account (read only)', category: 'books-tax', categoryLabel: 'Books, tax and invoicing',
    modes: [{ mode: 'read', status: 'planned', qualification: 'unqualified', what: 'Planned: balances and transactions, read only, with your consent and its end date shown. No provider is linked yet.' }],
    chips: ['planned: read'], regions: GI, regionNote: null, auth: 'Your consent, with an end date you can see', vendorUrl: null,
    note: 'Reads balances and transactions only and never moves money. In India this would go through an account aggregator.', starter: false, postingOptions: [],
  },
  {
    id: 'gst-einvoice', name: 'GST e-invoicing (IRP)', category: 'books-tax', categoryLabel: 'Books, tax and invoicing',
    modes: [PLANNED_HANDOFF, plannedWrite('GST e-invoicing (IRP)')],
    chips: ['planned: handoff', 'planned: write'], regions: ['india'], regionNote: null, auth: 'Through a GST suvidha provider', vendorUrl: 'https://www.gst.gov.in/',
    note: 'Needed for business sales once turnover passes the government limit. New businesses rarely need it in their first year.', starter: false, postingOptions: [],
  },
  {
    id: 'tally', name: 'TallyPrime', category: 'books-tax', categoryLabel: 'Books, tax and invoicing',
    modes: [PLANNED_HANDOFF, { mode: 'read', status: 'available', qualification: 'fixture-tested', what: 'Reads into the back office, under Sources. Needs TallyPrime running on this computer.' }],
    chips: ['read', 'planned: handoff'], regions: ['india'], regionNote: null, auth: 'TallyPrime on this computer', vendorUrl: 'https://tallysolutions.com/',
    note: "Reads TallyPrime's Day Book into the back office. Tested with a synthetic recording, not a real installation.", starter: false, postingOptions: [],
  },
  {
    id: 'gst-registration', name: 'GST registration', category: 'legal-entity', categoryLabel: 'Legal and entity',
    modes: [PLANNED_HANDOFF],
    chips: ['planned: handoff'], regions: ['india'], regionNote: null, auth: 'None', vendorUrl: 'https://www.gst.gov.in/',
    note: 'Register for GST on the government portal. A checklist from Chausar is planned. Not legal or tax advice.', starter: false, postingOptions: [],
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Your AI: the six presets with this desktop's availability (Claude Code waits on Anthropic's terms, Codex on its
// host profile), and each business's connections. Keys never appear: a connection only says whether one is loaded.
// ---------------------------------------------------------------------------------------------------------------

const apiConsent = (provider: string) => `Chausar will send your idea, your answers, your plan's words and practice-client conversations to ${provider} with your key, so the model can write questions, plans, briefs and practice drafts. It never sends your books, receipts, keys or real client details under this consent. Real client work is shown to you first and sent only after you approve it. Every call is listed under What was sent, with its cost. If your privacy setting is send nothing, connecting changes it to send question shapes; setting it back to send nothing stops every call.`;
const cliConsent = (tool: string) => `Chausar will run ${tool} on this computer, signed in with your own account, and give it your idea, your answers, your plan's words and practice-client conversations. It never passes your books, receipts, keys or real client details under this consent. Real client work is shown to you first and sent only after you approve it. Every run is listed under What was sent. If your privacy setting is send nothing, connecting changes it to send question shapes; setting it back to send nothing stops every run.`;
const KEY_NOTE = 'Not yet checked with a live key.';
const CLI_NOTE = 'Not yet checked on a real task.';
const READY_ANTHROPIC = 'Uses your Anthropic key. Not yet checked with a live key.';

export const MODEL_PRESETS: ModelPresetLite[] = [
  { id: 'anthropic-haiku-5-5', label: 'Claude Haiku 5.5', kind: 'anthropic-messages', model: 'claude-haiku-5-5', modelEditable: false, tiers: ['fast'], needsKey: true, keyHint: 'Create a key at console.anthropic.com', runsOn: 'provider-api', consentText: apiConsent('Anthropic'), consentDigest: 'consent-anthropic', verification: 'not-live-verified', verificationNote: KEY_NOTE, availability: 'ready', availabilityReason: READY_ANTHROPIC },
  { id: 'anthropic-sonnet-5-5', label: 'Claude Sonnet 5.5', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', modelEditable: false, tiers: ['main'], needsKey: true, keyHint: 'Create a key at console.anthropic.com', runsOn: 'provider-api', consentText: apiConsent('Anthropic'), consentDigest: 'consent-anthropic', verification: 'not-live-verified', verificationNote: KEY_NOTE, availability: 'ready', availabilityReason: READY_ANTHROPIC },
  { id: 'openai-gpt-6-luna', label: 'GPT-6 Luna', kind: 'openai-responses', model: 'gpt-6-luna', modelEditable: true, tiers: ['fast', 'main'], needsKey: true, keyHint: 'Create a key at platform.openai.com', runsOn: 'provider-api', consentText: apiConsent('OpenAI'), consentDigest: 'consent-openai', verification: 'not-live-verified', verificationNote: KEY_NOTE, availability: 'unverified', availabilityReason: 'Not yet tried on a real account, and a past probe failed. Type the model id your account shows. Costs are estimates.' },
  { id: 'claude-code-cli', label: 'Claude Code on this computer', kind: 'claude-cli', model: 'claude-sonnet-5-5', modelEditable: false, tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'this-computer', consentText: cliConsent('Claude Code'), consentDigest: 'consent-claude-code', verification: 'not-live-verified', verificationNote: CLI_NOTE, availability: 'needs-setup', availabilityReason: "Chausar hasn't yet accepted Anthropic's terms for running Claude Code. Use an Anthropic key for now." },
  { id: 'codex-cli', label: 'Codex on this computer', kind: 'codex-cli', model: 'gpt-6-luna', modelEditable: false, tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'this-computer', consentText: cliConsent('Codex'), consentDigest: 'consent-codex', verification: 'not-live-verified', verificationNote: CLI_NOTE, availability: 'needs-setup', availabilityReason: "Chausar's reviewed setup for Codex isn't on this computer yet. Use an OpenAI key for now." },
  { id: 'built-in-templates', label: 'Built-in templates (no AI)', kind: 'template', model: null, modelEditable: false, tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'chausar-engine', consentText: 'Chausar will use its built-in templates. Nothing is sent to any AI service.', consentDigest: 'consent-templates', verification: 'built-in', verificationNote: null, availability: 'ready', availabilityReason: 'Nothing is sent anywhere.' },
];

/** What serves a job when no AI is connected. */
export const TEMPLATES_TIER = { presetId: 'built-in-templates', model: null, usable: true, reason: 'No AI connected; using built-in templates', verificationNote: null };
const NOTHING_CONNECTED: ModelStatusLite = {
  connections: [], tiers: { fast: { ...TEMPLATES_TIER }, main: { ...TEMPLATES_TIER } },
  spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'shape', replay: { active: false, label: null },
};

export const MODEL_STATUS: Record<string, ModelStatusLite> = {
  lumen: NOTHING_CONNECTED,
  ledgerline: {
    connections: [
      { id: 'mc-ledgerline-1', presetId: 'anthropic-haiku-5-5', model: 'claude-haiku-5-5', tiers: ['fast'], status: 'connected', consentedAt: '2026-10-12T09:00:00.000Z', keyLoaded: true, usable: true, reason: READY_ANTHROPIC, verificationNote: KEY_NOTE },
      { id: 'mc-ledgerline-2', presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', tiers: ['main'], status: 'connected', consentedAt: '2026-10-12T09:00:00.000Z', keyLoaded: true, usable: true, reason: READY_ANTHROPIC, verificationNote: KEY_NOTE },
    ],
    tiers: {
      fast: { presetId: 'anthropic-haiku-5-5', model: 'claude-haiku-5-5', usable: true, reason: READY_ANTHROPIC, verificationNote: KEY_NOTE },
      main: { presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', usable: true, reason: READY_ANTHROPIC, verificationNote: KEY_NOTE },
    },
    spentThisMonthDisplay: 'USD 0.0420 (estimate, price unconfirmed)', estimate: true, sendPolicy: 'shape', replay: { active: false, label: null },
  },
};
/** The draft desk (venture.ai.*) before any business exists: nothing connected. */
export const DRAFT_AI_STATUS: ModelStatusLite = NOTHING_CONNECTED;

// ---------------------------------------------------------------------------------------------------------------
// Plan and playbook (venture.blueprint.get). Lumen's plan is accepted; Ledgerline's waits on Today as "Your plan is
// ready" (QUEUE q-plan, whose viewRef is this blueprint's id). Offer ids match ORDERS. Prices arrive only as receipts.
// The engine's playbook pick carries the human label ("YouTube channel"); a plain service type has none.
// ---------------------------------------------------------------------------------------------------------------

/** The flagship playbook each sample business's idea picks (platform/runtime/venture/playbooks/registry.ts). */
export const PLAYBOOKS: Record<string, PlaybookPick> = {
  lumen: { id: 'youtube', label: 'YouTube channel' },
  ledgerline: { id: 'ca-firm', label: 'AI-native CA firm' },
};

export const OFFER_RECEIPTS: ReceiptLite[] = [
  { id: 'R-0408', at: '2026-10-14T10:00:00.000Z', explanation: 'One mention at ₹15,000.00, no discount, no tax added, because tax is not turned on for this price.', stale: false, figures: [{ key: 'unit', label: 'Per mention', display: '₹15,000.00' }, { key: 'total', label: 'Total', display: '₹15,000.00' }] },
  { id: 'R-0409', at: '2026-10-21T08:05:00.000Z', explanation: 'Monthly books at ₹16,000.00, GST at 18% split as CGST and SGST.', stale: false, figures: [{ key: 'subtotal', label: 'Monthly books', display: '₹16,000.00' }, { key: 'cgst', label: 'CGST at 9%', display: '₹1,440.00' }, { key: 'sgst', label: 'SGST at 9%', display: '₹1,440.00' }, { key: 'total', label: 'Total', display: '₹18,880.00' }] },
];

const told = (value: string) => ({ value, label: 'told-by-you' as const, by: 'owner' as const });
const assumed = (value: string, by: 'model' | 'template' = 'model') => ({ value, label: 'assumption' as const, by });
const STEP_NOTES = {
  collect: 'You collect what the client sends and add the files to the order, where the agent reads them. Reading inboxes for you is planned.',
  work: 'You do the hands-on work. For bookkeeping, an agent reconciles a month from the files you add, for you to check; other hands-on work is planned.',
  draft: "An agent drafts a reply from the client's message. You check it.",
  send: 'You send it to the client. Sending for you is planned.',
};
const STARTERS = ['lovable', 'github', 'razorpay', 'mail-app', 'cal-com', 'chausar-books'];

export const BLUEPRINTS: Record<string, BlueprintViewLite> = {
  lumen: {
    blueprint: {
      id: 'bp-lumen-2', at: '2026-10-14T10:00:00.000Z', version: 2, status: 'accepted', source: 'model', digest: 'bp-lumen-2-digest', serviceType: 'content',
      name: told('Lumen Studio'),
      oneLiner: assumed('Weekly audio gear reviews on YouTube, cut into shorts, with sponsor slots.'),
      customer: assumed('People buying audio gear on a budget, and the brands that sponsor them.'),
      offers: [
        { id: 'offer_sponsor', name: told('Sponsor slot'), description: assumed('One mention of a sponsor in an episode, written with them and read on camera.'), pricing: { model: 'project', quantityUnit: 'project', unitPriceMinor: '1500000', unitPriceLabel: 'told-by-you', defaultQuantity: '1' } },
        { id: 'offer_shorts', playbookOffer: 'shorts-from-own-video', name: assumed('Shorts from your long video'), description: assumed("Six shorts cut from a client's own long video, each with a timestamp."), pricing: { model: 'project', quantityUnit: 'project', unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' } },
      ],
      deliverySteps: [
        { id: 'step_1', title: assumed('Collect the long video and the notes'), doneBy: 'you', capability: 'planned', note: STEP_NOTES.collect },
        { id: 'step_2', title: assumed('Cut the episode and the shorts'), doneBy: 'you', capability: 'planned', note: STEP_NOTES.work },
        { id: 'step_3', title: assumed('Draft the sponsor script'), doneBy: 'agent-then-you', capability: 'drafts-now', note: STEP_NOTES.draft },
        { id: 'step_4', title: assumed('Publish on YouTube'), doneBy: 'you', capability: 'planned', note: STEP_NOTES.send },
      ],
      approvals: [assumed('Every draft before a client sees it'), assumed('Prices and invoices'), assumed('Anything posted in your name')],
      backOffice: { currency: 'INR', taxLabel: 'GST', taxRegistered: { value: false, label: 'told-by-you', by: 'owner' }, invoiceKind: 'tax-invoice', taxInvoiceReady: false, taxInvoiceMissing: [], paymentRail: 'razorpay' },
      starterConnectorIds: STARTERS,
    },
    offerReceipts: { offer_sponsor: OFFER_RECEIPTS[0]!, offer_shorts: null },
    playbook: PLAYBOOKS.lumen!,
    // The shorts are the YouTube playbook's own-footage offer: an order says whose footage it is (engine: playbooks/intake.ts).
    intake: { offer_shorts: { rights: ['own-footage'], fields: ['format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile'] } },
  },
  ledgerline: {
    blueprint: {
      id: 'plan-ledgerline-1', at: '2026-10-21T08:05:00.000Z', version: 1, status: 'draft', source: 'template', digest: 'plan-ledgerline-1-digest', serviceType: 'bookkeeping',
      name: told('Ledgerline'),
      oneLiner: assumed('Monthly books, GST working, ITR and TDS preparation. Audit work stays with your CA.', 'template'),
      customer: assumed('Traders and small shops that need their books kept every month.', 'template'),
      offers: [
        { id: 'offer_books', name: assumed('Monthly books', 'template'), description: assumed('Bank lines matched to invoices, and the books for the month.', 'template'), pricing: { model: 'monthly', quantityUnit: 'month', unitPriceMinor: '1600000', unitPriceLabel: 'told-by-you', defaultQuantity: '1' } },
        { id: 'offer_gst', name: assumed('GST working', 'template'), description: assumed('The monthly GST working, ready for your CA to sign off.', 'template'), pricing: { model: 'project', quantityUnit: 'project', unitPriceMinor: '500000', unitPriceLabel: 'told-by-you', defaultQuantity: '1' } },
      ],
      deliverySteps: [
        { id: 'step_1', title: assumed('Collect the bank statement and the sales register', 'template'), doneBy: 'you', capability: 'planned', note: STEP_NOTES.collect },
        { id: 'step_2', title: assumed('Reconcile the month', 'template'), doneBy: 'agent-then-you', capability: 'drafts-now', note: STEP_NOTES.work },
        { id: 'step_3', title: assumed('Draft the note to the client', 'template'), doneBy: 'agent-then-you', capability: 'drafts-now', note: STEP_NOTES.draft },
        { id: 'step_4', title: assumed('Send it, with your CA for anything filed', 'template'), doneBy: 'you', capability: 'planned', note: STEP_NOTES.send },
      ],
      approvals: [assumed('Every draft before a client sees it', 'template'), assumed('Prices and invoices', 'template')],
      backOffice: { currency: 'INR', taxLabel: 'GST', taxRegistered: { value: true, label: 'told-by-you', by: 'owner' }, invoiceKind: 'tax-invoice', taxInvoiceReady: false, taxInvoiceMissing: ['Your SAC code'], paymentRail: 'razorpay' },
      starterConnectorIds: STARTERS,
    },
    offerReceipts: { offer_books: OFFER_RECEIPTS[1]!, offer_gst: null },
    playbook: PLAYBOOKS.ledgerline!,
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Website build (venture.build.status). Lumen has a brief that passed its checks, opened in Lovable once, and follows
// its repo on GitHub (answers from a synthetic recording). Ledgerline's plan is not accepted, so it has no brief yet.
// ---------------------------------------------------------------------------------------------------------------

export const GITHUB_TOKEN_LINK = 'https://github.com/settings/personal-access-tokens/new?name=Chausar%20read%20only&description=Lets%20Chausar%20read%20one%20app%20repo.%20Read%20only.&expires_in=90&contents=read&metadata=read&deployments=read&actions=read';
export const HANDOFF_NOTES: Record<'lovable' | 'replit' | 'copy', string[]> = {
  lovable: ['Lovable keeps your brief in this browser until you press send.', 'To follow the build, open Project settings, then Git, then GitHub, then Connect.'],
  replit: ['Replit receives this brief as soon as the page opens.', "To follow the build, open Replit's Git tool, connect GitHub and turn on auto-sync."],
  copy: ['No official link exists, and a pasted link may start building at once, so Chausar copies the brief for you to paste.'],
};
const LUMEN_BRIEF = [
  'Chausar build brief chb_lumen01, version 1',
  '',
  '## 1. What this business is',
  'Lumen Studio reviews audio gear on YouTube every week and sells sponsor slots to the brands it reviews.',
  '',
  '## 2. Pages',
  'Home, Sponsor with us, Episodes, About, Privacy and terms.',
  '',
  '## 3. Prices',
  'Sponsor slot: from the price receipt R-0408. Never type a price that is not in a receipt.',
].join('\n');
/** The brief a template writes for a newly accepted plan. */
export function templateBrief(name: string, version: number): string {
  return [`Chausar build brief chb_${name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 8)}, version ${version}`, '', '## 1. What this business is', `${name}, from its accepted plan.`, '', '## 2. Pages', 'Home, Offers and prices, How it works, Start a request, Privacy and terms.'].join('\n');
}

export const BUILDS: Record<string, BuildStatusView> = {
  lumen: {
    brief: { id: 'brief-lumen-1', at: '2026-10-14T11:00:00.000Z', briefId: 'chb_lumen01', version: 1, markdown: LUMEN_BRIEF, chars: LUMEN_BRIEF.length, wordsBy: 'model', lint: { ok: true, findings: [] } },
    handoffs: [{ id: 'ho-lumen-1', at: '2026-10-14T11:05:00.000Z', builder: 'lovable', mode: 'link', openedAt: '2026-10-14T11:05:02.000Z' }],
    follow: {
      id: 'follow-lumen', repo: { owner: 'lumenstudio', name: 'site' }, tokenState: 'none', linkedAt: '2026-10-14T12:00:00.000Z',
      lastStatus: {
        word: 'builder-making-changes', asOf: '2026-10-21T09:00:00.000Z',
        repo: { fullName: 'lumenstudio/site', private: false, defaultBranch: 'main', htmlUrl: 'https://github.com/lumenstudio/site' },
        lastCommit: { sha: '4f2a9c1', at: '2026-10-21T08:40:00.000Z', by: 'lovable', message: 'Add the Sponsor with us page' },
        briefMarker: 'found', briefMarkerVersion: 1, uiWorkflow: 'found', checks: 'passed',
        deployment: { host: 'Lovable', url: 'https://lumenstudio.lovable.app', at: '2026-10-21T08:45:00.000Z' },
        syncConflictBranch: null, cannotSay: ['These answers come from a synthetic recording of GitHub, not your real repo.'],
      },
    },
    tokenLink: GITHUB_TOKEN_LINK,
  },
  ledgerline: { brief: null, handoffs: [], follow: null, tokenLink: GITHUB_TOKEN_LINK },
};
