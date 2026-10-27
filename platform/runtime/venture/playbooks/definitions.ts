// Chausar playbooks: wave 5's kit definitions, one import per business package's stub (Ink v2 wave 5, package 5-0).
// Never edited after 5-0: a package fills its own playbooks/<id>/definition.ts, and a stub still null is left out here.
// 5A1's kit reads this list (the optional definitions parameter each kit function takes defaults to it). Written for
// Chausar; nothing here is learned from an outside source.
import type { PlaybookDefinition } from './kit/define.ts';
import { SEO_VISIBILITY_DEFINITION } from './seo-visibility/definition.ts';
import { ONLINE_SELLER_DEFINITION } from './online-seller/definition.ts';
import { SUPPORT_DESK_DEFINITION } from './support-desk/definition.ts';
import { RECRUITING_DESK_DEFINITION } from './recruiting-desk/definition.ts';
import { JOB_SEARCH_DESK_DEFINITION } from './job-search-desk/definition.ts';
import { TRANSLATION_STUDIO_DEFINITION } from './translation-studio/definition.ts';
import { BOOKKEEPING_CFO_DEFINITION } from './bookkeeping-cfo/definition.ts';
import { PODCAST_TO_ARTICLE_DEFINITION } from './podcast-to-article/definition.ts';
import { LEAD_GENERATION_DEFINITION } from './lead-generation/definition.ts';
import { NEWSLETTER_STUDIO_DEFINITION } from './newsletter-studio/definition.ts';
import { TENDER_DESK_DEFINITION } from './tender-desk/definition.ts';
import { WEBSITE_STUDIO_DEFINITION } from './website-studio/definition.ts';
import { NARRATION_STUDIO_DEFINITION } from './narration-studio/definition.ts';
import { VIRTUAL_ASSISTANT_DEFINITION } from './virtual-assistant/definition.ts';
import { DATA_ENTRY_DESK_DEFINITION } from './data-entry-desk/definition.ts';
import { APP_TESTING_DEFINITION } from './app-testing/definition.ts';
import { DEV_AGENCY_DEFINITION } from './dev-agency/definition.ts';
import { MONITORED_DATA_DEFINITION } from './monitored-data/definition.ts';
import { IT_TRIAGE_DEFINITION } from './it-triage/definition.ts';
import { PHONE_RECEPTIONIST_DEFINITION } from './phone-receptionist/definition.ts';

const ALL: readonly (PlaybookDefinition | null)[] = [
  SEO_VISIBILITY_DEFINITION,
  ONLINE_SELLER_DEFINITION,
  SUPPORT_DESK_DEFINITION,
  RECRUITING_DESK_DEFINITION,
  JOB_SEARCH_DESK_DEFINITION,
  TRANSLATION_STUDIO_DEFINITION,
  BOOKKEEPING_CFO_DEFINITION,
  PODCAST_TO_ARTICLE_DEFINITION,
  LEAD_GENERATION_DEFINITION,
  NEWSLETTER_STUDIO_DEFINITION,
  TENDER_DESK_DEFINITION,
  WEBSITE_STUDIO_DEFINITION,
  NARRATION_STUDIO_DEFINITION,
  VIRTUAL_ASSISTANT_DEFINITION,
  DATA_ENTRY_DESK_DEFINITION,
  APP_TESTING_DEFINITION,
  DEV_AGENCY_DEFINITION,
  MONITORED_DATA_DEFINITION,
  IT_TRIAGE_DEFINITION,
  PHONE_RECEPTIONIST_DEFINITION,
];

/** The wave 5 kit definitions landed so far, in package order; a stub still null is not listed. */
export const PLAYBOOK_DEFINITIONS: readonly PlaybookDefinition[] = Object.freeze(ALL.filter((entry): entry is PlaybookDefinition => entry !== null));
