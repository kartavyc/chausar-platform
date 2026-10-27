// Chausar connector catalogue: the narration-studio playbook's own entries (Narration and audiobooks; Ink v2 wave 5,
// packages 5Q). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts. Import
// only types from catalogue.ts: it loads this file while it is still being set up (build/catalogue-playbooks.ts).
// Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const NARRATION_STUDIO_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([]);
