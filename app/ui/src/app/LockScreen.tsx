/**
 * The lock screen (SH-02): the mark, the workspace name, the unlock control, a link to
 * unlock with the computer's own check where it has one, the recovery kit link, and one
 * line saying what is paused while locked. No rail, no ask line, no status line.
 * Nothing from the workspace is visible behind the lock.
 *
 * This screen never sees what is typed. It holds no field for the passphrase or PIN, no
 * state for it and no callback that carries it. The control that takes it is the trusted
 * host's own, placed here through `unlockControl`: today that is the existing host
 * unlock, mounted by the integration adapter into the element it passes, and it stays
 * until a replacement is qualified. The screen only says, in words, how the last try
 * went, from what the host reports.
 */

import type { ReactNode } from 'react';
import { useT } from './text';
import { Wordmark } from './Rail';
import { Button } from '../parts/Button';
import s from './LockScreen.module.css';

export interface LockScreenProps {
  workspaceName: string;
  /** The trusted host's unlock control. Rendered as given; never read by this screen. */
  unlockControl: ReactNode;
  /** "Windows Hello" or "Touch ID", when the computer has it. */
  device?: { name: string; onUnlock: () => void } | undefined;
  /** Absent when the host offers no recovery from here. */
  onRecoveryKit?: (() => void) | undefined;
  /** The last try was wrong. No count of tries is shown. */
  wrong?: boolean | undefined;
  /** Too many tries: the time to try again, already formatted. */
  waitUntil?: string | undefined;
}

export function LockScreen({ workspaceName, unlockControl, device, onRecoveryKit, wrong = false, waitUntil }: LockScreenProps) {
  const t = useT();
  const problem = waitUntil !== undefined ? t('SH-02.wait', { time: waitUntil }) : wrong ? t('SH-02.wrong') : undefined;

  return (
    <main className={s.lock} aria-labelledby="lock-title">
      <div className={s.form}>
        <Wordmark />
        <h1 id="lock-title" className={s.title}>
          {t('SH-02.title', { workspace: workspaceName })}
        </h1>
        <div className={s.unlock}>{unlockControl}</div>
        {problem !== undefined && (
          <p className={s.problem} role="alert">
            {problem}
          </p>
        )}
        {device && (
          <div className={s.actions}>
            <Button variant="link" onClick={device.onUnlock} disabled={waitUntil !== undefined}>
              {t('SH-02.device', { device: device.name })}
            </Button>
          </div>
        )}
        {onRecoveryKit && (
          <p className={s.forgot}>
            <Button variant="link" onClick={onRecoveryKit}>
              {t('SH-02.forgot')}
            </Button>
            <span>{t('SH-02.forgot.note')}</span>
          </p>
        )}
        <p className={s.paused}>{t('SH-02.paused')}</p>
      </div>
    </main>
  );
}
