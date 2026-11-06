import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format } from '../../src/text';
import { AI_SETTINGS, SETTINGS, SETTINGS_PAGES, findSettings, settingsFor } from '../../src/shell/settings';
import { navEntries } from '../../src/shell/nav';
import { parseHash } from '../../src/shell/routes';

/** C1 task 6: one list of settings, in four groups, with the words that find each page. */

const en = (key: string, values?: Record<string, string | number>) => format(CATALOGUES.en, 'en', key, values);
const titles = (found: ReturnType<typeof findSettings>) => found.map((m) => en(m.title));

describe('the settings list', () => {
  it('is four groups in order: Business, Work, Money, Safety', () => {
    expect(SETTINGS.map((g) => g.id)).toEqual(['business', 'work', 'money', 'safety']);
    expect(SETTINGS.map((g) => en(g.title))).toEqual(['Business', 'Work', 'Money', 'Safety']);
    expect(SETTINGS.map((g) => g.pages.map((p) => p.sub))).toEqual([
      ['plan', 'owner', 'voice', 'knowledge', 'build', 'app'],
      ['practice', 'routines', 'notifications', 'away', 'chats'],
      ['prices', 'goals', 'go-no-go', 'ca'],
      ['keep', 'decisions', 'rules', 'reports'],
    ]);
  });

  it('lists every page of places/business exactly once, so the list and the pages cannot drift', () => {
    const source = readFileSync(join(import.meta.dirname, '../../src/places/business/index.tsx'), 'utf8');
    const pages = [...source.matchAll(/\bsub: '([a-z-]+)'/g)].map((m) => m[1]!);
    expect([...pages].sort()).toEqual(SETTINGS_PAGES.map((p) => p.sub).sort());
    for (const p of SETTINGS_PAGES) {
      expect(pages.filter((sub) => sub === p.sub), p.sub).toHaveLength(1);
      expect(p.href).toBe(`#/business/${p.sub}`);
      expect(parseHash(p.href)).toEqual({ place: 'business', sub: p.sub, query: {} });
    }
  });

  it('lists Your CA only for a business on the CA firm playbook', () => {
    const subs = (venture: Parameters<typeof settingsFor>[0]) => settingsFor(venture).flatMap((g) => g.pages.map((p) => p.sub));
    expect(subs({ playbook: { id: 'ca-firm' } })).toContain('ca');
    expect(subs({ playbook: { id: 'youtube' } })).not.toContain('ca');
    expect(subs(null)).not.toContain('ca');
  });

  it('every title and search line is in the English catalogue', () => {
    for (const key of [...SETTINGS.map((g) => g.title), ...SETTINGS_PAGES.flatMap((p) => [p.title, p.find]), AI_SETTINGS.title, AI_SETTINGS.find]) {
      expect(CATALOGUES.en[key], key).toBeTypeOf('string');
    }
  });
});

describe('findSettings', () => {
  it('finds a page by its search words, case-insensitively, in list order', () => {
    expect(titles(findSettings('passphrase', en))).toEqual(['Keep this business']);
    expect(titles(findSettings('PASS', en))).toEqual(['Keep this business']);
    expect(titles(findSettings('telegram', en))).toEqual(['Notifications']);
    expect(titles(findSettings('rout', en))).toEqual(['Routines']);
    expect(findSettings('rout', en)[0]!.href).toBe('#/business/routines');
  });

  it('finds AI settings in Connections for the model and the AI', () => {
    for (const word of ['model', 'Codex', 'claude']) {
      expect(findSettings(word, en).map((m) => m.href), word).toContain('#/connections/ai');
    }
    expect(titles(findSettings('model', en))).toEqual(['AI settings, in Connections']);
  });

  it('nothing for an empty query or an unknown word', () => {
    expect(findSettings('  ', en)).toEqual([]);
    expect(findSettings('zzz', en)).toEqual([]);
  });
});

describe('the navigation seam (for Ctrl K)', () => {
  it('holds the rail places, the sub-pages and every settings page, each a known address', () => {
    const entries = navEntries({ playbook: { id: 'ca-firm' } });
    expect(new Set(entries.map((e) => e.id)).size).toBe(entries.length);
    expect(entries.filter((e) => e.area === 'place').map((e) => e.id)).toEqual(['today', 'chats', 'team', 'work', 'clients', 'money', 'apps', 'connections']);
    expect(entries.filter((e) => e.area === 'settings').map((e) => e.href)).toEqual(['#/business', ...SETTINGS_PAGES.map((p) => p.href)]);
    for (const entry of entries) {
      expect(CATALOGUES.en[entry.title], entry.title).toBeTypeOf('string');
      expect(entry.href.startsWith('#/')).toBe(true);
      expect(parseHash(entry.href).place).toBe(entry.href.slice(2).split(/[/?]/)[0]);
    }
  });
});
