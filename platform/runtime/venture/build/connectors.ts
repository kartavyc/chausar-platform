// Chausar venture launcher: connector cards with honest modes (package P4).
// A mode is 'available' only where this build's code really does it. Everything else is 'planned'.
import { authorize, check, type Context, type State } from '../../contracts.ts';
import { CONNECTOR_CATEGORIES, STARTER_CONNECTORS } from '../contracts.ts';
import type { ConnectorCard, ConnectorCategory, ConnectorMode, ConnectorModeName, VentureDeps, VentureRecord } from '../contracts.ts';
import { currentVenture, exactPayload, listRecords } from '../records.ts';
import { CATEGORY_LABELS, CONNECTOR_CATALOGUE, type CatalogueEntry } from './catalogue.ts';

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
});
const AVAILABLE_WRITE: Readonly<Record<string, Omit<ConnectorMode, 'mode' | 'status'>>> = Object.freeze({
  'chausar-crm': { qualification: 'built-in', what: 'Adds clients and orders inside Chausar.' },
  'chausar-books': { qualification: 'built-in', what: 'Issues invoices and records payments inside Chausar, each number with a receipt.' },
});
const PLANNED_HANDOFF_WHAT = 'Planned: Chausar will prepare what to paste there. For now, Visit site opens it.';
const PLANNED_WHAT_OVERRIDE: Readonly<Record<string, Partial<Record<ConnectorModeName, string>>>> = Object.freeze({
  'zoho-books': { read: 'Needs a Zoho sign-in. Not in this build.' },
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

export function connectorCard(item: CatalogueEntry, starter: boolean): ConnectorCard {
  const modes = connectorModes(item);
  return {
    id: item.id, name: item.name, category: item.category, categoryLabel: CATEGORY_LABELS[item.category],
    modes, chips: connectorChips(modes), regions: [...item.regions], regionNote: item.regionNote,
    auth: item.auth, vendorUrl: item.vendorUrl, note: item.note, starter,
  };
}

/**
 * Starter ids: the accepted plan's starterConnectorIds, or before acceptance the default six with the
 * country's first payment rail. No venture yet: none.
 */
export function starterIds(state: State, venture: VentureRecord | null): string[] {
  if (!venture) return [];
  if (venture.acceptedBlueprintId) {
    const accepted = listRecords(state, 'venture-blueprint', venture.id).find(b => b.id === venture.acceptedBlueprintId);
    if (accepted) return [...accepted.starterConnectorIds];
  }
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
  const cards = CONNECTOR_CATALOGUE
    .filter(item => body.category === undefined || item.category === body.category)
    .map(item => connectorCard(item, starters.has(item.id)))
    .filter(card => body.starterOnly !== true || card.starter);
  return orderCards(cards);
}
