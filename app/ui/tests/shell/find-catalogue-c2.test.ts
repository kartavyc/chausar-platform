import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUES, format } from '../../src/text';
import { parseHash, RAIL_PLACES } from '../../src/shell/routes';
import { SHEETS } from '../../src/shell/places';
import { catalogue, findInCatalogue, NAVIGATION, type CatalogueOptions } from '../../src/shell/find/catalogue';

// C2 task 5: pages and actions for the command bar, one catalogue that only navigates. Pages come from the one
// navigation list (C1's, through the seam in catalogue.ts); actions are hrefs (or a new chat) and nothing else.

const t = (key: string, values?: Record<string, string>) => format(CATALOGUES.en, 'en', key, values);
const OPEN: CatalogueOptions = { businessOpen: true, needsYou: 2, caFirm: false };
const top = (text: string, options: CatalogueOptions = OPEN) => findInCatalogue(text, catalogue(options), t);

describe('the command bar catalogue', () => {
  it('holds every page of the navigation list, and each page title finds that page first', () => {
    const entries = catalogue({ ...OPEN, caFirm: true });
    for (const page of NAVIGATION) {
      expect(entries.some((entry) => entry.kind === 'page' && entry.href === page.href), page.href).toBe(true);
      const found = findInCatalogue(t(page.title), entries, t);
      expect(found[0]?.entry.href, t(page.title)).toBe(page.href);
    }
    for (const place of RAIL_PLACES) expect(NAVIGATION.some((page) => page.href === `#/${place}`), place).toBe(true);
  });

  it('sends every href to a known place, and every named sheet is one the shell has', () => {
    for (const entry of catalogue({ ...OPEN, caFirm: true })) {
      if (entry.href === null) { expect(entry.id).toBe('new-chat'); continue; }
      const route = parseHash(entry.href);
      expect(entry.href.startsWith(`#/${route.place}`), entry.href).toBe(true);
      if (entry.href.includes('sheet=')) {
        expect(route.sheet, entry.href).toBeDefined();
        expect(SHEETS[route.sheet!.kind], entry.href).toBeDefined();
      }
    }
  });

  it('finds New order first for "new order", the Invoices page for "invoice"', () => {
    expect(top('new order')[0]?.entry.id).toBe('new-order');
    expect(top('invoice').some((hit) => hit.entry.kind === 'page' && hit.entry.href === '#/money/invoices')).toBe(true);
  });

  it('offers Export for your CA only with a business open, and Approve what is waiting only when something waits', () => {
    expect(top('ca').some((hit) => hit.entry.id === 'export-ca')).toBe(true);
    expect(top('ca', { ...OPEN, businessOpen: false }).some((hit) => hit.entry.id === 'export-ca')).toBe(false);
    expect(catalogue(OPEN).some((entry) => entry.id === 'approve')).toBe(true);
    expect(catalogue({ ...OPEN, needsYou: 0 }).some((entry) => entry.id === 'approve')).toBe(false);
  });

  it('has a label and extra words in English for every action', () => {
    for (const entry of catalogue({ ...OPEN, caFirm: true }).filter((item) => item.kind === 'action')) {
      expect(CATALOGUES.en[`find.action.${entry.id}`], entry.id).toBeDefined();
      expect(CATALOGUES.en[`find.action.${entry.id}.words`], entry.id).toBeDefined();
    }
  });

  it('never calls the engine', () => {
    const text = readFileSync(join(import.meta.dirname, '../../src/shell/find/catalogue.ts'), 'utf8');
    expect(text).not.toMatch(/useEngine/);
    expect(text).not.toMatch(/engine\/client/);
    expect(text).not.toMatch(/request\(/);
  });
});
