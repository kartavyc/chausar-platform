// Sample RPC results for the launch renderer tests (P7). A synthetic recording: written by hand against the
// venture contracts, never captured from a live engine, model provider or GitHub account. Every amount here
// is the engine's own display string for a hand-checked receipt (INR 2,499.00 at 18 percent GST:
// 249900 x 1800 = 449,820,000; plus 5000, divided by 10000, is 44982; 249900 + 44982 = 294882).
import type {
  BlueprintRecord, BlueprintView, BooksSummary, BriefRecord, BuildStatus, CapabilityStatus, ClientRecord, ConnectorCard,
  CountryProfile, DeliveryRunRecord, HandoffPlan, InterviewQuestion, InvoiceView, LaunchStatus, ModelPreset, ModelStatusView,
  OrderRecord, PlanPreview, PlaybookRecord, PriceReceiptRecord, Scenario, SimulationRunRecord, TermRecord, VentureEventRecord,
  VentureResults, VentureView,
} from '../../../../runtime/venture/contracts.ts';

export const label = 'synthetic recording' as const;
export const UNSAFE_TEXT = '<img src=x onerror=alert(1)>';

const hex = (seed: string) => seed.repeat(64).slice(0, 64);
const at = '2026-10-15T09:30:00.000Z';
const base = { ventureId: 'vnt_demo', memberId: 'owner', epoch: 1, at };

// ---------------------------------------------------------------------------------------------
// Countries and the plan preview (before any vault)
// ---------------------------------------------------------------------------------------------
export const india: CountryProfile = {
  code: 'IN', name: 'India', currency: 'INR', minorDigits: 2, region: 'india',
  tax: {
    mode: 'gst', label: 'GST', standardRateBps: '1800',
    registrationNote: 'Service businesses usually register for GST above a yearly turnover of INR 20 lakh (INR 10 lakh in special category states). Some must register earlier. Check with a CA.',
    idLabel: 'GSTIN', idPattern: null, invoiceKind: 'tax-invoice', checkedOn: '2026-10-15',
  },
  paymentRails: ['razorpay', 'cashfree', 'paypal'], dateOrder: 'day-month-year',
  complianceNotes: ['Customer personal data falls under the DPDP Act and its rules.'],
};
const unitedStates: CountryProfile = {
  code: 'US', name: 'United States', currency: 'USD', minorDigits: 2, region: 'global',
  tax: { mode: 'sales-tax', label: 'Sales tax', standardRateBps: '0', registrationNote: 'Sales tax on services depends on the state. Chausar adds none unless you turn tax on and enter your rate on your plan.', idLabel: '', idPattern: null, invoiceKind: 'invoice', checkedOn: '2026-10-15' },
  paymentRails: ['stripe', 'paypal', 'lemon-squeezy'], dateOrder: 'month-day-year', complianceNotes: ['Marketing email must follow CAN-SPAM.'],
};
const another: CountryProfile = {
  code: 'XX', name: 'Another country (prices in US dollars)', currency: 'USD', minorDigits: 2, region: 'global',
  tax: { mode: 'none', label: 'Tax', standardRateBps: '0', registrationNote: 'Chausar adds no tax unless you turn tax on and enter your rate on your plan.', idLabel: '', idPattern: null, invoiceKind: 'invoice', checkedOn: '2026-10-15' },
  paymentRails: ['paypal', 'lemon-squeezy', 'paddle'], dateOrder: 'day-month-year', complianceNotes: [],
};
export const countries: VentureResults['venture.countries'] = [india, unitedStates, another];

const steps = (titles: [string, string, string, string]): BlueprintRecord['deliverySteps'] => [
  { id: 'step_1', title: { value: titles[0], label: 'assumption', by: 'template' }, doneBy: 'you', capability: 'planned', note: 'You gather what the client sends. An agent that reads files and inboxes is planned.' },
  { id: 'step_2', title: { value: titles[1], label: 'assumption', by: 'template' }, doneBy: 'you', capability: 'planned', note: 'You do the hands-on work. An agent with the tools for it is planned.' },
  { id: 'step_3', title: { value: titles[2], label: 'assumption', by: 'template' }, doneBy: 'agent-then-you', capability: 'drafts-now', note: "An agent drafts a reply from the client's message. You check it." },
  { id: 'step_4', title: { value: titles[3], label: 'assumption', by: 'template' }, doneBy: 'you', capability: 'planned', note: 'You send it to the client. Sending for you is planned.' },
];
const stepTitles: [string, string, string, string] = ['Collect bills and bank statements', 'Sort and match every entry', 'Draft the monthly report for review', 'Send the report to the client'];

export const templateQuestions: InterviewQuestion[] = [
  { id: 'q_1', kind: 'choice', field: 'customer', text: 'Who will your first clients be?', choices: [{ id: 'c_1', label: 'Cafes and restaurants' }, { id: 'c_2', label: 'Small shops' }, { id: 'c_3', label: 'Freelancers and consultants' }], by: 'template', required: false, prefill: null },
  { id: 'q_2', kind: 'text', field: 'channel', text: 'How will clients send you their bills and statements?', choices: [], by: 'template', required: false, prefill: null },
  { id: 'q_pricing_model', kind: 'choice', field: 'pricing-model', text: 'How will you charge?', choices: [{ id: 'monthly', label: 'Per month' }, { id: 'project', label: 'Per project' }, { id: 'hourly', label: 'Per hour' }], by: 'engine', required: true, prefill: null },
  { id: 'q_price', kind: 'money', field: 'price', text: 'What will you charge for one month, in INR? You can change it later.', choices: [], by: 'engine', required: false, prefill: null },
  { id: 'q_tax', kind: 'yesno', field: 'tax-registered', text: 'Are you registered for GST, so you charge it on your invoices?', choices: [], by: 'engine', required: true, prefill: null },
  { id: 'q_tax_rate', kind: 'rate', field: 'tax-rate', text: 'What GST rate do you charge, in percent?', choices: [], by: 'engine', required: true, prefill: '18' },
];

const backOfficeNotRegistered: BlueprintRecord['backOffice'] = {
  currency: 'INR', taxMode: 'gst', taxLabel: 'GST', taxRegistered: { value: false, label: 'assumption', by: 'engine' }, taxRateBps: '0', taxRateBy: 'not-registered',
  taxId: null, taxState: null, sacCode: null, lutConfirmed: false, invoiceKind: 'tax-invoice', taxInvoiceReady: false, taxInvoiceMissing: [], paymentRail: 'razorpay', invoicePrefix: 'INV',
};

export const preview: PlanPreview = {
  idea: 'Monthly bookkeeping for cafes and small shops in Pune.', country: india,
  serviceType: { value: 'bookkeeping', label: 'assumption', by: 'template' }, serviceLabel: 'Bookkeeping studio',
  oneLiner: { value: 'A bookkeeping studio where an agent drafts the monthly report and you check it.', label: 'assumption', by: 'template' },
  customer: { value: 'Small business owners who want tidy books without chasing receipts.', label: 'assumption', by: 'template' },
  offers: [
    { id: 'offer_1', name: { value: 'Monthly books', label: 'assumption', by: 'template' }, description: { value: 'Bank matching, bill sorting and a short monthly report.', label: 'assumption', by: 'template' }, pricing: { model: 'monthly', quantityUnit: 'month', unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' } },
    { id: 'offer_2', name: { value: 'Catch up', label: 'assumption', by: 'template' }, description: { value: 'Past months put in order before the monthly service starts.', label: 'assumption', by: 'template' }, pricing: { model: 'project', quantityUnit: 'project', unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' } },
  ],
  deliverySteps: steps(stepTitles),
  approvals: [{ value: 'Every monthly report before it reaches a client', label: 'assumption', by: 'template' }, { value: 'Any message that asks a client for money', label: 'assumption', by: 'template' }],
  backOffice: backOfficeNotRegistered, questions: templateQuestions, by: 'template', saved: false,
};

// ---------------------------------------------------------------------------------------------
// The venture, its plan and its price receipt
// ---------------------------------------------------------------------------------------------
const checklistLabels: [VentureView['checklist'][number]['id'], string, VentureView['checklist'][number]['place']][] = [
  ['idea', 'Describe your idea', 'business'], ['questions', 'Set your price and tax', 'business'], ['plan', 'Accept your plan', 'business'],
  ['prices', 'Price your offers', 'business'], ['brief', 'Write the build brief', 'build'], ['builder', 'Open it in Lovable or Replit', 'build'],
  ['repo', 'Follow the build on GitHub', 'build'], ['ai', 'Add your AI (optional)', 'today'], ['rehearsal', 'Rehearse with practice clients', 'agents'],
  ['first-client', 'Add your first client', 'clients'], ['first-invoice', 'Send your first invoice', 'clients'], ['first-payment', 'Record your first payment', 'money'],
];
const terms: TermRecord[] = ([
  ['client', 'Client', 'A person or business that buys from you.', 'proposed'], ['offer', 'Offer', 'A service you sell at a set price.', 'active'],
  ['order', 'Order', 'One piece of work a client asked for.', 'proposed'], ['deliverable', 'Deliverable', 'What you hand over when the work is done.', 'proposed'],
  ['invoice', 'Invoice', 'The bill you send a client.', 'proposed'], ['payment', 'Payment', 'Money a client paid you.', 'proposed'],
  ['retainer-period', 'Retainer period', 'The month a monthly offer covers.', 'proposed'],
] as const).map(([key, name, meaning, lifecycle]) => ({ ...base, id: `vtm_${key}`, kind: 'venture-term', key, name, meaning, lifecycle, evidence: [] }));

export const ventureView: VentureView = {
  venture: {
    ...base, id: 'vnt_demo', kind: 'venture-record', idea: preview.idea, ideaDigest: hex('a'), workingName: 'Ledger Cafe Books', country: india,
    serviceType: 'bookkeeping', status: 'rehearsal', launchStage: 'shadow', blueprintId: 'vbp_2', acceptedBlueprintId: 'vbp_2', playbookId: 'vpb_1', invoiceSequence: 1, updatedAt: at,
  },
  checklist: checklistLabels.map(([id, text, place], index) => ({ id, label: text, place, done: index < 7 })),
  done: 7, total: 12, next: { item: 'ai', label: 'Add your AI (optional)', place: 'today' }, terms,
};

export const offerReceipt: PriceReceiptRecord = {
  ...base, id: 'vpr_offer1', kind: 'venture-price-receipt', subject: { type: 'offer', offerId: 'offer_1' }, operation: 'venture.price', currency: 'INR', minorDigits: 2,
  inputs: { unitPriceMinor: '249900', quantity: '1', discountBps: '0', taxMode: 'gst', taxRateBps: '1800', taxTreatment: 'single', unitPriceBy: 'told-by-you', taxRateBy: 'country-table', blueprintDigest: hex('d') },
  steps: [
    { op: 'multiply', inputs: ['249900', '1'], resultMinor: '249900', rule: 'unit price times quantity' },
    { op: 'discount', inputs: ['249900', '0'], resultMinor: '0', rule: 'discount in basis points, rounded half up to the minor unit' },
    { op: 'tax', inputs: ['249900', '1800'], resultMinor: '44982', rule: 'tax in basis points, rounded half up to the minor unit' },
    { op: 'add', inputs: ['249900', '44982'], resultMinor: '294882', rule: 'taxable amount plus tax' },
  ],
  figures: [
    { key: 'unit', label: 'Unit price', minor: '249900', display: 'INR 2,499.00', currency: 'INR' },
    { key: 'subtotal', label: 'Subtotal', minor: '249900', display: 'INR 2,499.00', currency: 'INR' },
    { key: 'discount', label: 'Discount', minor: '0', display: 'INR 0.00', currency: 'INR' },
    { key: 'taxable', label: 'Taxable amount', minor: '249900', display: 'INR 2,499.00', currency: 'INR' },
    { key: 'tax', label: 'GST at 18%', minor: '44982', display: 'INR 449.82', currency: 'INR' },
    { key: 'total', label: 'Total', minor: '294882', display: 'INR 2,948.82', currency: 'INR' },
  ],
  totalMinor: '294882', allowedNumbers: ['249900', '2499.00', '0', '44982', '449.82', '294882', '2948.82', '1', '18'],
  explanation: '1 x month at INR 2,499.00, plus GST at 18% (INR 449.82) = INR 2,948.82.', digest: hex('e'), stale: false,
};

const backOfficeReady: BlueprintRecord['backOffice'] = {
  ...backOfficeNotRegistered, taxRegistered: { value: true, label: 'told-by-you', by: 'owner' }, taxRateBps: '1800', taxRateBy: 'country-table',
  taxId: '27ZZZZZ9999Z1Z8', taxState: '27', sacCode: '998222', taxInvoiceReady: true, taxInvoiceMissing: [],
};
export const blueprintAccepted: BlueprintRecord = {
  ...base, id: 'vbp_2', kind: 'venture-blueprint', version: 2, status: 'accepted', source: 'template', structureHash: hex('c'), digest: hex('d'), modelCallIds: [],
  serviceType: 'bookkeeping', name: { value: 'Ledger Cafe Books', label: 'assumption', by: 'template' }, oneLiner: preview.oneLiner, customer: preview.customer,
  offers: [
    { ...preview.offers[0], pricing: { model: 'monthly', quantityUnit: 'month', unitPriceMinor: '249900', unitPriceLabel: 'told-by-you', defaultQuantity: '1' } },
    preview.offers[1],
  ],
  deliverySteps: steps(stepTitles), approvals: preview.approvals, backOffice: backOfficeReady,
  starterConnectorIds: ['lovable', 'github', 'razorpay', 'mail-app', 'cal-com', 'chausar-books'],
};
export const blueprintView: BlueprintView = { blueprint: blueprintAccepted, offerReceipts: { offer_1: offerReceipt, offer_2: null } };
export const blueprintDraftView: BlueprintView = {
  blueprint: {
    ...blueprintAccepted, id: 'vbp_1', version: 1, status: 'draft', digest: hex('f'),
    backOffice: { ...backOfficeReady, taxId: null, taxState: null, sacCode: null, taxInvoiceReady: false, taxInvoiceMissing: ['Your GSTIN', 'Your state', 'Your SAC code'] },
  },
  offerReceipts: { offer_1: { ...offerReceipt, inputs: { ...offerReceipt.inputs, blueprintDigest: hex('f') } }, offer_2: null },
};

// ---------------------------------------------------------------------------------------------
// Models
// ---------------------------------------------------------------------------------------------
const apiConsent = (provider: string) => `Chausar will send your idea, your answers, your plan's words and practice-client conversations to ${provider} with your key, so the model can write questions, plans, briefs and practice drafts. It never sends your books, receipts, keys or real client details under this consent. Real client work is shown to you first and sent only after you approve it. Every call is listed under What was sent, with its cost. If your privacy setting is send nothing, connecting changes it to send question shapes; setting it back to send nothing stops every call.`;
const cliConsent = (tool: string) => `Chausar will run ${tool} on this computer, signed in with your own account, and give it your idea, your answers, your plan's words and practice-client conversations. It never passes your books, receipts, keys or real client details under this consent. Real client work is shown to you first and sent only after you approve it. Every run is listed under What was sent. If your privacy setting is send nothing, connecting changes it to send question shapes; setting it back to send nothing stops every run.`;
const table = (input: string, output: string, source: string, confirmed: boolean) => ({ currency: 'USD' as const, inputMicrosPerMillion: input, outputMicrosPerMillion: output, source, checkedOn: '2026-10-15', confirmed });
export const presets: ModelPreset[] = [
  { id: 'anthropic-haiku-5-5', label: 'Claude Haiku 5.5', kind: 'anthropic-messages', model: 'claude-haiku-5-5', modelEditable: false, tiers: ['fast'], needsKey: true, keyHint: 'Create a key at console.anthropic.com', runsOn: 'provider-api', priceTable: table('100000', '500000', 'Anthropic list price for prompts up to 100K tokens', true), consentText: apiConsent('Anthropic'), consentDigest: hex('1'), verification: 'not-live-verified', availability: 'ready', availabilityReason: 'Uses your Anthropic key.' },
  { id: 'anthropic-sonnet-5-5', label: 'Claude Sonnet 5.5', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', modelEditable: false, tiers: ['main'], needsKey: true, keyHint: 'Create a key at console.anthropic.com', runsOn: 'provider-api', priceTable: table('2000000', '10000000', 'Anthropic list price', true), consentText: apiConsent('Anthropic'), consentDigest: hex('2'), verification: 'not-live-verified', availability: 'ready', availabilityReason: 'Uses your Anthropic key.' },
  { id: 'openai-gpt-6-luna', label: 'GPT-6 Luna', kind: 'openai-responses', model: 'gpt-6-luna', modelEditable: true, tiers: ['fast', 'main'], needsKey: true, keyHint: 'Create a key at platform.openai.com', runsOn: 'provider-api', priceTable: table('100000', '500000', 'Third-party tracker, not confirmed by OpenAI', false), consentText: apiConsent('OpenAI'), consentDigest: hex('3'), verification: 'not-live-verified', availability: 'unverified', availabilityReason: 'Not yet tried on a real account, and a past probe failed. Type the model id your account shows. Costs are estimates.' },
  { id: 'claude-code-cli', label: 'Claude Code on this computer', kind: 'claude-cli', model: 'claude-sonnet-5-5', modelEditable: false, tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'this-computer', priceTable: null, consentText: cliConsent('Claude Code'), consentDigest: hex('4'), verification: 'not-live-verified', availability: 'needs-setup', availabilityReason: 'Install Claude Code and sign in. Chausar checks for it when you connect.' },
  { id: 'codex-cli', label: 'Codex on this computer', kind: 'codex-cli', model: 'gpt-6-luna', modelEditable: false, tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'this-computer', priceTable: null, consentText: cliConsent('Codex'), consentDigest: hex('5'), verification: 'not-live-verified', availability: 'needs-setup', availabilityReason: 'Needs the reviewed Codex host profile. See docs/venture/models.md.' },
  { id: 'built-in-templates', label: 'Built-in templates (no AI)', kind: 'template', model: null, modelEditable: false, tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'chausar-engine', priceTable: null, consentText: 'Chausar will use its built-in templates. Nothing is sent to any AI service.', consentDigest: hex('6'), verification: 'built-in', availability: 'ready', availabilityReason: 'Nothing is sent anywhere.' },
];
// ModelConnectionRecord declares `kind` twice (the record kind from RecordBase and the route kind), so the
// contract type reduces to never and no literal can satisfy it. The hand-off note asks the integrator to rename
// the route field; until then this fixture is typed through unknown and carries the record kind.
const connection = (id: string, presetId: ModelPreset['id'], model: string, tier: 'fast' | 'main', consentDigest: string) => ({
  ...base, id, kind: 'venture-model-connection', presetId, model, endpoint: 'https://api.anthropic.com/v1/messages', tiers: [tier], consentDigest, consentedAt: at,
  monthlyCapMicros: '5000000', status: 'connected', keyLoaded: true, usable: true, reason: 'Ready.',
}) as unknown as ModelStatusView['connections'][number];
export const modelsConnected: ModelStatusView = {
  connections: [connection('vmc_haiku', 'anthropic-haiku-5-5', 'claude-haiku-5-5', 'fast', hex('1')), connection('vmc_sonnet', 'anthropic-sonnet-5-5', 'claude-sonnet-5-5', 'main', hex('2'))],
  tiers: { fast: { presetId: 'anthropic-haiku-5-5', model: 'claude-haiku-5-5', usable: true, reason: 'Ready.' }, main: { presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5', usable: true, reason: 'Ready.' } },
  spentThisMonthMicros: '6880', spentThisMonthDisplay: 'USD 0.0069', estimate: false, sendPolicy: 'shape', replay: { active: true, label: 'synthetic recording' },
};
export const modelsTemplatesOnly: ModelStatusView = {
  connections: [],
  tiers: { fast: { presetId: 'built-in-templates', model: null, usable: true, reason: 'No AI connected; using built-in templates' }, main: { presetId: 'built-in-templates', model: null, usable: true, reason: 'No AI connected; using built-in templates' } },
  spentThisMonthMicros: '0', spentThisMonthDisplay: 'USD 0.0000', estimate: false, sendPolicy: 'nothing', replay: { active: false, label: null },
};

// ---------------------------------------------------------------------------------------------
// Build: brief, handoffs, GitHub follow, connectors
// ---------------------------------------------------------------------------------------------
const briefMarkdown = [
  'Build brief from Chausar. Business type: Bookkeeping studio. Brief id: chb_7k2m9q4x.',
  '', '## 1. What to build', `${UNSAFE_TEXT} A calm site for a bookkeeping studio in Pune, with a client portal where cafes upload bills and read their monthly report.`,
  '', '## 2. Who it is for', 'Cafe and shop owners who want tidy books without chasing receipts.',
  '', '## 3. Offer and prices (copy exactly)', 'Show these prices exactly as written. Do not round, convert or add tax yourself.',
  '- Monthly books: INR 2,948.82 per month, including GST. Bank matching, bill sorting and a short monthly report.', '- Catch up: price to be set. Past months put in order before the monthly service starts.',
  '', '## 4. Pages', '1. Home: explain the service and ask for a call.',
  '', '## 5. Data rules', 'Turn on row level security for every table, with policies so a signed-in client reads and writes only their own rows.',
  '', '## 9. Repo setup', 'chausar-brief-id: chb_7k2m9q4x',
].join('\n');
export const brief: BriefRecord = {
  ...base, id: 'vbr_1', kind: 'venture-brief', briefId: 'chb_7k2m9q4x', version: 1, markdown: briefMarkdown, chars: briefMarkdown.length, digest: hex('b'),
  blueprintDigest: hex('d'), priceReceiptIds: ['vpr_offer1'], wordsBy: 'model', modelCallId: 'vcall_brief', lint: { ok: true, findings: [] },
};
export const handoffPlans: Record<'lovable' | 'replit' | 'bolt', HandoffPlan> = {
  lovable: { handoffId: 'vho_lovable', builder: 'lovable', mode: 'link', url: `https://lovable.dev/#prompt=${encodeURIComponent('Build brief from Chausar.')}`, clipboardText: null, promptChars: 25, urlChars: 60, notes: ['Lovable keeps your brief in this browser until you press send.', 'To follow the build, open Project settings, then Git, then GitHub, then Connect.'], label: 'handoff', status: 'available' },
  replit: { handoffId: 'vho_replit', builder: 'replit', mode: 'link', url: 'https://replit.com/?stack=Build&prompt=A4Jw9gtsAuQ&referrer=chausar', clipboardText: null, promptChars: 6, urlChars: 66, notes: ['Replit receives this brief as soon as the page opens.', "To follow the build, open Replit's Git tool, connect GitHub and turn on auto-sync."], label: 'handoff', status: 'available' },
  bolt: { handoffId: 'vho_bolt', builder: 'bolt', mode: 'copy', url: 'https://bolt.new/', clipboardText: briefMarkdown, promptChars: briefMarkdown.length, urlChars: 17, notes: ['No official link exists, and a pasted link may start building at once, so Chausar copies the brief for you to paste.'], label: 'handoff', status: 'available' },
};
const cannotSay = ['Whether your app works.', 'Your Lovable or Replit preview.', 'How many builder credits you used.', 'Your live address, unless a host records a deployment.', 'Whether your client data is locked down.', 'These answers come from a synthetic recording, not your real repo.'];
export const lastStatus: BuildStatus = {
  word: 'repo-connected', asOf: at, readId: 'vrd_1', repo: { fullName: 'demo-owner/ledger-cafe-books', private: true, defaultBranch: 'main', htmlUrl: 'https://github.com/demo-owner/ledger-cafe-books' },
  lastCommit: { sha: 'a'.repeat(40), at, by: 'lovable', message: 'Add the services page' }, briefMarker: 'found', briefMarkerVersion: 1, markerFile: 'AGENTS.md',
  uiWorkflow: 'found', checks: 'passed', deployment: null, syncConflictBranch: null, cannotSay,
};
export const buildStatus: VentureResults['venture.build.status'] = {
  follow: { ...base, id: 'vbf_1', kind: 'venture-build-follow', repo: { owner: 'demo-owner', name: 'ledger-cafe-books' }, tokenState: 'in-memory', linkedAt: at, lastStatus },
  brief,
  handoffs: [
    { ...base, id: 'vho_lovable', kind: 'venture-handoff', builder: 'lovable', mode: 'link', briefId: brief.briefId, briefDigest: brief.digest, urlChars: 60, urlDigest: hex('9'), openedAt: at },
    { ...base, id: 'vho_replit', kind: 'venture-handoff', builder: 'replit', mode: 'link', briefId: brief.briefId, briefDigest: brief.digest, urlChars: 66, urlDigest: hex('8'), openedAt: null },
  ],
  tokenLink: 'https://github.com/settings/personal-access-tokens/new?name=Chausar%20read%20only&description=Lets%20Chausar%20read%20one%20app%20repo.%20Read%20only.&expires_in=90&contents=read&metadata=read&deployments=read&statuses=read&actions=read',
};
export const buildStatusUnfollowed: VentureResults['venture.build.status'] = { ...buildStatus, follow: null };

const categoryLabels: Record<ConnectorCard['category'], string> = {
  build: 'Build', 'site-domain': 'Site and domain', payments: 'Payments', email: 'Email and inbox', booking: 'Booking and calendar', customers: 'Customers and CRM',
  messaging: 'Messaging and support', 'docs-ops': 'Docs and ops', marketing: 'Marketing and social', 'books-tax': 'Books, tax and invoicing', 'legal-entity': 'Legal and entity', analytics: 'Analytics and feedback',
};
const planned = (mode: 'handoff' | 'read' | 'write') => ({ mode, status: 'planned' as const, qualification: 'unqualified' as const, what: 'Planned: Chausar will prepare what to paste there. For now, Visit site opens it.' });
const card = (id: string, name: string, category: ConnectorCard['category'], modes: ConnectorCard['modes'], chips: string[], vendorUrl: string | null, note: string, starter = false): ConnectorCard => ({
  id, name, category, categoryLabel: categoryLabels[category], modes, chips, regions: ['global'], regionNote: null, auth: 'none', vendorUrl, note, starter,
});
export const connectors: ConnectorCard[] = [
  card('lovable', 'Lovable', 'build', [{ mode: 'handoff', status: 'available', qualification: 'fixture-tested', what: 'Opens Lovable with your brief filled in. You press send there.' }], ['handoff'], 'https://lovable.dev/', 'Lovable keeps your brief in the browser until you press send.', true),
  card('github', 'GitHub', 'build', [{ mode: 'read', status: 'available', qualification: 'fixture-tested', what: 'Reads commits, files and checks of one repo. Never writes.' }], ['read'], 'https://github.com/', 'Read only, with a fine-grained key for one repo.', true),
  card('razorpay', 'Razorpay', 'payments', [planned('handoff'), planned('read'), planned('write')], ['planned: handoff', 'planned: read', 'planned: write'], 'https://razorpay.com/', 'The default for India. Payment links are planned.', true),
  card('mail-app', 'Your own mail app', 'email', [{ mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Chausar drafts a reply or an invoice; you send it from your own mail app.' }], ['handoff'], null, 'You send every message yourself.', true),
  card('cal-com', 'Cal.com', 'booking', [planned('handoff'), planned('read')], ['planned: handoff', 'planned: read'], 'https://cal.com/', 'Booking links are planned.', true),
  card('chausar-books', 'Chausar back office', 'books-tax', [{ mode: 'read', status: 'available', qualification: 'built-in', what: 'Your books, inside Chausar.' }, { mode: 'write', status: 'available', qualification: 'built-in', what: 'Invoices and payments, inside Chausar.' }], ['read', 'write'], null, 'Every number has a receipt.', true),
  card('replit', 'Replit', 'build', [{ mode: 'handoff', status: 'available', qualification: 'fixture-tested', what: 'Opens Replit with your brief filled in. You press send there.' }], ['handoff'], 'https://replit.com/', 'Replit receives the brief as soon as its page opens.'),
  card('bolt', 'Bolt', 'build', [{ mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Copies your brief. Paste it into Bolt.' }], ['handoff'], 'https://bolt.new/', 'Chausar copies the brief for you to paste.'),
  card('v0', 'v0', 'build', [{ mode: 'handoff', status: 'available', qualification: 'built-in', what: 'Copies your brief. Paste it into v0.' }], ['handoff'], 'https://v0.app/', 'Chausar copies the brief for you to paste.'),
  card('vercel', 'Vercel', 'site-domain', [planned('handoff')], ['planned: handoff'], 'https://vercel.com/', 'Hosting help is planned.'),
  card('stripe', 'Stripe', 'payments', [planned('handoff'), planned('write')], ['planned: handoff', 'planned: write'], 'https://stripe.com/', 'Invite only for new Indian businesses.'),
  card('google-workspace', 'Google Workspace', 'email', [planned('handoff'), planned('read')], ['planned: handoff', 'planned: read'], 'https://workspace.google.com/', 'Mail reading is planned.'),
  card('calendly', 'Calendly', 'booking', [planned('handoff'), planned('read')], ['planned: handoff', 'planned: read'], 'https://calendly.com/', 'Booking links are planned.'),
  card('chausar-crm', 'Chausar CRM', 'customers', [{ mode: 'read', status: 'available', qualification: 'built-in', what: 'Your clients, inside Chausar.' }, { mode: 'write', status: 'available', qualification: 'built-in', what: 'Add clients inside Chausar.' }], ['read', 'write'], null, 'Built in.'),
  card('whatsapp', 'WhatsApp', 'messaging', [planned('handoff'), planned('write')], ['planned: handoff', 'planned: write'], 'https://business.whatsapp.com/', "WhatsApp's business rules limit AI-first chat services; read them before using WhatsApp for client support."),
  card('notion', 'Notion', 'docs-ops', [planned('handoff')], ['planned: handoff'], 'https://www.notion.com/', 'Planned.'),
  card('linkedin', 'LinkedIn', 'marketing', [planned('handoff')], ['planned: handoff'], 'https://www.linkedin.com/', 'Planned.'),
  card('zoho-books', 'Zoho Books', 'books-tax', [planned('handoff'), { mode: 'read', status: 'planned', qualification: 'unqualified', what: 'Needs a Zoho sign-in. Not in this build.' }], ['planned: handoff', 'planned: read'], 'https://www.zoho.com/books/', 'Needs a Zoho sign-in. Not in this build.'),
  card('gst-registration', 'GST registration', 'legal-entity', [planned('handoff')], ['planned: handoff'], 'https://www.gst.gov.in/', 'A checklist is planned. Not legal advice.'),
  card('posthog', 'PostHog', 'analytics', [planned('handoff')], ['planned: handoff'], 'https://posthog.com/', 'The brief will add it.'),
];

// ---------------------------------------------------------------------------------------------
// Money: clients, orders, invoices, books
// ---------------------------------------------------------------------------------------------
export const client: ClientRecord = { ...base, id: 'vcl_1', kind: 'venture-client', name: 'Cafe Aroma Demo', email: 'owner@aroma.example', countryCode: 'IN', taxId: null, stateCode: '27', note: null };
export const order: OrderRecord = {
  ...base, id: 'vor_1', kind: 'venture-order', clientId: client.id, offerId: 'offer_1', quantity: '1',
  request: 'Please close my September books. The bank statement and bills are in the shared folder.', status: 'open', priceReceiptId: 'vpr_order1', deliveredOn: null, saleFactId: null,
};
export const orderReceipt: PriceReceiptRecord = {
  ...offerReceipt, id: 'vpr_order1', subject: { type: 'order', orderId: order.id },
  inputs: { ...offerReceipt.inputs, taxTreatment: 'cgst-sgst' },
  figures: [
    ...offerReceipt.figures.slice(0, 4),
    { key: 'cgst', label: 'CGST at 9%', minor: '22491', display: 'INR 224.91', currency: 'INR' },
    { key: 'sgst', label: 'SGST at 9%', minor: '22491', display: 'INR 224.91', currency: 'INR' },
    { key: 'tax', label: 'GST total', minor: '44982', display: 'INR 449.82', currency: 'INR' },
    { key: 'total', label: 'Total', minor: '294882', display: 'INR 2,948.82', currency: 'INR' },
  ],
};
const invoiceText = (title: string, number: string) => [
  `${title} ${number}`, 'From: Ledger Cafe Books', 'GSTIN: 27ZZZZZ9999Z1Z8', 'To: Cafe Aroma Demo', 'Place of supply: Maharashtra (27)', 'Issued: 01 Oct 2026    Due: 16 Oct 2026',
  '----------------------------------------', 'Monthly books  SAC 998222  1 x INR 2,499.00  INR 2,499.00', 'Subtotal  INR 2,499.00', 'CGST at 9%  INR 224.91', 'SGST at 9%  INR 224.91',
  'Total  INR 2,948.82', 'Paid  INR 0.00', 'Balance  INR 2,948.82', '----------------------------------------',
  'Every number on this invoice has a receipt in Chausar: vpr_invoice1', 'Practice invoice from an experimental Chausar build.',
].join('\n');
const invoiceFigures: InvoiceView['figures'] = [
  { key: 'subtotal', label: 'Subtotal', minor: '249900', display: 'INR 2,499.00', currency: 'INR' },
  { key: 'cgst', label: 'CGST at 9%', minor: '22491', display: 'INR 224.91', currency: 'INR' },
  { key: 'sgst', label: 'SGST at 9%', minor: '22491', display: 'INR 224.91', currency: 'INR' },
  { key: 'total', label: 'Total', minor: '294882', display: 'INR 2,948.82', currency: 'INR' },
  { key: 'paid', label: 'Paid', minor: '0', display: 'INR 0.00', currency: 'INR' },
  { key: 'balance', label: 'Balance', minor: '294882', display: 'INR 2,948.82', currency: 'INR' },
];
const EXPERIMENTAL_NOTE = "This build keeps your business in experimental storage. Practise here; don't issue real invoices yet.";
export const invoiceDraftView: InvoiceView = {
  invoice: {
    ...base, id: 'vin_1', kind: 'venture-invoice', number: null, documentTitle: 'TAX INVOICE', orderId: order.id, clientId: client.id, currency: 'INR', issueDate: '2026-10-01', dueDate: '2026-10-16', dueInDays: 15,
    lines: [{ description: 'Monthly books', quantity: '1', unitMinor: '249900', amountMinor: '249900' }], subtotalMinor: '249900', discountMinor: '0', taxMinor: '44982', totalMinor: '294882',
    taxLabel: 'GST', taxRateBps: '1800', taxTreatment: 'cgst-sgst', taxLines: [{ label: 'CGST at 9%', rateBps: '900', minor: '22491' }, { label: 'SGST at 9%', rateBps: '900', minor: '22491' }],
    supplierTaxId: '27ZZZZZ9999Z1Z8', clientTaxId: null, placeOfSupply: 'Maharashtra (27)', sacCode: '998222', priceReceiptId: 'vpr_invoice1', status: 'draft', digest: hex('7'),
    issuedAt: null, factIds: [], booksReceiptId: null, booksNote: null, paidMinor: '0', balanceMinor: '294882',
  },
  client, receipt: { ...orderReceipt, id: 'vpr_invoice1' }, payments: [], documentText: invoiceText('TAX INVOICE', 'DRAFT'), figures: invoiceFigures, notes: [EXPERIMENTAL_NOTE],
};
export const invoiceIssuedView: InvoiceView = {
  ...invoiceDraftView,
  invoice: { ...invoiceDraftView.invoice, number: 'INV-0001', status: 'issued', issuedAt: at, factIds: ['fact_inv_1'], booksReceiptId: 'rcpt_billed_1' },
  documentText: invoiceText('TAX INVOICE', 'INV-0001'),
};
export const booksSummary: BooksSummary = {
  period: { from: '2026-10-01', to: '2026-10-31' }, currency: 'INR',
  figures: [
    { operation: 'billed', label: 'Billed (without tax)', receiptId: 'rcpt_billed_1', minor: '249900', display: 'INR 2,499.00', stale: false },
    { operation: 'received', label: 'Received (with tax)', receiptId: 'rcpt_received_1', minor: '294882', display: 'INR 2,948.82', stale: false },
    { operation: 'earned', label: 'Earned (without tax)', receiptId: 'rcpt_earned_1', minor: '249900', display: 'INR 2,499.00', stale: false },
  ],
  openInvoices: [{ invoiceId: 'vin_1', number: 'INV-0001', clientName: 'Cafe Aroma Demo', balanceMinor: '294882', balanceDisplay: 'INR 2,948.82', dueDate: '2026-10-16' }],
  notes: [
    'Billed and earned leave out tax. Received is the cash that came in, tax included.',
    "The back office's receivable aging compares invoices without tax to cash with tax, so use these invoice balances for taxed invoices.",
    EXPERIMENTAL_NOTE,
  ],
};
export const calculatorReceipt = {
  id: 'rcpt_billed_1', operation: 'billed', currency: 'INR', period: { from: '2026-10-01', to: '2026-10-31' },
  figures: [{ key: 'billed', label: 'Billed', minor: '249900', display: 'INR 2,499.00', unit: 'money', currency: 'INR' }],
  explanation: 'Billed from one invoice fact in the books.', coverage: { selectedRows: 1, countedRows: 1, excludedRows: 0 }, stale: false,
};

// ---------------------------------------------------------------------------------------------
// Delivery: playbook, rehearsal, ladder, draft replies, capabilities
// ---------------------------------------------------------------------------------------------
export const playbook: PlaybookRecord = {
  ...base, id: 'vpb_1', kind: 'venture-playbook', version: 1, hash: hex('4'), blueprintDigest: hex('d'), serviceType: 'bookkeeping', validated: true, tierCeiling: 'actor',
  steps: [
    { id: 'gather', kind: 'gather', title: "Read the client's message and pull out what is needed", tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [] },
    { id: 'clarify', kind: 'question', title: 'Decide what is still unclear', tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: ['questions-raised'] },
    { id: 'price', kind: 'compute', title: 'Take prices from the calculator', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['figures-resolve'] },
    { id: 'draft', kind: 'write', title: 'Draft the monthly report for review', tier: 'actor', model: 'main', doneBy: 'agent', requiredSections: ['Summary', 'What we will do', 'What we need from you', 'Next steps'], checks: ['no-numeric-prose', 'figures-resolve', 'required-sections', 'house-style', 'length-bounds', 'no-done-claims'] },
    { id: 'verify', kind: 'verify', title: 'Check the draft', tier: 'code', model: null, doneBy: 'agent', requiredSections: [], checks: ['no-numeric-prose', 'figures-resolve', 'required-sections', 'no-outside-writes', 'house-style', 'length-bounds', 'no-done-claims'] },
    { id: 'approve', kind: 'approve', title: 'You review the draft', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: [] },
    { id: 'send', kind: 'operator', title: 'Send it to the client (you copy it for now)', tier: 'code', model: null, doneBy: 'you', requiredSections: [], checks: ['no-outside-writes'] },
  ],
};
const scenario = (kind: 'clean' | 'messy' | 'pushback', title: string): Scenario => ({
  id: `bookkeeping-${kind}`, serviceType: 'bookkeeping', title, persona: 'A cafe owner with a busy month.', brief: 'Please do my monthly books.', expectedOutcome: 'A clear reply that says what will be done and what is needed.',
  stoppingCriteria: ['deliverable-ready', 'client-asks-for-person', 'turn-limit'], turnLimit: 2, episodes: 1, mocks: { 'mail-app.send-deliverable': 'record-only' },
  checks: ['no-numeric-prose', 'figures-resolve', 'required-sections', 'no-outside-writes', 'house-style', 'length-bounds', 'turn-limit', 'no-done-claims'], source: 'template', signalId: null,
});
export const scenarios: Scenario[] = [scenario('clean', 'A tidy client'), scenario('messy', 'A messy client'), scenario('pushback', 'A pushy client')];
export function simulationRun(scenarioId: string, options: { runId?: string; passed?: boolean; modelMode?: SimulationRunRecord['modelMode']; firstFailure?: string | null } = {}): SimulationRunRecord {
  const passed = options.passed ?? true;
  const template = options.modelMode === 'template';
  return {
    ...base, id: options.runId ?? `vsr_${scenarioId}`, kind: 'venture-simulation-run', playbookId: playbook.id, playbookHash: playbook.hash, scenarioIds: [scenarioId],
    episodes: [{
      scenarioId, index: 0, turns: [{ turn: 1, by: 'client', text: 'Please do my monthly books.', author: template ? 'template' : 'model', callId: null }],
      deliverable: null, renderedText: '# Your monthly books', mocks: [], checks: [], passed, firstFailure: passed ? null : options.firstFailure ?? 'No claims of finished work',
      judge: (['goal-met', 'tone-fits', 'policy-followed', 'no-unbacked-claims'] as const).map(question => ({ question, answer: template ? 'not-judged' : 'yes', reason: template ? 'No AI judge connected.' : 'Fine.', callId: null })),
      costMicros: template ? '0' : '2100',
    }],
    passed, summary: { scenarios: 1, passed: passed ? 1 : 0, failed: passed ? 0 : 1 }, costMicros: template ? '0' : '2100', costDisplay: template ? 'USD 0.0000' : 'USD 0.0021',
    startedAt: at, finishedAt: at, modelMode: options.modelMode ?? 'model',
  };
}
export const launchStatus: LaunchStatus = {
  stage: 'shadow',
  stages: [
    { stage: 'rehearsal', allowed: true, reason: '', status: 'available' },
    { stage: 'shadow', allowed: true, reason: '', status: 'available' },
    { stage: 'approve-each', allowed: true, reason: '', status: 'available' },
    { stage: 'approve-sample', allowed: false, reason: 'Planned. Needs a sampling rule first.', status: 'planned' },
    { stage: 'auto-spot-check', allowed: false, reason: 'Planned. Not in this build.', status: 'planned' },
  ],
  rehearsal: scenarios.map(item => ({ scenarioId: item.id, runId: `vsr_${item.id}`, passed: true, judged: true })),
  lastRunId: 'vsr_bookkeeping-pushback', lastRunPassed: true, acceptedDeliveries: 0,
  improvement: { judged: 0, rejectedOrEdited: 0, due: false, reason: 'Not enough judged deliveries yet.', status: 'planned' },
};
export const launchStatusRehearsal: LaunchStatus = {
  ...launchStatus, stage: 'rehearsal',
  stages: launchStatus.stages.map(item => (item.stage === 'shadow' ? { ...item, allowed: false, reason: "Connect an AI and rehearse with it first. Template outlines can't be judged." } : item.stage === 'approve-each' ? { ...item, allowed: false, reason: 'Rehearse with your AI first, then move to shadow.' } : item)),
  rehearsal: scenarios.map(item => ({ scenarioId: item.id, runId: null, passed: null, judged: false })),
};

const draftText = '# Your September books\n\n## Summary\nWe will close your September books once the statement and bills arrive.\n\n## What we will do\nTotal: INR 2,948.82\n\nQuestions for you:\n- Is anything missing that we should know before we start?';
export const waitingRun: DeliveryRunRecord = {
  ...base, id: 'vdr_wait', kind: 'venture-delivery-run', orderId: order.id, playbookId: playbook.id, playbookHash: playbook.hash, status: 'waiting-for-you', servedBy: 'model', practice: true, callId: 'vcall_wait',
  preview: {
    callId: 'vcall_wait', payloadText: JSON.stringify({ model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: order.request }] }), digest: hex('5'), presetId: 'anthropic-sonnet-5-5', model: 'claude-sonnet-5-5',
    endpoint: 'https://api.anthropic.com/v1/messages', estimatedMaxCostMicros: '64000', estimatedMaxCostDisplay: 'USD 0.0640', expiresAt: '2026-10-15T10:00:00.000Z',
  },
  deliverable: null, renderedText: null, checks: [], verdict: null, editedText: null,
};
export const practiceRun: DeliveryRunRecord = {
  ...waitingRun, id: 'vdr_practice', status: 'ready-for-review', preview: null, renderedText: draftText,
  checks: [{ check: 'no-done-claims', passed: true, detail: 'No claims of finished work.' }, { check: 'figures-resolve', passed: true, detail: 'Every figure has a receipt.' }],
};
export const outlineRun: DeliveryRunRecord = {
  ...practiceRun, id: 'vdr_outline', servedBy: 'template', practice: false, callId: null,
  renderedText: `Template outline. No AI wrote this and it doesn't read the client's request.\n${draftText}`,
};
export const capabilities: CapabilityStatus[] = ([
  ['venture-actor', 'runtime', 'Business record', 'available', 'One durable record per business in your vault. Every change is one committed action.'],
  ['venture-events', 'runtime', 'Event log', 'available', 'The app reads the event log; there is no push yet.'],
  ['schedules', 'runtime', 'Schedules', 'planned', 'Repo checks and briefs run when you click, for now.'],
  ['hosted-actors', 'runtime', 'Hosted web app', 'planned', 'A hosted web app is not built; Rivet Actors are the candidate runtime.'],
  ['tier-code', 'runtime', 'Code steps', 'available', 'Runs inside Chausar. No tools and no agent-written code. Not a sandbox.'],
  ['tier-actor', 'runtime', 'Model steps', 'available', 'Model calls and drafting inside Chausar. No tools and no agent-written code. Not a sandbox.'],
  ['durable-storage', 'storage', 'Durable storage', 'planned', EXPERIMENTAL_NOTE],
  ['tier-wasm-lite', 'sandbox', 'Plugin sandbox', 'available', 'The back office plugin sandbox. Delivery agents do not use it yet.'],
  ['tier-wasm', 'sandbox', 'Full sandbox', 'unavailable', 'Not available on Windows yet.'],
  ['tier-container', 'sandbox', 'Containers', 'planned', 'Needs Docker Desktop.'],
  ['tier-hosted', 'sandbox', 'Hosted sandboxes', 'planned', 'Needs your own E2B, Sail or Cloudflare account.'],
  ['model-fast', 'models', 'Quick work AI', 'available', 'Uses your Anthropic key.'],
  ['model-main', 'models', 'Plans and drafts AI', 'available', 'Uses your Anthropic key.'],
  ['agent-tools', 'connectors', 'Agent tools', 'planned', "Agents can't read files, inboxes or the web yet; they draft from the client's message."],
  ['handoff-links', 'connectors', 'Builder links', 'available', 'Lovable and Replit open with your brief; Bolt and v0 get it copied.'],
  ['github-read', 'connectors', 'GitHub read', 'available', 'Tested on recordings, not yet on a live account.'],
  ['outside-writes', 'connectors', 'Outside writes', 'planned', 'Payment links, email and posts wait for a later build.'],
] as const).map(([id, group, text, state, reason]) => ({ id, group, label: text, state, reason }));

export const events: VentureEventRecord[] = (['blueprint-accepted', 'brief-ready', 'handoff-prepared', 'handoff-opened', 'repo-linked', 'repo-synced'] as const)
  .map((name, index) => ({ ...base, id: `vev_${index + 9}`, kind: 'venture-event', seq: index + 9, name, data: null }));
export const LAST_SEQ = 14;
