// C7 task 25: Chausar's own guide (docs/beta-guide.md), as scripts/guide-index.mjs indexed it into guide-data.json.
// The chief's guide tool answers section ids and titles only; an answer that names a section gets that section's own
// words filled in by code, never the model's. Read once, on first use.
import { readFileSync } from 'node:fs';
import { FROM_SOURCE, runtimeUrl } from '../../engine-paths.ts';

export type GuideSection = { anchor: string; title: string; level: number; part: string; text: string };
/** The guide's page in the public repository; a section's link is this plus its anchor. */
export const GUIDE_URL = 'https://github.com/kartavyc/chausar-platform/blob/main/docs/beta-guide.md';

let sections: readonly GuideSection[] | null = null;
/** Every section of the guide but its contents list. */
export function guideSections(): readonly GuideSection[] {
  if (!sections) {
    const data = JSON.parse(readFileSync(runtimeUrl(FROM_SOURCE ? '../shared/venture/core/guide-data.json' : 'venture/core/guide-data.json'), 'utf8')) as { sections: GuideSection[] };
    sections = Object.freeze(data.sections.filter(section => section.anchor !== 'contents').map(section => Object.freeze({ ...section })));
  }
  return sections;
}

/** One section by its anchor, or null for an id the guide does not have. */
export function guideSection(anchor: string): GuideSection | null {
  return guideSections().find(section => section.anchor === anchor) ?? null;
}

