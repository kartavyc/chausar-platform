import { Component, Suspense, lazy, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import { Button } from '../parts/Button';
import { Skeleton } from '../parts/Skeleton';
import { useT } from '../text';

/** A still page outline. No heading: the real page must arrive before a walk can settle. */
export function ChunkPlaceholder() {
  return <div data-chunk-loading="" aria-busy="true"><Skeleton shape="list" /></div>;
}
class LoadFailure extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

/** Keep one component identity per page; only an explicit retry creates a fresh React.lazy promise. */
export function chunkComponent<P extends object>(load: () => Promise<ComponentType<P>>): ComponentType<P> {
  return function Chunk(props: P) {
    const t = useT();
    const [attempt, setAttempt] = useState(0);
    const Loaded = useMemo(() => lazy(async () => ({ default: await load() })), [attempt]);
    const retry = <div role="status"><p>{t('shell.chunk.failed')}</p><Button onClick={() => setAttempt(value => value + 1)}>{t('status.retry')}</Button></div>;
    return <LoadFailure key={attempt} fallback={retry}><Suspense fallback={<ChunkPlaceholder />}><Loaded {...props} /></Suspense></LoadFailure>;
  };
}
