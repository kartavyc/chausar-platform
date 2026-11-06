// Chausar flagship playbook, YouTube channel: its Start gallery tile (Ink v2 wave 5, package 5A1; plan 5B "Gallery
// tile"; 5B3 updates the line when its offers land). The hours and pay are a model estimate, shown so with their basis
// (playbooks/ways.ts WAY_SOURCE). The team names the playbook's own roles, at most four; its code role (Chausar, which
// builds the edit list) is never drawn as an AI. The Hindi is machine-drafted and needs a native reviewer
// (HINDI_REVIEW, playbooks/ways.ts). Written for Chausar; nothing here is learned from an outside source.
import type { StartTile } from '../kit/define.ts';

export const YOUTUBE_TILE: StartTile = Object.freeze({
  category: 'content',
  icon: 'video',
  line: "Episodes, shorts, packaging and audits for your own channel or a client's, from footage you own or license.",
  youDo: Object.freeze({ hoursMin: 4, hoursMax: 8, line: 'Record, watch each cut, meet sponsors.' }),
  team: Object.freeze({ roleIds: Object.freeze(['chausar', 'story-editor', 'producer', 'packager']), line: 'Edits, shorts, titles and sponsor quotes.' }),
  pay: Object.freeze({ minRupees: 5000, maxRupees: 30000, per: 'per video' }),
});

/** The tile's lines in Hindi (machine-drafted, needs a native reviewer). */
