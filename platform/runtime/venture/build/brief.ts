// Chausar venture launcher: the build brief (package P4).
// Code assembles the brief in a fixed order. Words come from a model (only words, never numbers) or from a
// built-in template. Every price is copied from the newest current price receipt; the brief never carries
// client names, client requests, emails or phone numbers, because nothing about clients is ever read here.
import { authorize, check, hash, type Context, type State } from '../../contracts.ts';
import { SERVICE_TYPE_LABELS } from '../contracts.ts';
import type {
  BlueprintRecord, BriefModelOutput, BriefRecord, CountryProfile, DateOrder, Json, ModelTask, Offer, PriceReceiptRecord, ServiceType,
  VentureDeps, VentureRecord,
} from '../contracts.ts';
import { copiedTokens, digest, exactPayload, listRecords, modelNumbers, modelWords, readVenture, tidyWords, ventureAction } from '../records.ts';
import type { BriefLint } from '../contracts.ts';
import {
  ANON_KEY_LINE, BRIEF_HEADINGS, LINTAPPLE_LINE, NO_TRACKING_LINE, RLS_LINE, SIGN_IN_LINE, UI_POLICY_LINE, WORKFLOW_LINE, WORKFLOW_STEPS_LINE,
  lintBrief,
} from './brief-lint.ts';
import {SITE_UI_ARTIFACT_GUIDANCE} from '../playbooks/website-studio/ui-contract.ts';
import {siteScreenFlowText,type SiteFlowPage} from '../playbooks/website-studio/screen-flow.ts';
import { connectorName } from './catalogue.ts';

export const BRIEF_INSTRUCTIONS = 'Write the words for a build brief that a website builder will follow. Describe what to build, who it is for, the pages and how it should feel. Never write digits, prices, percentages or amounts; Chausar inserts every number. Plain words, no dashes, no hype.';

export const BRIEF_SCHEMA: Json = {
  type: 'object', additionalProperties: false,
  required: ['whatToBuild', 'whoItIsFor', 'pages', 'lookAndFeel', 'doneMeans'],
  properties: {
    whatToBuild: { type: 'string', description: 'One paragraph. No digits.' },
    whoItIsFor: { type: 'string', description: 'Who the site serves. No digits.' },
    pages: {
      type: 'array', items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'purpose'],
        properties: { title: { type: 'string' }, purpose: { type: 'string', description: 'One sentence with one main action. No digits.' } },
      },
    },
    lookAndFeel: { type: 'string', description: 'How it should feel. No digits.' },
    doneMeans: { type: 'array', items: { type: 'string', description: 'A checkable line. No digits.' } },
  },
};

// ---------------------------------------------------------------------------
// Template words (no AI). Fixed words carry no digits, no house-style words and no claims of finished work.
// ---------------------------------------------------------------------------

const TEMPLATE_WORK: Readonly<Record<ServiceType, { work: string; area: string }>> = Object.freeze({
  agency: { work: 'Clients say what they want to promote, then review each plan and draft before anything goes out.', area: 'A signed-in page where each client sees their own plans and drafts and sends notes.' },
  studio: { work: 'Clients send their brief and files, then review drafts before the final version.', area: 'A signed-in page where each client shares files and reviews their own drafts.' },
  consulting: { work: 'Clients ask for a first conversation and share notes before each session.', area: 'A signed-in page where each client keeps their own notes and next steps.' },
  bookkeeping: { work: 'Clients upload bills and bank statements and see where their monthly books stand.', area: 'A signed-in page where each client uploads bills and statements and sees their own requests.' },
  research: { work: 'Clients describe the question they need answered and receive the findings in their own area.', area: 'A signed-in page where each client sees their own questions and findings.' },
  content: { work: 'Clients send topics and notes, then review each draft before it is published.', area: 'A signed-in page where each client sends topics and reviews their own drafts.' },
  support: { work: 'Business owners describe their product and support needs, then review the replies drafted for their customers.', area: 'A signed-in page where each client sees their own support requests and drafted replies.' },
  teaching: { work: 'Learners or parents ask for a class, pick a time and follow their progress notes.', area: 'A signed-in page where each learner sees their own classes, worksheets and progress notes.' },
  'local-services': { work: 'Customers ask for a visit, see the quote and pick a time that suits them.', area: 'A signed-in page where each customer sees their own bookings, quotes and reminders.' },
  licensed: { work: 'Clients book a consultation and share their papers before it.', area: 'A signed-in page where each client shares their own papers and sees their next steps.' },
  other: { work: 'Clients describe what they need and follow their requests in one place.', area: 'A signed-in page where each client sees their own requests and files.' },
});

export const TEMPLATE_FIXED_WORDS = Object.freeze({
  intro: 'A public website and a private client area for',
  visitors: 'Visitors learn what the business does, see the offers and prices, and ask to start. Each signed-in client sees only their own requests and files.',
  reader: 'They often read on a phone, so keep the words short and plain.',
  pages: Object.freeze([
    { title: 'Home', purpose: 'Say what the business does in one line and show one button to start a request.' },
    { title: 'Offers and prices', purpose: 'Show each offer with its price exactly as written in this brief.' },
    { title: 'How it works', purpose: 'Explain in a few short steps how work moves from the first message to the result.' },
    { title: 'Start a request', purpose: 'A short form that saves the request and shows a consent line.' },
    { title: 'Client area', purpose: '' },
    { title: 'Privacy and terms', purpose: 'Headings only, for the owner to fill in. Do not write legal text.' },
  ]),
  lookAndFeel: 'Calm and plain, with plenty of white space, one accent colour and large, easy to read text.',
  doneMeans: Object.freeze([
    'Every page works on a phone and a computer',
    'Every price matches the offer section exactly',
    'The request form saves a request and shows a thank you line',
    'A signed-in client sees only their own requests and files',
    'The brief id is in AGENTS.md or replit.md and in the page head',
    'The UI lint workflow runs on every push',
  ]),
});

function sentence(value: string): string {
  const words = tidyWords(value);
  return /[.!?]$/.test(words) ? words : `${words}.`;
}

/** Words for a composed plan with no client area: the parts of the template that assume one are left out. */
export const OPEN_SITE_WORDS = Object.freeze({
  intro: 'A public website for',
  visitors: 'Visitors learn what the business does, see the offers and prices, and ask to start.',
  uploads: 'Keep client uploads private to that client.',
  clientArea: 'A signed-in client sees only their own requests and files',
  composedPages: 'Use these pages, in this order. Add the legal pages the country line asks for on top of them.',
});

/** The plan's own pages (a composed plan), 4 to 6 of them, as brief pages. Null for a template plan. */
export function planPages(blueprint: BlueprintRecord): { title: string; purpose: string }[] | null {
  const pages = blueprint.pages;
  if (!pages || pages.length === 0) return null;
  return pages.map(page => ({ title: tidyWords(page.title.value), purpose: sentence(page.purpose.value) }));
}

/** A composed plan has a private client area only when one of its pages is the client-area block. Template plans always do. */
export function hasClientArea(blueprint: BlueprintRecord): boolean {
  return !blueprint.pages || blueprint.pages.length === 0 || blueprint.pages.some(page => page.block === 'client-area');
}

/**
 * Template brief words for a service type. Only the business name and customer line come from the plan, and for a
 * composed plan its own pages; without a client-area page the lines that assume a private client area are left out.
 */
export function briefTemplateWords(serviceType: ServiceType, plan: { name: string; customer: string; pages?: { title: string; purpose: string }[] | null; clientArea?: boolean }): BriefModelOutput {
  const detail = TEMPLATE_WORK[serviceType] ?? TEMPLATE_WORK.other;
  const fixed = TEMPLATE_FIXED_WORDS;
  const clientArea = plan.clientArea !== false;
  return {
    whatToBuild: clientArea ? `${fixed.intro} ${tidyWords(plan.name)}. ${detail.work} ${fixed.visitors}` : `${OPEN_SITE_WORDS.intro} ${tidyWords(plan.name)}. ${OPEN_SITE_WORDS.visitors}`,
    whoItIsFor: `${sentence(plan.customer)} ${fixed.reader}`,
    pages: plan.pages ? plan.pages.map(page => ({ ...page })) : fixed.pages.map(page => ({ title: page.title, purpose: page.purpose || detail.area })),
    lookAndFeel: fixed.lookAndFeel,
    doneMeans: clientArea ? [...fixed.doneMeans] : fixed.doneMeans.filter(line => line !== OPEN_SITE_WORDS.clientArea),
  };
}

/** The template's own words for a service type (no plan words), for the no-digits test. */
export function templateFixedText(serviceType: ServiceType): string[] {
  const detail = TEMPLATE_WORK[serviceType];
  const fixed = TEMPLATE_FIXED_WORDS;
  return [fixed.intro, detail.work, detail.area, fixed.visitors, fixed.reader, fixed.lookAndFeel,
    ...fixed.pages.flatMap(page => [page.title, page.purpose]).filter(Boolean), ...fixed.doneMeans];
}

// ---------------------------------------------------------------------------
// Model output validation: words only, within BriefModelOutput limits.
// ---------------------------------------------------------------------------

/** Every line of words in a brief's model output. */
function briefWordList(words: BriefModelOutput): string[] {
  return [words.whatToBuild, words.whoItIsFor, ...words.pages.flatMap(page => [page.title, page.purpose]), words.lookAndFeel, ...words.doneMeans];
}

/**
 * One-shot A1 (row 13): the three text fields, with their limits. A field past its limit is cut, never refused; an
 * empty one is asked for again on its own (writeBrief), so one bad field never throws the whole answer away.
 */
const TEXT_FIELDS = Object.freeze({
  whatToBuild: { field: 'description of what to build', words: 'what to build', max: 600, multiline: true },
  whoItIsFor: { field: 'description of who it is for', words: 'who it is for', max: 400, multiline: false },
  lookAndFeel: { field: 'look and feel', words: 'how it should look and feel', max: 300, multiline: false },
});
export type BriefTextField = keyof typeof TEXT_FIELDS;
const TEXT_FIELD_NAMES = Object.keys(TEXT_FIELDS) as BriefTextField[];

/** The model's text cut to max characters: at the last full sentence when that keeps most of it, else at a word. */
export function fitWords(value: string, max: number, multiline = false): string {
  const words = tidyWords(value, multiline);
  if (words.length <= max) return words;
  const head = words.slice(0, max);
  const sentence = Math.max(...['. ', '! ', '? ', '.\n', '!\n', '?\n'].map(end => head.lastIndexOf(end)));
  if (sentence >= max / 2) return head.slice(0, sentence + 1);
  const space = Math.max(head.lastIndexOf(' '), head.lastIndexOf('\n'));
  return (space > 0 ? head.slice(0, space) : head).replace(/[\s,;:]+$/u, '');
}

/** True when a text field came back empty or not at all, so it is asked for again. */
const emptyText = (value: unknown): boolean => value === undefined || value === null || (typeof value === 'string' && tidyWords(value, true).length === 0);

/** One text field: cut to its limit and checked as model words; '' when it came back empty. */
function textField(value: unknown, name: BriefTextField, allowed: readonly string[]): string {
  if (emptyText(value)) return '';
  const spec = TEXT_FIELDS[name];
  return modelWords(typeof value === 'string' ? fitWords(value, spec.max, spec.multiline) : value, spec.field, spec.max, { allowed, multiline: spec.multiline });
}

/** The text fields a brief's words still lack. */
export function missingTextFields(words: BriefModelOutput): BriefTextField[] {
  return TEXT_FIELD_NAMES.filter(name => words[name] === '');
}

export function validateBriefOutput(raw: unknown, allowed: readonly string[]): BriefModelOutput {
  const body = exactPayload(raw, ['whatToBuild', 'whoItIsFor', 'pages', 'lookAndFeel', 'doneMeans'], ['pages', 'doneMeans'], 'MODEL_OUTPUT_REJECTED');
  const whatToBuild = textField(body.whatToBuild, 'whatToBuild', allowed);
  const whoItIsFor = textField(body.whoItIsFor, 'whoItIsFor', allowed);
  check(Array.isArray(body.pages) && body.pages.length >= 4 && body.pages.length <= 6, 'MODEL_OUTPUT_REJECTED', 'The brief needs four to six pages.');
  const pages = (body.pages as unknown[]).map(page => {
    const item = exactPayload(page, ['title', 'purpose'], ['title', 'purpose'], 'MODEL_OUTPUT_REJECTED');
    return {
      title: modelWords(typeof item.title === 'string' ? fitWords(item.title, 60) : item.title, 'page title', 60, { allowed }),
      purpose: modelWords(typeof item.purpose === 'string' ? fitWords(item.purpose, 200) : item.purpose, 'page purpose', 200, { allowed }),
    };
  });
  const lookAndFeel = textField(body.lookAndFeel, 'lookAndFeel', allowed);
  // An empty done line is dropped; four to eight must stay.
  const lines = Array.isArray(body.doneMeans) ? (body.doneMeans as unknown[]).filter(item => !emptyText(item)) : null;
  check(lines && lines.length >= 4 && lines.length <= 8, 'MODEL_OUTPUT_REJECTED', 'The brief needs four to eight done lines.');
  const doneMeans = lines.map(item => modelWords(typeof item === 'string' ? fitWords(item, 120) : item, 'done line', 120, { allowed }));
  return { whatToBuild, whoItIsFor, pages, lookAndFeel, doneMeans };
}

const FILL_LINE = 'Write only the fields listed in writeOnly; the rest of the brief is written.';

/** The words a brief task lets the model copy (its own validate closes over them; the fill task needs the same). */
const ALLOWED_OF = new WeakMap<object, readonly string[]>();

/**
 * The second ask (one-shot A1, row 13): only the text fields the first answer left empty, with the rest of the brief as
 * it stands, plan words only. Each field must come back this time; still empty is refused, naming it.
 */
export function briefFillTask(base: ModelTask<BriefModelOutput>, missing: readonly BriefTextField[], words: BriefModelOutput, template: () => BriefModelOutput): ModelTask<Partial<BriefModelOutput>> {
  const allowed = ALLOWED_OF.get(base) ?? [];
  const written = Object.fromEntries(TEXT_FIELD_NAMES.filter(name => !missing.includes(name)).map(name => [name, words[name]]));
  const properties = (BRIEF_SCHEMA as { properties: Record<string, Json> }).properties;
  return {
    purpose: base.purpose,
    // D2: a fixed line; which fields to write is in the input (writeOnly), so the fixed prompt stays the same.
    instructions: `${base.instructions} ${FILL_LINE}`,
    input: { ...(base.input as Record<string, Json>), writeOnly: missing.map(name => TEXT_FIELDS[name].words), written, writtenPages: words.pages.map(page => ({ ...page })) } as Json,
    schemaName: 'venture-brief-fill',
    schema: { type: 'object', additionalProperties: false, required: [...missing], properties: Object.fromEntries(missing.map(name => [name, properties[name]!])) },
    validate: raw => {
      const body = exactPayload(raw, [...missing], [...missing], 'MODEL_OUTPUT_REJECTED');
      return Object.fromEntries(missing.map(name => {
        check(!emptyText(body[name]), 'MODEL_OUTPUT_REJECTED', `The ${TEXT_FIELDS[name].field} was empty.`);
        return [name, textField(body[name], name, allowed)];
      }));
    },
    template: () => { const fixed = template(); return Object.fromEntries(missing.map(name => [name, fixed[name]])); },
    containsClientData: false,
    maxOutputTokens: 1024,
  };
}

// ---------------------------------------------------------------------------
// Plan and price lookups
// ---------------------------------------------------------------------------

export function acceptedBlueprint(state: State, venture: VentureRecord): BlueprintRecord {
  const id = venture.acceptedBlueprintId;
  const blueprint = id ? listRecords(state, 'venture-blueprint', venture.id).find(b => b.id === id) : undefined;
  check(blueprint && blueprint.status === 'accepted', 'BLUEPRINT_NOT_ACCEPTED', 'Accept your plan before writing the build brief.');
  return blueprint;
}

/** The newest non-stale receipt for an offer of this blueprint version, or null. */
export function currentOfferReceipt(state: State, ventureId: string, offerId: string, blueprintDigest: string): PriceReceiptRecord | null {
  let newest: PriceReceiptRecord | null = null;
  for (const receipt of listRecords(state, 'venture-price-receipt', ventureId)) {
    if (receipt.subject.type !== 'offer' || receipt.subject.offerId !== offerId) continue;
    if (receipt.inputs.blueprintDigest !== blueprintDigest || receipt.stale === true) continue;
    if (!newest || receipt.at >= newest.at) newest = receipt;
  }
  return newest;
}

export type PricedOffer = { offer: Offer; receipt: PriceReceiptRecord | null };

/** Every priced offer needs a current receipt, so a priced offer is never written as "price to be set". */
export function pricedOffers(state: State, venture: VentureRecord, blueprint: BlueprintRecord): PricedOffer[] {
  return blueprint.offers.map(offer => {
    if (offer.pricing.unitPriceMinor === null) return { offer, receipt: null };
    const receipt = currentOfferReceipt(state, venture.id, offer.id, blueprint.digest);
    check(receipt && receipt.figures.some(f => f.key === 'total'), 'PRICE_REQUIRED', `Price ${offer.name.value} again before writing the brief.`);
    return { offer, receipt };
  });
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

const DATE_WORDS: Readonly<Record<DateOrder, string>> = Object.freeze({
  'day-month-year': 'day, then month, then year',
  'month-day-year': 'month, then day, then year',
  'year-month-day': 'year, then month, then day',
});

/** 'GST' stays as it is; 'Sales tax' reads as 'sales tax' inside a sentence. */
function taxWords(label: string): string {
  return label === label.toUpperCase() ? label : label.charAt(0).toLowerCase() + label.slice(1);
}

function offerLine(item: PricedOffer, taxLabel: string): string {
  const name = tidyWords(item.offer.name.value);
  const description = tidyWords(item.offer.description.value);
  if (!item.receipt) return `- ${name}: price to be set. ${description}`;
  const total = item.receipt.figures.find(f => f.key === 'total')!;
  const quantity = item.receipt.inputs.quantity;
  const unit = item.offer.pricing.quantityUnit;
  const per = quantity === '1' ? `per ${unit}` : `for ${quantity} ${unit}s`;
  const tax = item.receipt.figures.find(f => f.key === 'tax');
  const taxed = item.receipt.inputs.taxTreatment !== 'none' && !!tax && tax.minor !== '0';
  return `- ${name}: ${total.display} ${per}${taxed ? `, including ${taxWords(taxLabel)}` : ''}. ${description}`;
}

export type BriefParts = {
  flowPages?: readonly SiteFlowPage[];
  briefId: string;
  serviceType: ServiceType;
  words: BriefModelOutput;
  offers: PricedOffer[];
  taxLabel: string;
  paymentRail: string;
  country: CountryProfile;
  /** False for a composed plan without a client-area page: no sign-in, row security or private-upload lines. */
  clientArea?: boolean;
};

/** The markdown, assembled by code in the fixed order. */
export function assembleBrief(parts: BriefParts): string {
  const { briefId, words, country } = parts;
  const h = BRIEF_HEADINGS;
  const countryLine = [
    `Currency: ${country.currency}.`,
    `Dates: ${DATE_WORDS[country.dateOrder] ?? DATE_WORDS['day-month-year']}.`,
    tidyWords(country.tax.registrationNote ?? ''),
    parts.paymentRail === 'razorpay' ? 'International cards need Terms, Privacy, Refund and Shipping pages, so add them.' : '',
  ].filter(Boolean).join(' ');
  const blocks: string[][] = [
    [`Build brief from Chausar. Business type: ${SERVICE_TYPE_LABELS[parts.serviceType]}. Brief id: ${briefId}.`],
    [h[0], words.whatToBuild],
    [h[1], words.whoItIsFor],
    [h[2], 'Show these prices exactly as written. Do not round, convert or add tax yourself.', ...parts.offers.map(item => offerLine(item, parts.taxLabel))],
    [h[3], ...words.pages.map((page, i) => `${i + 1}. ${page.title}: ${page.purpose}`), ...(parts.flowPages ? [siteScreenFlowText(parts.flowPages)] : [])],
    parts.clientArea === false
      ? [h[4], 'Collect only the fields each form needs. Show a consent line on every form.', ANON_KEY_LINE, NO_TRACKING_LINE]
      : [h[4],
        `Collect only the fields each form needs. Show a consent line on every form. ${OPEN_SITE_WORDS.uploads}`,
        RLS_LINE, SIGN_IN_LINE, ANON_KEY_LINE, NO_TRACKING_LINE],
    [h[5], `Chausar is the back office. Do not build invoices, totals, tax maths or a ledger. Put every pay button link in one file, site.config.ts, as a placeholder the owner fills in. Keep secrets out of the code. Payments use ${connectorName(parts.paymentRail)}.`],
    [h[6], words.lookAndFeel,
      '- Use the system font stack, starting with system-ui.',
      '- One main button per page.',
      '- Body text at least 15px. Buttons at least 24px tall.',
      "- Follow the device's light or dark setting.",
      '- Nothing loops or blinks. No spinners.',
      'UI check, copy exactly:',
      LINTAPPLE_LINE, UI_POLICY_LINE,
      '- Add tests/ui.spec.ts that imports test from @playwright/test and expectUI from lintapple/playwright, visits every route, and calls expectUI(page, testInfo, policy) with the policy from ui-policy.json.',
      WORKFLOW_LINE, WORKFLOW_STEPS_LINE, SITE_UI_ARTIFACT_GUIDANCE],
    [h[7], countryLine],
    [h[8],
      'Keep GitHub sync on, on the main branch. Create AGENTS.md (Lovable) or replit.md (Replit) at the root, starting with these two lines:',
      ...briefMarkerLines(briefId),
      `Add <meta name="chausar-brief" content="${briefId}"> to the page head.`],
    [h[9], ...words.doneMeans.map(item => `- [ ] ${item}`)],
    [h[10], 'No invented reviews, client counts, awards or results. No features beyond this brief. Ask before guessing.'],
  ];
  return blocks.map(block => block.join('\n')).join('\n\n');
}

/** The two lines AGENTS.md or replit.md starts with: the brief's own words, and the file a saved brief comes with. */
export function briefMarkerLines(briefId: string): string[] {
  return [`chausar-brief-id: ${briefId}`, 'Money numbers come from Chausar. Do not compute totals or tax.'];
}

export function briefIdFor(ventureId: string, version: number): string {
  return `chb_${hash(`${ventureId}:${version}`).slice(0, 8)}`;
}

/** The lint for this plan: a composed plan without a client-area page doesn't need the row security and sign-in lines. */
export function lintFor(markdown: string, receipts: readonly PriceReceiptRecord[], briefId: string, clientArea: boolean): BriefLint {
  return lintBrief(markdown, receipts, briefId, { clientArea });
}

/** The model task: plan words only, never amounts and never client data. */
export function briefTask(venture: VentureRecord, blueprint: BlueprintRecord, template: () => BriefModelOutput): ModelTask<BriefModelOutput> {
  const allowed = copiedTokens(venture.idea);
  const pages = planPages(blueprint);
  const instructions = pages ? `${BRIEF_INSTRUCTIONS} ${OPEN_SITE_WORDS.composedPages}${hasClientArea(blueprint) ? '' : ' There is no signed-in client area: do not add one.'}` : BRIEF_INSTRUCTIONS;
  const task: ModelTask<BriefModelOutput> = {
    purpose: 'brief',
    instructions,
    input: {
      serviceType: blueprint.serviceType,
      name: blueprint.name.value,
      oneLiner: blueprint.oneLiner.value,
      customer: blueprint.customer.value,
      offers: blueprint.offers.map(offer => ({ name: offer.name.value, description: offer.description.value })),
      // A flagship plan lists the steps that run (playbooks/steps.ts); the builder brief describes those.
      steps: blueprint.flagshipSteps?.map(step => step.title.value) ?? blueprint.deliverySteps.map(step => step.title.value),
      country: venture.country.name,
      ...(pages ? { pages } : {}),
    },
    schemaName: 'venture-brief',
    schema: BRIEF_SCHEMA,
    validate: raw => validateBriefOutput(raw, allowed),
    template,
    containsClientData: false,
    maxOutputTokens: 4096,
  };
  ALLOWED_OF.set(task, allowed);
  return task;
}

// ---------------------------------------------------------------------------
// venture.build.brief { useTemplate? } (level prepare)
// ---------------------------------------------------------------------------

export async function writeBrief(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BriefRecord> {
  // One-shot C3 task 9: one model call, so one step.
  const work = deps.work?.begin('brief', ['write']);
  work?.step('write', 'current');
  try {
    const brief = await writeBriefNow(deps, ctx, payload);
    work?.step('write', 'done');
    return brief;
  } catch (error) {
    work?.failCurrent();
    throw error;
  } finally {
    work?.end();
  }
}

async function writeBriefNow(deps: VentureDeps, ctx: Context, payload: unknown): Promise<BriefRecord> {
  const body = exactPayload(payload ?? {}, ['useTemplate']);
  if (body.useTemplate !== undefined) check(typeof body.useTemplate === 'boolean', 'INVALID_VENTURE_REQUEST', 'useTemplate must be true or false.');
  authorize(deps.store, ctx, 'prepare'); // before any model call, so a reader never starts one
  const { state, venture } = readVenture(deps, ctx);
  const blueprint = acceptedBlueprint(state, venture);
  pricedOffers(state, venture, blueprint); // refuse PRICE_REQUIRED before any model call

  const template = () => briefTemplateWords(blueprint.serviceType, {
    name: blueprint.name.value, customer: blueprint.customer.value, pages: planPages(blueprint), clientArea: hasClientArea(blueprint),
  });
  let words: BriefModelOutput;
  let wordsBy: BriefRecord['wordsBy'] = 'template';
  let modelCallId: string | null = null;
  let fillCallId: string | null = null;
  if (body.useTemplate === true) {
    words = template();
  } else {
    const task = briefTask(venture, blueprint, template);
    const outcome = await deps.models.generate(ctx, task);
    words = outcome.value;
    wordsBy = outcome.by;
    modelCallId = outcome.callId;
    // One-shot A1 (row 13): a field the AI left empty is asked for again on its own; the rest of its answer stays.
    const missing = missingTextFields(words);
    if (missing.length) {
      const fill = await deps.models.generate(ctx, briefFillTask(task, missing, words, template));
      words = { ...words, ...fill.value };
      // Review of A1 (row 13): the fill call is recorded; a fill the built-in words answered makes the brief mixed.
      fillCallId = fill.callId;
      if (fill.by === 'template' && wordsBy === 'model') wordsBy = 'mixed';
    }
  }

  return ventureAction(deps, ctx, 'prepare', 'build.brief', tx => {
    const current = tx.venture!;
    const plan = acceptedBlueprint(tx.state, current);
    check(plan.id === blueprint.id && plan.digest === blueprint.digest, 'APPROVAL_STALE', 'Your plan changed while the brief was being written. Write it again.');
    const offers = pricedOffers(tx.state, current, plan);
    const version = tx.list('venture-brief').reduce((max, brief) => Math.max(max, brief.version), 0) + 1;
    const briefId = briefIdFor(current.id, version);
    const receipts = offers.flatMap(item => item.receipt ? [item.receipt] : []);
    const clientArea = hasClientArea(plan);
    const markdown = assembleBrief({
      briefId, serviceType: plan.serviceType, words, offers, taxLabel: plan.backOffice.taxLabel,
      paymentRail: plan.backOffice.paymentRail, country: current.country, clientArea,
      flowPages: plan.pages?.length ? plan.pages : TEMPLATE_FIXED_WORDS.pages.map((page,i)=>({id:'template-'+i,block:['home','offers-prices','how-it-works','start-request','client-area','privacy-terms'][i]!,title:{value:page.title}})),
    });
    const record: BriefRecord = {
      ...tx.base('venture-brief'),
      briefId, version, markdown, chars: markdown.length, digest: digest(markdown), blueprintDigest: plan.digest,
      priceReceiptIds: receipts.map(receipt => receipt.id), wordsBy, modelCallId, ...(fillCallId !== null || wordsBy === 'mixed' ? { fillCallId } : {}),
      lint: lintFor(markdown, receipts, briefId, clientArea),
      // A number in the model's words is a model estimate, never a receipt.
      ...(wordsBy !== 'template' && briefWordList(words).some(line => modelNumbers(line, copiedTokens(current.idea))) ? { estimate: true as const } : {}),
    };
    const stored = tx.put(record);
    tx.emit('brief-ready', { briefId, version, lintOk: record.lint.ok });
    return stored;
  });
}

/** The newest brief of the venture (highest version), or null. */
export function latestBrief(state: State, ventureId: string): BriefRecord | null {
  let latest: BriefRecord | null = null;
  for (const brief of listRecords(state, 'venture-brief', ventureId)) if (!latest || brief.version > latest.version) latest = brief;
  return latest;
}
