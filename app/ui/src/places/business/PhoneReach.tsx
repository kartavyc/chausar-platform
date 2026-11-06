/**
 * Business > Notifications, on this computer (wave 6, 6F6 and 6F7; D35). Two folds under "How alerts reach you":
 *   - Telegram alerts: the owner's own bot token and chat id go to the engine, which keeps them in the computer's
 *     protected key storage; the page clears the token at once. Count only by default; titles are the owner's opt-in.
 *     A test alert sends the current count. Approvals stay in the app: Telegram only says how many things wait.
 *   - Phone access: a one-time pairing link (and its QR code, as the engine drew it) for a phone on this Wi-Fi, or
 *     through Tailscale when this computer has a Tailscale address; Stop ends phone access and every phone session.
 * Each fold asks the engine only once it is opened. Every state is the engine's answer, in its words.
 */

import { useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { ParamsOf, PhoneAccessView, TelegramView } from '../../engine/types';
import { messageOf } from './shared';
import { QrCode } from '../../parts/QrCode';
import s from './Business.module.css';
import n from './Notifications.module.css';

/** A fold that renders its body only once opened, so a closed fold asks the engine nothing. */
function Fold({ title, children }: { title: string; children: () => ReactNode }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className={s.fold} onToggle={(event) => { if (event.currentTarget.open) setOpened(true); }}>
      <summary>{title}</summary>
      {opened && <div className={s.foldBody}>{children()}</div>}
    </details>
  );
}

export function PhoneReach() {
  const t = useT();
  return (
    <>
      <Fold title={t('business.notify.telegram')}>{() => <Telegram />}</Fold>
      <Fold title={t('business.notify.phone')}>{() => <PhoneAccess />}</Fold>
    </>
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
  // C5 task 11: what Find me read from the bot; nothing is saved until the owner says yes.
  const [finding, setFinding] = useState<{ found: { chatId: string; name: string } | null; line: string } | null>(null);

  async function findMe() {
    if (!token.trim()) return;
    setBusy(true);
    setProblem(null);
    setFinding(null);
    try { setFinding(await client.request('venture.notify.telegram.findChat', { token: token.trim() })); }
    catch (error) { setProblem(t('business.notify.failed', { message: messageOf(error) })); }
    finally { setBusy(false); }
  }
  async function saveFound(chat: string) {
    if (await send({ bot: { token: token.trim(), chatId: chat } })) { setToken(''); setChatId(''); setFinding(null); }
  }

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
      <div className={s.buttons}>
        <Button variant="secondary" disabled={busy || !token.trim()} onClick={() => void findMe()}>{t('business.notify.findMe')}</Button>
      </div>
      {finding && <p className={s.note} role="status">{finding.line}</p>}
      {finding?.found && (
        <div className={s.buttons}>
          <Button variant="primary" disabled={busy} onClick={() => void saveFound(finding.found!.chatId)}>{t('business.notify.findYes')}</Button>
        </div>
      )}
      <details className={s.fold}>
        <summary>{t('business.notify.chatManual')}</summary>
        <div className={s.foldBody}>
          <Field label={t('business.notify.chatId')} inputMode="numeric" autoComplete="off" spellCheck={false} value={chatId} disabled={busy} onChange={(event) => setChatId(event.currentTarget.value)} />
          <Button type="submit" variant="secondary" disabled={busy || !token.trim() || !chatId.trim()}>{t('business.notify.botSave')}</Button>
        </div>
      </details>
      <div className={s.buttons}>
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
