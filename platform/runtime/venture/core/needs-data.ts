// Chausar venture launcher, core (wave 6, 6C7; DECISIONS D50): the data of "Connect what your business needs". After the
// plan is kept, the outside services this owner's business would use, each with one line on why, an honest label and a
// guided connect, every one skippable. The same list lives in Connections. Chausar ships no shared keys: every owner
// connects their own account, through the service's own sign-in or a key saved to this computer's keychain.
//
// The list is chosen by code from the family the owner's AI (or a tile) picked: the AI reads the owner, code keeps the
// labels honest. A label is the connector card's real mode in this build when the need is that card's job; a need whose
// own job is not built yet says planned, with who it waits on and the manual path meanwhile. Pure data and functions
// with no Node imports, so the fake engine answers from this same file. Plain words only: no digits, no prices.
//
// The list follows the plan when the plan says what it needs (founder, 14 Nov 2026). Beside the way to earn, the
// owner's AI names up to four needs from NEED_IDS; code checks them (keptNeeds), they are kept with the way, and
// neededGroups answers each kept need with the ways Chausar can meet it today, the most useful first, each with the
// label its own source gives it: the lead sources as finding customers lists them (customers/find-words.ts), a
// connector card's real mode (CARD_LABELS), and a curated MCP server as planned, since none has run on a live account.
// A way is listed when it works or can be connected today; a planned card with nothing to connect is listed only where
// it is the need's one answer (getting paid), or beside a way that works when the owner's customers are there
// (WhatsApp beside email: found live, 15 Nov 2026, a tradesman whose customers reply on WhatsApp was shown Gmail
// alone), always with the card's own label and its manual path. Every card is still in Connections.
// A need to receive and send files is still left out: its only answer is the planned Drive link, and adding an id
// changes what the AI is asked to pick from (core/about.ts).
// With no need kept (templates only, or an older business) the field's list below stands.
import { isFamilyId, keywordFamilyWith, type Classify, type FamilyId } from './families.ts';
import { CURATED_MCP_SERVERS, type CuratedMcpServer } from '../agent-runtime/mcp-registry.ts';
import type { FindSourceView } from '../customers/find-words.ts';

import type { NeedConnect, NeedGroup, NeedId, NeedLabel, NeedView } from './first-run-types.ts';

export type { NeedAction, NeedConnect, NeedGroup, NeedId, NeedLabel, NeedView, NeedsList } from './first-run-types.ts';

type Service = {
  id: string; name: string; why: string;
  /** The connector card whose real modes give the label, and whose sheet holds the setup guide. */
  connectorId?: string;
  /** Set when the need's own job is not built in this build, whatever the card can do. */
  planned?: { waitsOn: string; meanwhile: string };
  connect: NeedConnect['kind'];
  place?: NeedConnect['place'];
  /** A fixed label for a need that is not a catalogue card (owner-added MCP servers). */
  label?: NeedLabel;
  /** True when it works with nothing to connect (the card's own guide says so): the row offers no Set up. */
  ready?: true;
};

const SERVICES: Readonly<Record<string, Service>> = Object.freeze({
  payments: { id: 'payments', name: 'Payments', why: 'Clients pay you online through a link on your own account.', connect: 'sign-in' },
  gmail: {
    // The mail-app card's guide starts "Nothing to connect." (build/guides.ts): Chausar drafts, the owner sends.
    id: 'gmail', name: 'Gmail', connectorId: 'mail-app', connect: 'guide', ready: true,
    why: 'Invoices and replies go from your own address. Chausar drafts, you send.',
  },
  telegram: {
    // 6F6: built; the owner adds their own bot under Business, Notifications.
    id: 'telegram', name: 'Telegram alerts', connect: 'key', why: 'Your own Telegram bot tells your phone when something needs you.',
  },
  tailscale: {
    // 6F7: built; the phone access guide is docs/venture/phone-access.md.
    id: 'tailscale', name: 'Phone approvals', connect: 'guide', why: 'Approve work from your phone when you are away from home, through Tailscale.',
  },
  happenstance: {
    id: 'happenstance', name: 'Happenstance', connect: 'key', why: 'Find people in your own network who could become clients.',
    // 6F8: built and fixture-tested; it waits on the owner's own key and a first run on a real account.
    planned: { waitsOn: 'Needs your own Happenstance key, added in Connections, More ways to connect. Not tried on a live account yet.', meanwhile: 'Add your contacts under Clients, Network.' },
  },
  probe42: {
    id: 'probe42', name: 'Probe42', connect: 'key', why: 'Look up Indian company records before you pitch a business.',
    // 6F8: built and fixture-tested; it waits on the owner's own key and a first run on a real account.
    planned: { waitsOn: 'Needs your own Probe42 key, added in Connections, More ways to connect. Not tried on a live account yet.', meanwhile: 'Check a company on the MCA website yourself.' },
  },
  sunra: {
    id: 'sunra', name: 'Sunra', connect: 'key', why: 'Make images and short videos, with a cost shown before each one.',
    // 6F9: built and fixture-tested through the MCP client; it waits on the owner's own account.
    planned: { waitsOn: 'Needs your own Sunra account, added in Connections, MCP servers. Not tried on a live account yet.', meanwhile: 'Make images in your own tools and add them as files.' },
  },
  'google-calendar': { id: 'google-calendar', name: 'Google Calendar', connectorId: 'google-calendar', connect: 'sign-in', why: 'Your classes and sessions show next to your own plans.' },
  'cal-com': { id: 'cal-com', name: 'Cal.com', connectorId: 'cal-com', connect: 'sign-in', why: 'Clients book a free slot on a page you control.' },
  'google-drive': { id: 'google-drive', name: 'Google Drive', connectorId: 'google-drive', connect: 'sign-in', why: 'Send big files to clients from your own Drive folder.' },
  whatsapp: { id: 'whatsapp', name: 'WhatsApp', connectorId: 'whatsapp', connect: 'sign-in', why: 'Most clients reply fastest on WhatsApp. You send each message.' },
  youtube: { id: 'youtube', name: 'YouTube', connectorId: 'youtube', connect: 'sign-in', why: 'Publish finished videos to your own channel.' },
  'tally-forms': { id: 'tally-forms', name: 'Tally forms', connectorId: 'tally-forms', connect: 'guide', why: 'A free enquiry form that brings new leads in.' },
  tally: { id: 'tally', name: 'TallyPrime', connectorId: 'tally', connect: 'guide', why: 'Read your clients\' books from the accounts they already keep.' },
  github: { id: 'github', name: 'GitHub', connectorId: 'github', connect: 'sign-in', why: 'Follow the code of the websites you build for clients.' },
  mcp: {
    id: 'mcp', name: 'Your other tools', connect: 'guide', place: 'connections/ai', label: 'write',
    why: 'Add MCP servers for tools you already use. Each action asks you first.',
  },
});

/** Per family: the services in order, and a family's own reason where it reads better than the general one. */
const FAMILY_NEEDS: Readonly<Record<FamilyId, readonly (string | [string, string])[]>> = Object.freeze({
  'money-tax': ['payments', ['gmail', 'Send returns, reminders and invoices from your own address.'], 'tally', ['google-drive', 'Collect bank statements and bills from clients in one folder.'], 'probe42', 'telegram', 'tailscale'],
  teaching: ['google-calendar', ['whatsapp', 'Parents and learners hear about classes and fees on WhatsApp.'], 'payments', ['tally-forms', 'A free form where new learners sign up.'], 'telegram', 'tailscale'],
  creative: [['google-drive', 'Send big video and design files from your own Drive.'], 'sunra', 'youtube', 'payments', 'gmail', 'whatsapp', 'telegram'],
  writing: ['gmail', ['google-drive', 'Share drafts and finished pieces from your own Drive.'], 'sunra', 'mcp', 'payments', 'telegram'],
  'local-services': ['cal-com', 'whatsapp', 'payments', 'google-calendar', 'telegram', 'tailscale'],
  documents: [['google-drive', 'Collect source papers and share finished documents.'], 'gmail', 'probe42', 'payments', 'telegram'],
  research: ['happenstance', 'probe42', ['google-drive', 'Share reports and data files from your own Drive.'], 'gmail', 'mcp', 'payments'],
  people: ['happenstance', 'gmail', ['google-calendar', 'Interviews and calls show next to your own plans.'], 'payments', 'telegram'],
  'shop-office': ['whatsapp', 'gmail', 'payments', 'mcp', 'telegram'],
  tech: ['github', 'gmail', 'mcp', 'payments', 'telegram', 'tailscale'],
  licensed: ['cal-com', 'google-calendar', 'gmail', 'payments', 'telegram'],
});
const GENERAL_NEEDS: readonly string[] = ['gmail', 'payments', 'telegram'];

/**
 * What each connector card really does in this build: its strongest available mode, else planned. Kept here as data so
 * the fake engine reads the same list; venture-about-w6.test.ts checks every entry against the cards' real modes.
 */
export const CARD_LABELS: Readonly<Record<string, NeedLabel>> = Object.freeze({
  'mail-app': 'handoff', 'google-calendar': 'read', 'cal-com': 'planned', 'google-drive': 'planned', whatsapp: 'planned',
  youtube: 'planned', 'tally-forms': 'planned', tally: 'read', github: 'read',
  razorpay: 'planned', cashfree: 'planned', stripe: 'planned', paypal: 'planned', 'lemon-squeezy': 'planned',
});
const cardLabel = (connectorId: string): NeedLabel => CARD_LABELS[connectorId] ?? 'planned';
/** The payment rails' card names in the connector catalogue (build/catalogue.ts; the same test checks them). */
export const RAIL_NAMES: Readonly<Record<string, string>> = Object.freeze({
  razorpay: 'Razorpay', cashfree: 'Cashfree Payments', stripe: 'Stripe', paypal: 'PayPal', 'lemon-squeezy': 'Lemon Squeezy',
});

/** The country's first payment rail that Chausar lists as a connector card, or null (no payment row then). */
function paymentRail(countryCode: string | null, rails: readonly string[]): string | null {
  if (countryCode === 'IN') return 'razorpay';
  return rails.find(rail => Object.hasOwn(RAIL_NAMES, rail)) ?? null;
}

function needOf(service: Service, why: string | null, rail: string | null): NeedView | null {
  let base = service;
  if (service.id === 'payments') {
    if (!rail) return null;
    base = { ...service, id: rail, name: RAIL_NAMES[rail]!, connectorId: rail };
  }
  const label = base.planned ? 'planned' : base.label ?? (base.connectorId ? cardLabel(base.connectorId) : 'planned');
  const planned = label === 'planned'
    ? base.planned ?? { waitsOn: `Chausar's ${base.name} link is coming later.`, meanwhile: base.id === rail ? (rail === 'razorpay' ? 'For now, share your UPI or bank details and mark payments yourself.' : 'For now, share your payment details and mark payments yourself.') : `Use ${base.name} on its own until then.` }
    : null;
  const connect: NeedConnect = { kind: base.connect, connectorId: base.connectorId ?? null, place: base.place ?? (base.connectorId ? 'connections' : null) };
  // Set up only where a connect flow is real: a card or a place that works today. A planned one shows its manual path.
  const action = label === 'planned' ? 'manual' : !base.ready && (connect.connectorId !== null || connect.place !== null) ? 'set-up' : 'none';
  return { id: base.id, name: base.name, why: why ?? base.why, label, connect, waitsOn: planned?.waitsOn ?? null, meanwhile: planned?.meanwhile ?? null, required: false, action };
}

/** The services one family's business would use, for its country. */
export function businessNeeds(familyId: FamilyId | null, countryCode: string | null, rails: readonly string[] = []): NeedView[] {
  const items = familyId ? FAMILY_NEEDS[familyId] : GENERAL_NEEDS;
  const rail = paymentRail(countryCode, rails);
  return items.flatMap(item => {
    const [id, why] = Array.isArray(item) ? item : [item, null];
    const need = needOf(SERVICES[id]!, why, rail);
    return need ? [need] : [];
  });
}

/** The family a business was kept with (About you), else the keyword guess from its idea, else none. */
export function businessFamily(familyId: unknown, idea: string, classify?: Classify): FamilyId | null {
  if (isFamilyId(familyId)) return familyId;
  return keywordFamilyWith(idea, classify);
}

// ---------------------------------------------------------------------------
// The plan's own needs
// ---------------------------------------------------------------------------

/**
 * What a business may need from outside, in the words the AI picks from. A need is listed only when Chausar has
 * something real for it today: a way that works (the public map search, a message the owner sends from their own
 * mail app, a calendar it reads), a connect flow for the owner's own account (Monid, Canva), or a manual path inside
 * Chausar (payments the owner marks). A need whose only answer is a planned card (a drive for files) is left out: it
 * would bring back a row with nothing to do. Email and messaging are one need, so the way that works leads it. The ids
 * say what they mean, so the prompt carries no other words.
 */
export const NEED_IDS = Object.freeze(['find-customers', 'write-to-customers', 'designs-documents', 'payments', 'appointments'] as const) satisfies readonly NeedId[];
/** A short list the owner reads in one look: the most needed first. */
export const NEEDS_MAX = 4;
const isNeedId = (value: unknown): value is NeedId => typeof value === 'string' && (NEED_IDS as readonly string[]).includes(value);

/**
 * The needs as the owner keeps them: listed ids only, in the order given, once each. Anything else is dropped. The
 * owner ticks and unticks them after setup (step 3 and Connections, through venture.owner.set), and may keep every
 * listed need: the short list below is what the AI is held to, never a ceiling on the owner's own choice.
 */
export function ownerNeeds(value: unknown): NeedId[] {
  if (!Array.isArray(value)) return [];
  const kept: NeedId[] = [];
  for (const item of value) if (isNeedId(item) && !kept.includes(item)) kept.push(item);
  return kept;
}

/** The needs as the AI's answer is kept: the same check, and at most four (NEEDS_MAX), the most needed first. */
export function keptNeeds(value: unknown): NeedId[] {
  return ownerNeeds(value).slice(0, NEEDS_MAX);
}

/**
 * Per need: the services (SERVICES, with the need's own reason where it reads truer) and curated MCP servers that meet
 * it, the most useful first. Lead sources are passed in.
 */
const NEED_WAYS: Readonly<Record<Exclude<NeedId, 'find-customers'>, readonly (string | [string, string] | { mcp: string; meanwhile: string })[]>> = Object.freeze({
  // Email leads: it works today. WhatsApp follows with its card's own label (planned) and manual path, never a better one.
  'write-to-customers': ['gmail', ['whatsapp', 'For customers who reply on WhatsApp. Chausar drafts each message, and you send it from your own WhatsApp.']],
  'designs-documents': [{ mcp: 'canva', meanwhile: 'Make designs in your own tools and add them as files.' }],
  payments: ['payments'],
  // What the calendar read does today (build/guides.ts): calls that ended show on Today for the owner's notes.
  appointments: [['google-calendar', 'Chausar reads your calendar, so calls that ended show on Today for your notes.']],
});
/**
 * A curated server's line on a row, where the registry's own words run long. The row stays one line; the server's own
 * form, opened by Set up, shows the registry words whole before anything is saved.
 */
const CURATED_LINES: Readonly<Record<string, string>> = Object.freeze({
  monid: 'Business lists from many data tools. Monid charges each call to your balance there.',
});
/** What a listed server waits on: the owner's own account, and a first run on a live one. Set up is on the row itself. */
const untried = (name: string): string => `Needs your own ${name} account. Not tried on a live account yet.`;

const signInKind = (entry: CuratedMcpServer): NeedConnect['kind'] => (entry.signIn === 'oauth' ? 'sign-in' : entry.signIn === 'key' ? 'key' : 'none');
/** A server form is the connect flow of a curated server, and of one the owner already saved. */
const serverConnect = (kind: NeedConnect['kind'], mcpServerId: string): NeedConnect => ({ kind, connectorId: null, place: 'connections/ai', mcpServerId });

/**
 * A curated MCP server as a way: the registry's own name and words. Planned, as every connected tool is until it has
 * run on a live account; its own server form is a real connect flow, so the row offers Set up.
 */
function curatedWay(entry: CuratedMcpServer, meanwhile: string): NeedView {
  return {
    id: entry.id, name: entry.name, why: CURATED_LINES[entry.id] ?? entry.about, label: 'planned', connect: serverConnect(signInKind(entry), entry.id),
    waitsOn: untried(entry.name), meanwhile, required: false, action: 'set-up',
  };
}

/**
 * A lead source as finding customers lists it (customers/find-words.ts sourceRows), with its name and its label. The
 * public map and a tool the owner saved keep its words whole; a listed tool not saved yet reads as a curated server.
 */
function sourceWay(row: FindSourceView): NeedView {
  const entry = CURATED_MCP_SERVERS.find(item => item.id === row.id);
  if (entry && !row.usable && row.meanwhile) return { ...curatedWay(entry, row.meanwhile), name: row.name, label: row.label };
  // The public map needs nothing. A lead tool the owner saved is managed through its own server form.
  const connect: NeedConnect = row.id === 'public-map' ? { kind: 'none', connectorId: null, place: null } : serverConnect(entry ? signInKind(entry) : 'guide', row.id);
  return { id: row.id, name: row.name, why: row.line, label: row.label, connect, waitsOn: row.waitsOn, meanwhile: row.meanwhile, required: false, action: connect.mcpServerId ? 'set-up' : 'none' };
}

/**
 * The kept needs, each with the ways Chausar can meet it today. sources: the lead sources of this business
 * (customers/find-target.ts leadSources; the fake engine passes its own). A need with no way here is left out.
 * notes: one plain line for a need whose ways do not say everything, such as finding customers when the plan's
 * customers are not places on a map (customers/find-brief.ts MAP_PLACES_ONLY).
 */
export function neededGroups(needs: readonly unknown[], countryCode: string | null, rails: readonly string[], sources: readonly FindSourceView[], notes: Partial<Record<NeedId, string>> = {}): NeedGroup[] {
  const rail = paymentRail(countryCode, rails);
  return ownerNeeds([...needs]).flatMap((id): NeedGroup[] => {
    const ways = id === 'find-customers' ? sources.map(sourceWay) : NEED_WAYS[id].flatMap((item): NeedView[] => {
      if (typeof item === 'string' || Array.isArray(item)) { const [service, why] = Array.isArray(item) ? item : [item, null]; const need = needOf(SERVICES[service]!, why, rail); return need ? [need] : []; }
      const entry = CURATED_MCP_SERVERS.find(server => server.id === item.mcp);
      return entry ? [curatedWay(entry, item.meanwhile)] : [];
    });
    return ways.length ? [{ id, ways, note: notes[id] ?? null }] : [];
  });
}
