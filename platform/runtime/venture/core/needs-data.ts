// Chausar venture launcher, core (wave 6, 6C7; DECISIONS D50): the data of "Connect what your business needs". After the
// plan is kept, the outside services this owner's business would use, each with one line on why, an honest label and a
// guided connect, every one skippable. The same list lives in Connections. Chausar ships no shared keys: every owner
// connects their own account, through the service's own sign-in or a key saved to this computer's keychain.
//
// The list is chosen by code from the family the owner's AI (or a tile) picked: the AI reads the owner, code keeps the
// labels honest. A label is the connector card's real mode in this build when the need is that card's job; a need whose
// own job is not built yet says planned, with who it waits on and the manual path meanwhile. Pure data and functions
// with no Node imports, so the fake engine answers from this same file. Plain words only: no digits, no prices.
import { isFamilyId, keywordFamilyWith, type Classify, type FamilyId } from './families.ts';

import type { NeedConnect, NeedLabel, NeedView } from './first-run-types.ts';

export type { NeedConnect, NeedLabel, NeedView, NeedsList } from './first-run-types.ts';

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
};

const SERVICES: Readonly<Record<string, Service>> = Object.freeze({
  payments: { id: 'payments', name: 'Payments', why: 'Clients pay you online through a link on your own account.', connect: 'sign-in' },
  gmail: {
    id: 'gmail', name: 'Gmail', connectorId: 'mail-app', connect: 'guide',
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
  return {
    id: base.id, name: base.name, why: why ?? base.why, label,
    connect: { kind: base.connect, connectorId: base.connectorId ?? null, place: base.place ?? (base.connectorId ? 'connections' : null) },
    waitsOn: planned?.waitsOn ?? null, meanwhile: planned?.meanwhile ?? null, required: false,
  };
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
