import { createContext, useCallback, useContext, useEffect, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { keyOf, readsFor, type ReadMethod, type ReadParams } from './reads';
import type { EngineClient, EngineError, EngineStatus, ResultOf, UiRunEvent } from './types';

const EngineContext = createContext<EngineClient | null>(null);

export function EngineProvider({ client, children }: { client: EngineClient; children: ReactNode }) {
  return <EngineContext.Provider value={client}>{children}</EngineContext.Provider>;
}

/**
 * The engine client for a place. One-shot B3: its request is wrapped (reads.ts), so a write refreshes every place on
 * screen whose reads accept a queue change.
 */
export function useEngine(): EngineClient {
  return readsFor(useRawEngine()).client;
}

/** The client as the provider was given it. */
function useRawEngine(): EngineClient {
  const client = useContext(EngineContext);
  if (!client) throw new Error('useEngine needs an EngineProvider.');
  return client;
}

export function useEngineStatus(): EngineStatus {
  const client = useEngine();
  return useSyncExternalStore(client.onStatus, client.status, client.status);
}

/** Call a listener for every run and queue event while the component is mounted. */
export function useEngineEvents(listener: (event: UiRunEvent) => void): void {
  const client = useEngine();
  const latest = useRef(listener);
  latest.current = listener;
  useEffect(() => client.subscribe((event) => latest.current(event)), [client]);
}

export interface Resource<T> { data: T | undefined; error: EngineError | undefined; loading: boolean; reload: () => void }

/**
 * Read one engine method and keep it fresh: it reloads when `refreshOn` says an event matters (by default, every
 * event). One-shot B3: the read goes through the client's one read store (reads.ts), so places that read the same
 * method and params share one request and one answer. Only read methods (READS) are accepted.
 */
export function useResource<M extends ReadMethod>(method: M, params: ReadParams<M>, options: { refreshOn?: (event: UiRunEvent) => boolean; skip?: boolean } = {}): Resource<ResultOf<M>> {
  const store = readsFor(useRawEngine()).store;
  const key = keyOf(method, params);
  const skip = options.skip ?? false;
  const refreshOn = useRef(options.refreshOn);
  refreshOn.current = options.refreshOn;
  const subscribe = useCallback(
    (changed: () => void) => (skip ? () => {} : store.subscribe(method, JSON.parse(key.slice(method.length + 1)) as unknown, changed, refreshOn)),
    [store, method, key, skip],
  );
  const read = useCallback(() => store.snapshot<ResultOf<M>>(key, skip), [store, key, skip]);
  const state = useSyncExternalStore(subscribe, read, read);
  // As before the store: while a new key loads for the first time, the place keeps the answer it showed last.
  const shown = useRef<ResultOf<M> | undefined>(undefined);
  const data = state.data === undefined && !skip ? shown.current : state.data;
  if (state.data !== undefined) shown.current = state.data;
  const reload = useCallback(() => store.reload(key), [store, key]);
  return { data, error: state.error, loading: state.loading, reload };
}
