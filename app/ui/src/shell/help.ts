// C7 task 24: in-app help, from Chausar's own guide (docs/beta-guide.md, indexed at build into guide-data.json by
// scripts/guide-index.mjs). Code only: the owner's words are matched against each section's title first, then its
// text, and the top three come back. Nothing here asks an AI; the guide's own words are what the sheet quotes.
import guide from '../../../../platform/runtime/venture/core/guide-data.json';

export type GuideSection = { anchor: string; title: string; level: number; part: string; text: string };
/** The guide's page in the public repository; a section's link is this plus its anchor. */
export const GUIDE_URL = 'https://github.com/kartavyc/chausar-platform/blob/main/docs/beta-guide.md';
export const GUIDE_SECTIONS: readonly GuideSection[] = (guide as { sections: GuideSection[] }).sections.filter((section) => section.anchor !== 'contents');

/** Words too common to tell sections apart. */
const COMMON = new Set(['a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'from', 'get', 'how', 'i', 'in', 'is', 'it', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'when', 'where', 'which', 'with', 'you', 'your']);
const wordsOf = (text: string): string[] => text.toLowerCase().replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').split(/[^a-z0-9]+/).filter((word) => word.length > 1 && !COMMON.has(word));
const stem = (word: string) => word.replace(/(?:ing|ed|es|s)$/, '');

/** The link to one section of the guide. */
export const guideLink = (anchor: string): string => `${GUIDE_URL}#${anchor}`;

/** The three sections whose title, then text, share the most words with the question; none when nothing matches. */
export function findGuide(question: string): GuideSection[] {
  const asked = [...new Set(wordsOf(question).map(stem))];
  if (!asked.length) return [];
  const titles = GUIDE_SECTIONS.map((section) => new Set(wordsOf(section.title).map(stem)));
  const rare = (word: string) => 1 / Math.max(1, titles.filter((title) => title.has(word)).length);
  const scored = GUIDE_SECTIONS.map((section, index) => {
    const title = titles[index]!, text = new Set(wordsOf(section.text).map(stem));
    const inTitle = asked.filter((word) => title.has(word)).reduce((sum, word) => sum + rare(word), 0), inText = asked.filter((word) => text.has(word)).length;
    return { section, index, score: inTitle * 10 + inText };
  }).filter((item) => item.score > 0);
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, 3).map((item) => item.section);
}
