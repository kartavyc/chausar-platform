// Chausar flagship playbook, YouTube channel: the dated register of platform rules (design 7.8). Each rule says what
// the platform's own page said on the day it was read, links that page, and goes stale visibly after a set number of
// days so nobody keeps acting on a rule that may have changed. The deterministic checks read their limits from here.
// Each rule names the playbook steps and checks that use it (usedBy) and what it does not cover (limitations); a
// draft's rules-current result and venture.rules.list read both (playbooks/rules-current.ts).
//
// Idea taken, code written here: bridge-mind/bridgeclip (MIT), whose docs/automation-metadata.md writes platform limits
// down with the date they were checked.
import { validDate } from '../../../memory.ts';
import type { IsoDate } from '../../contracts.ts';
// playbook.ts loads nothing that reads these rules, so this import makes no cycle. Keep it so: playbook.ts must not
// read these rules while it loads (inside a function is fine).
import { YOUTUBE_STEPS } from './playbook.ts';

export type PlatformRuleId =
  | 'api-upload-privacy' | 'altered-synthetic-disclosure' | 'reused-content' | 'inauthentic-content'
  | 'chapters' | 'shorts-length' | 'metadata-limits' | 'paid-promotion';

export type PlatformRule = {
  id: PlatformRuleId;
  platform: 'youtube';
  title: string;
  /** What the source page said when it was read, in plain words. */
  rule: string;
  /** What it means for this playbook. */
  effect: string;
  /** Numbers the checks use, taken from the source page. */
  limits: Readonly<Record<string, number>>;
  sourceTitle: string;
  sourceUrl: string;
  /** The page's own "last updated" date when it shows one. */
  sourceUpdated: IsoDate | null;
  /** When the rule took effect, only when the source page says so. */
  effectiveFrom: IsoDate | null;
  checkedOn: IsoDate;
  recheckAfterDays: number;
  /** The rule this one replaced, when the page changed since the research was written. */
  previously?: { rule: string; recordedFrom: string };
  /** The YouTube playbook's step ids and check ids that use this rule, so a changed rule lists what it touches. */
  usedBy: readonly string[];
  /** What the rule does not cover, or how far its page was read, in plain words. At least one line. */
  limitations: readonly string[];
};

const CHECKED_ON = '2026-10-21';
const RECHECK_DAYS = 90;

const RULES: PlatformRule[] = [
  {
    id: 'api-upload-privacy', platform: 'youtube', title: 'Uploads through the YouTube API from unverified projects',
    usedBy: ['publish'],
    limitations: ['Read on the API reference page only; the API terms of service were not read again.', 'No YouTube API client ships in this build, so the rule decides nothing until one does.'],
    rule: "Google's page says videos uploaded from unverified API projects are not restricted to private viewing mode. Some uploads can still default to private because of the creator's account settings.",
    effect: 'Upload stays a handoff in this playbook because no YouTube API client ships in this build, and the owner publishes every video.',
    limits: {}, sourceTitle: 'Videos: insert, YouTube Data API', sourceUrl: 'https://developers.google.com/youtube/v3/docs/videos/insert',
    sourceUpdated: '2026-10-15', effectiveFrom: null, checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
    previously: {
      rule: 'Videos uploaded from unverified API projects created after 28 July 2020 were locked to private until the project passed an audit of its compliance with the terms of service.',
      recordedFrom: 'Chausar research cards of 21 October 2026, read from the podcast-shorts-factory repository',
    },
  },
  {
    id: 'altered-synthetic-disclosure', platform: 'youtube', title: 'Disclosing AI-generated or altered content',
    usedBy: ['ai-disclosure', 'publish'],
    limitations: ["The help page gives examples, not a full list; the playbook discloses any AI voice or presenter so edge cases don't decide.", 'You choose the setting in YouTube Studio; Chausar cannot see whether it is on.'],
    rule: 'Creators must disclose AI-generated or altered content that seems realistic, with the AI use setting in YouTube Studio at upload. Making a real person appear to say or do something they did not needs disclosure; cloning your own voice for voice overs does not.',
    effect: 'This playbook goes further: any AI voice or AI presenter is disclosed, realistic or not, with a line in the description and the AI use setting at upload.',
    limits: {}, sourceTitle: 'Disclosing use of GenAI content, YouTube Help', sourceUrl: 'https://support.google.com/youtube/answer/14328491',
    sourceUpdated: null, effectiveFrom: null, checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
  {
    id: 'reused-content', platform: 'youtube', title: 'Reused content and earning money',
    usedBy: ['rights-recorded', 'source-credit', 'intake'],
    limitations: ["Whether added commentary is significant is YouTube's judgement; the page gives no number or test.", 'Covers earning money only; copyright claims follow their own process.'],
    rule: "Channels that repurpose content already on YouTube or another online source, without adding significant original commentary, substantive modifications, or educational or entertainment value, can't earn money from it.",
    effect: 'Clips of other shows are offered only under a recorded licence or clip programme, credit the source, and still need added value for the client to earn from them.',
    limits: {}, sourceTitle: 'YouTube channel monetization policies, YouTube Help', sourceUrl: 'https://support.google.com/youtube/answer/1311392',
    sourceUpdated: null, effectiveFrom: null, checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
  {
    id: 'inauthentic-content', platform: 'youtube', title: 'Inauthentic content, formerly repetitious content',
    usedBy: ['publish'],
    limitations: ['The page names no threshold for mass-produced; the playbook keeps a person approving every video instead.'],
    rule: 'On 15 July 2025 YouTube renamed the repetitious content policy to inauthentic content and said it covers content that is repetitive or mass-produced, which has never been able to earn money.',
    effect: 'No offer here makes videos in bulk from a template, and nothing is posted on a schedule without the owner.',
    limits: {}, sourceTitle: 'YouTube channel monetization policies, YouTube Help', sourceUrl: 'https://support.google.com/youtube/answer/1311392',
    sourceUpdated: null, effectiveFrom: '2025-07-15', checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
  {
    id: 'chapters', platform: 'youtube', title: 'Video chapters added by hand',
    usedBy: ['chapters', 'find', 'package'],
    limitations: ['The check reads the chapters written in the description; automatic chapters YouTube may add are not read.'],
    rule: 'The first timestamp starts at 00:00, there are at least three timestamps in ascending order, and each chapter is at least 10 seconds long.',
    effect: 'The chapter check refuses a description whose chapters would not show.',
    limits: { firstAtSeconds: 0, minimumCount: 3, minimumSeconds: 10 }, sourceTitle: 'Video Chapters, YouTube Help', sourceUrl: 'https://support.google.com/youtube/answer/9884579',
    sourceUpdated: null, effectiveFrom: null, checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
  {
    id: 'shorts-length', platform: 'youtube', title: 'How long a Short can be',
    usedBy: ['finishing'],
    limitations: ['The finishing check reads the length and the frame only; music and Content ID claims are not part of it.', 'Applies to uploads on or after 15 October 2024.'],
    rule: 'A video with a square or vertical frame up to three minutes long is a Short, for uploads on or after 15 October 2024.',
    effect: 'The finishing check flags a Short that runs longer than three minutes or has a wide frame.',
    limits: { maxSeconds: 180 }, sourceTitle: 'Understand three-minute YouTube Shorts, YouTube Help', sourceUrl: 'https://support.google.com/youtube/answer/15424877',
    sourceUpdated: null, effectiveFrom: '2024-10-15', checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
  {
    id: 'metadata-limits', platform: 'youtube', title: 'Title, description and tag limits',
    usedBy: ['metadata-limits', 'title-thumbnail', 'package'],
    limitations: ['These are the limits the Data API enforces; YouTube Studio may differ.', 'A description is counted in bytes, and Hindi text takes about three bytes a character, so less of it fits.'],
    rule: 'A title holds at most 100 characters and a description at most 5000 bytes, neither with the characters < or >. Tags hold at most 500 characters together.',
    effect: 'The metadata check refuses a package that YouTube would refuse.',
    limits: { titleChars: 100, descriptionBytes: 5000, tagsChars: 500 }, sourceTitle: 'Videos, YouTube Data API', sourceUrl: 'https://developers.google.com/youtube/v3/docs/videos',
    sourceUpdated: '2026-10-15', effectiveFrom: null, checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
  {
    id: 'paid-promotion', platform: 'youtube', title: 'Paid product placement, endorsements and sponsorships',
    usedBy: ['paid-promotion', 'publish'],
    limitations: ["Which deals count as paid promotion also depends on local law, such as ASCI's rules in India; this rule covers only YouTube's setting.", 'You tick the setting in YouTube Studio; Chausar cannot see whether it is on.'],
    rule: 'A video with paid promotion is declared by selecting the paid promotion setting in the video details, which adds a disclosure label at the start of the video.',
    effect: 'When the order says the video has paid promotion, the package needs the paid promotion setting ticked before the owner publishes.',
    limits: {}, sourceTitle: 'Add branded content restrictions and disclosure labels, YouTube Help', sourceUrl: 'https://support.google.com/youtube/answer/154235',
    sourceUpdated: null, effectiveFrom: null, checkedOn: CHECKED_ON, recheckAfterDays: RECHECK_DAYS,
  },
];

export const PLATFORM_RULES: readonly PlatformRule[] = Object.freeze(RULES.map(rule => Object.freeze({ ...rule, limits: Object.freeze({ ...rule.limits }) })));

const SOURCE = /^https:\/\/(support\.google\.com|developers\.google\.com)\/[^\s]*$/;

/** The YouTube playbook's step ids and check ids: what a rule's usedBy may name. */
export function youtubeRuleTargets(): ReadonlySet<string> {
  return new Set<string>([...YOUTUBE_STEPS.map(step => step.id), ...YOUTUBE_STEPS.flatMap(step => step.youtubeChecks)]);
}

/**
 * Every rule has a title, its words, a source page on Google's own sites, a real checked date and a recheck window,
 * names the steps or checks that use it (each one the playbook has) and at least one line on what it does not cover.
 */
export function validatePlatformRules(rules: readonly PlatformRule[], targets: ReadonlySet<string> = youtubeRuleTargets()): void {
  const seen = new Set<string>();
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`The platform rule ${rule.id} is listed twice.`);
    seen.add(rule.id);
    if (!Array.isArray(rule.usedBy) || !rule.usedBy.length) throw new Error(`The platform rule ${rule.id} needs the steps or checks it is used by.`);
    const unknown = rule.usedBy.filter(id => !targets.has(id));
    if (unknown.length) throw new Error(`The platform rule ${rule.id} is used by ${unknown.join(', ')}, which the YouTube playbook has no step or check for.`);
    if (!Array.isArray(rule.limitations) || !rule.limitations.length || !rule.limitations.every(line => typeof line === 'string' && line.trim().length > 0)) {
      throw new Error(`The platform rule ${rule.id} needs its limitations: at least one line on what it does not cover.`);
    }
    if (!rule.title?.trim() || !rule.rule?.trim() || !rule.effect?.trim()) throw new Error(`The platform rule ${rule.id} needs a title, its words and what it means here.`);
    if (!SOURCE.test(rule.sourceUrl)) throw new Error(`The platform rule ${rule.id} needs its source page on the platform's own site.`);
    if (!validDate(rule.checkedOn)) throw new Error(`The platform rule ${rule.id} needs the date it was checked, like 2026-10-21.`);
    for (const date of [rule.sourceUpdated, rule.effectiveFrom]) if (date !== null && !validDate(date)) throw new Error(`The platform rule ${rule.id} has a date that is not a real date.`);
    if (!Number.isInteger(rule.recheckAfterDays) || rule.recheckAfterDays < 1 || rule.recheckAfterDays > 366) throw new Error(`The platform rule ${rule.id} needs a recheck window of one day to a year.`);
    for (const value of Object.values(rule.limits)) if (!Number.isInteger(value) || value < 0) throw new Error(`The platform rule ${rule.id} has a limit that is not a whole number.`);
  }
}

export function platformRule(id: PlatformRuleId): PlatformRule {
  const rule = PLATFORM_RULES.find(item => item.id === id);
  if (!rule) throw new Error(`There is no platform rule ${id}.`);
  return rule;
}

const dayNumber = (date: IsoDate) => Math.floor(Date.parse(`${date}T00:00:00.000Z`) / 86400000);

/** 'recheck' once more days than the rule's window have passed since it was checked. Whole days, no clock inside. */
export function ruleFreshness(rule: PlatformRule, today: IsoDate): 'current' | 'recheck' {
  if (!validDate(today)) throw new Error('Give today like 2026-10-21.');
  return dayNumber(today) - dayNumber(rule.checkedOn) > rule.recheckAfterDays ? 'recheck' : 'current';
}
