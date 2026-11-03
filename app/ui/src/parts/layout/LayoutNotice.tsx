/**
 * W6 6H3 (D40): what the owner's AI changed on this page since the owner's own last change, in the engine's words, with
 * Undo (one request back to the layout from before the first of them) and Keep. Nothing shows until the AI has changed
 * something, so the page at rest has no more words than before.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import type { LayoutChange, LayoutView } from '../../engine/types';
import { Button } from '../Button';
import s from './Layout.module.css';

export function LayoutNotice({ layout, reload }: { layout: LayoutView | undefined; reload: () => void }) {
  const t = useT();
  const client = useEngine();
  const [busy, setBusy] = useState(false);
  const ai = layout?.ai;
  if (!layout || !ai) return null;
  const place = layout.place;
  async function send(change: LayoutChange) {
    setBusy(true);
    try {
      await client.request('venture.layout.change', { place, change });
    } finally {
      setBusy(false);
      reload();
    }
  }
  const more = ai.count - ai.lines.length;
  return (
    <p className={s.notice} role="status" aria-label={t('layout.change.label')}>
      <span className={s.lines}>
        {ai.lines.join(' ')}
        {more > 0 && <> {t('layout.ai.more', { count: more })}</>}
      </span>
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => void send(ai.undo.change)}>{t('layout.undo')}</Button>
      <Button variant="quiet" size="sm" disabled={busy} onClick={() => void send({ op: 'keep' })}>{t('layout.keep')}</Button>
    </p>
  );
}
