// Chausar connector catalogue: the bookkeeping-cfo playbook's own entries (Bookkeeping and CFO help; Ink v2 wave 5,
// packages 5K1, 5K2). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts.
// Import only types from catalogue.ts: it loads this file while it is still being set up
// (build/catalogue-playbooks.ts). Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const BOOKKEEPING_CFO_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([]);
