/**
 * TR-12 Vault, "This computer" (SH-07): start at login over release's `shell.startAtLogin`, background mode over
 * jobs-ext's `jobsx.background` / `jobsx.setBackground`, wake for jobs over `jobsx.setWake`, and how to restore a
 * backup from the lock screen. Start at login and the wake timer are built by other lanes this round: until they
 * answer, each says so in words and draws no switch.
 */
import type { ReactNode } from 'react';
import { Button } from '../../parts/Button';
import { State } from '../../patterns/States';
import { words } from '../../places/types.ts';
import { useEngine, useSend, type Loaded } from './kit/engine.ts';
import { Group, screenState } from './kit/Screen';
import { AskTwice, Tag, type P } from './common';
import { rtt } from './rtt.ts';
import { Said } from './rtt-parts';
import { validateBackground, validateSetBackground, validateSetWake, validateStartAtLogin, type Background, type StartAtLogin } from './validate-hosted.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

/** The owner's and cofounder's settings for this computer. */
export function ComputerSettings({ p }: { p: P }) {
  return (
    <>
      <StartAtLoginGroup p={p} />
      <BackgroundGroup p={p} />
    </>
  );
}

/** Codes that mean "not the installed desktop app" rather than a fault. */
const NO_SHELL: ReadonlySet<string> = new Set(['SHELL_UNAVAILABLE', 'SHELL_PORT_MISSING', 'SERVICE_UNAVAILABLE', 'OPEN_DESKTOP']);

function StartAtLoginGroup({ p }: { p: P }) {
  const say = rtt(p.language);
  const { state, reload } = useEngine(p.rpc, 'shell.startAtLogin', {}, validateStartAtLogin);
  const { sent, send } = useSend(p.rpc, validateStartAtLogin);
  // Release's write asks for the person's confirmation in the request; the screen asks once more before sending it.
  const set = async (enabled: boolean) => { if (await send('shell.setStartAtLogin', { enabled, confirmed: true }) !== null && p.live(p.address)) reload(); };
  return (
    <Group title={say('RTT.vault.loginTitle')} note={say('RTT.vault.loginNote')}>
      {state.kind === 'not-built' ? <p className={s.quiet} data-login="not-built">{say('RTT.vault.loginNotBuilt')}</p>
        : state.kind === 'failed' && NO_SHELL.has(state.code) ? <p className={s.quiet} data-login="desktop">{say('RTT.vault.loginDesktop')}</p>
          : state.kind !== 'ready' ? <State state={screenState(state)} />
            : <LoginBody p={p} x={state.value} busy={sent.kind === 'sending'} onSet={(on) => void set(on)} />}
      <Said sent={sent} done={(x) => say(x.enabled ? 'RTT.vault.loginOn' : 'RTT.vault.loginOff')} language={p.language} />
    </Group>
  );
}

function LoginBody({ p, x, busy, onSet }: { p: P; x: StartAtLogin; busy: boolean; onSet: (on: boolean) => void }) {
  const say = rtt(p.language);
  const label = say(x.enabled ? 'RTT.vault.turnOffLogin' : 'RTT.vault.turnOnLogin');
  return (
    <div className={s.stack}>
      <p className={s.text} data-login={x.enabled ? 'on' : 'off'}>{say(x.enabled ? 'RTT.vault.loginOn' : 'RTT.vault.loginOff')}</p>
      {x.enabled && x.matches === false && <p className={s.problem} data-login="other-copy">{say('RTT.vault.loginOtherCopy')}</p>}
      <span><AskTwice label={label} ask={say(x.enabled ? 'RTT.vault.loginAskOff' : 'RTT.vault.loginAskOn')} confirmLabel={label}
        onConfirm={() => onSet(!x.enabled)} language={p.language} disabled={busy} /></span>
    </div>
  );
}

function BackgroundGroup({ p }: { p: P }) {
  const say = rtt(p.language);
  const { state, reload } = useEngine(p.rpc, 'jobsx.background', {}, validateBackground);
  return (
    <>
      <Group title={say('RTT.vault.backgroundTitle')} note={say('RTT.vault.awake')}>
        <Ready loaded={state} notBuilt={say('RTT.vault.backgroundNotBuilt')}>{(b) => <BackgroundBody p={p} b={b} reload={reload} />}</Ready>
      </Group>
      <Group title={say('RTT.vault.wakeTitle')}>
        <p className={s.text}><Tag>{words(COMMON, p.language).experimental}</Tag></p>
        <Ready loaded={state} notBuilt={say('RTT.vault.wakeUnavailable')}>{(b) => <WakeBody p={p} b={b} reload={reload} />}</Ready>
      </Group>
    </>
  );
}

function Ready<T>({ loaded, notBuilt, children }: { loaded: Loaded<T>; notBuilt: string; children: (value: T) => ReactNode }) {
  if (loaded.kind === 'ready') return <>{children(loaded.value)}</>;
  if (loaded.kind === 'not-built') return <p className={s.quiet}>{notBuilt}</p>;
  return <State state={screenState(loaded)} />;
}

function BackgroundBody({ p, b, reload }: { p: P; b: Background; reload: () => void }) {
  const say = rtt(p.language);
  const { sent, send } = useSend(p.rpc, validateSetBackground);
  const set = async (enabled: boolean) => { if (await send('jobsx.setBackground', { enabled }) !== null && p.live(p.address)) reload(); };
  return (
    <div className={s.stack}>
      <p className={s.text} data-background={b.backgroundMode ? 'on' : 'off'}>{say(b.backgroundMode ? 'RTT.vault.backgroundOn' : 'RTT.vault.backgroundOff')}</p>
      <span>
        <Button variant="quiet" disabled={sent.kind === 'sending'} onClick={() => void set(!b.backgroundMode)}>
          {say(b.backgroundMode ? 'RTT.vault.backgroundTurnOff' : 'RTT.vault.backgroundTurnOn')}
        </Button>
      </span>
      <p className={s.quiet}>{say('RTT.vault.autoLock')}</p>
      <Said sent={sent} done={(x) => say(x.backgroundMode ? 'RTT.vault.backgroundOn' : 'RTT.vault.backgroundOff')} language={p.language} />
    </div>
  );
}

function WakeBody({ p, b, reload }: { p: P; b: Background; reload: () => void }) {
  const say = rtt(p.language);
  const { sent, send } = useSend(p.rpc, validateSetWake);
  const set = async (enabled: boolean) => { if (await send('jobsx.setWake', { enabled }) !== null && p.live(p.address)) reload(); };
  // Until the system timer exists, jobs-ext says so in the read; no switch is drawn.
  if (!b.wake.available) return <p className={s.quiet} data-wake="unavailable">{say('RTT.vault.wakeUnavailable')}</p>;
  return (
    <div className={s.stack}>
      <p className={s.text} data-wake={b.wake.on ? 'on' : 'off'}>{say(b.wake.on ? 'RTT.vault.wakeOn' : 'RTT.vault.wakeOff')}</p>
      <span><Button variant="quiet" disabled={sent.kind === 'sending'} onClick={() => void set(!b.wake.on)}>{say(b.wake.on ? 'RTT.vault.wakeTurnOff' : 'RTT.vault.wakeTurnOn')}</Button></span>
      <Said sent={sent} done={(x) => say(x.enabled ? 'RTT.vault.wakeOn' : 'RTT.vault.wakeOff')} language={p.language} />
    </div>
  );
}

/** Restore from the lock screen: the backup file the lock screen's "Choose your backup file" opens, by name. */
export function RestoreFile({ p, file, steps = false }: { p: P; file: string | null; steps?: boolean }) {
  const say = rtt(p.language);
  return (
    <>
      {steps && <p className={s.text}>{say('RTT.vault.lockRestoreSteps')}</p>}
      {file === null ? <p className={s.quiet}>{say('RTT.vault.lockRestoreNone')}</p> : <p className={s.mono} data-restore-file="">{say('RTT.vault.lockRestoreFile', { file })}</p>}
    </>
  );
}
