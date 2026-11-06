import { useState } from 'react';
import { useEngine, useResource } from '../engine/context';
import { useT } from '../text';
import { Button } from '../parts/Button';
import { Icon } from '../parts/Icon';
import { refusalWords } from '../parts/custody';
import s from './StorageNotice.module.css';

/**
 * One line under a place's header while the owner has paused the open business (W4 4F3; Pause all in the business
 * menu): the engine's own line from venture.get ("Paused by you. No new work starts until you unpause."). Nothing
 * while it is not paused, until venture.get answers, or when it fails. Shown on Today and Work.
 *
 * One-shot C4 task 5: Unpause sits at the end of the line, through the same venture.business.pause { paused: false } as
 * the business menu's; its done line stays once the paused line has gone (a seam for B4's result slot).
 */
export function PausedNote() {
  const t = useT();
  const client = useEngine();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);
  const paused = venture.data?.paused;

  async function unpause() {
    if (busy) return;
    setBusy(true);
    setSaid(null);
    try {
      await client.request('venture.business.pause', { paused: false });
      setSaid({ line: t('business.unpause.done'), problem: false });
      venture.reload();
    } catch (error) {
      setSaid({ line: t('business.runControls.failed', { message: refusalWords(error, t) }), problem: true });
    } finally {
      setBusy(false);
    }
  }

  const result = said && <p className={s.notice} role={said.problem ? 'alert' : 'status'}>{said.line}</p>;
  if (!paused) return result || null;
  return (
    <>
      <p className={s.notice} role="note" data-paused="">
        <Icon name="clock" size={16} className={s.icon} />
        <span>{paused.line}</span>
        <Button size="sm" disabled={busy} onClick={() => void unpause()}>{t('business.unpause')}</Button>
      </p>
      {result}
    </>
  );
}
