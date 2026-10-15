/**
 * PIN quick unlock (SH-02, TR-12), over core-gateway-auth's `workspace.pin.*` (contract in
 * `bridge/r4-contracts.ts`).
 * - `PinUnlock`, for the lock screen: drawn only when the engine says a PIN is set for this
 *   folder on this computer and it still works. The field is uncontrolled: its value is read
 *   once, the field is emptied at once and the PIN goes straight to the engine; nothing holds
 *   it. A wrong PIN says so with no count; the engine counts the tries, and after too many
 *   only the passphrase unlocks (the field goes away).
 * - `PinSettings`, for Trust · Vault: set a PIN (with the passphrase, both read once and
 *   emptied) or remove it.
 * Without the methods each says "not built yet"; the lock screen then simply has no PIN field.
 */

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { useT } from '../../app/text';
import { Button } from '../../parts/Button';
import { isPinStatus, type PinStatus } from '../../bridge/r4-contracts.ts';
import { failureOf, type JourneyFailure } from './journey-contracts.ts';
import { Act, Actions, FailureLine, Status } from './JourneyParts';
import type { ComputerPort } from './this-computer.ts';
import s from './Journey.module.css';

type Known = { readonly kind: 'reading' } | { readonly kind: 'known'; readonly status: PinStatus } | JourneyFailure;

async function readPin(rpc: ComputerPort, payload: Record<string, unknown>): Promise<Known> {
  try {
    const reply = await rpc.request('workspace.pin.status', payload);
    return isPinStatus(reply) ? { kind: 'known', status: reply } : { kind: 'refused', code: 'INVALID_REPLY' };
  } catch (error) { return failureOf(error); }
}

/** Read a field once and empty it at once. The value is never put in state. */
function takeOnce(field: HTMLInputElement | null): string {
  if (field === null) return '';
  const value = field.value; field.value = ''; return value;
}

/* ------------------------------------------------------------------ the lock screen */

export interface PinUnlockProps {
  readonly rpc: ComputerPort;
  readonly folder: string;
  /** Called once the engine accepted the PIN; the host leaves its lock and reads afresh. */
  readonly onUnlocked: () => void | Promise<unknown>;
}

export function PinUnlock({ rpc, folder, onUnlocked }: PinUnlockProps) {
  const t = useT();
  const fieldId = useId();
  const field = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [state, setState] = useState<Known>({ kind: 'reading' });
  const [problem, setProblem] = useState<'wrong' | 'lockedOut' | 'failed' | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    setState({ kind: 'reading' }); setProblem(null);
    void readPin(rpc, { folder }).then(next => { if (live) setState(next); });
    return () => { live = false; };
  }, [rpc, folder]);

  const lockedOut = problem === 'lockedOut' || (state.kind === 'known' && state.status.passphraseOnly);
  if (state.kind !== 'known' || !state.status.set) return null;
  if (lockedOut) return <p className={s.problem} role="alert" data-pin-locked-out="">{t('SH-02.pin.lockedOut')}</p>;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const pin = takeOnce(field.current);
    if (pending.current || pin.length === 0) return;
    pending.current = true; setBusy(true); setProblem(null);
    void rpc.request('workspace.pin.unlock', { folder, pin }).then(
      () => onUnlocked(),
      (error: unknown) => {
        const failure = failureOf(error);
        setProblem(failure.kind === 'refused' && failure.code === 'PIN_WRONG' ? 'wrong' : failure.kind === 'refused' && failure.code === 'PIN_LOCKED_OUT' ? 'lockedOut' : 'failed');
      },
    ).finally(() => { pending.current = false; setBusy(false); field.current?.focus(); });
  };

  return (
    <form onSubmit={submit} autoComplete="off" data-pin-unlock="">
      <label htmlFor={fieldId} className={s.sectionTitle}>{t('SH-02.pin.field')}</label>
      <div className={s.actions}>
        <input ref={field} id={fieldId} type="password" inputMode="numeric" name="pin" autoComplete="off" spellCheck={false} maxLength={12}
          aria-invalid={problem === 'wrong' ? true : undefined} />
        <Button variant="filled" submit aria-busy={busy || undefined}>{t('SH-02.pin.unlock.btn')}</Button>
      </div>
      {problem !== null && <p className={s.problem} role="alert">{t(problem === 'wrong' ? 'SH-02.pin.wrong' : 'SH-02.pin.failed')}</p>}
      <p className={s.note}>{t('SH-02.pin.or')}</p>
    </form>
  );
}

/* ------------------------------------------------------------------ Trust · Vault */

/** For Trust · Vault: the PIN for this computer, set with the passphrase or removed. Needs an owner seat. */
export function PinSettings({ rpc }: { rpc: ComputerPort }) {
  const t = useT();
  const pinId = useId(), passId = useId();
  const pin = useRef<HTMLInputElement>(null), passphrase = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<Known>({ kind: 'reading' });
  const [message, setMessage] = useState<{ readonly key: string; readonly code?: string; readonly alert: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    void readPin(rpc, {}).then(next => { if (live) setState(next); });
    return () => { live = false; };
  }, [rpc]);

  const change = async (method: 'workspace.pin.set' | 'workspace.pin.remove', payload: Record<string, unknown>, done: string) => {
    setBusy(true); setMessage(null);
    try {
      const reply = await rpc.request(method, payload);
      if (!isPinStatus(reply)) { setMessage({ key: 'TR-12.pin.refused', code: 'INVALID_REPLY', alert: true }); return; }
      setState({ kind: 'known', status: reply }); setMessage({ key: done, alert: false });
    } catch (error) {
      const failure = failureOf(error);
      if (failure.kind === 'not-built') { setMessage({ key: 'TR-12.pin.notBuilt', alert: false }); return; }
      const key = failure.code === 'PIN_INVALID' ? 'TR-12.pin.invalid' : failure.code === 'UNLOCK_FAILED' ? 'TR-12.pin.wrongPassphrase'
        : failure.code === 'FORBIDDEN' || failure.code === 'ACCESS_DENIED' ? 'TR-12.pin.owner' : 'TR-12.pin.refused';
      setMessage({ key, code: failure.code, alert: true });
    } finally { setBusy(false); }
  };

  if (state.kind === 'reading') return <section data-pin-settings="reading"><Status k="TR-12.pin.reading" /></section>;
  if (state.kind !== 'known') return <section data-pin-settings={state.kind}><FailureLine failure={state} notBuilt="TR-12.pin.notBuilt" refused="TR-12.pin.refused" /></section>;
  const status = state.status;
  return (
    <section data-pin-settings={status.set ? 'set' : 'none'}>
      <h2 className={s.sectionTitle}>{t('TR-12.pin.title')}</h2>
      <p className={s.note}>{t('TR-12.pin.lede')}</p>
      <p className={s.status}>{t(status.set ? 'TR-12.pin.on' : 'TR-12.pin.none')}</p>
      {status.passphraseOnly && <p className={s.note}>{t('TR-12.pin.lockedOut')}</p>}
      <form autoComplete="off" onSubmit={event => {
        event.preventDefault();
        const typedPin = takeOnce(pin.current), typedPassphrase = takeOnce(passphrase.current);
        if (!/^\d{4,12}$/.test(typedPin)) { setMessage({ key: 'TR-12.pin.invalid', alert: true }); return; }
        void change('workspace.pin.set', { pin: typedPin, passphrase: typedPassphrase }, 'TR-12.pin.saved');
      }}>
        <div className={s.fields}>
          <label htmlFor={pinId}>{t('TR-12.pin.new')}</label>
          <input ref={pin} id={pinId} type="password" inputMode="numeric" name="new-pin" autoComplete="off" maxLength={12} />
          <label htmlFor={passId}>{t('TR-12.pin.passphrase')}</label>
          <input ref={passphrase} id={passId} type="password" name="pin-passphrase" autoComplete="off" />
        </div>
        {message !== null && <p className={message.alert ? s.problem : s.status} role={message.alert ? 'alert' : 'status'}>{t(message.key, { code: message.code ?? '' })}</p>}
        <Actions>
          <Act variant="filled" submit label="TR-12.pin.set.btn" disabled={busy} />
          {status.set && <Act variant="link" label="TR-12.pin.remove.btn" disabled={busy} onClick={() => { void change('workspace.pin.remove', {}, 'TR-12.pin.removed'); }} />}
        </Actions>
      </form>
    </section>
  );
}
