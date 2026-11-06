import { useEffect, useState } from 'react';
import { useT } from '../../text';
import { useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import type { BackupCopyLite, RecoveryLite } from '../../engine/types';
import { Button } from '../../parts/Button';
import { codeOf, momentOf, refusalWords } from '../../parts/custody';
import { openExternal } from '../connections/external';
import { TileSection } from './shared';
import s from './Business.module.css';

/**
 * C5 tasks 23, 24: a copy that survives a dead laptop. The desktop picks a drive or folder (the window never holds a path, only
 * the folder's last name) and the engine copies each automatic backup there, encrypted. Below it, Google Drive in its honest
 * state: until Chausar's Google sign-in exists, the engine says what it needs and there is no button to press.
 */
export function KeepCopy({ copy, recovery, locked, busy, onMakeCode, onChanged }: {
  copy: BackupCopyLite | null; recovery: RecoveryLite; locked: boolean; busy: boolean; onMakeCode: () => void; onChanged: () => void;
}) {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const [working, setWorking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function folder(action: 'pick' | 'clear') {
    setWorking(true);
    setProblem(null);
    try {
      await client.setBackupFolder!(action);
      onChanged();
    } catch (error) {
      setProblem(refusalWords(error, t));
    }
    setWorking(false);
  }

  return (
    <TileSection title={t('business.copy.title')}>
      <p className={s.line}>{t('business.copy.line')}</p>
      {copy && (
        <>
          <p className={s.note} data-content="">{t('business.copy.where', { folder: copy.folderName })}</p>
          {copy.problem
            ? <p className={s.problem} role="status" data-engine-line="">{copy.problem}</p>
            : copy.lastCopiedAt && <p className={s.note}>{t('business.copy.last', { when: momentOf(copy.lastCopiedAt, zone) })}</p>}
        </>
      )}
      {recovery !== 'made' && <p className={s.warn}>{t('business.copy.needsCode')}</p>}
      {problem && <p className={s.problem} role="alert" data-engine-line="">{problem}</p>}
      <div className={s.buttons}>
        <Button disabled={working} onClick={() => void folder('pick')}>{t(copy ? 'business.copy.change' : 'business.copy.pick')}</Button>
        {copy && <Button variant="quiet" disabled={working} onClick={() => void folder('clear')}>{t('business.copy.stop')}</Button>}
        {recovery !== 'made' && !locked && <Button variant="quiet" disabled={busy} onClick={onMakeCode}>{t('business.makeCode')}</Button>}
      </div>
      <DriveRow />
    </TileSection>
  );
}

function DriveRow() {
  const t = useT();
  const zone = useOwnerZone();
  const client = useEngine();
  const drive = useResource('workspace.backups.drive.status', {});
  const [opening, setOpening] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const state = drive.data?.state;
  // The sign-in finishes in the browser; this says so as soon as the engine knows.
  useEffect(() => {
    if (state !== 'connecting') return undefined;
    const timer = setInterval(() => drive.reload(), 3000);
    return () => clearInterval(timer);
  }, [state, drive]);

  async function act(method: 'workspace.backups.drive.connect' | 'workspace.backups.drive.disconnect') {
    setOpening(true);
    setProblem(null);
    try {
      if (method === 'workspace.backups.drive.connect') await openExternal((await client.request(method, {})).url, null);
      else await client.request(method, {});
    } catch (error) {
      setProblem(refusalWords(error, t));
    }
    drive.reload();
    setOpening(false);
  }

  // Not set up: the engine's own words, and nothing to press.
  if (drive.error) return <p className={s.note} data-engine-line="">{codeOf(drive.error) === 'DRIVE_NOT_SET_UP' ? drive.error.message : t('business.actionFailed', { message: drive.error.message })}</p>;
  if (!drive.data) return null;
  return (
    <>
      <p className={s.line}>{t(state === 'connected' ? 'business.drive.connected' : state === 'connecting' ? 'business.drive.connecting' : 'business.drive.line')}</p>
      {drive.data.problem
        ? <p className={s.problem} role="status" data-engine-line="">{drive.data.problem}</p>
        : drive.data.lastCopiedAt && <p className={s.note}>{t('business.copy.last', { when: momentOf(drive.data.lastCopiedAt, zone) })}</p>}
      {problem && <p className={s.problem} role="alert" data-engine-line="">{problem}</p>}
      <div className={s.buttons}>
        {state === 'not-connected' && <Button disabled={opening} onClick={() => void act('workspace.backups.drive.connect')}>{t('business.drive.connect')}</Button>}
        {state === 'connected' && <Button variant="quiet" disabled={opening} onClick={() => void act('workspace.backups.drive.disconnect')}>{t('business.drive.disconnect')}</Button>}
      </div>
    </>
  );
}
