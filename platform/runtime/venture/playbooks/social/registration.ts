// Chausar flagship playbook: the social media agency (design 7.8). The registry entry only, with no runtime imports,
// so the registry (and the plan views that read it) never load the checks or the report.
import type { PlaybookRegistration } from '../registry.ts';

export const SOCIAL_AGENCY_ID = 'social-agency';
export const SOCIAL_AGENCY_LABEL = 'Social media agency';

export const SOCIAL_AGENCY_REGISTRATION: PlaybookRegistration = Object.freeze({
  id: SOCIAL_AGENCY_ID,
  label: SOCIAL_AGENCY_LABEL,
  serviceType: 'agency',
  picks: Object.freeze([
    'social media agency', 'social media marketing', 'social media management', 'social media manager', 'smm agency',
    'instagram management', 'instagram marketing', 'instagram agency', 'linkedin content', 'content marketing', 'content calendar',
    'community management', 'ugc ads', 'ugc-style ads',
  ]),
  summary: 'Agents draft calendars, posts, replies and creator-style ads for your clients; you approve each one, then your client does, and report figures come from their platform exports.',
  // Published in the client's name, under platform and disclosure rules. Chausar's build audit of 23 October 2026 last reviewed its rules; no person has yet.
  riskLevel: 'medium',
  lastReviewed: '2026-10-23',
});
