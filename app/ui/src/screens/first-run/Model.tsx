/**
 * FR-05 Connect an AI model. One row per route with its health from `models.list` and a
 * short note. A route is connected with the engine's `models.configure`; an API key is read
 * once from its field, the field is emptied, and the key is handed to the host's own adapter,
 * which sends it to the engine. This screen keeps no copy and never shows it again. Without
 * that adapter the API key row says it is not built yet.
 *
 * The Ollama row offers the models installed on this computer (`modelsx.localList`), and with
 * two or more routes the order they are tried in can be set (`models.setLadder`); both say
 * "not built yet" while their owners have not registered them.
 *
 * Skipping is a real choice: importing, the menu of calculations, receipts and backup work
 * without a model. The managed allowance is planned, not available yet.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { Field } from '../../parts/Field';
import { validateModelRoutes, type UiModelRoute } from '../../host/contracts.ts';
import { failureOf, type JourneyFailure, type JourneyPort, type RouteConfigInput, type RouteKind } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, StepHeader } from './JourneyParts';
import { LocalModels, RouteLadder } from './RouteLadder';
import s from './Journey.module.css';

type RouteRow = 'codex-cli' | 'claude-cli' | 'api' | 'ollama' | 'managed';
const ROWS: readonly RouteRow[] = ['codex-cli', 'claude-cli', 'api', 'ollama', 'managed'];
const KINDS: Readonly<Record<RouteRow, readonly string[]>> = {
  'codex-cli': ['codex-cli'], 'claude-cli': ['claude-cli'], api: ['openai-responses', 'openai-compatible'], ollama: ['ollama'], managed: ['managed'],
};
const NOTE: Readonly<Record<RouteRow, string>> = {
  'codex-cli': 'FR-05.note.cli', 'claude-cli': 'FR-05.note.cli', api: 'FR-05.note.api', ollama: 'FR-05.note.ollama', managed: 'FR-05.note.managed',
};

/** The host's adapter for a route that needs an API key: it sends the key to the engine once. */
export type SaveRouteKey = (config: RouteConfigInput, key: string) => Promise<unknown>;

export interface ModelProps {
  readonly rpc: JourneyPort;
  readonly saveRouteKey?: SaveRouteKey | undefined;
  readonly onDone: (outcome: 'skipped' | 'connected') => void;
}

type Routes = { readonly kind: 'reading' } | { readonly kind: 'ready'; readonly routes: readonly UiModelRoute[] } | { readonly kind: 'failed'; readonly failure: JourneyFailure };
type RowResult = { readonly row: RouteRow; readonly ok: 'connected' | 'key-saved' } | { readonly row: RouteRow; readonly failure: JourneyFailure };

export function Model({ rpc, saveRouteKey, onDone }: ModelProps) {
  const t = useT();
  const [routes, setRoutes] = useState<Routes>({ kind: 'reading' });
  const [open, setOpen] = useState<RouteRow | null>(null);
  const [modelName, setModelName] = useState('');
  const [endpoint, setEndpoint] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<RowResult | null>(null);
  const [missingModel, setMissingModel] = useState(false);
  const [connected, setConnected] = useState(false);
  const [skipped, setSkipped] = useState(false);
  const generation = useRef(0);
  const [readCount, setReadCount] = useState(0);

  const read = useCallback(async () => {
    const token = ++generation.current;
    try {
      const reply = await rpc.request('models.list', {});
      if (token === generation.current) { setRoutes({ kind: 'ready', routes: validateModelRoutes(reply) }); setReadCount(count => count + 1); }
    } catch (error) { if (token === generation.current) setRoutes({ kind: 'failed', failure: failureOf(error) }); }
  }, [rpc]);
  useEffect(() => { void read(); return () => { generation.current++; }; }, [read]);

  const health = (row: RouteRow): string => {
    if (row === 'managed') return t('FR-05.note.managed');
    if (routes.kind === 'reading') return t('FR-05.health.reading');
    if (routes.kind === 'failed') return routes.failure.kind === 'not-built' ? t('FR-05.health.notBuilt') : t('FR.journey.code', { code: routes.failure.code });
    const found = routes.routes.filter(route => KINDS[row].includes(route.kind));
    if (found.length === 0) return t('FR-05.health.none');
    return found.some(route => route.enabled) ? t('FR-05.health.set') : t('FR-05.health.off');
  };

  const connect = async (row: RouteRow, form: HTMLFormElement) => {
    const field = form.elements.namedItem('route-key');
    const typedKey = field instanceof HTMLInputElement ? field.value : '';
    if (field instanceof HTMLInputElement) field.value = '';
    const model = modelName.trim();
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(model)) { setMissingModel(true); return; }
    setMissingModel(false); setBusy(true); setResult(null);
    try {
      if (row === 'api') {
        if (saveRouteKey === undefined) { setResult({ row, failure: { kind: 'not-built' } }); return; }
        const address = endpoint.trim();
        const kind: RouteKind = address.length > 0 ? 'openai-compatible' : 'openai-responses';
        await saveRouteKey(address.length > 0 ? { kind, model, endpoint: address } : { kind, model }, typedKey);
        setResult({ row, ok: 'key-saved' });
      } else if (row !== 'managed') {
        await rpc.request('models.configure', { config: { kind: row, model } });
        setResult({ row, ok: 'connected' });
      }
      setConnected(true); setSkipped(false); setOpen(null); setModelName(''); setEndpoint('');
      void read();
    } catch (error) { setResult({ row, failure: failureOf(error) }); }
    finally { setBusy(false); }
  };

  const failureWords = (failure: JourneyFailure) => failure.kind === 'refused' && failure.code === 'DEMO_PROVIDER_DISABLED'
    ? <p className={s.problem} role="alert">{t('FR-05.refused.DEMO_PROVIDER_DISABLED')}</p>
    : <FailureLine failure={failure} notBuilt="FR-05.notBuilt" refused="FR-05.refused" />;

  return (
    <section data-first-run-screen="model">
      <StepHeader step={3} title="FR-05.title" lede="FR-05.lede" />
      <ul className={s.rows}>
        {ROWS.map(row => (
          <li key={row} className={s.row} data-route-row={row}>
            <div className={s.rowLine}>
              <span className={s.rowName}>{t(`FR-05.route.${row}`)}</span>
              <span className={s.rowState}>{health(row)}</span>
            </div>
            {row !== 'managed' && <p className={s.note}>{t(NOTE[row])}</p>}
            {row !== 'managed' && open !== row && (
              <Act variant="link" label="FR-05.connect.btn" aria-label={`${t('FR-05.connect.btn')}: ${t(`FR-05.route.${row}`)}`} disabled={busy}
                onClick={() => { setOpen(row); setResult(null); setMissingModel(false); }} />
            )}
            {open === row && (
              <form onSubmit={event => { event.preventDefault(); void connect(row, event.currentTarget); }}>
                <div className={s.fields}>
                  <Field label={t('FR-05.model')} value={modelName} onChange={event => setModelName(event.currentTarget.value)} autoComplete="off" spellCheck={false}
                    problem={missingModel ? t('FR-05.modelNeeded') : undefined} />
                  {row === 'api' && (
                    <>
                      <Field label={t('FR-05.key')} name="route-key" type="password" autoComplete="off" spellCheck={false} />
                      <Field label={t('FR-05.endpoint')} value={endpoint} onChange={event => setEndpoint(event.currentTarget.value)} autoComplete="off" spellCheck={false} inputMode="url" />
                    </>
                  )}
                </div>
                {row === 'ollama' && <LocalModels rpc={rpc} chosen={modelName} onPick={setModelName} />}
                <Actions>
                  <Act submit label="FR-05.save.btn" disabled={busy} />
                  <Act variant="link" label="FR.journey.back.btn" onClick={() => setOpen(null)} disabled={busy} />
                </Actions>
              </form>
            )}
            {result !== null && result.row === row && ('ok' in result
              ? <p className={s.status} role="status">{t(result.ok === 'key-saved' ? 'FR-05.keySaved' : 'FR-05.connected')}</p>
              : failureWords(result.failure))}
          </li>
        ))}
      </ul>
      <RouteLadder rpc={rpc} quietWhenShort version={readCount} />
      <Note k="FR-05.sendLevel" />
      {skipped && <Note k="FR-05.skipped" role="status" />}
      <Actions>
        {!connected && <Act label="FR-05.skip.btn" onClick={() => setSkipped(true)} />}
        <Act variant="filled" label="FR.journey.continue.btn" disabled={!(connected || skipped) || busy} onClick={() => onDone(connected ? 'connected' : 'skipped')} />
      </Actions>
    </section>
  );
}
