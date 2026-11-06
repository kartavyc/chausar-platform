// Chausar venture launcher, core (P1; wave 6, 6E1): the substring keywords each service type is guessed from when no
// playbook phrase picks the idea (core/service-types.ts classifyIdea). Pure and import-free so the UI's fake engine
// reads the same list (app/ui/src/engine/fixtures.ts) and both guess alike. Keys follow SERVICE_TYPES order, because a
// tie goes to the type listed first; the wave 6 types (teaching, local services, licensed work) come last for that reason.

/** The service types of contracts.ts SERVICE_TYPES except 'other', named here so this file needs no engine import. */
export type KeywordServiceType = 'agency' | 'studio' | 'consulting' | 'bookkeeping' | 'research' | 'content' | 'support' | 'teaching' | 'local-services' | 'licensed';

/** Substring keywords per type, matched against the lower-cased idea. */
export const SERVICE_KEYWORDS: Readonly<Record<KeywordServiceType, readonly string[]>> = Object.freeze({
  agency: ['marketing', 'ads', 'advert', 'social media', 'agency', 'leads', 'outreach', 'growth', 'campaign'],
  studio: ['podcast', 'video', 'design', 'edit', 'photo', 'logo', 'brand', 'studio', 'animation'],
  consulting: ['consult', 'advis', 'coach', 'strategy', 'audit', 'mentor'],
  bookkeeping: ['bookkeep', 'accounts', 'accounting', 'gst', 'tax', 'ledger', 'payroll', 'invoice', 'books'],
  research: ['research', 'lead list', 'market', 'report', 'analysis', 'data', 'survey'],
  content: ['blog', 'newsletter', 'copy', 'writing', 'seo', 'article', 'content', 'script'],
  support: ['support', 'customer service', 'inbox', 'helpdesk', 'help desk', 'chat', 'tickets'],
  // W6 6E1 (D2).
  teaching: ['tuition', 'tutor', 'teach', 'lesson', 'classes', 'student', 'learner', 'spoken english', 'yoga', 'fitness', 'music', 'dance', 'trainer', 'worksheet', 'dietitian'],
  'local-services': ['salon', 'beauty', 'beautician', 'electrician', 'plumber', 'repair', 'home visit', 'home service', 'tiffin', 'home chef', 'catering', 'wedding', 'event planner', 'travel agent', 'real estate', 'physiotherap', 'technician', 'booking'],
  licensed: ['advocate', 'lawyer', 'legal', 'doctor', 'clinic', 'patient', 'physician', 'licensed', 'sign off', 'financial planner', 'mutual fund', 'sebi'],
});
