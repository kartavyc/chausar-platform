/**
 * Business > Notifications, on this computer (wave 6, 6F6 and 6F7; D35). C4 task 39 (17.d2): one fold under "How alerts
 * reach you", "Get alerts on your phone", which opens by itself while nothing is set up, holding in this order:
 *   - Telegram alerts: the owner's own bot token and chat id go to the engine, which keeps them in the computer's
 *     protected key storage; the page clears the token at once. Count only by default; titles are the owner's opt-in.
 *     A test alert sends the current count. Approvals stay in the app: Telegram only says how many things wait.
 *   - Phone access: a one-time pairing link (and its QR code, as the engine drew it) for a phone on this Wi-Fi, or
 *     through Tailscale when this computer has a Tailscale address.
 * Above the fold, whenever the engine says phone access is on: its words and Stop, which ends phone access and every
 * phone session. The engine is asked again while it is on (usePhoneAccess), so a link that ran out shows as off.
 * Every state is the engine's answer, in its words.
 */

import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Confirm, useSecondAsk } from '../../parts/Confirm';
import { Field } from '../../parts/Field';
import { usePhoneAccess, type PhoneAccess as PhoneAccessState } from '../../engine/usePhoneAccess';
import type { ParamsOf, TelegramView } from '../../engine/types';
import { messageOf } from './shared';
import { ResultLine } from '../../parts/ResultLine';
import { QrCode } from '../../parts/QrCode';
import s from './Business.module.css';
import n from './Notifications.module.css';
import { Fold } from '../../parts/Fold';
import { LoadingPlace } from '../../parts/Skeleton';

/** One part of the group under its own heading. */
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
  const phone = usePhoneAccess();
  const [problem, setProblem] = useState<string | null>(null);
  // Nothing set up is the engine's answer: no bot and no phone access. Until the two answers come it stays closed.
  // A fold the owner made a link in stays open while that link shows.
  const nothingSetUp = telegram.data?.connected === false && phone.status?.on === false;
  const [pressed, setPressed] = useState<boolean | null>(null);
  const open = pressed ?? (nothingSetUp || phone.made !== null);

  async function act(run: () => Promise<void>) {
    setProblem(null);
    try { await run(); }
    catch (error) { setProblem(t('business.notify.phoneFailed', { message: messageOf(error) })); }
  }

  return (
    <>
      {/* Found on the real app, 16 November 2026: while the engine listens for a phone, the page says so and offers
          Stop here, outside the fold, whether the fold is open or not and whoever made the link. */}
      {phone.status?.on && (
        <div className={s.moreRow} data-phone-on="">
          {/* The answer that made a link carries the link's own words, which the fold shows beside the link. */}
          <p className={s.line} role="status">{phone.status.link ? null : phone.status.line}</p>
          <div className={s.buttons}>
            <Button variant="secondary" disabled={phone.busy} aria-busy={phone.busy || undefined} onClick={() => void act(phone.stop)}>{t('business.notify.phoneStop')}</Button>
          </div>
          {problem && !open && <p className={s.problem} role="alert">{problem}</p>}
        </div>
      )}
      <Fold summary={t('business.notify.phoneGroup')} className={s.fold} open={open} onToggle={(event) => { if (event.currentTarget.open !== open) setPressed(event.currentTarget.open); }}>
        {open && (
          <>
            <Part title={t('business.notify.telegram')}><Telegram /></Part>
            <Part title={t('business.notify.phone')}><PhoneAccess phone={phone} problem={problem} act={act} /></Part>
          </>
        )}
      </Fold>
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
  const remove = useSecondAsk();

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
  if (!shown) return <LoadingPlace shape="settings" />;
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
      <Fold summary={t('business.notify.chatManual')} className={s.fold}>
        <div className={s.foldBody}>
          <Field label={t('business.notify.chatId')} inputMode="numeric" autoComplete="off" spellCheck={false} value={chatId} disabled={busy} onChange={(event) => setChatId(event.currentTarget.value)} />
          <Button type="submit" variant="secondary" disabled={busy} disabledReason={!token.trim() || !chatId.trim() ? t('business.notify.botFirst') : undefined}>{t('business.notify.botSave')}</Button>
        </div>
      </Fold>
      <div className={s.buttons}>
        {shown.connected && <Button variant="quiet" disabled={busy} onClick={() => void send({ test: true })}>{t('business.notify.botTest')}</Button>}
        {shown.connected && !remove.asking && <Button ref={remove.button} variant="quiet" disabled={busy} onClick={remove.ask}>{t('business.notify.botRemove')}</Button>}
      </div>
      {/* Removing forgets the bot's token from this computer's key storage: it asks once first. */}
      {shown.connected && remove.asking && (
        <Confirm action={t('business.notify.botRemove')} tone="danger" busy={busy} onCancel={remove.cancel} onConfirm={() => { void send({ bot: null }).finally(remove.done); }}>
          <p className={s.line}>{t('business.notify.botRemoveAsk')}</p>
        </Confirm>
      )}
      {shown.connected && (
        <label className={s.agree}>
          <input type="checkbox" checked={shown.details} disabled={busy} onChange={(event) => void send({ details: event.currentTarget.checked })} />
          {t('business.notify.botDetails')}
        </label>
      )}
      <ResultLine tone={problem ? 'problem' : 'done'}>{problem ?? shown.said}</ResultLine>
    </form>
  );
}

/**
 * Making a pairing link. Whether phone access is on, and Stop, sit above the fold (PhoneReach): here is the link this
 * page made, for as long as the engine says it still waits, and the engine's words while it is off.
 */
function PhoneAccess({ phone, problem, act }: { phone: PhoneAccessState; problem: string | null; act: (run: () => Promise<void>) => Promise<void> }) {
  const t = useT();
  const { status, made, busy } = phone;
  if (phone.error && !status) return <p className={s.problem} role="alert">{t('business.failed', { message: phone.error.message })}</p>;
  if (!status) return <LoadingPlace shape="settings" />;
  const tailscale = status.addresses.some((item) => item.via === 'tailscale');
  return (
    <>
      {made ? <p className={s.note}>{made.line}</p> : !status.on && <p className={s.note}>{status.line}</p>}
      {made?.link && (
        <>
          {made.qr && <QrCode rows={made.qr.rows} label={t('business.notify.phoneQr')} />}
          <p className={n.link} data-content="">{made.link}</p>
        </>
      )}
      <div className={s.buttons}>
        <Button variant="secondary" disabled={busy} onClick={() => void act(() => phone.link('wifi'))}>{t('business.notify.phoneLink')}</Button>
        {tailscale && <Button variant="quiet" disabled={busy} onClick={() => void act(() => phone.link('tailscale'))}>{t('business.notify.phoneTailscale')}</Button>}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </>
  );
}
