// Chausar venture launcher: connector cards with honest modes (package P4).
// A mode is 'available' only where this build's code really does it. Everything else is 'planned'.
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

const MODE_ORDER: readonly ConnectorModeName[] = Object.freeze(['handoff', 'read', 'write']);

/** Handoffs Chausar really prepares in this build. */
const AVAILABLE_HANDOFF: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  lovable: { qualification: 'fixture-tested', what: 'Opens Lovable with your brief filled in. You press send there.' },
  replit: { qualification: 'fixture-tested', what: 'Opens Replit with your brief filled in. You press send there.' },
  bolt: { qualification: 'built-in', what: 'Copies your brief. Paste it into Bolt.' },
  v0: { qualification: 'built-in', what: 'Copies your brief. Paste it into v0.' },
  'mail-app': { qualification: 'built-in', what: 'Chausar drafts a reply or an invoice; you send it from your own mail app.' },
});
const AVAILABLE_READ: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  github: { qualification: 'fixture-tested', what: 'Reads commits, files and checks of one repo. Never writes.' },
  tally: { qualification: 'fixture-tested', what: 'Reads into the back office, under Sources. Needs TallyPrime running on this computer.' },
  'chausar-crm': { qualification: 'built-in', what: 'Shows your clients and orders inside Chausar.' },
  'chausar-books': { qualification: 'built-in', what: 'Shows invoices, payments and the books inside Chausar, each number with a receipt.' },
  // venture.bank.import reads a statement file the owner downloaded; venture.bank.consent keeps consent for a provider not yet wired.
  'bank-account': {
    qualification: 'built-in',
    what: 'Imports a bank statement file you download, read only, counting each row once. A live bank link with consent and an end date is planned: no provider is linked yet.',
  },
});
const AVAILABLE_WRITE: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  'chausar-crm': { qualification: 'built-in', what: 'Adds clients and orders inside Chausar.' },
  'chausar-books': { qualification: 'built-in', what: 'Issues invoices and records payments inside Chausar, each number with a receipt.' },
});
const PLANNED_HANDOFF_WHAT = 'Planned: Chausar will prepare what to paste there. For now, Visit site opens it.';
const PLANNED_WHAT_OVERRIDE: Readonly<Record<string, Partial<Record<ConnectorModeName, string>>>> = Object.freeze({
  'zoho-books': { read: 'Needs a Zoho sign-in. Not in this build.' },
  // Staged edits (venture.site.stage) read the followed repo; applying them needs a write grant and a writer, and this
  // build has neither, so the write mode stays planned.
  github: { write: 'Planned: edits you review, applied to your repo only after you grant write access. Chausar only reads today. You can stage an edit from it and review it now.' },
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
  const cards = CONNECTOR_CATALOGUE
    .filter(item => body.category === undefined || item.category === body.category)
    .map(item => connectorCard(item, starters.has(item.id), env, connectorId => stepsDatesOf(state, connectorId)))
    .filter(card => body.starterOnly !== true || card.starter);
  // A YouTube business also sees the transcript made on this computer, with what this computer really has (2E2).
  const venture = currentVenture(state);
  if (venture && pickPlaybook(venture.idea)?.id === YOUTUBE_ID && body.starterOnly !== true && (body.category === undefined || body.category === 'docs-ops')) {
    cards.push(transcriptionCard(deps));
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
