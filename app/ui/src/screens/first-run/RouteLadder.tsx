/**
 * FR-05 and TR-08: the order routes are tried in, and the models installed on this computer.
 * - `RouteLadder`: the routes from `models.list` in their order; each moves with its Move up and
 *   Move down buttons, or with Alt and an arrow key while the row has focus (the focus stays on
 *   the moved row and the new place is announced). Save order sends `models.setLadder`
 *   (core-gateway-auth); Check asks `models.probe` for the route's state. Either method absent:
 *   "not built yet" for that part, the list still reads.
 * - `LocalModels`: models-ext's `modelsx.localList`; picking one hands its name to the caller
 *   (the Ollama row's model field). Unreachable, empty and absent each have their own words.
 * Route labels and model names are data, drawn as text.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useT } from '../../app/text';
import { validateModelRoutes, type UiModelRoute } from '../../host/contracts.ts';
import { isLadderReply, isRouteProbe, readLocalModels, type LocalModelsReply, type ProbeState } from '../../bridge/r4-contracts.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Status } from './JourneyParts';
import type { ComputerPort } from './this-computer.ts';
import s from './Journey.module.css';

type Routes = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly routes: readonly UiModelRoute[] } | JourneyFailure;
type Probe = { readonly kind: 'state'; readonly state: ProbeState } | JourneyFailure | { readonly kind: 'checking' };

/** The list with one route moved by one place; the same list when it cannot move. */
export function moveRoute<T>(list: readonly T[], index: number, by: -1 | 1): readonly T[] {
  const to = index + by;
  if (index < 0 || index >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

export interface RouteLadderProps {
  readonly rpc: ComputerPort;
  /** Draw nothing while there are fewer than two routes (first run). */
  readonly quietWhenShort?: boolean | undefined;
  /** Read the routes again when this changes. */
  readonly version?: number | undefined;
}

export function RouteLadder({ rpc, quietWhenShort = false, version = 0 }: RouteLadderProps) {
  const t = useT();
  const [routes, setRoutes] = useState<Routes>({ kind: 'reading' });
  const [order, setOrder] = useState<readonly UiModelRoute[]>([]);
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved' | JourneyFailure>('idle');
  const [announce, setAnnounce] = useState('');
  const [probes, setProbes] = useState<Readonly<Record<string, Probe>>>({});
  const rows = useRef(new Map<string, HTMLLIElement>());
  const focusAfter = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void rpc.request('models.list', {}).then(reply => {
      if (!live) return;
      try { const list = validateModelRoutes(reply); setRoutes({ kind: 'ready', routes: list }); setOrder(list); }
      catch (error) { setRoutes(failureOf(error)); }
    }, (error: unknown) => { if (live) setRoutes(failureOf(error)); });
    return () => { live = false; };
  }, [rpc, version]);

  useEffect(() => {
    if (focusAfter.current === null) return;
    rows.current.get(focusAfter.current)?.focus();
    focusAfter.current = null;
  }, [order]);

  const move = useCallback((index: number, by: -1 | 1) => {
    const next = moveRoute(order, index, by);
    if (next === order) return;
    const route = order[index]!;
    focusAfter.current = route.id;
    setOrder(next); setSaved('idle');
    setAnnounce(t('FR-05.ladder.moved', { name: route.label, n: String(index + by + 1), total: String(next.length) }));
  }, [order, t]);

  const save = async () => {
    setSaved('saving');
    try {
      const reply = await rpc.request('models.setLadder', { routeIds: order.map(route => route.id) });
      if (!isLadderReply(reply) || reply.routeIds.join('\n') !== order.map(route => route.id).join('\n')) { setSaved({ kind: 'refused', code: 'INVALID_REPLY' }); return; }
      setSaved('saved');
    } catch (error) { setSaved(failureOf(error)); }
  };

  const check = async (routeId: string) => {
    setProbes(current => ({ ...current, [routeId]: { kind: 'checking' } }));
    let next: Probe;
    try {
      const reply = await rpc.request('models.probe', { routeId });
      next = isRouteProbe(reply) && reply.routeId === routeId ? { kind: 'state', state: reply.state } : { kind: 'refused', code: 'INVALID_REPLY' };
    } catch (error) { next = failureOf(error); }
    setProbes(current => ({ ...current, [routeId]: next }));
  };

  if (routes.kind === 'reading') return quietWhenShort ? null : <Status k="FR-05.health.reading" />;
  if (routes.kind !== 'ready') return quietWhenShort ? null : <FailureLine failure={routes} notBuilt="FR-05.health.notBuilt" refused="FR-05.ladder.readRefused" />;
  if (order.length < 2 && quietWhenShort) return null;

  const onKey = (event: KeyboardEvent<HTMLLIElement>, index: number) => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') || event.target !== event.currentTarget) return;
    event.preventDefault();
    move(index, event.key === 'ArrowUp' ? -1 : 1);
  };

  return (
    <section className={s.section} data-route-ladder="">
      <h2 className={s.sectionTitle}>{t('FR-05.ladder.title')}</h2>
      {order.length === 0 ? <p className={s.note}>{t('FR-05.ladder.empty')}</p> : (
        <>
          <p className={s.note}>{t('FR-05.ladder.lede')}</p>
          <ol className={s.rows} aria-label={t('FR-05.ladder.title')}>
            {order.map((route, index) => {
              const probe = probes[route.id];
              return (
                <li key={route.id} className={s.row} tabIndex={0} data-ladder-route={route.id}
                  ref={node => { if (node === null) rows.current.delete(route.id); else rows.current.set(route.id, node); }}
                  aria-label={`${route.label}, ${t('FR-05.ladder.position', { n: String(index + 1), total: String(order.length) })}`}
                  onKeyDown={event => onKey(event, index)}>
                  <div className={s.rowLine}>
                    <span className={s.rowName}>{route.label}</span>
                    <span className={s.rowState}>{t('FR-05.ladder.position', { n: String(index + 1), total: String(order.length) })}</span>
                  </div>
                  <Actions>
                    <Act variant="link" label="FR-05.ladder.up.btn" aria-label={`${t('FR-05.ladder.up.btn')}: ${route.label}`} disabled={index === 0} onClick={() => move(index, -1)} />
                    <Act variant="link" label="FR-05.ladder.down.btn" aria-label={`${t('FR-05.ladder.down.btn')}: ${route.label}`} disabled={index === order.length - 1} onClick={() => move(index, 1)} />
                    <Act variant="link" label="FR-05.ladder.check.btn" aria-label={`${t('FR-05.ladder.check.btn')}: ${route.label}`} disabled={probe?.kind === 'checking'} onClick={() => { void check(route.id); }} />
                  </Actions>
                  {probe !== undefined && probe.kind === 'state' && <p className={s.status} data-probe-state={probe.state}>{t(`FR-05.ladder.probe.${probe.state}`)}</p>}
                  {probe !== undefined && (probe.kind === 'not-built' || probe.kind === 'refused') && <FailureLine failure={probe} notBuilt="FR-05.ladder.probe.notBuilt" refused="FR-05.ladder.probe.refused" />}
                </li>
              );
            })}
          </ol>
          <p className="sr" role="status" aria-live="polite">{announce}</p>
          <Actions><Act label="FR-05.ladder.save.btn" disabled={saved === 'saving' || order.length < 2} onClick={() => { void save(); }} /></Actions>
          {saved === 'saved' && <Status k="FR-05.ladder.saved" />}
          {typeof saved === 'object' && <FailureLine failure={saved} notBuilt="FR-05.ladder.notBuilt" refused="FR-05.ladder.refused" />}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ models on this computer */

type Local = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly reply: LocalModelsReply } | JourneyFailure;

/** Sizes in gigabytes with one decimal, for reading only. */
export function gigabytes(bytes: number): string {
  return (Math.round(bytes / 1e8) / 10).toFixed(1);
}

export function LocalModels({ rpc, onPick, chosen }: { rpc: ComputerPort; onPick: (name: string) => void; chosen?: string | undefined }) {
  const t = useT();
  const [state, setState] = useState<Local>({ kind: 'reading' });
  useEffect(() => {
    let live = true;
    void rpc.request('modelsx.localList', {}).then(reply => {
      if (!live) return;
      const read = readLocalModels(reply);
      setState(read === null ? { kind: 'refused', code: 'INVALID_REPLY' } : { kind: 'ready', reply: read });
    }, (error: unknown) => { if (live) setState(failureOf(error)); });
    return () => { live = false; };
  }, [rpc]);
  return (
    <div className={s.section} data-local-models={state.kind === 'ready' ? (state.reply.reachable ? 'ready' : 'unreachable') : state.kind}>
      <h3 className={s.sectionTitle}>{t('FR-05.local.title')}</h3>
      {state.kind === 'reading' && <Status k="FR-05.local.reading" />}
      {state.kind === 'refused' && state.code === 'DEMO_PROVIDER_DISABLED' && <p className={s.note} role="status">{t('FR-05.local.demo')}</p>}
      {(state.kind === 'not-built' || (state.kind === 'refused' && state.code !== 'DEMO_PROVIDER_DISABLED')) && <FailureLine failure={state} notBuilt="FR-05.local.notBuilt" refused="FR-05.local.refused" />}
      {state.kind === 'ready' && !state.reply.reachable && <p className={s.note} role="status">{t('FR-05.local.unreachable')}</p>}
      {state.kind === 'ready' && state.reply.reachable && state.reply.models.length === 0 && <p className={s.note} role="status">{t('FR-05.local.none')}</p>}
      {state.kind === 'ready' && state.reply.reachable && state.reply.models.length > 0 && (
        <ul className={s.rows}>
          {state.reply.models.map(model => (
            <li key={model.name} className={s.row} data-local-model={model.name}>
              <div className={s.rowLine}>
                <span className={s.rowName}>{model.name}</span>
                {model.sizeBytes !== null && <span className={s.rowState}>{t('FR-05.local.size', { size: gigabytes(model.sizeBytes) })}</span>}
              </div>
              <Act variant="link" label="FR-05.local.pick.btn" aria-label={`${t('FR-05.local.pick.btn')}: ${model.name}`} onClick={() => onPick(model.name)} />
              {chosen === model.name && <p className={s.status} role="status">{t('FR-05.local.chosen', { name: model.name })}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
