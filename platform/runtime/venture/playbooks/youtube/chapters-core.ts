// Existing chapter parser and checks, extracted unchanged for native and browser service checks.
// Limits are the dated official chapters row in platform-rules.ts.
export const CHAPTER_LIMITS=Object.freeze({firstAtSeconds:0,minimumCount:3,minimumSeconds:10});
export type Chapter = { atMs: number; label: string; line: string };
const CHAPTER_LINE = /^\s*(?:(\d{1,2}):)?(\d{1,2}):(\d{2})\s*(?:[-|:]\s*)?(.+?)\s*$/;

/** Every description line that starts with a timestamp, in the order written. */
export function parseChapters(description: string): Chapter[] {
  const chapters: Chapter[] = [];
  for (const line of description.split(/\r?\n/)) {
    const match = CHAPTER_LINE.exec(line);
    if (!match) continue;
    const [, hours, minutes, seconds, label] = match;
    if (Number(seconds) > 59 || (hours !== undefined && Number(minutes) > 59)) continue;
    chapters.push({ atMs: ((Number(hours ?? 0) * 60 + Number(minutes)) * 60 + Number(seconds)) * 1000, label:label!, line: line.trim() });
  }
  return chapters;
}

export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor(total / 60) % 60, s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

/** The platform's rules for chapters: the first at 0:00, at least three, in order, each at least ten seconds. */
export function chapterProblems(chapters: readonly Chapter[], durationMs: number | null): string[] {
  const rule = CHAPTER_LIMITS;
  const minMs = rule.minimumSeconds * 1000;
  const problems: string[] = [];
  if (!chapters.length) return ['The description has no chapters.'];
  if (chapters[0]!.atMs !== rule.firstAtSeconds * 1000) problems.push(`The first chapter must start at 0:00, not ${clock(chapters[0]!.atMs)}.`);
  if (chapters.length < rule.minimumCount) problems.push(`YouTube needs at least three chapters; there are ${chapters.length}.`);
  for (let index = 1; index < chapters.length; index += 1) {
    const gap = chapters[index]!.atMs - chapters[index - 1]!.atMs;
    if (gap <= 0) { problems.push(`The chapter at ${clock(chapters[index]!.atMs)} is out of order.`); break; }
    if (gap < minMs) { problems.push(`The chapter at ${clock(chapters[index - 1]!.atMs)} is shorter than ten seconds.`); break; }
  }
  const last = chapters.at(-1)!;
  if (durationMs !== null && durationMs - last.atMs < minMs && !problems.some(line => /order/.test(line))) problems.push(`The last chapter, at ${clock(last.atMs)}, is shorter than ten seconds.`);
  return problems;
}
