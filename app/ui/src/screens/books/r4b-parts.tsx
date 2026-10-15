/**
 * Round-4 pieces shared by the Books screens: the workspace time zone for dates (from
 * `ui.context.timeZone`, never the machine's), the frame's "About:" seam for the ask line
 * (`setAbout`, when the host supplies it), and the demo clock state from the frame
 * (`todayx.shell`). Each one that is missing draws its "not built yet" state or the earlier
 * behaviour; nothing is assumed about another lane being absent.
 */
import type { Language } from '../../app/presentation.ts';
import { day, dayTime } from '../work/kit/format.ts';
import { time } from '../../format/dates.ts';
import { useReply } from '../work/kit/reply.ts';
import { Note } from '../work/kit/Page';
import { shellClock, zoneReply } from './contract-r4b.ts';
import { fill, styles as s, valueOf, type BooksProps } from './shared.tsx';
import { useR4bWords } from './words-r4b.ts';

/** The workspace time zone when the engine serves one (`ui.context.timeZone`); null keeps dates in UTC as before. */
export function useZone(props: BooksProps): string | null {
  const { loaded } = useReply(props, 'ui.context', {}, zoneReply);
  const zone = valueOf(loaded)?.timeZone ?? null;
  if (zone === null) return null;
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return zone; } catch { return null; }
}

/** The calendar day of a date or an instant: an instant's day is taken in the workspace zone when there is one. */
export function dayIn(iso: string, language: Language, zone: string | null): string {
  if (zone === null || !/T/.test(iso) || !Number.isFinite(Date.parse(iso))) return day(iso, language);
  const local = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
  return /^\d{4}-\d{2}-\d{2}$/.test(local) ? day(local, language) : day(iso, language);
}

/** An instant as its day and clock time in the workspace zone; without a zone, as before (UTC). */
export function dayTimeIn(iso: string, language: Language, zone: string | null): string {
  if (zone === null || !/T/.test(iso) || !Number.isFinite(Date.parse(iso))) return dayTime(iso, language);
  return `${dayIn(iso, language, zone)} ${time(new Date(Date.parse(iso)).toISOString(), zone)}`;
}

/**
 * The frame's ask-line context (frame-today, round 4): `setAbout({ kind, id, name })` puts
 * "About: <name>" on the ask line, `setAbout(null)` clears it. Read from the props without
 * assuming it exists: absent, the record page says asking about it is not built yet.
 */
export type About = { kind: 'record'; id: string; name: string };
export function setAboutOf(props: BooksProps): ((about: About | null) => void) | null {
  const candidate = (props as unknown as { setAbout?: unknown }).setAbout;
  return typeof candidate === 'function' ? (about: About | null) => { (candidate as (about: About | null) => void)(about); } : null;
}

/** BK-15: the demo clock state, drawn with its label on a demo workspace only. A real workspace shows nothing. */
export function DemoClockState({ props }: { props: BooksProps }) {
  const k = useR4bWords(props.language);
  const { loaded } = useReply(props, 'todayx.shell', {}, shellClock);
  if (loaded.phase === 'refused') return loaded.state.kind === 'not-built' ? <Note>{k['clock.notBuilt']}</Note> : null;
  const value = valueOf(loaded);
  if (!value || !value.workspace.demo) return null;
  return value.clock.mode === 'demo'
    ? <p className={s.amber} role="status" data-demo-clock={value.clock.date}>{fill(k['clock.set'], { date: day(value.clock.date, props.language) })}</p>
    : <p className={s.amber} role="status" data-demo-clock="not-set">{k['clock.notSet']}</p>;
}
