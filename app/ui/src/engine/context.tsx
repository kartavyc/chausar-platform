import { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { EngineError, type EngineClient, type EngineStatus, type MethodName, type ParamsOf, type ResultOf, type VentureRunEvent } from './types';

const EngineContext = createContext<EngineClient | null>(null);

export function EngineProvider({ client, children }: { client: EngineClient; children: ReactNode }) {
  return <EngineContext.Provider value={client}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineClient {
  const client = useContext(EngineContext);
  if (!client) throw new Error('useEngine needs an EngineProvider.');
  return client;
}

export function useEngineStatus(): EngineStatus {
  const client = useEngine();
  return useSyncExternalStore(client.onStatus, client.status, client.status);
}

/** Call a listener for every run and queue event while the component is mounted. */
export function useEngineEvents(listener: (event: VentureRunEvent) => void): void {
  const client = useEngine();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => client.subscribe((event) => latest.current(event)), [client]);
}

export interface Resource<T> { data: T | undefined; error: EngineError | undefined; loading: boolean; reload: () => void }

/**
 * Read one engine method and keep it fresh: it reloads when `refreshOn` says an event matters (by default, every
 * event). A reply that arrives after a newer request started is dropped.
 */
export function useResource<M extends MethodName>(method: M, params: ParamsOf<M>, options: { refreshOn?: (event: VentureRunEvent) => boolean; skip?: boolean } = {}): Resource<ResultOf<M>> {
  const client = useEngine();
  const key = JSON.stringify(params);
  const [state, setState] = useState<{ data: ResultOf<M> | undefined; error: EngineError | undefined; loading: boolean }>({ data: undefined, error: undefined, loading: !options.skip });
  const generation = useRef(0);
  const refreshOn = useRef(options.refreshOn);
  refreshOn.current = options.refreshOn;

  const load = useCallback(() => {
    const mine = ++generation.current;
    setState((s) => ({ ...s, loading: true }));
    client.request(method, JSON.parse(key) as ParamsOf<M>).then(
      (data) => { if (mine === generation.current) setState({ data, error: undefined, loading: false }); },
      (error: unknown) => {
        if (mine !== generation.current) return;
        const e = error instanceof EngineError ? error : new EngineError('REQUEST_FAILED', error instanceof Error ? error.message : String(error));
        setState((s) => ({ data: s.data, error: e, loading: false }));
      },
    );
  }, [client, method, key]);

  useEffect(() => {
    if (options.skip) return;
    load();
  }, [load, options.skip]);

  useEffect(() => {
    if (options.skip) return;
    return client.subscribe((event) => { if (!refreshOn.current || refreshOn.current(event)) load(); });
  }, [client, load, options.skip]);

  return { ...state, reload: load };
}
