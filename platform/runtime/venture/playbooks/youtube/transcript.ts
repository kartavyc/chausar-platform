// Chausar flagship playbook, YouTube channel: transcripts. An SRT or VTT file, or Whisper's JSON, read into cues in
// whole milliseconds with stable segment ids (seg-1, seg-2 ...). Agents pick moments only by these ids, never by
// times or words they write themselves.
//
// Ported from Jakeschincariol/youtube-agent-skill (MIT, Copyright (c) 2026 Jake Schincariol), skills/yt-edit/deadair.py
// (load, parse_ts), rewritten here with integer milliseconds.

export type Cue = { id: string; startMs: number; endMs: number; text: string };

const STAMP_LINE = /^\s*(\d[\d:.,]*)\s*-->\s*(\d[\d:.,]*)/;
const MAX_CUES = 20000;

/** "01:02:03,500", "02:03.500" or "3.5" in whole milliseconds; null when it is not a time. */
export function parseTimestamp(value: string): number | null {
  const text = value.trim().replace(',', '.');
  const match = /^(?:(\d+):)?(?:(\d+):)?(\d+)(?:\.(\d{1,9}))?$/.exec(text);
  if (!match) return null;
  const [, first, second, secs, fraction = ''] = match;
  const hours = second !== undefined ? Number(first) : 0;
  const minutes = second !== undefined ? Number(second) : first !== undefined ? Number(first) : 0;
  const millis = Number((fraction + '000').slice(0, 3));
  return ((hours * 60 + minutes) * 60 + Number(secs)) * 1000 + millis;
}

function fromJson(text: string): Cue[] | null {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return null; }
  const segments = Array.isArray(data) ? data : (data as { segments?: unknown })?.segments;
  if (!Array.isArray(segments)) return null;
  const cues: Cue[] = [];
  for (const segment of segments.slice(0, MAX_CUES)) {
    const item = segment as { start?: unknown; end?: unknown; text?: unknown };
    if (typeof item?.start !== 'number' || typeof item.end !== 'number' || !Number.isFinite(item.start) || !Number.isFinite(item.end)) continue;
    const words = typeof item.text === 'string' ? item.text.trim() : '';
    if (!words) continue;
    cues.push({ id: '', startMs: Math.round(item.start * 1000), endMs: Math.round(item.end * 1000), text: words });
  }
  return cues;
}

function fromCueFile(text: string): Cue[] {
  const cues: { startMs: number; endMs: number; lines: string[] }[] = [];
  let current: { startMs: number; endMs: number; lines: string[] } | null = null;
  for (const line of text.split(/\r?\n/)) {
    const stamp = STAMP_LINE.exec(line);
    if (stamp) {
      const startMs = parseTimestamp(stamp[1]);
      const endMs = parseTimestamp(stamp[2]);
      current = startMs === null || endMs === null ? null : { startMs, endMs, lines: [] };
      if (current) cues.push(current);
      if (cues.length >= MAX_CUES) break;
      continue;
    }
    const words = line.trim();
    if (current && words && !/^\d+$/.test(words)) current.lines.push(words);
  }
  return cues.filter(cue => cue.lines.length).map(cue => ({ id: '', startMs: cue.startMs, endMs: cue.endMs, text: cue.lines.join(' ') }));
}

/** Cues in file order, each with its segment id. A file with no readable cue gives an empty list. */
export function parseTranscript(text: string): Cue[] {
  const trimmed = text.trim();
  const cues = (trimmed.startsWith('{') || trimmed.startsWith('[') ? fromJson(trimmed) : null) ?? fromCueFile(text);
  return cues.filter(cue => cue.endMs >= cue.startMs).map((cue, index) => ({ ...cue, id: `seg-${index + 1}` }));
}

/** What was said between two times, within a margin, cut to a short line. */
export function saidNear(cues: readonly Cue[], atMs: number, marginMs = 4000, maxChars = 140): string | null {
  const near = cues.filter(cue => cue.startMs <= atMs + marginMs && cue.endMs >= atMs - marginMs).map(cue => cue.text);
  return near.length ? near.join(' ').slice(0, maxChars) : null;
}
