/**
 * W6 6H3 (D40): the owner's AI asked the app to open a place (Chausar's ui_navigate tool). The engine keeps the latest
 * request as data (venture.layout.get's `go`); the window opens a request once, only when it is newer than the one it
 * found when it started, and says so with Go back while that page is open. Nothing is opened from an old request.
 */

import { useEffect, useRef, useState } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { useRoute } from '../../shell/navigation';
import { Button } from '../Button';
import { LAYOUT_EVENTS } from './useLayout';
import s from './Layout.module.css';

export function AiGo() {
  const t = useT();
  useRoute();
  const layout = useResource('venture.layout.get', { place: 'today' }, { refreshOn: LAYOUT_EVENTS });
  const seen = useRef<string | null | undefined>(undefined);
  const [opened, setOpened] = useState<{ href: string; title: string; from: string } | null>(null);
  const go = layout.data?.go;
  useEffect(() => {
    if (!layout.data) return;
    if (seen.current === undefined) { seen.current = go?.id ?? null; return; }
    if (!go || go.id === seen.current) return;
    seen.current = go.id;
    const from = window.location.hash || '#/today';
    window.location.hash = go.href;
    setOpened({ href: go.href, title: go.title, from });
  }, [layout.data, go]);
  if (!opened || window.location.hash !== opened.href) return null;
  return (
    <p className={s.notice} role="status" aria-label={t('layout.go.label')}>
      <span>{t('layout.go.line', { title: opened.title })}</span>
      <Button variant="quiet" size="sm" onClick={() => { const back = opened.from; setOpened(null); window.location.hash = back; }}>{t('layout.go.back')}</Button>
    </p>
  );
}
