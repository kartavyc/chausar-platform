// Chausar flagship playbook, social media agency: its Start gallery tile (Ink v2 wave 5, package 5A1; plan 5D "Gallery
// tile"). The hours and pay are a model estimate, shown so with their basis (playbooks/ways.ts WAY_SOURCE). The team
// names the playbook's own roles, at most four; its code role (Chausar, which plans the calendar and works the report
// figures) is never drawn as an AI. The Hindi is machine-drafted and needs a native reviewer (HINDI_REVIEW,
// playbooks/ways.ts). Written for Chausar; nothing here is learned from an outside source.
import type { StartTile } from '../kit/define.ts';

export const SOCIAL_AGENCY_TILE: StartTile = Object.freeze({
  category: 'marketing',
  icon: 'megaphone',
  line: 'Posts, replies, reels and monthly reports for local shops, clinics and coaches.',
  youDo: Object.freeze({ hoursMin: 4, hoursMax: 6, line: 'Approve drafts, talk to clients, post or hand off.' }),
  team: Object.freeze({ roleIds: Object.freeze(['strategist', 'writer', 'creative', 'code']), line: 'Calendars, posts, reply drafts, report figures from exports.' }),
  pay: Object.freeze({ minRupees: 8000, maxRupees: 25000, per: 'a client a month' }),
});

/** The tile's lines in Hindi (machine-drafted, needs a native reviewer). */
