/**
 * C2 task 5: the pages and actions the command bar finds, matched in the browser on the same scale as the engine's
 * records (find-core.ts). Every entry only navigates: a page or an action is an href, and New chat opens an empty
 * chat. None of them holds a function that calls the engine: each lands where the owner finishes the thing with that
 * place's own button and its own approval or second ask.
 *
 * NAVIGATION comes from C1's one navigation list (shell/nav.ts): the rail places, Settings in its four groups with every
 * page, Money's and Clients' sub pages. An address that two entries share is listed once. Money's Businesses page waits:
 * nav.ts lists it always, and with one business it has nothing to show.
 */

import { match, type FindHit } from '../../../../../platform/runtime/venture/views/find-core';
import { navEntries } from '../nav';
import { CA_FIRM } from '../settings';

export interface NavigationPage {
  /** The page's title key in the English catalogue. */
  title: string;
  href: string;
  /** Shown only for a CA firm's business (Business > Your CA). */
  caFirm?: true;
}

/** C1's one navigation list, every page a CA firm can have; `caFirm` marks the one only a CA firm has. */
export const NAVIGATION: readonly NavigationPage[] = Object.freeze([
  ...new Map(navEntries({ playbook: { id: CA_FIRM } }).filter((entry) => entry.href !== '#/money/businesses').map((entry): [string, NavigationPage] => [entry.href, { title: entry.title, href: entry.href, ...(entry.href === '#/business/ca' ? { caFirm: true as const } : {}) }])).values(),
]);

export interface CatalogueEntry {
  id: string;
  kind: 'page' | 'action';
  /** The title key; an action's extra words are under `<title>.words`. */
  title: string;
  /** Where choosing it goes; null opens a new chat. */
  href: string | null;
}

export interface CatalogueOptions {
  /** A business is open (Export for your CA needs one). */
  businessOpen: boolean;
  /** What waits on the owner now (useNeedsYou), so Approve what's waiting shows only above 0 with no extra read. */
  needsYou: number;
  /** The open business is a CA firm's (Business > Your CA). */
  caFirm: boolean;
}

/** The actions, each an href (or a new chat) and nothing else. */
const ACTIONS: readonly { id: string; href: string | null; when?: (options: CatalogueOptions) => boolean }[] = [
  { id: 'new-order', href: '#/work?sheet=new-order:new' },
  { id: 'add-client', href: '#/clients?sheet=client:new' },
  { id: 'import-contacts', href: '#/clients/network?sheet=network-import:new' },
  { id: 'add-bill', href: '#/money/bills' },
  { id: 'export-ca', href: '#/money/books?sheet=accountant:books', when: (options) => options.businessOpen },
  { id: 'approve', href: '#/approve/next', when: (options) => options.needsYou > 0 },
  { id: 'new-chat', href: null },
  { id: 'make-app', href: '#/apps' },
  { id: 'set-goal', href: '#/business/goals' },
  { id: 'back-up', href: '#/business/keep' },
  { id: 'rehearse', href: '#/business/practice' },
  { id: 'connect-ai', href: '#/connections/ai' },
];

/** The pages and actions on offer now. */
export function catalogue(options: CatalogueOptions): CatalogueEntry[] {
  const pages = NAVIGATION.filter((page) => !page.caFirm || options.caFirm)
    .map((page): CatalogueEntry => ({ id: `page:${page.href}`, kind: 'page', title: page.title, href: page.href }));
  const actions = ACTIONS.filter((action) => !action.when || action.when(options))
    .map((action): CatalogueEntry => ({ id: action.id, kind: 'action', title: `find.action.${action.id}`, href: action.href }));
  return [...pages, ...actions];
}

export interface CatalogueHit { entry: CatalogueEntry; label: string; score: number; hit: FindHit | null }

/**
 * The entries the words find, best first; on equal scores pages come before actions, then the catalogue's order. A
 * page answers to its title; an action to its label and its extra words.
 */
export function findInCatalogue(text: string, entries: readonly CatalogueEntry[], t: (key: string) => string): CatalogueHit[] {
  const hits: (CatalogueHit & { index: number })[] = [];
  entries.forEach((entry, index) => {
    const label = t(entry.title);
    const fields = [{ name: 'title', text: label }, ...(entry.kind === 'action' ? [{ name: 'words', text: t(`${entry.title}.words`) }] : [])];
    const scored = match(text, fields);
    if (scored) hits.push({ entry, label, score: scored.score, hit: scored.hit, index });
  });
  const rankOf = (kind: CatalogueEntry['kind']) => (kind === 'page' ? 0 : 1);
  return hits.sort((a, b) => b.score - a.score || rankOf(a.entry.kind) - rankOf(b.entry.kind) || a.index - b.index)
    .map(({ index: _index, ...hit }) => hit);
}
