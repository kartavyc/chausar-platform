// 15 Nov 2026 (the first walk of the built Windows app): words pointed to a place called "Business" that the
// navigation calls "Settings" ("Change it any time in Business, Notifications.", "under Business, Decisions."). The
// place was renamed and the lines that name it were not. A line that sends the owner somewhere must use the words the
// navigation shows: the place's own label, then the page's own title. This holds for every text key, in English and
// in the Hindi pack, against the navigation's labels in the same language.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES } from '../src/text';
import { RAIL_PLACES } from '../src/shell/routes';
import { SETTINGS_PAGES } from '../src/shell/settings';

/** A key's words as one text: a key with plural forms holds one line per form. */
const flat = (pack: Readonly<Record<string, unknown>>): Record<string, string> => Object.fromEntries(Object.entries(pack).map(([key, value]) => [key, typeof value === 'string' ? value : Object.values(value as object).join('\n')]));
const en = flat(CATALOGUES.en);
const HI = join(import.meta.dirname, '../src/text/hi');
const hi = flat(Object.assign({}, ...readdirSync(HI).map((file) => JSON.parse(readFileSync(join(HI, file), 'utf8')) as Record<string, unknown>)));

/** The navigation's places: the rail's, and Settings. */
const NAV_KEYS = [...RAIL_PLACES.map((place) => `place.${place}`), 'place.business'];
const escape = (words: string) => words.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

describe('a text key that names a place uses the navigation\'s own words', () => {
  const nav = NAV_KEYS.map((key) => en[key]!);
  const settings = en['place.business']!;
  const pages = SETTINGS_PAGES.map((page) => en[page.title]!);
  const lines = Object.entries(en).filter(([key]) => !NAV_KEYS.includes(key));

  it('the navigation has its labels, and Settings its pages', () => {
    expect(nav).toEqual(['Today', 'Chats', 'Team', 'Work', 'Clients', 'Money', 'Apps', 'Connections', 'Settings']);
    expect(pages).toEqual(expect.arrayContaining(['How the work is done', 'Prices', 'Notifications', 'Decisions']));
    expect(pages.every((title) => typeof title === 'string' && title.length > 0)).toBe(true);
  });

  it('"in X, Page" and "under X, Page" name a place the navigation has', () => {
    // A place and a page are both capitalised, with a comma between: "under Settings, Prices".
    const PLACE_THEN_PAGE = /\b(?:[Ii]n|[Uu]nder)\s+([A-Z][A-Za-z]*), [A-Z]/g;
    const wrong = lines.flatMap(([key, text]) => [...text.matchAll(PLACE_THEN_PAGE)].filter((found) => !nav.includes(found[1]!)).map((found) => `${key}: "${found[1]}" in "${text}"`));
    expect(wrong).toEqual([]);
  });

  it('the old name of Settings, "Business", names no place', () => {
    const OLD_PLACE = /\b(?:in|under|to|from|on|at|open|see|into)\s+Business\b(?=\s*[,.>:;)]|\s*$)|\bBusiness\s*>\s*[A-Z]|\bBusiness, [A-Z]/;
    expect(lines.filter(([, text]) => OLD_PLACE.test(text)).map(([key, text]) => `${key}: ${text}`)).toEqual([]);
  });

  it('a Settings page named after a comma has "Settings" before it, and "Settings, ..." names a real page', () => {
    const wrongPlace = lines.flatMap(([key, text]) => pages.flatMap((title) => [...text.matchAll(new RegExp(`([A-Za-z]+), ${escape(title)}(?![A-Za-z])`, 'g'))]
      .filter((found) => /^[A-Z]/.test(found[1]!) && found[1] !== settings).map((found) => `${key}: "${found[1]}, ${title}" in "${text}"`)));
    expect(wrongPlace).toEqual([]);
    const noPage = lines.flatMap(([key, text]) => [...text.matchAll(new RegExp(`\\b${escape(settings)}, ([A-Z][^.;:!?]*)`, 'g'))]
      .filter((found) => !pages.some((title) => found[1]!.startsWith(title))).map((found) => `${key}: "${settings}, ${found[1]}"`));
    expect(noPage).toEqual([]);
  });

  it('the Hindi pack names the same place and page, in the Hindi navigation\'s words', () => {
    const settingsHi = hi['place.business'] ?? settings;
    const pageHi = (title: string) => hi[title] ?? en[title]!;
    // Every line whose English says "Settings, <page>" says the Hindi label and that page's Hindi title.
    const missing = lines.flatMap(([key, text]) => SETTINGS_PAGES.filter((page) => text.includes(`${settings}, ${en[page.title]}`))
      .filter((page) => key in hi && !hi[key]!.includes(`${settingsHi}, ${pageHi(page.title)}`)).map((page) => `${key}: needs "${settingsHi}, ${pageHi(page.title)}" in "${hi[key]}"`));
    expect(missing).toEqual([]);
    // The check is not empty: these lines name a Settings page in English.
    expect(lines.filter(([, text]) => SETTINGS_PAGES.some((page) => text.includes(`${settings}, ${en[page.title]}`))).length).toBeGreaterThanOrEqual(5);
  });
});
