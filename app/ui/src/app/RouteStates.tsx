/**
 * SH-09 "Sign in again, and a route that is down": one row where the answer would be, per route
 * that cannot answer, from a checked `models.probe` reply. The ask lane places `RouteStateRow`
 * where its answer would draw; the host draws `RouteStates` on Ask, New under the route picker.
 *
 * Rules: never a silent retry and never an automatic switch. "Sign in again" starts the tool's own
 * sign-in only through `onSignIn`, which a host supplies only when an engine method for it exists;
 * without it the row says signing in from here is not built yet. A route skipped by the send
 * setting says why. A job waiting on the route shows when it resumes.
 */
import type { RouteProbe, RouteProbeReply } from '../bridge/todayx-contract.ts';
import { time } from '../format/dates.ts';
import { Button } from '../parts/Button';
import { State } from '../patterns/States';
import { useT } from './text';
import s from './ShellSheets.module.css';

export interface RouteStateRowProps {
  probe: RouteProbe;
  /** The workspace time zone, for "resumes at". Without it the time is not shown. */
  timeZone: string | null;
  /** Starts the tool's own sign-in through an engine method. Absent: "not built yet". */
  onSignIn?: ((routeId: string) => void) | undefined;
}

export function RouteStateRow({ probe, timeZone, onSignIn }: RouteStateRowProps) {
  const t = useT();
  const route = probe.label;
  const sentence = probe.state === 'skipped-send' && probe.send !== null
    ? t('SH-09.skipped-send', { routeSend: t(`SH-09.send.${probe.send.route}`), yourSend: t(`SH-09.send.${probe.send.yours}`) })
    : t(`SH-09.${probe.state}`, { route });
  return (
    <div className={s.section} role={probe.state === 'ready' ? undefined : 'status'} data-route-state={probe.state}>
      <p className={s.p}>{sentence}</p>
      {probe.state === 'signed-out' && (onSignIn !== undefined
        ? <div className={s.actions}><Button variant="filled" onClick={() => onSignIn(probe.routeId)}>{t('SH-09.sign-in')}</Button></div>
        : <p className={s.note} data-sign-in="not-built">{t('SH-09.sign-in.not-built', { route })}</p>)}
      {probe.resumesAt !== null && timeZone !== null && <p className={s.note}>{t('SH-09.resumes', { time: time(probe.resumesAt, timeZone) })}</p>}
    </div>
  );
}

export interface RouteStatesProps {
  /** The checked reply; null while read; 'not-built' when no lane serves `models.probe`. */
  reply: RouteProbeReply | null | 'not-built';
  timeZone: string | null;
  onSignIn?: ((routeId: string) => void) | undefined;
  /** Only this route (where one answer would be); otherwise every route that cannot answer. */
  routeId?: string | undefined;
}

export function RouteStates({ reply, timeZone, onSignIn, routeId }: RouteStatesProps) {
  const t = useT();
  if (reply === 'not-built') return <p className={s.note} data-route-states="not-built">{t('SH-09.not-built')}</p>;
  if (reply === null) return <State state={{ kind: 'loading' }} />;
  const rows = reply.routes.filter(probe => (routeId === undefined ? probe.state !== 'ready' : probe.routeId === routeId));
  if (rows.length === 0) return null;
  return (
    <section className={s.stack} aria-label={t('SH-09.label')}>
      {rows.map(probe => <RouteStateRow key={probe.routeId} probe={probe} timeZone={timeZone} onSignIn={onSignIn} />)}
      <p className={s.note}>{t('SH-09.no-retry')}</p>
    </section>
  );
}
