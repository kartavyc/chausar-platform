/**
 * Small pieces every CA console screen shares: one engine read and one change with their
 * outcome (a reply is validated before it is kept, and dropped when the address is no longer
 * live), the page frame with the design's common states, refusals in plain words, and the
 * formatting of counts and dates exactly as the engine sent them.
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { PageHeader } from '../../../app/PageHeader';
import type { Address, Count, Language } from '../../../app/presentation.ts';
import { useT } from '../../../app/text';
import { count as groupDigits, date } from '../../../format/index.ts';
import type { PlaceRenderProps } from '../../../places/types.ts';
import { Button } from '../../../parts/Button';
import { State } from '../../../patterns/States';
import { KNOWN_CODES, DUE_WORDS } from './words.ts';
import s from './Firm.module.css';

export type P = PlaceRenderProps;
export type T = (key: string, values?: Record<string, string | number>) => string;

export type Loaded<V> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly value: V }
  | { readonly kind: 'not-built' }
  | { readonly kind: 'locked' }
  | { readonly kind: 'not-firm' }
  | { readonly kind: 'failed'; readonly code: string };

export const NOT_BUILT: ReadonlySet<string> = new Set(['UNKNOWN_METHOD', 'INVALID_REQUEST', 'METHOD_UNAVAILABLE']);
const LOCKED: ReadonlySet<string> = new Set(['VAULT_LOCKED', 'WORKSPACE_LOCKED', 'LOCKED', 'NO_WORKSPACE']);

export function errorCode(error: unknown): string {
  const code = error !== null && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
}

function settle<V>(error: unknown): Loaded<V> {
  const code = errorCode(error);
  if (NOT_BUILT.has(code)) return { kind: 'not-built' };
  if (LOCKED.has(code)) return { kind: 'locked' };
  if (code === 'CA_NOT_A_FIRM') return { kind: 'not-firm' };
  return { kind: 'failed', code };
}

/** Who may change things here. A viewer changes nothing; admin changes are the owner's and cofounder's. */
export function powers(p: P): { change: boolean; admin: boolean } {
  const role = p.member.role;
  return { change: !p.viewer, admin: !p.viewer && (role === 'owner' || role === 'cofounder') };
}

/** One engine read; `key` changes when the request should be asked again. */
export function useRead<V>(p: P, method: string, payload: Record<string, unknown>, validate: (reply: unknown) => V, key = ''): { state: Loaded<V>; reload: () => void } {
  const [state, setState] = useState<Loaded<V>>({ kind: 'loading' });
  const [round, setRound] = useState(0);
  const latest = useRef(0);
  const body = JSON.stringify(payload);
  const live = useRef(p.live);
  live.current = p.live;
  const at = useRef<Address>(p.address);
  at.current = p.address;
  useEffect(() => {
    const ticket = ++latest.current;
    const address = at.current;
    let alive = true;
    setState((prev) => (prev.kind === 'ready' ? prev : { kind: 'loading' }));
    p.rpc.request(method, JSON.parse(body) as Record<string, unknown>).then(
      (reply) => {
        if (!alive || ticket !== latest.current || !live.current(address)) return;
        try { setState({ kind: 'ready', value: validate(reply) }); } catch (error) { setState({ kind: 'failed', code: errorCode(error) }); }
      },
      (error: unknown) => { if (alive && ticket === latest.current && live.current(address)) setState(settle<V>(error)); },
    );
    return () => { alive = false; };
    // validate is a module-level function for every caller.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.rpc, method, body, key, round]);
  const reload = useCallback(() => setRound((r) => r + 1), []);
  return { state, reload };
}

export type Sent<V> = { readonly kind: 'idle' } | { readonly kind: 'sending' } | { readonly kind: 'done'; readonly value: V } | { readonly kind: 'refused'; readonly code: string };

/** One change: one press, one request, its validated outcome kept while the address is live. */
export function useSend<V>(p: P, validate: (reply: unknown) => V): { sent: Sent<V>; send: (method: string, payload: Record<string, unknown>) => Promise<V | null>; clear: () => void } {
  const [sent, setSent] = useState<Sent<V>>({ kind: 'idle' });
  const busy = useRef(false);
  const ref = useRef(p);
  ref.current = p;
  const send = useCallback(async (method: string, payload: Record<string, unknown>) => {
    if (busy.current) return null;
    busy.current = true;
    const address = ref.current.address;
    setSent({ kind: 'sending' });
    try {
      const reply = await ref.current.rpc.request(method, payload);
      if (!ref.current.live(address)) return null;
      const value = validate(reply);
      setSent({ kind: 'done', value });
      return value;
    } catch (error) {
      if (ref.current.live(address)) setSent({ kind: 'refused', code: errorCode(error) });
      return null;
    } finally { busy.current = false; }
  }, [validate]);
  const clear = useCallback(() => setSent({ kind: 'idle' }), []);
  return { sent, send, clear };
}

/** The design's common state for a read that is not ready. */
export function LoadedState({ loaded }: { loaded: Exclude<Loaded<unknown>, { kind: 'ready' }> }) {
  const t = useT();
  switch (loaded.kind) {
    case 'loading': return <State state={{ kind: 'loading' }} />;
    case 'not-built': return <State state={{ kind: 'not-built' }} />;
    case 'locked': return <State state={{ kind: 'locked' }} />;
    case 'not-firm': return (
      <div className={s.stack} data-not-firm="">
        <p className={s.text}>{t('CAX-notFirm')}</p>
        <p className={s.quiet}>{t('CAX-notFirm.how')}</p>
      </div>
    );
    case 'failed': return <State state={{ kind: 'failed', code: loaded.code }} />;
  }
}

export interface PageProps<V> {
  where: string;
  title: string;
  loaded: Loaded<V>;
  count?: Count | undefined;
  aside?: ReactNode;
  viewer?: boolean | undefined;
  children: (value: V) => ReactNode;
}

export function Page<V>({ where, title, loaded, count, aside, viewer, children }: PageProps<V>) {
  const t = useT();
  return (
    <section className={s.page} aria-label={title}>
      <PageHeader where={where} title={title} count={loaded.kind === 'ready' ? count : undefined} aside={loaded.kind === 'ready' ? aside : undefined} />
      {viewer === true && <p className={s.banner} role="note">{t('CAX-readOnly')}</p>}
      {loaded.kind === 'ready' ? children(loaded.value) : <LoadedState loaded={loaded} />}
    </section>
  );
}

/** A titled group inside a page. */
export function Group({ title, note, children }: { title: string; note?: string | undefined; children: ReactNode }) {
  return (
    <section className={s.group}>
      <h2 className={s.heading}>{title}</h2>
      {note !== undefined && <p className={s.quiet}>{note}</p>}
      {children}
    </section>
  );
}

/** A refusal in plain words for a code this lane knows; otherwise the general sentence and the code in small type. */
export function Refusal({ code }: { code: string }) {
  const t = useT();
  const known = NOT_BUILT.has(code) ? t('CAX-code.notBuilt') : KNOWN_CODES.has(code) ? t(`CAX-code.${code}`) : null;
  return (
    <p className={s.problem} role="status" data-code={code}>
      {known ?? t('CAX-code.other')} {known === null && <span className={s.mono}>{t('CAX-code', { code })}</span>}
    </p>
  );
}

/** What happened to a change, in words: sending, refused, or nothing yet. Success is the screen's own. */
export function Outcome({ sent }: { sent: Sent<unknown> }) {
  const t = useT();
  if (sent.kind === 'sending') return <p className={s.quiet} role="status">{t('CAX-sending')}</p>;
  if (sent.kind === 'refused') return <Refusal code={sent.code} />;
  return null;
}

// ---------- formatting: what the engine sent, never a calculation ----------

/** A count as digits, or "not known" in words; never 0 for null. */
export function nText(value: number | null, t: T): string {
  return value === null ? t('CAX-notKnown') : groupDigits(String(value));
}
export function countOf(value: number | null, t: T): Count {
  return value === null ? { exact: null, display: t('CAX-notKnown') } : { exact: String(value), display: groupDigits(String(value)) };
}
export function dayText(iso: string, language: Language): string {
  return date(iso.slice(0, 10), 'short', language);
}
export function monthText(month: string, language: Language): string {
  const instant = new Date(`${month}-01T00:00:00.000Z`);
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(instant);
}
const DAY_MS = 86_400_000;
/** When something was read: today, yesterday, so many days ago within a week, else the date. */
export function whenText(iso: string | null, language: Language, t: T, now: number = Date.now()): string {
  if (iso === null) return t('CAX-notKnown');
  const then = Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const today = Date.parse(`${new Date(now).toISOString().slice(0, 10)}T00:00:00.000Z`);
  const days = Math.round((today - then) / DAY_MS);
  if (days === 0) return t('CAX-when.today');
  if (days === 1) return t('CAX-when.yesterday');
  if (days > 1 && days < 7) return t('CAX-when.daysAgo', { days });
  return dayText(iso, language);
}
/** A due-date calendar code in words, for the common codes; otherwise the code itself. */
export function dueText(code: string, t: T): string {
  return DUE_WORDS.has(code) ? t(`CAX-due.${code}`) : code;
}
export function seatText(seat: { seat: 'ca' | 'accountant'; endsOn: string | null }, language: Language, t: T): string {
  const kind = t(`CAX-seat.${seat.seat}`);
  return seat.endsOn === null ? t('CAX-seat.noEnd', { seat: kind }) : t('CAX-seat.until', { seat: kind, date: dayText(seat.endsOn, language) });
}

// ---------- files ----------

/** Hand the person a file to save. Nothing is written anywhere by the app itself. */
export function saveFile(name: string, body: string, type: string): void {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([body], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function copyText(value: string): void {
  void navigator.clipboard?.writeText(value).catch(() => undefined);
}

/** A press that asks once more before it acts. */
export function AskTwice({ label, ask, confirm, onConfirm, disabled }: { label: string; ask: string; confirm: string; onConfirm: () => void; disabled?: boolean | undefined }) {
  const t = useT();
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button variant="link" danger disabled={disabled} onClick={() => setAsking(true)}>{label}</Button>;
  return (
    <span className={s.ask} role="group" aria-label={ask}>
      <span>{ask}</span>
      <Button variant="link" danger onClick={() => { setAsking(false); onConfirm(); }}>{confirm}</Button>
      <Button variant="link" onClick={() => setAsking(false)}>{t('CAX-cancel')}</Button>
    </span>
  );
}
