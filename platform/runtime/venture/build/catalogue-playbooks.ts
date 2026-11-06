// Chausar connector catalogue: wave 5's playbook entries, one import per business package's stub (Ink v2 wave 5,
// package 5-0). Never edited after 5-0: a package adds its connectors in its own build/catalogue/<id>.ts.
// CONNECTOR_CATALOGUE (catalogue.ts) spreads this list; the catalogue count test counts it. Written for Chausar;
// nothing here is learned from an outside source.
import type { CatalogueEntry } from './catalogue.ts';
import { SEO_VISIBILITY_CATALOGUE } from './catalogue/seo-visibility.ts';
import { ONLINE_SELLER_CATALOGUE } from './catalogue/online-seller.ts';
import { SUPPORT_DESK_CATALOGUE } from './catalogue/support-desk.ts';
import { RECRUITING_DESK_CATALOGUE } from './catalogue/recruiting-desk.ts';
import { JOB_SEARCH_DESK_CATALOGUE } from './catalogue/job-search-desk.ts';
import { TRANSLATION_STUDIO_CATALOGUE } from './catalogue/translation-studio.ts';
import { BOOKKEEPING_CFO_CATALOGUE } from './catalogue/bookkeeping-cfo.ts';
import { PODCAST_TO_ARTICLE_CATALOGUE } from './catalogue/podcast-to-article.ts';
import { LEAD_GENERATION_CATALOGUE } from './catalogue/lead-generation.ts';
import { NEWSLETTER_STUDIO_CATALOGUE } from './catalogue/newsletter-studio.ts';
import { TENDER_DESK_CATALOGUE } from './catalogue/tender-desk.ts';
import { WEBSITE_STUDIO_CATALOGUE } from './catalogue/website-studio.ts';
import { NARRATION_STUDIO_CATALOGUE } from './catalogue/narration-studio.ts';
import { VIRTUAL_ASSISTANT_CATALOGUE } from './catalogue/virtual-assistant.ts';
import { DATA_ENTRY_DESK_CATALOGUE } from './catalogue/data-entry-desk.ts';
import { APP_TESTING_CATALOGUE } from './catalogue/app-testing.ts';
import { DEV_AGENCY_CATALOGUE } from './catalogue/dev-agency.ts';
import { MONITORED_DATA_CATALOGUE } from './catalogue/monitored-data.ts';
import { IT_TRIAGE_CATALOGUE } from './catalogue/it-triage.ts';
import { PHONE_RECEPTIONIST_CATALOGUE } from './catalogue/phone-receptionist.ts';

/** Every wave 5 playbook's own catalogue entries, in package order. */
export const PLAYBOOK_CATALOGUE_ENTRIES: readonly CatalogueEntry[] = Object.freeze([
  ...SEO_VISIBILITY_CATALOGUE,
  ...ONLINE_SELLER_CATALOGUE,
  ...SUPPORT_DESK_CATALOGUE,
  ...RECRUITING_DESK_CATALOGUE,
  ...JOB_SEARCH_DESK_CATALOGUE,
  ...TRANSLATION_STUDIO_CATALOGUE,
  ...BOOKKEEPING_CFO_CATALOGUE,
  ...PODCAST_TO_ARTICLE_CATALOGUE,
  ...LEAD_GENERATION_CATALOGUE,
  ...NEWSLETTER_STUDIO_CATALOGUE,
  ...TENDER_DESK_CATALOGUE,
  ...WEBSITE_STUDIO_CATALOGUE,
  ...NARRATION_STUDIO_CATALOGUE,
  ...VIRTUAL_ASSISTANT_CATALOGUE,
  ...DATA_ENTRY_DESK_CATALOGUE,
  ...APP_TESTING_CATALOGUE,
  ...DEV_AGENCY_CATALOGUE,
  ...MONITORED_DATA_CATALOGUE,
  ...IT_TRIAGE_CATALOGUE,
  ...PHONE_RECEPTIONIST_CATALOGUE,
]);
