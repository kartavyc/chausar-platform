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
import type { RouteStateProbe } from '../bridge/todayx-contract.ts';
import { time } from '../format/dates.ts';
import { Button } from '../parts/Button';
import { useT } from './text';
import s from './ShellSheets.module.css';

export interface RouteStateRowProps {
  /** The route's name as the host's route list gives it. */
  label: string;
  probe: RouteStateProbe;
  /** The workspace time zone, for "resumes at". Without it the time is not shown. */
  timeZone: string | null;
  /** Starts the tool's own sign-in through an engine method. Absent: "not built yet". */
  onSignIn?: ((routeId: string) => void) | undefined;
}

export function RouteStateRow({ label, probe, timeZone, onSignIn }: RouteStateRowProps) {
  const t = useT();
  const sentence = probe.state === 'skipped-by-send' && probe.send !== undefined
    ? t('SH-09.skipped-by-send', { routeSend: t(`SH-09.send.${probe.send.route}`), yourSend: t(`SH-09.send.${probe.send.yours}`) })
    : t(`SH-09.${probe.state === 'skipped-by-send' ? 'skipped-by-send.plain' : probe.state}`, { route: label });
  return (
    <div className={s.section} role={probe.state === 'ready' ? undefined : 'status'} data-route-state={probe.state}>
      <p className={s.p}>{sentence}</p>
      {probe.state === 'signed-out' && (onSignIn !== undefined
        ? <div className={s.actions}><Button variant="filled" onClick={() => onSignIn(probe.routeId)}>{t('SH-09.sign-in')}</Button></div>
        : <p className={s.note} data-sign-in="not-built">{t('SH-09.sign-in.not-built', { route: label })}</p>)}
      {typeof probe.resumesAt === 'string' && timeZone !== null && <p className={s.note}>{t('SH-09.resumes', { time: time(probe.resumesAt, timeZone) })}</p>}
    </div>
  );
}

export interface RouteStatesProps {
  /** One checked probe per route, with its label; 'not-built' when no lane serves `models.probe`. */
  rows: readonly { readonly label: string; readonly probe: RouteStateProbe }[] | 'not-built';
  timeZone: string | null;
  onSignIn?: ((routeId: string) => void) | undefined;
}

/** Every route that cannot answer, with the rule that nothing retries or switches by itself. Ready routes say nothing. */
export function RouteStates({ rows, timeZone, onSignIn }: RouteStatesProps) {
  const t = useT();
  if (rows === 'not-built') return <p className={s.note} data-route-states="not-built">{t('SH-09.not-built')}</p>;
  const down = rows.filter(row => row.probe.state !== 'ready');
  if (down.length === 0) return null;
  return (
    <section className={s.stack} aria-label={t('SH-09.label')}>
      {down.map(row => <RouteStateRow key={row.probe.routeId} label={row.label} probe={row.probe} timeZone={timeZone} onSignIn={onSignIn} />)}
      <p className={s.note}>{t('SH-09.no-retry')}</p>
    </section>
  );
}
