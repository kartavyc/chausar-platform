// Chausar flagship playbook: the AI-native CA firm (design 7.8). The registry entry only, with no runtime imports, so
// the registry (and the plan views that read it) never load the tax engines.
import type { PlaybookRegistration } from '../registry.ts';

export const CA_FIRM_ID = 'ca-firm';
export const CA_FIRM_LABEL = 'AI-native CA firm';

export const CA_FIRM_REGISTRATION: PlaybookRegistration = Object.freeze({
  id: CA_FIRM_ID,
  label: CA_FIRM_LABEL,
  serviceType: 'bookkeeping',
  picks: Object.freeze([
    'ca firm', 'chartered accountant', 'chartered accountancy', 'ai-native ca', 'ca practice',
    'bookkeeping practice', 'gst filing service', 'gst filing', 'gst return', 'itr filing', 'income tax return', 'tds return', 'tds filing',
  ]),
  summary: 'Agents prepare books, GST, TDS and income tax working papers; a chartered accountant of record signs off anything regulated.',
});
