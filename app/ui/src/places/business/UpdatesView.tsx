import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { UpdatesView as View } from '../../engine/types';
import { Button } from '../../parts/Button';
import { formatBytes } from '../../parts/when';
import { TileSection, messageOf } from './shared';
import s from './Business.module.css';
import r from './Reports.module.css';

/** The states where a download or a check is under way: the page reads the engine again until it ends. */
const WORKING: readonly View['state'][] = ['checking', 'downloading'];
const POLL_MS = 2000;
/** The states with an installer the owner can run themselves. */
const BY_HAND: readonly View['state'][] = ['needs-signing', 'manual'];

/**
 * Business > Updates (C5 task 33): the version, the channel, Check daily, what the update is doing and Check now. What is
 * waiting on the Windows certificate or on the build's key says so plainly; nothing here pretends a step that can't run.
 */
export function UpdatesView() {
  const t = useT();
  const client = useEngine();
  const resource = useResource('updates.status', {});
  const [changed, setChanged] = useState<View | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const view = changed ?? resource.data ?? null;
  const state = view?.state ?? null;
  const { reload } = resource;
  // B3: an answer stays until a newer read arrives.
  useEffect(() => { if (resource.data) setChanged(null); }, [resource.data]);
  useEffect(() => {
    if (!state || !WORKING.includes(state)) return undefined;
    const timer = setInterval(() => { reload(); }, POLL_MS);
    return () => clearInterval(timer);
  }, [state, reload]);

  async function run(call: () => Promise<View | void>) {
    setBusy(true);
    setProblem(null);
    try { const next = await call(); if (next) setChanged(next); } catch (error) { setProblem(messageOf(error)); } finally { setBusy(false); }
  }
  if (!view) {
    return (
      <div className={s.page}>
        {resource.error ? <p className={s.problem} role="alert">{resource.error.message}</p> : <p className={s.note}>{t('updates.loading')}</p>}
      </div>
    );
  }
  const version = view.target?.version ?? '';
  const words = view.state === 'downloading' ? t('updates.state.downloading', { size: formatBytes(view.downloadedBytes ?? 0) })
    : view.state === 'failed' ? t('updates.state.failed', { reason: view.reason ?? t('updates.noReason') })
      : view.state === 'manual' ? t('updates.state.manual', { version })
        : t(`updates.state.${view.state}`);
  return (
    <div className={s.page}>
      <TileSection title={t('updates.title')}>
        <p className={s.line} role="status">{words}</p>
        {view.rolledBack && <p className={s.note} data-rolled-back="">{t(`updates.rolledBack.${view.rolledBack.reason}`, { from: view.rolledBack.from, to: view.rolledBack.to })}</p>}
        {view.state === 'needs-signing' && <p className={s.note}>{t('updates.needsSigning', { version })}</p>}
        {problem && <p className={s.problem} role="alert" data-engine-line="">{problem}</p>}
        {BY_HAND.includes(view.state) && client.showUpdateInstaller && (
          <div className={s.buttons}>
            <Button disabled={busy} onClick={() => void run(() => client.showUpdateInstaller!('staged'))}>{t('updates.show')}</Button>
          </div>
        )}
        <p className={s.note}>{t('updates.version', { version: view.version, channel: t(`updates.channel.${view.channel}`) })}</p>
        {view.configured && (
          <>
            <label className={r.choice}>
              <input type="checkbox" checked={view.daily} disabled={busy} onChange={(event) => { const daily = event.target.checked; void run(() => client.request('updates.settings', { daily })); }} />
              <span>{t('updates.daily')}</span>
            </label>
            <div className={s.buttons}>
              <Button disabled={busy || WORKING.includes(view.state)} onClick={() => void run(() => client.request('updates.check', {}))}>{t('updates.check')}</Button>
            </div>
          </>
        )}
      </TileSection>
    </div>
  );
}
