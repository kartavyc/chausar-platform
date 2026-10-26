import { useEffect, useRef, useState } from 'react';
import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { refusalWords } from '../parts/custody';
import { Button } from '../parts/Button';
import { stoppable } from '../places/work/StopDialog';
import menu from './BusinessMenu.module.css';
import { useOpenBusiness } from './openBusiness';
import s from './RunControlsMenu.module.css';

/**
 * The business menu's run controls (W4 4F3; spec 5.6, catalogue O4): Pause all, Stop all and Away. Pause all stops new
 * work from starting until the owner unpauses; Stop all also stops each run that is going (the engine's Stop, which
 * lets the step in progress finish and keeps every finished step). Each asks a second time inside the menu, Not now
 * first in focus; Stop all's ask counts the runs it would stop (going or waiting on the owner, not already stopping).
 * Whether the business is paused comes from venture.get (Pause all or Unpause, after a reload too), and its line shows
 * while it is; what was done is said in the screen's words with the engine's own count of runs stopped, and the focus
 * goes back to the menu item. Away is the business page (#/business/away). `onLeave` closes the menu on the Away link.
 */
export function RunControlsMenu({ onLeave }: { onLeave: () => void }) {
  const t = useT();
  const client = useEngine();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [ask, setAsk] = useState<'pause' | 'stop' | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ line: string; problem: boolean } | null>(null);
  const runs = useResource('venture.runs.list', { state: 'all' });
  const notNow = useRef<HTMLButtonElement>(null);
  const pauseItem = useRef<HTMLButtonElement>(null);
  const stopItem = useRef<HTMLButtonElement>(null);
  const paused = venture.data?.paused;
  // W4 4J19 review: a run's businessId is the open workspace, never venture.get's venture_ id. venture.runs.list lists
  // the open business's runs; when the engine names the open business through its rows, only those runs count.
  const { businessId } = useOpenBusiness();
  const going = (runs.data?.runs ?? []).filter((run) => (businessId === undefined || run.businessId === businessId) && stoppable(run)).length;

  useEffect(() => { if (ask) notNow.current?.focus(); }, [ask]);

  async function pause(next: boolean, stopRunning = false) {
    if (busy) return;
    // The focus goes back to the item that asked before the ask closes, so it never leaves the menu.
    (stopRunning ? stopItem : pauseItem).current?.focus();
    setBusy(true);
    setSaid(null);
    try {
      const result = await client.request('venture.business.pause', stopRunning ? { paused: next, stopRunning: true } : { paused: next });
      // The engine's own count of the runs Stop all stopped, in the screen's words (English and Hindi).
      const line = !result.paused ? t('business.unpause.done') : stopRunning ? t('business.stopAll.done', { count: result.stopped }) : t('business.pauseAll.done');
      setSaid({ line, problem: false });
      venture.reload();
      runs.reload();
    } catch (error) {
      setSaid({ line: t('business.runControls.failed', { message: refusalWords(error, t) }), problem: true });
    } finally {
      setBusy(false);
      setAsk(null);
    }
  }

  const question = ask === 'pause' ? t('business.pauseAll.ask') : going > 0 ? t('business.stopAll.ask', { count: going }) : t('business.stopAll.askNone');

  return (
    <>
      <ul className={menu.list}>
        <li>
          {/* One button for Pause all and Unpause, so the focus stays on it when the business changes state. */}
          <button
            ref={pauseItem} type="button" className={menu.item} aria-expanded={paused ? undefined : ask === 'pause'}
            onClick={() => { if (paused) void pause(false); else setAsk(ask === 'pause' ? null : 'pause'); }}
          >
            {t(paused ? 'business.unpause' : 'business.pauseAll')}
          </button>
        </li>
        <li>
          <button ref={stopItem} type="button" className={menu.item} aria-expanded={ask === 'stop'} onClick={() => setAsk(ask === 'stop' ? null : 'stop')}>{t('business.stopAll')}</button>
        </li>
        <li>
          <a className={menu.item} href="#/business/away" onClick={onLeave}>{t('business.away')}</a>
        </li>
      </ul>
      {paused && <p className={menu.notice}>{paused.line}</p>}
      {ask && (
        <div className={s.ask} role="group" aria-label={question}>
          <p className={s.askLine}>{question}</p>
          <div className={s.askActs}>
            <Button ref={notNow} size="sm" variant="quiet" onClick={() => { (ask === 'stop' ? stopItem : pauseItem).current?.focus(); setAsk(null); }}>{t('approval.cancel')}</Button>
            <Button size="sm" variant="primary" data-confirm="" onClick={() => void pause(true, ask === 'stop')}>
              {t(ask === 'pause' ? 'business.pauseAll' : 'business.stopAll')}
            </Button>
          </div>
        </div>
      )}
      {said && <p className={said.problem ? menu.problem : menu.notice} role="status">{said.line}</p>}
    </>
  );
}
