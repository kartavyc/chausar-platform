// Chausar flagship playbooks: the Start gallery's words for each registered playbook (Ink v2 wave 4, package 4J8;
// catalogue U3; spec 3 "Start"). One way to earn per playbook Chausar can run today, as data: its category, what the
// owner does and the hours a week, what its AI team does, what clients usually pay, and a starter sentence that picks
// the playbook. Who is on the team is never written here: core/ways.ts reads the playbook's own agents and their
// departments (playbooks/steps.ts, departments.ts).
//
// The hours and the price ranges were written by an AI (the one that built this file), not measured or surveyed, so
// every screen shows them as a model estimate with WAY_SOURCE as their basis, never as a receipt or a promise. Owners
// set every price themselves.
//
// A way for a playbook that is not registered, or not built yet, is never listed: validateWays refuses it, and
// core/ways.ts lists only registered playbooks that deliver today. Wave 5 adds its own playbooks' ways here.
import type { WayCategory } from '../contracts.ts';
import { houseStyleFindings } from '../records.ts';
import { PLAYBOOK_REGISTRY, pickPlaybook, type PlaybookRegistration } from './registry.ts';
import { flagshipDelivery } from './steps.ts';
import { CA_CONNECTORS } from './ca-firm/playbook.ts';
import { CA_FIRM_ID } from './ca-firm/registration.ts';
import { SOCIAL_CONNECTORS } from './social/playbook.ts';
import { SOCIAL_AGENCY_ID } from './social/registration.ts';
import { youtubeConnectors } from './youtube/playbook.ts';
import { YOUTUBE_ID } from './youtube/registration.ts';
import { YOUTUBE_TILE } from './youtube/tile.ts';
import { CA_FIRM_TILE } from './ca-firm/tile.ts';
import { SOCIAL_AGENCY_TILE } from './social/tile.ts';
import type { StartTile } from './kit/define.ts';

/**
 * The words of one way in one language. per: what the range is for, as it reads after "Clients usually pay,". needs:
 * in plain words, the connections the way uses (each listed in uses, and working today) and any it can use only when
 * the owner has it, which the words call optional (ffmpeg for the YouTube way's finishing check is not in uses).
 */
export type WayLanguage = { label: string; line: string; youDo: string; teamLine: string; per: string; starter: string; needs: string };
export type WayData = {
  /** The registered playbook this way runs; also the way's id. */
  playbook: string;
  category: WayCategory;
  /** Hours a week the owner puts in: a model estimate. */
  hours: { min: number; max: number };
  /** What clients usually pay, in whole rupees: a model estimate. */
  pay: { minRupees: number; maxRupees: number };
  en: WayLanguage;


  /** The playbook's connectors the needs line names; each must work today (connectorWorks), never a planned one. */
  uses: readonly string[];
  /**
   * Ink v2 wave 5 (5A1): the roles the tile's team shows, by role id, at most four (the tile's team.roleIds); a code role
   * among them is never drawn as an AI. Absent: every agent of the playbook.
   */
  team?: readonly string[];
};

/**
 * A flagship tile's figures and lines onto its way (Ink v2 wave 5, 5A1): category, hours, pay, the English
 * lines and the team; the label, what the pay is per, the starter and what it needs stay the way's own.
 */
function fromTile(tile: StartTile, way: WayData): WayData {
  return {
    ...way, category: tile.category, hours: { min: tile.youDo.hoursMin, max: tile.youDo.hoursMax }, pay: { minRupees: tile.pay.minRupees, maxRupees: tile.pay.maxRupees },
    en: { ...way.en, line: tile.line, youDo: tile.youDo.line, teamLine: tile.team.line },
    team: [...tile.team.roleIds],
  };
}


/** The four categories, in the order the gallery's chips show them. */
export const WAY_CATEGORIES: readonly { readonly id: WayCategory; readonly en: string;  }[] = Object.freeze([
  Object.freeze({ id: 'content' as const, en: 'Content',  }),
  Object.freeze({ id: 'marketing' as const, en: 'Marketing',  }),
  Object.freeze({ id: 'money-and-tax' as const, en: 'Money and tax',  }),
  Object.freeze({ id: 'shops-and-firms' as const, en: 'Shops and firms',  }),
]);

/** The basis of every way's hours and price range. */
export const WAY_SOURCE = Object.freeze({
  en: 'Model estimate, written by an AI in October 2026 from general knowledge of freelance work in India. Not a survey, a quote or a promise: you set every price.',

});

/** What every way needs first: the owner's own AI, which the owner pays for (no credits). */
export const WAY_AI_NEED = Object.freeze({
  en: 'Your own AI, paid by you directly.',

});

/** The quick filter on the gallery: ways that need at most this many hours a week. */
export const UP_TO_HOURS = 5;
export const UP_TO_WORDS = Object.freeze({ en: `Up to ${UP_TO_HOURS} h a week`,  });

const PER = Object.freeze({
  video: { en: 'per video',  },
  clientMonth: { en: 'a client a month',  },
});

const YOUTUBE_WAY: WayData = {
  playbook: YOUTUBE_ID,
  category: 'content',
  hours: { min: 4, max: 8 },
  pay: { minRupees: 5000, maxRupees: 30000 },
  en: {
    label: 'YouTube channel',
    line: 'Hooks, edit lists, titles, descriptions and chapters for client videos, from footage the client owns or has licensed.',
    youDo: 'Talk to clients, cut each video from the edit list in your own editor, then you or the client publish.',
    teamLine: 'Read each brief, ask the client what is missing, write hooks, pick moments for the edit list, and draft titles and chapters.',
    per: PER.video.en,
    starter: 'A YouTube channel service: hooks, titles and chapters for client videos.',
    needs: "The client's transcript (SRT or VTT) and footage notes as files. ffmpeg on this computer is optional, for the check on a finished cut.",
  },


  uses: ['client-files'],
};

const CA_FIRM_WAY: WayData = {
  playbook: CA_FIRM_ID,
  category: 'money-and-tax',
  hours: { min: 6, max: 10 },
  pay: { minRupees: 5000, maxRupees: 20000 },
  en: {
    label: 'CA practice',
    line: 'Books, GST, TDS and income tax working papers for small businesses. Your CA of record signs anything regulated.',
    youDo: 'Meet clients, review every draft, and work with your CA.',
    teamLine: 'Read client files, match statements, pick the tax rules and write working papers. Code works out every figure.',
    per: PER.clientMonth.en,
    starter: 'A CA practice: books, GST and income tax working papers for small businesses.',
    needs: "The client's files (PDF, CSV or Excel) and your own mail app. Tally on this computer if you use it. A person files on the tax portals.",
  },


  uses: ['client-files', 'mail-app', 'tally'],
};

const SOCIAL_AGENCY_WAY: WayData = {
  playbook: SOCIAL_AGENCY_ID,
  category: 'marketing',
  hours: { min: 4, max: 6 },
  pay: { minRupees: 8000, maxRupees: 25000 },
  en: {
    label: 'Social media agency',
    line: 'Calendars, posts, replies and monthly reports for local shops, clinics and coaches.',
    youDo: 'Approve every draft and post, talk to clients, and post or hand off.',
    teamLine: "Voice sheets, calendars, captions, reply drafts, ad briefs, and report words from the client's own exports.",
    per: PER.clientMonth.en,
    starter: 'A social media agency: calendars, posts and replies for local shops.',
    needs: "The client's brand files and platform exports, and your own mail app. You post from your own accounts, or import the calendar file into your scheduler.",
  },


  uses: ['client-files', 'mail-app', 'calendar-export'],
};

/** Every way, in registry order. */
export const WAYS: readonly WayData[] = Object.freeze([
  fromTile(CA_FIRM_TILE, CA_FIRM_WAY), fromTile(YOUTUBE_TILE, YOUTUBE_WAY), fromTile(SOCIAL_AGENCY_TILE, SOCIAL_AGENCY_WAY),
].map(way => deepFreeze(way)));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const HIDDEN = /[\p{Cf}\u0000-\u001F\u007F-\u009F]/u;
const LIMITS: Readonly<Record<keyof WayLanguage, number>> = Object.freeze({ label: 40, line: 200, youDo: 140, teamLine: 180, per: 40, starter: 160, needs: 240 });
const fail = (message: string): never => { throw new Error(message); };

/**
 * Whether one of a playbook's connectors works today: some way of using it is built, not planned. ffmpeg counts as not
 * found, so a way never needs it. False for a connector or playbook Chausar does not know.
 */
export function connectorWorks(playbook: string, id: string): boolean {
  if (playbook === CA_FIRM_ID) return CA_CONNECTORS.find(item => item.id === id)?.modes.some(mode => mode.status === 'available') ?? false;
  if (playbook === YOUTUBE_ID) return youtubeConnectors({ ffmpeg: false }).find(item => item.id === id)?.modes.some(mode => mode.status === 'available') ?? false;
  if (playbook === SOCIAL_AGENCY_ID) {
    const label = SOCIAL_CONNECTORS.find(item => item.id === id)?.label;
    return typeof label === 'string' && !label.startsWith('planned');
  }
  return false;
}

/** One shown string: present, within its length, one line, no em dash or AI-tell word, no hidden character. */
function checkWords(id: string, field: string, value: unknown, max: number): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`The way ${id} needs its ${field}, at most ${max} characters.`);
  const words = value as string;
  if (HIDDEN.test(words) || /[\n\r\t]/.test(words) || houseStyleFindings(words).length > 0) fail(`The way ${id}'s ${field} breaks house style.`);
}

/**
 * Throws, naming the way and the rule, unless every way: names a registered playbook that delivers today, once; has one
 * of the four categories; has whole hours from 1 to 60 a week, the fewest first; has a rupee range above zero, the
 * lowest first; has every English word within its length and in house style; names only connections that work today;
 * and has starters that pick
 * its own playbook.
 */
export function validateWays(ways: readonly WayData[] = WAYS, registry: readonly PlaybookRegistration[] = PLAYBOOK_REGISTRY): void {
  const seen = new Set<string>();
  for (const way of ways) {
    const id = String(way?.playbook);
    if (!registry.some(entry => entry.id === way.playbook)) fail(`${id} is not a registered work plan, so it has no way to earn.`);
    if (seen.has(id)) fail(`The way ${id} is listed twice.`);
    seen.add(id);
    const delivery = flagshipDelivery(id) ?? fail(`The work plan ${id} does not deliver yet, so it has no way to earn.`);
    if (!WAY_CATEGORIES.some(category => category.id === way.category)) fail(`The way ${id} needs a category: content, marketing, money and tax, or shops and firms.`);
    const { min, max } = way.hours ?? { min: NaN, max: NaN };
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > 60) fail(`The way ${id} needs whole hours a week from 1 to 60, the fewest first.`);
    const { minRupees, maxRupees } = way.pay ?? { minRupees: NaN, maxRupees: NaN };
    if (!Number.isSafeInteger(minRupees) || !Number.isSafeInteger(maxRupees) || minRupees < 1 || minRupees > maxRupees) fail(`The way ${id} needs a pay range in whole rupees above zero, the lowest first.`);
    for (const [language, words] of [['en', way.en]] as const) {
      for (const field of Object.keys(LIMITS) as (keyof WayLanguage)[]) checkWords(id, `${language} ${field}`, words?.[field], LIMITS[field]);
      if (pickPlaybook(words.starter, registry)?.id !== id) fail(`The way ${id}'s ${language} starter must pick the ${id} work plan.`);
    }
    if (!Array.isArray(way.uses) || !way.uses.length) fail(`The way ${id} needs the connections it uses.`);
    for (const connector of way.uses) if (!connectorWorks(id, connector)) fail(`${connector} is not a connection that works today in the ${id} work plan.`);

  }
}
