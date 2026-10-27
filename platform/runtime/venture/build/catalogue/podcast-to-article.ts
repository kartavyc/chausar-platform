// Chausar connector catalogue: the podcast-to-article playbook's own entries (Podcast to articles; Ink v2 wave 5,
// packages 5L). Package 5-0 left it empty; the package adds its connectors here, never in build/catalogue.ts. Import
// only types from catalogue.ts: it loads this file while it is still being set up (build/catalogue-playbooks.ts).
// Written for Chausar; nothing here is learned from an outside source.
import type { CatalogueEntry } from '../catalogue.ts';

export const PODCAST_TO_ARTICLE_CATALOGUE: readonly CatalogueEntry[] = Object.freeze([]);
