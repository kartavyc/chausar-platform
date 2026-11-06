/**
 * Settings (C1 task 6): the one list of the business's settings pages, in four groups, with the words that find each.
 * The Settings page (places/business/SettingsList.tsx), the rail's Settings row, the business menu's Settings and
 * Away links, and the Ctrl K command bar (C2) all read it, so the pages and the ways to them cannot drift apart.
 * Every page keeps its address, `#/business/<sub>`, so the links other places hold still land.
 *
 * Pure: no engine, no request. Titles and search words are text keys; `findSettings` reads them through `t`.
 */

import type { T } from '../text';
import { match } from '../../../../platform/runtime/venture/views/find-core';

export type SettingsGroupId = 'business' | 'work' | 'money' | 'safety';

export interface SettingsPage {
  sub: string;
  /** The page's title key (the Settings list's row and the page's header). */
  title: string;
  /** The text key of the page's search words. */
  find: string;
  href: string;
}

export interface SettingsGroup {
  id: SettingsGroupId;
  /** The group's heading key. */
  title: string;
  pages: readonly SettingsPage[];
}

/** Where Settings opens: the list (a phone), or the first page beside it (a wide window). */
export const SETTINGS_HREF = '#/business';

const page = (sub: string, title: string): SettingsPage => ({ sub, title, find: `business.settings.find.${sub}`, href: `${SETTINGS_HREF}/${sub}` });

/** The four groups in order, each with its pages in order (founder's answer, 5 Nov). */
export const SETTINGS: readonly SettingsGroup[] = [
  {
    id: 'business',
    title: 'business.settings.group.business',
    pages: [page('plan', 'business.plan'), page('owner', 'business.owner'), page('voice', 'business.voice'), page('knowledge', 'business.knowledge'), page('build', 'business.build'), page('app', 'business.app')],
  },
  {
    id: 'work',
    title: 'business.settings.group.work',
    pages: [page('practice', 'business.practice'), page('routines', 'business.routines'), page('notifications', 'business.notify'), page('away', 'business.away'), page('chats', 'business.chats')],
  },
  {
    id: 'money',
    title: 'business.settings.group.money',
    pages: [page('prices', 'business.prices'), page('goals', 'business.goals'), page('go-no-go', 'kit-sales.page'), page('ca', 'business.ca')],
  },
  {
    id: 'safety',
    title: 'business.settings.group.safety',
    pages: [page('keep', 'business.keep'), page('decisions', 'business.decisions'), page('rules', 'business.yourRules'), page('reports', 'feedback.page')],
  },
];

/** The flagship playbook whose businesses have a CA of record: only they list Your CA. */
export const CA_FIRM = 'ca-firm';

/** Every page, in list order. */
export const SETTINGS_PAGES: readonly SettingsPage[] = SETTINGS.flatMap((group) => group.pages);

/** One page by its sub, wherever it sits. */
export function settingsPage(sub: string): SettingsPage {
  const found = SETTINGS_PAGES.find((p) => p.sub === sub);
  if (!found) throw new Error(`no settings page ${sub}`);
  return found;
}

/** The groups this business shows: Your CA only for a business on the CA firm playbook. */
export function settingsFor(venture: { playbook?: { id: string } | null | undefined } | null | undefined): SettingsGroup[] {
  const caFirm = venture?.playbook?.id === CA_FIRM;
  return SETTINGS.map((group) => ({ ...group, pages: group.pages.filter((p) => p.sub !== 'ca' || caFirm) }));
}

/** One result of a search: a page in a group, or the one way out of Settings (AI settings, in Connections). */
export interface SettingsMatch {
  group: SettingsGroupId | null;
  sub: string | null;
  title: string;
  href: string;
}

/** The model picker lives with the AI connection, so Settings' search points there (C1 task 13). */
export const AI_SETTINGS = { title: 'business.settings.ai', find: 'business.settings.find.ai', href: '#/connections/ai' } as const;

/**
 * The pages whose title or search words hold every word typed, case-insensitively, in list order; then AI settings in
 * Connections when it matches. An empty query matches nothing.
 */
export function findSettings(query: string, t: T, groups: readonly SettingsGroup[] = SETTINGS): SettingsMatch[] {
  if (!query.trim()) return [];
  // C2: the same matching as the command bar.
  const hits = (title: string, find: string) => match(query, [{ name: 'title', text: t(title) }, { name: 'words', text: t(find) }]) !== null;
  const found: SettingsMatch[] = groups.flatMap((group) => group.pages.filter((p) => hits(p.title, p.find)).map((p) => ({ group: group.id, sub: p.sub, title: p.title, href: p.href })));
  if (hits(AI_SETTINGS.title, AI_SETTINGS.find)) found.push({ group: null, sub: null, title: AI_SETTINGS.title, href: AI_SETTINGS.href });
  return found;
}
