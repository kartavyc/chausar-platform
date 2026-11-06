// Types for scripts/guide-index.mjs (C7): the guide, indexed at build.
export type GuideSection = { anchor: string; title: string; level: 2 | 3; part: string; text: string };
export const GUIDE_FORMAT: string;
export function slugOf(title: string): string;
export function guideSections(markdown: string): GuideSection[];
export function guideData(markdown: string): string;
