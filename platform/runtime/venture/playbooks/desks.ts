// Chausar playbooks: every playbook's desk, one import per package's stub (Ink v2 wave 5, package 5-0). Never edited
// after 5-0: a package fills only its own playbooks/<id>/desk.ts. venture.desk.list, .get and .act reach a handler
// through deskHandler; 5A1 wires those three methods to it (playbooks/index.ts), and until then they answer
// NOT_BUILT_YET. Written for Chausar; nothing here is learned from an outside source.
import type { DeskHandler, DeskHandlers, DeskPlaybook } from './desk-types.ts';
import { YOUTUBE_DESK } from './youtube/desk.ts';
import { CA_FIRM_DESK } from './ca-firm/desk.ts';
import { SOCIAL_AGENCY_DESK } from './social/desk.ts';
import { SEO_VISIBILITY_DESK } from './seo-visibility/desk.ts';
import { ONLINE_SELLER_DESK } from './online-seller/desk.ts';
import { SUPPORT_DESK_DESK } from './support-desk/desk.ts';
import { RECRUITING_DESK_DESK } from './recruiting-desk/desk.ts';
import { JOB_SEARCH_DESK_DESK } from './job-search-desk/desk.ts';
import { TRANSLATION_STUDIO_DESK } from './translation-studio/desk.ts';
import { BOOKKEEPING_CFO_DESK } from './bookkeeping-cfo/desk.ts';
import { PODCAST_TO_ARTICLE_DESK } from './podcast-to-article/desk.ts';
import { LEAD_GENERATION_DESK } from './lead-generation/desk.ts';
import { NEWSLETTER_STUDIO_DESK } from './newsletter-studio/desk.ts';
import { TENDER_DESK_DESK } from './tender-desk/desk.ts';
import { WEBSITE_STUDIO_DESK } from './website-studio/desk.ts';
import { NARRATION_STUDIO_DESK } from './narration-studio/desk.ts';
import { VIRTUAL_ASSISTANT_DESK } from './virtual-assistant/desk.ts';
import { DATA_ENTRY_DESK_DESK } from './data-entry-desk/desk.ts';
import { APP_TESTING_DESK } from './app-testing/desk.ts';
import { DEV_AGENCY_DESK } from './dev-agency/desk.ts';
import { MONITORED_DATA_DESK } from './monitored-data/desk.ts';
import { IT_TRIAGE_DESK } from './it-triage/desk.ts';
import { PHONE_RECEPTIONIST_DESK } from './phone-receptionist/desk.ts';

/** Each playbook's desk handlers, by playbook id, then by record kind. */
export const PLAYBOOK_DESKS: Readonly<Record<DeskPlaybook, DeskHandlers>> = Object.freeze({
  'youtube': YOUTUBE_DESK,
  'ca-firm': CA_FIRM_DESK,
  'social-agency': SOCIAL_AGENCY_DESK,
  'seo-visibility': SEO_VISIBILITY_DESK,
  'online-seller': ONLINE_SELLER_DESK,
  'support-desk': SUPPORT_DESK_DESK,
  'recruiting-desk': RECRUITING_DESK_DESK,
  'job-search-desk': JOB_SEARCH_DESK_DESK,
  'translation-studio': TRANSLATION_STUDIO_DESK,
  'bookkeeping-cfo': BOOKKEEPING_CFO_DESK,
  'podcast-to-article': PODCAST_TO_ARTICLE_DESK,
  'lead-generation': LEAD_GENERATION_DESK,
  'newsletter-studio': NEWSLETTER_STUDIO_DESK,
  'tender-desk': TENDER_DESK_DESK,
  'website-studio': WEBSITE_STUDIO_DESK,
  'narration-studio': NARRATION_STUDIO_DESK,
  'virtual-assistant': VIRTUAL_ASSISTANT_DESK,
  'data-entry-desk': DATA_ENTRY_DESK_DESK,
  'app-testing': APP_TESTING_DESK,
  'dev-agency': DEV_AGENCY_DESK,
  'monitored-data': MONITORED_DATA_DESK,
  'it-triage': IT_TRIAGE_DESK,
  'phone-receptionist': PHONE_RECEPTIONIST_DESK,
});

/** The handler for one record kind on one playbook's desk, or null when that playbook has none for it yet. */
export function deskHandler(playbook: string, kind: string): DeskHandler | null {
  if (!Object.hasOwn(PLAYBOOK_DESKS, playbook)) return null;
  const desk = PLAYBOOK_DESKS[playbook as DeskPlaybook];
  return Object.hasOwn(desk, kind) ? desk[kind]! : null;
}
