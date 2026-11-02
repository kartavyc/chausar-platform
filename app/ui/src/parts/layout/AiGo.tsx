/**
 * W6 6H3 (D40): the owner's AI offers a place (Chausar's ui_navigate tool). The founder decided on 2 November 2026 that
 * the AI only offers a page link and never opens a page by itself. The engine keeps the latest offer as data
 * (venture.layout.get's `go`); the window shows an offer only when it is newer than the one it found when it started,
 * with Open <place> and Not now. Nothing navigates until the owner presses Open. An old offer is never shown again.
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
  const [offer, setOffer] = useState<{ href: string; title: string } | null>(null);
  const go = layout.data?.go;
  useEffect(() => {
    if (!layout.data) return;
    if (seen.current === undefined) { seen.current = go?.id ?? null; return; }
    if (!go || go.id === seen.current) return;
    seen.current = go.id;
    setOffer({ href: go.href, title: go.title });
  }, [layout.data, go]);
  // Already on that page: there is nothing to open, so the offer stays out of the way.
  if (!offer || window.location.hash === offer.href) return null;
  return (
    <p className={s.notice} role="status" aria-label={t('layout.go.label')}>
      <span>{t('layout.go.line', { title: offer.title })}</span>
      <Button variant="quiet" size="sm" onClick={() => { const href = offer.href; setOffer(null); window.location.hash = href; }}>{t('layout.go.open', { title: offer.title })}</Button>
      <Button variant="quiet" size="sm" onClick={() => setOffer(null)}>{t('layout.go.dismiss')}</Button>
    </p>
  );
}
