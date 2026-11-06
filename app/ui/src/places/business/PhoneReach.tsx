/**
 * Business > Notifications, on this computer (wave 6, 6F6 and 6F7; D35). C4 task 39 (17.d2): one fold under "How alerts
 * reach you", "Get alerts on your phone", which opens by itself while nothing is set up, holding in this order:
 *   - Telegram alerts: the owner's own bot token and chat id go to the engine, which keeps them in the computer's
 *     protected key storage; the page clears the token at once. Count only by default; titles are the owner's opt-in.
 *     A test alert sends the current count. Approvals stay in the app: Telegram only says how many things wait.
 *   - Phone access: a one-time pairing link (and its QR code, as the engine drew it) for a phone on this Wi-Fi, or
 *     through Tailscale when this computer has a Tailscale address; Stop ends phone access and every phone session.
 * Every state is the engine's answer, in its words.
 */

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { ParamsOf, PhoneAccessView, TelegramView } from '../../engine/types';
import { messageOf } from './shared';
import s from './Business.module.css';
import n from './Notifications.module.css';

/** One part of the group under its own heading. Seam: C3's Fold takes the details below once C3 lands. */
function Part({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={s.foldBody} aria-labelledby={id}>
      <h3 id={id} className={n.partTitle}>{title}</h3>
      {children}
    </section>
  );
}

export function PhoneReach() {
  const t = useT();
  const telegram = useResource('venture.notify.telegram', {});
  const phone = useResource('venture.phone.access', {});
  // Nothing set up is the engine's answer: no bot and no phone access. Until the two answers come it stays closed.
  const nothingSetUp = telegram.data?.connected === false && phone.data?.on === false;
  const [pressed, setPressed] = useState<boolean | null>(null);
  const open = pressed ?? nothingSetUp;
  return (
    <details className={s.fold} open={open} onToggle={(event) => { if (event.currentTarget.open !== open) setPressed(event.currentTarget.open); }}>
      <summary>{t('business.notify.phoneGroup')}</summary>
      {open && (
        <>
          <Part title={t('business.notify.telegram')}><Telegram /></Part>
          <Part title={t('business.notify.phone')}><PhoneAccess /></Part>
        </>
      )}
    </details>
  );
}

function Telegram() {
  const t = useT();
  const client = useEngine();
  const read = useResource('venture.notify.telegram', {});
  const [view, setView] = useState<TelegramView | null>(null);
  const [token, setToken] = useState('');
  const [chatId, setChatId] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = view ?? read.data ?? null;

  async function send(params: ParamsOf<'venture.notify.telegram'>) {
    setBusy(true);
    setProblem(null);
    try { setView(await client.request('venture.notify.telegram', params)); return true; }
    catch (error) { setProblem(t('business.notify.failed', { message: messageOf(error) })); return false; }
    finally { setBusy(false); }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (!token.trim() || !chatId.trim()) return;
    const value = { token: token.trim(), chatId: chatId.trim() };
    if (await send({ bot: value })) { setToken(''); setChatId(''); }
  }

  if (read.error && !shown) return <p className={s.problem} role="alert">{t('business.failed', { message: read.error.message })}</p>;
  if (!shown) return <p className={s.note}>{t('business.loading')}</p>;
  return (
    <form className={s.form} onSubmit={(event) => void save(event)}>
      <p className={s.note}>{shown.line}</p>
      <Field label={t('business.notify.botToken')} hint={t('business.notify.botTokenHint')} type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} onChange={(event) => setToken(event.currentTarget.value)} />
      <Field label={t('business.notify.chatId')} inputMode="numeric" autoComplete="off" spellCheck={false} value={chatId} disabled={busy} onChange={(event) => setChatId(event.currentTarget.value)} />
      <div className={s.buttons}>
        <Button type="submit" variant="secondary" disabled={busy || !token.trim() || !chatId.trim()}>{t('business.notify.botSave')}</Button>
        {shown.connected && <Button variant="quiet" disabled={busy} onClick={() => void send({ test: true })}>{t('business.notify.botTest')}</Button>}
        {shown.connected && <Button variant="quiet" disabled={busy} onClick={() => void send({ bot: null })}>{t('business.notify.botRemove')}</Button>}
      </div>
      {shown.connected && (
        <label className={s.agree}>
          <input type="checkbox" checked={shown.details} disabled={busy} onChange={(event) => void send({ details: event.currentTarget.checked })} />
          {t('business.notify.botDetails')}
        </label>
      )}
      {shown.said && <p className={s.note} role="status">{shown.said}</p>}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </form>
  );
}

/** The engine's QR matrix as squares (as the invoice sheet draws the UPI code); nothing about the link is worked out here. */
function QrCode({ rows, label }: { rows: string[]; label: string }) {
  const side = rows.length + 8;
  const path = rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '1' ? [`M${x + 4} ${y + 4}h1v1h-1z`] : []))).join('');
  return (
    <svg className={n.qr} role="img" aria-label={label} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" focusable="false">
      <rect className={n.qrLight} width={side} height={side} />
      <path className={n.qrDark} d={path} />
    </svg>
  );
}

function PhoneAccess() {
  const t = useT();
  const client = useEngine();
  const read = useResource('venture.phone.access', {});
  const [view, setView] = useState<PhoneAccessView | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = view ?? read.data ?? null;

  async function send(params: ParamsOf<'venture.phone.access'>) {
    setBusy(true);
    setProblem(null);
    try { setView(await client.request('venture.phone.access', params)); }
    catch (error) { setProblem(t('business.notify.phoneFailed', { message: messageOf(error) })); }
    finally { setBusy(false); }
  }

  if (read.error && !shown) return <p className={s.problem} role="alert">{t('business.failed', { message: read.error.message })}</p>;
  if (!shown) return <p className={s.note}>{t('business.loading')}</p>;
  const tailscale = shown.addresses.some((item) => item.via === 'tailscale');
  return (
    <>
      <p className={s.note}>{shown.line}</p>
      {shown.link && (
        <>
          {shown.qr && <QrCode rows={shown.qr.rows} label={t('business.notify.phoneQr')} />}
          <p className={n.link} data-content="">{shown.link}</p>
        </>
      )}
      <div className={s.buttons}>
        <Button variant="secondary" disabled={busy} onClick={() => void send({ action: 'link', via: 'wifi' })}>{t('business.notify.phoneLink')}</Button>
        {tailscale && <Button variant="quiet" disabled={busy} onClick={() => void send({ action: 'link', via: 'tailscale' })}>{t('business.notify.phoneTailscale')}</Button>}
        {shown.on && <Button variant="quiet" disabled={busy} onClick={() => void send({ action: 'stop' })}>{t('business.notify.phoneStop')}</Button>}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </>
  );
}
