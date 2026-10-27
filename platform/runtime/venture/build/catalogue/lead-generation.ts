// Chausar connector catalogue: the lead-generation playbook's own entries (Lead generation and appointment setting; Ink
// v2 wave 5, packages 5M). Package 5-0 left it empty; the package adds its connectors here, never in
// build/catalogue.ts. Import only types from catalogue.ts: it loads this file while it is still being set up
// (build/catalogue-playbooks.ts). Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const LEAD_GENERATION_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([]);
