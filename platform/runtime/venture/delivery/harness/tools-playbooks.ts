// Chausar delivery harness: every wave 5 tool, one import per package's tool file (Ink v2 wave 5, package 5-0). Never
// edited after 5-0: a package changes only its own tools-<id>.ts (or, for the kit and the flagships, its own lines in
// tools-kit.ts and the flagship's *_W5_TOOLS). tools.ts spreads PLAYBOOK_TOOLS into the tool table. Written for
// Chausar; nothing here is learned from an outside source.
import { KIT_TOOLS } from './tools-kit.ts';
import { YOUTUBE_W5_TOOLS } from './tools-youtube.ts';
import { CA_W5_TOOLS } from './tools-ca.ts';
import { SOCIAL_W5_TOOLS } from './tools-social.ts';
import { SEO_VISIBILITY_TOOLS } from './tools-seo-visibility.ts';
import { ONLINE_SELLER_TOOLS } from './tools-online-seller.ts';
import { SUPPORT_DESK_TOOLS } from './tools-support-desk.ts';
import { RECRUITING_DESK_TOOLS } from './tools-recruiting-desk.ts';
import { JOB_SEARCH_DESK_TOOLS } from './tools-job-search-desk.ts';
import { TRANSLATION_STUDIO_TOOLS } from './tools-translation-studio.ts';
import { BOOKKEEPING_CFO_TOOLS } from './tools-bookkeeping-cfo.ts';
import { PODCAST_TO_ARTICLE_TOOLS } from './tools-podcast-to-article.ts';
import { LEAD_GENERATION_TOOLS } from './tools-lead-generation.ts';
import { NEWSLETTER_STUDIO_TOOLS } from './tools-newsletter-studio.ts';
import { TENDER_DESK_TOOLS } from './tools-tender-desk.ts';
import { WEBSITE_STUDIO_TOOLS } from './tools-website-studio.ts';
import { NARRATION_STUDIO_TOOLS } from './tools-narration-studio.ts';
import { VIRTUAL_ASSISTANT_TOOLS } from './tools-virtual-assistant.ts';
import { DATA_ENTRY_DESK_TOOLS } from './tools-data-entry-desk.ts';
import { APP_TESTING_TOOLS } from './tools-app-testing.ts';
import { DEV_AGENCY_TOOLS } from './tools-dev-agency.ts';
import { MONITORED_DATA_TOOLS } from './tools-monitored-data.ts';
import { IT_TRIAGE_TOOLS } from './tools-it-triage.ts';
import { PHONE_RECEPTIONIST_TOOLS } from './tools-phone-receptionist.ts';

/** The kit's tools, the flagships' wave 5 tools and every new playbook's tools, by name. */
export const PLAYBOOK_TOOLS = Object.freeze({
  ...KIT_TOOLS,
  ...YOUTUBE_W5_TOOLS,
  ...CA_W5_TOOLS,
  ...SOCIAL_W5_TOOLS,
  ...SEO_VISIBILITY_TOOLS,
  ...ONLINE_SELLER_TOOLS,
  ...SUPPORT_DESK_TOOLS,
  ...RECRUITING_DESK_TOOLS,
  ...JOB_SEARCH_DESK_TOOLS,
  ...TRANSLATION_STUDIO_TOOLS,
  ...BOOKKEEPING_CFO_TOOLS,
  ...PODCAST_TO_ARTICLE_TOOLS,
  ...LEAD_GENERATION_TOOLS,
  ...NEWSLETTER_STUDIO_TOOLS,
  ...TENDER_DESK_TOOLS,
  ...WEBSITE_STUDIO_TOOLS,
  ...NARRATION_STUDIO_TOOLS,
  ...VIRTUAL_ASSISTANT_TOOLS,
  ...DATA_ENTRY_DESK_TOOLS,
  ...APP_TESTING_TOOLS,
  ...DEV_AGENCY_TOOLS,
  ...MONITORED_DATA_TOOLS,
  ...IT_TRIAGE_TOOLS,
  ...PHONE_RECEPTIONIST_TOOLS,
});
