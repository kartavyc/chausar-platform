// Chausar flagship playbooks: the Start gallery's words for each registered playbook (Ink v2 wave 4, package 4J8;
// catalogue U3; spec 3 "Start"). One way to earn per playbook Chausar can run today, as data: its category, what the
// owner does and the hours a week, what its AI team does, what clients usually pay, and a starter sentence that picks
// the playbook. Who is on the team is never written here: core/ways.ts reads the playbook's own agents and their
// departments (playbooks/steps.ts, departments.ts); this file gives only their Hindi names.
//
// The hours and the price ranges were written by an AI (the one that built this file), not measured or surveyed, so
// every screen shows them as a model estimate with WAY_SOURCE as their basis, never as a receipt or a promise. Owners
// set every price themselves. The Hindi is machine-drafted and needs a native reviewer (HINDI_REVIEW); it keeps the
// app's one word per concept (क्लाइंट, ड्राफ़्ट, बिज़नेस, मंज़ूर, दाम).
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
import { YOUTUBE_TILE, YOUTUBE_TILE_HI } from './youtube/tile.ts';
import { CA_FIRM_TILE, CA_FIRM_TILE_HI } from './ca-firm/tile.ts';
import { SOCIAL_AGENCY_TILE, SOCIAL_AGENCY_TILE_HI } from './social/tile.ts';
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
  hi: WayLanguage;
  /** The Hindi name of each of the playbook's agents, by role id. */
  roles: Readonly<Record<string, string>>;
  /** The playbook's connectors the needs line names; each must work today (connectorWorks), never a planned one. */
  uses: readonly string[];
  /**
   * Ink v2 wave 5 (5A1): the roles the tile's team shows, by role id, at most four (the tile's team.roleIds); a code role
   * among them is never drawn as an AI. Absent: every agent of the playbook.
   */
  team?: readonly string[];
};

/**
 * A flagship tile's figures and lines onto its way (Ink v2 wave 5, 5A1): category, hours, pay, the English and Hindi
 * lines and the team; the label, what the pay is per, the starter and what it needs stay the way's own.
 */
function fromTile(tile: StartTile, hi: { line: string; youDo: string; teamLine: string }, way: WayData): WayData {
  return {
    ...way, category: tile.category, hours: { min: tile.youDo.hoursMin, max: tile.youDo.hoursMax }, pay: { minRupees: tile.pay.minRupees, maxRupees: tile.pay.maxRupees },
    en: { ...way.en, line: tile.line, youDo: tile.youDo.line, teamLine: tile.team.line }, hi: { ...way.hi, line: hi.line, youDo: hi.youDo, teamLine: hi.teamLine },
    team: [...tile.team.roleIds],
  };
}

/** Marks the Hindi in this file for a native reviewer. */
export const HINDI_REVIEW = 'machine-drafted, needs a native reviewer';

/** The four categories, in the order the gallery's chips show them. */
export const WAY_CATEGORIES: readonly { readonly id: WayCategory; readonly en: string; readonly hi: string }[] = Object.freeze([
  Object.freeze({ id: 'content' as const, en: 'Content', hi: 'कंटेंट' }),
  Object.freeze({ id: 'marketing' as const, en: 'Marketing', hi: 'मार्केटिंग' }),
  Object.freeze({ id: 'money-and-tax' as const, en: 'Money and tax', hi: 'पैसा और टैक्स' }),
  Object.freeze({ id: 'shops-and-firms' as const, en: 'Shops and firms', hi: 'दुकानें और फ़र्म' }),
]);

/** The basis of every way's hours and price range. */
export const WAY_SOURCE = Object.freeze({
  en: 'Model estimate, written by an AI in October 2026 from general knowledge of freelance work in India. Not a survey, a quote or a promise: you set every price.',
  hi: 'मॉडल का अनुमान, जिसे एक AI ने अक्टूबर 2026 में भारत में फ़्रीलांस काम की आम जानकारी से लिखा। यह कोई सर्वे, कोटेशन या वादा नहीं है: हर दाम आप तय करते हैं।',
});

/** What every way needs first: the owner's own AI, which the owner pays for (no credits). */
export const WAY_AI_NEED = Object.freeze({
  en: 'Your own AI, paid by you directly.',
  hi: 'आपका अपना AI, जिसका ख़र्च आप सीधे देते हैं।',
});

/** The quick filter on the gallery: ways that need at most this many hours a week. */
export const UP_TO_HOURS = 5;
export const UP_TO_WORDS = Object.freeze({ en: `Up to ${UP_TO_HOURS} h a week`, hi: `हफ़्ते में ${UP_TO_HOURS} घंटे तक` });

const PER = Object.freeze({
  video: { en: 'per video', hi: 'प्रति वीडियो' },
  clientMonth: { en: 'a client a month', hi: 'प्रति क्लाइंट, हर महीने' },
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
  hi: {
    label: 'YouTube चैनल',
    line: 'क्लाइंट के वीडियो के लिए हुक, एडिट लिस्ट, टाइटल, डिस्क्रिप्शन और चैप्टर, उसी फ़ुटेज से जो क्लाइंट का अपना है या लाइसेंस पर है।',
    youDo: 'क्लाइंट से बात करें, एडिट लिस्ट से अपने एडिटर में हर वीडियो एडिट करें, फिर आप या क्लाइंट पब्लिश करें।',
    teamLine: 'हर ब्रीफ़ पढ़ते हैं, क्लाइंट से कमी पूछते हैं, हुक लिखते हैं, एडिट लिस्ट के लिए पल चुनते हैं और टाइटल व चैप्टर का ड्राफ़्ट बनाते हैं।',
    per: PER.video.hi,
    starter: 'क्लाइंट के वीडियो के लिए YouTube चैनल सर्विस: हुक, टाइटल और चैप्टर।',
    needs: 'क्लाइंट की ट्रांसक्रिप्ट (SRT या VTT) और फ़ुटेज के नोट्स, फ़ाइलों में। इस कंप्यूटर पर ffmpeg हो तो कटे हुए वीडियो की जाँच भी होती है, पर ज़रूरी नहीं।',
  },
  roles: { 'intake-clerk': 'इनटेक क्लर्क', producer: 'प्रोड्यूसर', 'story-editor': 'स्टोरी एडिटर', cutter: 'वीडियो संपादक', packager: 'पैकेजर' },
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
  hi: {
    label: 'CA प्रैक्टिस',
    line: 'छोटे बिज़नेस के लिए बही-खाते, GST, TDS और इनकम टैक्स के वर्किंग पेपर्स। जो भी काम नियमों के तहत है, उस पर आपके CA दस्तख़त करते हैं।',
    youDo: 'क्लाइंट से मिलें, हर ड्राफ़्ट जाँचें और अपने CA के साथ काम करें।',
    teamLine: 'क्लाइंट की फ़ाइलें पढ़ते हैं, स्टेटमेंट मिलाते हैं, टैक्स के नियम चुनते हैं और वर्किंग पेपर्स लिखते हैं। हर आँकड़ा कोड निकालता है।',
    per: PER.clientMonth.hi,
    starter: 'CA practice: छोटे बिज़नेस के लिए बही-खाते, GST और इनकम टैक्स के वर्किंग पेपर्स।',
    needs: 'क्लाइंट की फ़ाइलें (PDF, CSV या Excel) और आपका अपना मेल ऐप। अगर आप Tally इस्तेमाल करते हैं, तो इस कंप्यूटर पर Tally। टैक्स पोर्टल पर फ़ाइलिंग कोई व्यक्ति करता है।',
  },
  roles: { intake: 'इनटेक क्लर्क', preparer: 'टैक्स प्रिपेयरर', reconciler: 'रिकंसाइलर', writer: 'वर्किंग पेपर्स राइटर' },
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
  hi: {
    label: 'सोशल मीडिया एजेंसी',
    line: 'लोकल दुकानों, क्लिनिक और कोच के लिए कैलेंडर, पोस्ट, जवाब और महीने की रिपोर्ट।',
    youDo: 'हर ड्राफ़्ट और पोस्ट मंज़ूर करें, क्लाइंट से बात करें, और ख़ुद पोस्ट करें या क्लाइंट को सौंपें।',
    teamLine: 'वॉइस शीट, कैलेंडर, कैप्शन, जवाबों के ड्राफ़्ट, ऐड ब्रीफ़, और क्लाइंट के अपने एक्सपोर्ट से रिपोर्ट के शब्द।',
    per: PER.clientMonth.hi,
    starter: 'Social media agency: लोकल दुकानों के लिए कैलेंडर, पोस्ट और जवाब।',
    needs: 'क्लाइंट की ब्रांड फ़ाइलें और प्लेटफ़ॉर्म के एक्सपोर्ट, और आपका अपना मेल ऐप। पोस्ट आप अपने अकाउंट से करते हैं, या कैलेंडर फ़ाइल अपने शेड्यूलर में डालते हैं।',
  },
  roles: { intake: 'इनटेक', strategist: 'स्ट्रैटेजिस्ट', writer: 'राइटर', creative: 'क्रिएटिव', checker: 'चेकर', analyst: 'एनालिस्ट' },
  uses: ['client-files', 'mail-app', 'calendar-export'],
};

/** Every way, in registry order. */
export const WAYS: readonly WayData[] = Object.freeze([
  fromTile(CA_FIRM_TILE, CA_FIRM_TILE_HI, CA_FIRM_WAY), fromTile(YOUTUBE_TILE, YOUTUBE_TILE_HI, YOUTUBE_WAY), fromTile(SOCIAL_AGENCY_TILE, SOCIAL_AGENCY_TILE_HI, SOCIAL_AGENCY_WAY),
].map(way => deepFreeze(way)));

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}

const DEVANAGARI = /\p{Script=Devanagari}/u;
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
function checkWords(id: string, field: string, value: unknown, max: number, hindi: boolean): void {
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail(`The way ${id} needs its ${field}, at most ${max} characters.`);
  const words = value as string;
  if (HIDDEN.test(words) || /[\n\r\t]/.test(words) || houseStyleFindings(words).length > 0) fail(`The way ${id}'s ${field} breaks house style.`);
  if (hindi && !DEVANAGARI.test(words)) fail(`The way ${id}'s Hindi ${field} has no Hindi in it.`);
}

/**
 * Throws, naming the way and the rule, unless every way: names a registered playbook that delivers today, once; has one
 * of the four categories; has whole hours from 1 to 60 a week, the fewest first; has a rupee range above zero, the
 * lowest first; has every word in English and Hindi within its length and in house style; gives every one of the
 * playbook's agents a Hindi name; names only connections that work today; and has starters (both languages) that pick
 * its own playbook.
 */
export function validateWays(ways: readonly WayData[] = WAYS, registry: readonly PlaybookRegistration[] = PLAYBOOK_REGISTRY): void {
  const seen = new Set<string>();
  for (const way of ways) {
    const id = String(way?.playbook);
    if (!registry.some(entry => entry.id === way.playbook)) fail(`${id} is not a registered playbook, so it has no way to earn.`);
    if (seen.has(id)) fail(`The way ${id} is listed twice.`);
    seen.add(id);
    const delivery = flagshipDelivery(id) ?? fail(`The playbook ${id} does not deliver yet, so it has no way to earn.`);
    if (!WAY_CATEGORIES.some(category => category.id === way.category)) fail(`The way ${id} needs a category: content, marketing, money and tax, or shops and firms.`);
    const { min, max } = way.hours ?? { min: NaN, max: NaN };
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 1 || min > max || max > 60) fail(`The way ${id} needs whole hours a week from 1 to 60, the fewest first.`);
    const { minRupees, maxRupees } = way.pay ?? { minRupees: NaN, maxRupees: NaN };
    if (!Number.isSafeInteger(minRupees) || !Number.isSafeInteger(maxRupees) || minRupees < 1 || minRupees > maxRupees) fail(`The way ${id} needs a pay range in whole rupees above zero, the lowest first.`);
    for (const [language, words] of [['en', way.en], ['hi', way.hi]] as const) {
      for (const field of Object.keys(LIMITS) as (keyof WayLanguage)[]) checkWords(id, `${language} ${field}`, words?.[field], LIMITS[field], language === 'hi');
      if (pickPlaybook(words.starter, registry)?.id !== id) fail(`The way ${id}'s ${language} starter must pick the ${id} playbook.`);
    }
    if (!Array.isArray(way.uses) || !way.uses.length) fail(`The way ${id} needs the connections it uses.`);
    for (const connector of way.uses) if (!connectorWorks(id, connector)) fail(`${connector} is not a connection that works today in the ${id} playbook.`);
    for (const role of delivery.roles.filter(item => item.kind === 'agent')) {
      const hindi = way.roles?.[role.id];
      if (typeof hindi !== 'string' || !DEVANAGARI.test(hindi) || HIDDEN.test(hindi)) fail(`The way ${id} needs a Hindi name for ${role.name}.`);
    }
  }
}
