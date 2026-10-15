/**
 * The page frame and small pieces both hosted-link screens share: the header, the design's
 * common state for a read, the stale line, who may change things, a day from an engine instant,
 * and the sentence for a change that was refused or is not built.
 */
import type { ReactNode } from 'react';
import { PageHeader } from '../../app/PageHeader';
import type { Language } from '../../app/presentation.ts';
import { useT } from '../../app/text';
import { date } from '../../format/index.ts';
import { Button } from '../../parts/Button';
import { Label } from '../../parts/Label';
import type { PlaceRenderProps } from '../../places/types.ts';
import { State } from '../../patterns/States';
import { screenState, type Read, type Sent } from './engine.ts';
import s from './hosted-link.module.css';

export type T = ReturnType<typeof useT>;

/** Owner or cofounder, and not a viewer seat: the `admin` permission these methods need. */
export function canChange(props: Pick<PlaceRenderProps, 'viewer' | 'member'>): boolean {
  return !props.viewer && (props.member.role === 'owner' || props.member.role === 'cofounder');
}

/** The day of an engine instant, from the shared format module. */
export function day(iso: string, language: Language): string { return date(iso.slice(0, 10), 'short', language); }

/** A refusal in this lane's words when it has them, else the code as the engine sent it. */
export function refusal(t: T, code: string, known: ReadonlySet<string>): string {
  return known.has(code) ? t(`HL.refusal.${code}`) : t('HL.refused', { code });
}
export const KNOWN_REFUSALS: ReadonlySet<string> = new Set([
  'DOCUMENT_ROUTE_REQUIRED', 'DOCUMENT_TOO_LARGE_TO_READ', 'DOCUMENT_READER_UNAVAILABLE', 'DOCUMENT_PREVIEW_UNAVAILABLE', 'DOCUMENT_NOT_FOUND',
  'DOCUMENT_MISSING', 'HOSTED_NOT_CONFIGURED', 'HOSTED_NOT_PAIRED', 'HOSTED_UNREACHABLE', 'HOSTED_REPLY_INVALID', 'OPEN_DESKTOP', 'INVALID_REPLY',
  'BILL_READ_EXPIRED', 'PREVIEW_CHANGED', 'TAINTED_REQUEST', 'MESSAGE_NOT_FOUND',
]);

/** What happened to the last change: sending, done (with its sentence), not built, or refused. */
export function SentLine<V>({ sent, done }: { sent: Sent<V>; done?: string | undefined }) {
  const t = useT();
  if (sent.kind === 'sending') return <p className={s.status} role="status">{t('HL.sending')}</p>;
  if (sent.kind === 'not-built') return <p className={s.status} role="status">{t('HL.stepNotBuilt')}</p>;
  if (sent.kind === 'refused') return <p className={s.refused} role="status">{refusal(t, sent.code, KNOWN_REFUSALS)}</p>;
  if (sent.kind === 'done' && done !== undefined) return <p className={s.status} role="status">{done}</p>;
  return null;
}

/**
 * The page: header, then the common state for the read, or the body. A failure this lane has
 * a sentence for (the relay is not set up, not paired) reads as that sentence with its code.
 */
export function Page<V>({ where, title, read, aside, top, emptyKey, isEmpty, children }: {
  where: string; title: string; read: Read<V>; aside?: ReactNode; top?: ReactNode; emptyKey: string;
  isEmpty: (value: V) => boolean; children: (value: V) => ReactNode;
}) {
  const t = useT();
  let body: ReactNode;
  if (read.kind === 'ready') {
    body = (
      <>
        {read.staleCode !== null && (
          <p className={s.warn} role="status"><Label kind="stale" /> {t('HL.stale')} <span className="fig">{t('HL.staleCode', { code: read.staleCode })}</span></p>
        )}
        {isEmpty(read.value) ? <State state={{ kind: 'empty' }} emptyKey={emptyKey} /> : children(read.value)}
      </>
    );
  } else if (read.kind === 'failed' && KNOWN_REFUSALS.has(read.code) && read.code !== 'INVALID_REPLY') {
    body = <State state={{ kind: 'failed', code: read.code, what: t(`HL.refusal.${read.code}`) }} />;
  } else {
    body = <State state={screenState(read)} />;
  }
  return (
    <section className={s.screen} aria-label={title}>
      <PageHeader where={where} title={title} aside={aside} />
      {top}
      {body}
    </section>
  );
}

/** The link to Tools, Phone, drawn by the reports-tools-trust lane: pairing, channels, texts. */
export function PhoneLink({ navigate }: Pick<PlaceRenderProps, 'navigate'>) {
  const t = useT();
  return <Button variant="link" onClick={() => navigate({ place: 'tools', sub: 'phone' })}>{t('HL.phoneLink')}</Button>;
}

export function Note({ children, status = false }: { children: ReactNode; status?: boolean }) {
  return <p className={s.note} role={status ? 'status' : undefined}>{children}</p>;
}
