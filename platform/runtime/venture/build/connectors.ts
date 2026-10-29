import {SELLER_HANDOFF_MODES,SELLER_READ_MODES,SELLER_WRITE_MODES} from './seller-connector-modes.ts';
// Chausar venture launcher: connector cards with honest modes (package P4).
// A mode is 'available' only where this build's code really does it. Everything else is 'planned'.
// Ink v2 wave 4 (4J7): each card carries its setup guide (guides.ts) and, in venture.connectors.list, each mode's rung
// of the truth ladder from this business's records and the operations it really takes (connector-truth.ts).
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { CONNECTOR_CATEGORIES, STARTER_CONNECTORS } from '../contracts.ts';
import type { ConnectorCard, ConnectorCategory, ConnectorMode, ConnectorModeName, IsoDate, PostingOption, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, exactPayload, listRecords } from '../records.ts';
import { CATEGORY_LABELS, CONNECTOR_CATALOGUE, type CatalogueEntry } from './catalogue.ts';
import { NOT_PROBED, postingEnvironment, postingOptions, type PostingEnvironment } from './posting.ts';
import { BROWSER_SCRIPTS } from './browser.ts';
import { stepsDatesOf } from './posting-steps.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { YOUTUBE_ID } from '../playbooks/youtube/registration.ts';
import { youtubeConnectors } from '../playbooks/youtube/playbook.ts';
import { localTranscription, transcriptionNote } from '../playbooks/youtube/transcribe.ts';
import { NO_EVIDENCE, connectorEvidence, withTruth } from './connector-truth.ts';
import { guideOf, halfConfigured } from './guides.ts';

const MODE_ORDER: readonly ConnectorModeName[] = Object.freeze(['handoff', 'read', 'write']);

/** Handoffs Chausar really prepares in this build. */
const AVAILABLE_HANDOFF: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  ...Object.fromEntries(['career-pinloop','career-linkedin','career-naukri'].map(id=>[id,{qualification:'built-in' as const,what:'Prepares source-backed drafts and files for manual review. The client uses their own account, sends messages and applies themselves.'}])),
  ...SELLER_HANDOFF_MODES,
  'narration-distribution': {qualification:'fixture-tested',what:'Exports exact approved audio with AI narration disclosure after named legal review. The owner uploads manually; acceptance is not guaranteed.'},
  'tender-submission': {qualification:'fixture-tested',what:'Exports an exact owner-approved response pack. The owner submits manually; no portal login or submission is performed.'},
  'newsletter-owner-tool': {qualification:'fixture-tested',what:'Prepares exact approved issue HTML, plain text and recipient CSV for owner sending. Live list import and export wait for named consent review.'},
  'article-publishing': {qualification:'fixture-tested',what:'Prepares the exact approved article and companion text for the owner to copy and publish manually.'},
  lovable: { qualification: 'fixture-tested', what: 'Opens Lovable with your brief filled in. You press send there.' },
  replit: { qualification: 'fixture-tested', what: 'Opens Replit with your brief filled in. You press send there.' },
  bolt: { qualification: 'built-in', what: 'Copies your brief. Paste it into Bolt.' },
  v0: { qualification: 'built-in', what: 'Copies your brief. Paste it into v0.' },
  'mail-app': { qualification: 'built-in', what: 'Chausar drafts a reply or an invoice; you send it from your own mail app.' },
});
const AVAILABLE_READ: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  'career-links':{qualification:'fixture-tested',what:'Reads one approved public static listing with policy, robots and complete-revision checks. LinkedIn and Naukri use pasted text only.'},
  'career-boards':{qualification:'fixture-tested',what:'Reads a bounded public Greenhouse, Lever or Ashby index. An index is not a complete captured listing.'},
  ...SELLER_READ_MODES,
  'narration-local-checks': {qualification:'fixture-tested',what:'Desktop ffmpeg and whisper.cpp measure and transcribe actual audio. The owner installs them; missing tools never pass.'},
  'narration-files': {qualification:'fixture-tested',what:'Reads the current client manuscript bytes and rights from TXT, Markdown or bounded DOCX.'},
  'website-public-site': {qualification:'fixture-tested',what:'Reads a client public page with robots and network guards. Runtime evidence needs an owner-installed checker or an uploaded report.'},
  'tender-documents': {qualification:'fixture-tested',what:'Reads current order RFP and separate client documents, preserving an explicit issuer spreadsheet column map. PDFs need the desktop reader.'},
  'article-transcript': {qualification:'fixture-tested',what:'Reads owner-supplied SRT, VTT or TXT and reuses transcripts only within the same client.'},
  'article-local-transcription': {qualification:'fixture-tested',what:'Desktop only, with owner-installed ffmpeg and whisper.cpp. Copies approved local video or audio up to 50 MB before transcription; otherwise add a transcript.'},
  'zoho-books': {qualification:'fixture-tested',what:'Reads exact accounting references through the owner self client, scoped to the selected client organisation.'},
  'recruit-greenhouse': {qualification:'fixture-tested',what:'Reads published jobs from the exact owner-approved Greenhouse board and filters.'},
  'recruit-lever': {qualification:'fixture-tested',what:'Reads published jobs from the exact owner-approved Lever board and filters.'},
  'recruit-ashby': {qualification:'fixture-tested',what:'Reads published jobs from the exact owner-approved Ashby board and filters.'},
  'seo-cloudflare-kv': {qualification:'fixture-tested',what:'Reads the existing client override key before a reviewed change.'},
  // 5M: bounded, policy-checked lead research and one exact-approved paid network search.
  overpass: { qualification: 'fixture-tested', what: 'Reads bounded city prospects with OpenStreetMap attribution.' },
  nominatim: { qualification: 'fixture-tested', what: 'Looks up a city once, cached and serialised under its usage policy.' },
  'own-site': { qualification: 'fixture-tested', what: 'Reads a business own homepage and limited contact pages, obeying robots.' },
  happenstance: { qualification: 'fixture-tested', what: 'Uses your own key in the lead desk; each paid search shows credits and asks for exact approval.' },
  github: { qualification: 'fixture-tested', what: 'Reads commits, files and checks of one repo. Never writes.' },
  tally: { qualification: 'fixture-tested', what: 'Reads into the back office, under Sources. Needs TallyPrime running on this computer.' },
  'chausar-crm': { qualification: 'built-in', what: 'Shows your clients and orders inside Chausar.' },
  'chausar-books': { qualification: 'built-in', what: 'Shows invoices, payments and the books inside Chausar, each number with a receipt.' },
  // venture.bank.import reads a statement file the owner downloaded; venture.bank.consent keeps consent for a provider not yet wired.
  'bank-account': {
    qualification: 'built-in',
    what: 'Imports a bank statement file you download, read only, counting each row once. A live bank link with consent and an end date is planned: no provider is linked yet.',
  },
  // Ink v2 wave 4 (4E3, labelled by 4J7): the owner's own mailbox over IMAP and the private calendar address, desktop only.
  'zoho-mail': {
    qualification: 'fixture-tested',
    what: 'Reads your inbox over IMAP with an app-specific password, read only, in the desktop app: replies from people in your network and pipeline. Never sends mail or marks it read.',
  },
  'google-workspace': {
    qualification: 'fixture-tested',
    what: 'Reads your Gmail inbox over IMAP with an app password, read only, in the desktop app: replies from people in your network and pipeline. Never sends mail or marks it read.',
  },
  'google-calendar': {
    qualification: 'fixture-tested',
    what: 'Reads your calendar from the private address you paste, in the desktop app, each morning: past calls with people in your network. Never writes to it.',
  },
  // Ink v2 wave 5 (5A6): .eml and .mbox files the owner imports (build/mail-in.ts).
  'mail-import': { qualification: 'fixture-tested', what: 'Reads the .eml or .mbox files you import, each message screened first. Nothing is sent.' },
});
const AVAILABLE_WRITE: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  ...SELLER_WRITE_MODES,
  ...Object.fromEntries(['bluesky','mastodon','telegram','discord'].map(id=>[id,{qualification:'fixture-tested' as const,what:'Posts exact approved plain text through the owner official API connection. Each destination has its own approval and recorded outcome; uncertain results require inspection.'}])),
  'google-tts': {qualification:'fixture-tested',what:'Makes one exact approved stock voice request on the owner Google key. Current rights, private-source refusal, quoted cost and named legal confirmation are required.'},
  'website-cloudflare': {qualification:'fixture-tested',what:'Deploys only an exact approved immutable Direct Upload manifest. Preview, production and rollback each ask separately; asset uploading stays manual.'},
  'zoho-books': {qualification:'fixture-tested',what:'Creates exact-approved drafts, masters, opening balances and received settlements, then verifies readback. Invoice issue asks separately. No email or automatic retry.'},
  'seo-wordpress': {qualification:'fixture-tested',what:'Creates only the exact owner and client approved article draft. The owner publishes it in WordPress.'},
  'seo-cloudflare-kv': {qualification:'fixture-tested',what:'Writes an exact reviewed existing key, journals the result and keeps its previous value for undo.'},
  // Ink v2 wave 5 (5A6, K24): one item you approve, exactly as shown, to your own webhook (build/webhook-handoff.ts).
  'n8n-webhook': { qualification: 'fixture-tested', what: 'Sends only an item you approve, exactly as shown, to your own n8n webhook. In this build that is the test item.' },
  'make-webhook': { qualification: 'fixture-tested', what: 'Sends only an item you approve, exactly as shown, to your own Make webhook. In this build that is the test item.' },
  'chausar-crm': { qualification: 'built-in', what: 'Adds clients and orders inside Chausar.' },
  'chausar-books': { qualification: 'built-in', what: 'Issues invoices and records payments inside Chausar, each number with a receipt.' },
});
const PLANNED_HANDOFF_WHAT = 'Planned: Chausar will prepare what to paste there. For now, Visit site opens it.';
const PLANNED_WHAT_OVERRIDE: Readonly<Record<string, Partial<Record<ConnectorModeName, string>>>> = Object.freeze({
  'shopify-store-assistant':{write:'Planned for buyers until named lawyer confirmation of notice, consent and provider handling. Link to the shop meanwhile. Every later AI question needs its own exact owner approval.'},
  tally: {write:'Planned: local optional voucher writes need a reviewed native installation profile. Enter reviewed vouchers in Tally manually meanwhile; automatic issue is not qualified.'},
  // Staged edits (venture.site.stage) read the followed repo; applying them needs a write grant and a writer, and this
  // build has neither, so the write mode stays planned.
  github: { write: 'Planned: edits you review, applied to your repo only after you grant write access. Chausar only reads today. You can stage an edit from it and review it now.' },
  'google-workspace': { write: 'Planned: sending from Gmail would need a Google review first. Chausar only reads your inbox today.' },
  'google-calendar': { write: 'Planned: adding calls to your calendar. Chausar only reads it today.' },
  // 5A6: speech out waits for a place to add your own key.
  'sarvam-tts': { write: 'Planned: speech on your own key, after a quote. Chausar has no place to take the key yet.' },
  elevenlabs: { write: 'Planned: speech on your own key, after a quote. Chausar has no place to take the key yet.' },
});

function planned(mode: ConnectorModeName, what: string): ConnectorMode {
  return { mode, status: 'planned', qualification: 'unqualified', what };
}

/** The modes of one catalogue entry in this build, in the order handoff, read, write. */
export function connectorModes(item: CatalogueEntry): ConnectorMode[] {
  const modes: ConnectorMode[] = [];
  const handoff = AVAILABLE_HANDOFF[item.id];
  if (handoff) modes.push({ mode: 'handoff', status: 'available', ...handoff });
  else if (item.vendorUrl !== null) modes.push(planned('handoff', PLANNED_HANDOFF_WHAT));
  for (const mode of ['read', 'write'] as const) {
    const available = (mode === 'read' ? AVAILABLE_READ : AVAILABLE_WRITE)[item.id];
    if (available) { modes.push({ mode, status: 'available', ...available }); continue; }
    if (!item.targets.includes(mode)) continue;
    const override = PLANNED_WHAT_OVERRIDE[item.id]?.[mode];
    modes.push(planned(mode, override ?? (mode === 'read'
      ? `Planned: reading from ${item.name}. Not in this build.`
      : `Planned: writing to ${item.name}. Not in this build.`)));
  }
  return modes;
}

/** Available modes first (handoff, read, write), then the planned ones in the same order. */
export function connectorChips(modes: readonly ConnectorMode[]): string[] {
  const chips: string[] = [];
  for (const mode of MODE_ORDER) if (modes.some(m => m.mode === mode && m.status === 'available')) chips.push(mode);
  for (const mode of MODE_ORDER) if (modes.some(m => m.mode === mode && m.status === 'planned')) chips.push(`planned: ${mode}`);
  return chips;
}

/** The sentence the browser mode carries until its steps are checked (build/posting.ts). */
const NOT_CHECKED_WORDS = ' Not yet checked against the live site.';

/**
 * The browser mode of a text platform carries stepsCheckedOn and boxAndButtonCheckedOn (Ink v2 wave 2, 2B2): the oldest day across its posting
 * steps on which one of the step's candidates last worked, or null. Once dated, the mode no longer says it is unchecked.
 */
type StepsDates = (connectorId: string) => { stepsCheckedOn: IsoDate | null; boxAndButtonCheckedOn: IsoDate | null };
function withSteps(option: PostingOption, connectorId: string, stepsDates: StepsDates): PostingOption {
  if (option.mode !== 'owner-browser-session' || !BROWSER_SCRIPTS[connectorId]) return option;
  const { stepsCheckedOn: on, boxAndButtonCheckedOn } = stepsDates(connectorId);
  return { ...option, stepsCheckedOn: on, boxAndButtonCheckedOn, ...(on ? { what: option.what.replace(NOT_CHECKED_WORDS, '') } : {}) };
}

/** env says what this computer can do for posting; without it every posting mode is planned. stepsDates: from the vault. */
export function connectorCard(
  item: CatalogueEntry, starter: boolean, env: PostingEnvironment = NOT_PROBED,
  stepsDates: StepsDates = () => ({ stepsCheckedOn: null, boxAndButtonCheckedOn: null }),
): ConnectorCard {
  const modes = connectorModes(item);
  const options = postingOptions(item.id, env).map(option => withSteps(option, item.id, stepsDates));
  const posting = options.find(option => option.status === 'available') ?? options.find(option => option.mode === 'owner-browser-session');
  return {
    id: item.id, name: item.name, category: item.category, categoryLabel: CATEGORY_LABELS[item.category],
    modes, chips: connectorChips(modes), regions: [...item.regions], regionNote: item.regionNote,
    auth: item.auth, vendorUrl: item.vendorUrl, note: item.note, starter, ...(posting ? { posting } : {}), postingOptions: options,
    // 4J7 (K11): the setup guide; listConnectors adds the missing setting of a half-configured connection.
    guide: guideOf(item),
  };
}

/**
 * Starter ids: the accepted plan's starterConnectorIds; before acceptance a composed plan's own (its tools), or else
 * the default six with the country's first payment rail. No venture yet: none.
 */
export function starterIds(state: State, venture: VentureRecord | null): string[] {
  if (!venture) return [];
  const blueprints = listRecords(state, 'venture-blueprint', venture.id);
  if (venture.acceptedBlueprintId) {
    const accepted = blueprints.find(b => b.id === venture.acceptedBlueprintId);
    if (accepted) return [...accepted.starterConnectorIds];
  }
  const composed = blueprints.filter(b => Array.isArray(b.tools)).sort((a, b) => a.version - b.version).pop();
  if (composed) return [...composed.starterConnectorIds];
  const rail = venture.country?.paymentRails?.[0] ?? null;
  return STARTER_CONNECTORS.flatMap(id => id === '<payment-rail>' ? (rail ? [rail] : []) : [id]);
}

/** Starter cards first, then by category order, then by name. */
export function orderCards(cards: ConnectorCard[]): ConnectorCard[] {
  const categoryIndex = (category: ConnectorCategory) => CONNECTOR_CATEGORIES.indexOf(category);
  return [...cards].sort((a, b) => {
    if (a.starter !== b.starter) return a.starter ? -1 : 1;
    const byCategory = categoryIndex(a.category) - categoryIndex(b.category);
    if (byCategory !== 0) return byCategory;
    const left = a.name.toLowerCase(), right = b.name.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  });
}

/** venture.connectors.list { category?, starterOnly? } (level read). */
export async function listConnectors(deps: VentureDeps, ctx: Context, payload: unknown): Promise<ConnectorCard[]> {
  const body = exactPayload(payload ?? {}, ['category', 'starterOnly']);
  if (body.category !== undefined) {
    check(typeof body.category === 'string' && (CONNECTOR_CATEGORIES as readonly string[]).includes(body.category), 'INVALID_VENTURE_REQUEST', 'Choose one of the connector categories.');
  }
  if (body.starterOnly !== undefined) check(typeof body.starterOnly === 'boolean', 'INVALID_VENTURE_REQUEST', 'starterOnly must be true or false.');
  authorize(deps.store, ctx, 'read');
  const state = deps.store.read();
  const starters = new Set(starterIds(state, currentVenture(state)));
  const env = await postingEnvironment(deps);
  const venture = currentVenture(state);
  // 4J7 (K6, K11): each card's truth from this business's records, and a half-configured connection's missing setting.
  const evidence = venture ? connectorEvidence(state, venture.id) : NO_EVIDENCE;
  const hosted = deps.host === 'hosted-web';
  const cards = CONNECTOR_CATALOGUE
    .filter(item => body.category === undefined || item.category === body.category)
    .map(item => {
      const card = connectorCard(item, starters.has(item.id), env, connectorId => stepsDatesOf(state, connectorId));
      const missing = venture ? halfConfigured(deps, state, venture.id, item.id) : null;
      return withTruth(missing ? { ...card, guide: guideOf(item, missing) } : card, evidence, hosted);
    })
    .filter(card => body.starterOnly !== true || card.starter);
  // A YouTube business also sees the transcript made on this computer, with what this computer really has (2E2).
  if (venture && pickPlaybook(venture.idea)?.id === YOUTUBE_ID && body.starterOnly !== true && (body.category === undefined || body.category === 'docs-ops')) {
    cards.push(withTruth(transcriptionCard(deps), evidence, hosted));
  }
  return orderCards(cards);
}

/** The transcription card: ffmpeg and the owner's whisper.cpp on this computer, available only when both are here. */
export function transcriptionCard(deps: VentureDeps): ConnectorCard {
  const here = localTranscription(deps);
  const entry = youtubeConnectors({ ffmpeg: here.ffmpeg, speech: here.speech }).find(item => item.id === 'transcription')!;
  const modes: ConnectorMode[] = entry.modes.map(mode => ({ mode: mode.mode, status: mode.status, qualification: mode.status === 'available' ? 'fixture-tested' : 'unqualified', what: mode.what }));
  return {
    id: entry.id, name: entry.name, category: 'docs-ops', categoryLabel: CATEGORY_LABELS['docs-ops'], modes, chips: connectorChips(modes),
    regions: ['global'], regionNote: null, auth: 'Programs already on this computer. No account.', vendorUrl: null,
    note: transcriptionNote(here, deps.host === 'hosted-web'), starter: false, postingOptions: [],
  };
}
