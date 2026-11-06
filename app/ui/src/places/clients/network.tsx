/**
 * Small pieces the Network tab and the person sheet share (Ink v2 wave 4, package 4D4): a person's role line, a warm
 * path drawn as a PathLine from the engine's path view, quoted file words marked as quoted, the engine's refusals that
 * the UI words itself, the event that reloads the network's lists, the signal that someone was forgotten, and the
 * outlined Open in LinkedIn button.
 */

import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { useT, type T } from '../../text';
import { PathLine, type LinkStrength, type PathPerson } from '../../parts/PathLine';
import type { StrengthLevel } from '../../parts/StrengthDots';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import b from '../../parts/Button.module.css';
import { EngineError, type EngineClient, type PersonSummary, type TieBand, type VentureRunEvent, type WarmPathView } from '../../engine/types';
import { onDesktop, openExternal, openProblem, safeUrl } from '../connections/external';
import s from './Network.module.css';

/**
 * "Someone was forgotten", per engine client (memory only), so the results drop them at once. The engine sends no
 * event for Forget; the lists and sources read again on clientsChanged.
 */
const forgotten = new WeakMap<EngineClient, Set<(id: string) => void>>();

export function personForgotten(client: EngineClient, id: string): void {
  for (const listener of [...(forgotten.get(client) ?? [])]) listener(id);
}

export function usePersonForgotten(client: EngineClient, listener: (id: string) => void): void {
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => {
    const set = forgotten.get(client) ?? new Set<(id: string) => void>();
    forgotten.set(client, set);
    const call = (id: string) => latest.current(id);
    set.add(call);
    return () => { set.delete(call); };
  }, [client]);
}

/**
 * Open in LinkedIn, D's outlined button with its icon: the profile address the owner's own file holds. On the desktop
 * the preload opens it in the system browser; on the web it is a new-tab link drawn as the outlined button.
 */
export function LinkedInButton({ href }: { href: string }) {
  const t = useT();
  const [problem, setProblem] = useState<string | null>(null);
  const url = safeUrl(href);
  if (!url) return null;
  const content = <><Icon name="contact" size={16} />{t('clients.person.linkedin')}</>;
  if (onDesktop()) {
    return (
      <>
        <button type="button" className={cx(b.button, s.linkButton)} data-variant="secondary" data-size="md" onClick={() => { setProblem(null); openExternal(url).catch((error: unknown) => setProblem(openProblem(error, t))); }}>{content}</button>
        {problem && <span className={s.problem} role="status">{problem}</span>}
      </>
    );
  }
  return <a className={cx(b.button, s.linkButton)} data-variant="secondary" data-size="md" href={url} target="_blank" rel="noopener noreferrer">{content}</a>;
}

/** The network's lists reload on a queue change and on a pipeline change (a card added or gone). */
export const networkRefresh = (event: VentureRunEvent) => event.type === 'queue.changed' || event.type === 'pipeline.changed';

/** "Founder at Kettle Audio", or whichever of the two the files gave; null when neither. */
export function roleLine(t: T, person: Pick<PersonSummary, 'title' | 'company'>): string | null {
  if (person.title && person.company) return t('clients.network.role', { title: person.title, company: person.company });
  return person.title ?? person.company ?? null;
}

/** The five dots as the engine counted them (0 before any tie is worked out). */
export const dotsOf = (person: Pick<PersonSummary, 'dots'>): StrengthLevel => Math.max(0, Math.min(5, person.dots)) as StrengthLevel;

/** A band as PathLine's two strengths: the engine's band, never a guess. Cold claims no strength. */
function strengthOf(band: TieBand): LinkStrength | undefined {
  if (band === 'close' || band === 'know-well') return 'strong';
  if (band === 'know' || band === 'met-once') return 'fair';
  return undefined;
}

/**
 * One warm path: the PathLine (you, the connector when there is one, the person) and the engine's own line under it.
 * A path the engine marks unconfirmed draws its last step dashed and says "possible path, not confirmed".
 */
export function WarmPath({ path, name, layout = 'named' }: { path: WarmPathView; name: string; layout?: 'card' | 'named' }) {
  const people: PathPerson[] = path.via
    ? [{ name: path.via.name, confirmed: true }, { name, confirmed: path.confirmed }]
    : [{ name, confirmed: path.confirmed, strength: path.confirmed ? strengthOf(path.strength) : undefined }];
  // A direct tie the engine finds cold is no path to draw ("You know them directly" would claim more): its line says so.
  const drawn = !(path.kind === 'direct' && path.strength === 'cold');
  return (
    <div className={s.path} data-path={path.kind} data-confirmed={String(path.confirmed)}>
      {drawn && <PathLine people={people} layout={layout} strength={path.confirmed && path.via ? strengthOf(path.strength) : undefined} />}
      <p className={s.pathLine}>{path.line}</p>
    </div>
  );
}

/**
 * Engine words that quote the owner's own files in double quotes ("Why: Dev's role reads "Founder" (...)"): the quoted
 * parts are the file's words, so each is marked `data-content`; the rest stays the engine's words as they came.
 */
export function quoted(text: string): ReactNode {
  const parts = text.split('"');
  if (parts.length < 3) return text;
  return parts.map((part, index) => {
    if (index % 2 === 0) return <Fragment key={index}>{part}</Fragment>;
    // An odd part without its closing quote (the last part of an odd split) is plain text.
    if (index === parts.length - 1) return <Fragment key={index}>{`"${part}`}</Fragment>;
    return <span key={index} className={s.quote} data-content="">{`"${part}"`}</span>;
  });
}

/** The engine's message, for a refusal the UI does not word itself. */
export const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The engine's error code, or ''. */
export const codeOf = (error: unknown): string => (error instanceof EngineError ? error.code : '');
