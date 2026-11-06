import { useEffect, useState } from 'react';
import { useT } from '../text';
import s from './Skeleton.module.css';

export type SkeletonShape = 'today' | 'list' | 'tiles' | 'cards' | 'sheet' | 'settings' | 'chat';

/** A load this quick shows nothing at all, so a fast answer never flashes a shape. */
export const SKELETON_DELAY_MS = 150;

/** True once `loading` has lasted `delayMs`; false again as soon as it ends. */
export function useDelayed(loading: boolean, delayMs = SKELETON_DELAY_MS): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!loading) { setLate(false); return undefined; }
    const timer = setTimeout(() => setLate(true), delayMs);
    return () => clearTimeout(timer);
  }, [loading, delayMs]);
  return loading && late;
}

/** Whether what just landed followed a skeleton: it then fades in once (data-arrived), and never at any other time. */
export function useArrived(loading: boolean, delayMs = SKELETON_DELAY_MS): boolean {
  const late = useDelayed(loading, delayMs);
  const [arrived, setArrived] = useState(false);
  useEffect(() => {
    if (late) setArrived(true);
  }, [late]);
  return arrived && !loading;
}

const ROWS: Record<SkeletonShape, readonly string[]> = {
  today: ['title', 'card', 'card', 'card'],
  list: ['title', 'row', 'row', 'row', 'row', 'row'],
  tiles: ['title', 'tile', 'tile', 'tile', 'tile'],
  cards: ['title', 'card', 'card'],
  sheet: ['line', 'block', 'line', 'line'],
  settings: ['title', 'tile', 'row', 'row'],
  chat: ['line', 'block', 'line'],
};

/**
 * What a page will look like while its first answer is on its way (one-shot C3 task 12): grey blocks on a surface token
 * at the final layout's sizes, so nothing jumps when the content lands. No animation at all: no shimmer, no pulse.
 * Hidden from screen readers, with one quiet status for them. Show it through `useDelayed`, so a fast load shows nothing.
 */
export function Skeleton({ shape }: { shape: SkeletonShape }) {
  const t = useT();
  return (
    <div className={s.skeleton} data-skeleton={shape}>
      <p className="sr-only" role="status">{t('skeleton.status')}</p>
      <div aria-hidden="true" className={s.blocks} data-grid={shape === 'tiles' ? '' : undefined}>
        {ROWS[shape].map((kind, index) => <span key={`${kind}-${index}`} className={s[kind]} data-block={kind} />)}
      </div>
    </div>
  );
}

/** A place's first load: nothing for the first 150 ms, then its skeleton. */
export function LoadingPlace({ shape, loading = true }: { shape: SkeletonShape; loading?: boolean }) {
  const late = useDelayed(loading);
  return late ? <Skeleton shape={shape} /> : null;
}
