// Chausar playbooks: wave 5's registrations, one import per business package's stub (Ink v2 wave 5, package 5-0). Never
// edited after 5-0: a package fills its own playbooks/<id>/registration.ts, and a stub still null is left out here. 5A1
// joins this list to the registry (registry.ts PLAYBOOK_REGISTRY). Written for Chausar; nothing here is learned from an
// outside source.
import type { PlaybookRegistration } from './registry.ts';
import { SEO_VISIBILITY_REGISTRATION } from './seo-visibility/registration.ts';
import { ONLINE_SELLER_REGISTRATION } from './online-seller/registration.ts';
import { SUPPORT_DESK_REGISTRATION } from './support-desk/registration.ts';
import { RECRUITING_DESK_REGISTRATION } from './recruiting-desk/registration.ts';
import { JOB_SEARCH_DESK_REGISTRATION } from './job-search-desk/registration.ts';
import { TRANSLATION_STUDIO_REGISTRATION } from './translation-studio/registration.ts';
import { BOOKKEEPING_CFO_REGISTRATION } from './bookkeeping-cfo/registration.ts';
import { PODCAST_TO_ARTICLE_REGISTRATION } from './podcast-to-article/registration.ts';
import { LEAD_GENERATION_REGISTRATION } from './lead-generation/registration.ts';
import { NEWSLETTER_STUDIO_REGISTRATION } from './newsletter-studio/registration.ts';
import { TENDER_DESK_REGISTRATION } from './tender-desk/registration.ts';
import { WEBSITE_STUDIO_REGISTRATION } from './website-studio/registration.ts';
import { NARRATION_STUDIO_REGISTRATION } from './narration-studio/registration.ts';
import { VIRTUAL_ASSISTANT_REGISTRATION } from './virtual-assistant/registration.ts';
import { DATA_ENTRY_DESK_REGISTRATION } from './data-entry-desk/registration.ts';
import { APP_TESTING_REGISTRATION } from './app-testing/registration.ts';
import { DEV_AGENCY_REGISTRATION } from './dev-agency/registration.ts';
import { MONITORED_DATA_REGISTRATION } from './monitored-data/registration.ts';
import { IT_TRIAGE_REGISTRATION } from './it-triage/registration.ts';
import { PHONE_RECEPTIONIST_REGISTRATION } from './phone-receptionist/registration.ts';

const ALL: readonly (PlaybookRegistration | null)[] = [
  SEO_VISIBILITY_REGISTRATION,
  ONLINE_SELLER_REGISTRATION,
  SUPPORT_DESK_REGISTRATION,
  RECRUITING_DESK_REGISTRATION,
  JOB_SEARCH_DESK_REGISTRATION,
  TRANSLATION_STUDIO_REGISTRATION,
  BOOKKEEPING_CFO_REGISTRATION,
  PODCAST_TO_ARTICLE_REGISTRATION,
  LEAD_GENERATION_REGISTRATION,
  NEWSLETTER_STUDIO_REGISTRATION,
  TENDER_DESK_REGISTRATION,
  WEBSITE_STUDIO_REGISTRATION,
  NARRATION_STUDIO_REGISTRATION,
  VIRTUAL_ASSISTANT_REGISTRATION,
  DATA_ENTRY_DESK_REGISTRATION,
  APP_TESTING_REGISTRATION,
  DEV_AGENCY_REGISTRATION,
  MONITORED_DATA_REGISTRATION,
  IT_TRIAGE_REGISTRATION,
  PHONE_RECEPTIONIST_REGISTRATION,
];

/** The wave 5 playbooks registered so far, in package order; a stub still null is not listed. */
export const PLAYBOOK_REGISTRATIONS: readonly PlaybookRegistration[] = Object.freeze(ALL.filter((entry): entry is PlaybookRegistration => entry !== null));
