/**
 * Business > Notifications (Ink v2 wave 4, 4G4; spec 5.7 and 8, catalogue O12 and O13, W3's U18). What the engine's
 * settings say, in its own words, then two tiles and a list:
 *   - How alerts reach you. On the hosted app: phone alerts by web push, a count only, turned on by a walkthrough that
 *     asks the browser only when "Turn on phone alerts" is pressed and follows the browser's permission live while the
 *     page is open; a blocked browser reads "Push is off: your browser blocked it. The bell still works." (spec 8); and
 *     the honest limit: alerts come only while Chausar is awake for the business. On this computer: the engine's own
 *     words that phone alerts need the hosted app, the tray switch, and an optional relay of the owner's own.
 *     Which of the two shows is the engine's answer (push.key and relay refuse with TIER_UNAVAILABLE where they do not
 *     apply), never a guess about the host.
 *   - Quiet times: quiet hours and the digest hour, saved together, and a pause until a date, 30 days at most.
 *   - What keeps running while Chausar is closed, as the engine lists it from its records.
 * Every change is the engine's to accept or refuse; a refusal shows in its words.
 */

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { useClock } from '../../shell/clock';
import { useBrowserPush, type PushPermission } from '../../shell/push';
import { EngineError, type NotifySettingsView, type ParamsOf } from '../../engine/types';
import { TileSection, messageOf } from './shared';
import { DraftRecover, DraftWord, useSettingsDraft } from './settingsDraft';
import s from './Business.module.css';
import n from './Notifications.module.css';

type Change = ParamsOf<'venture.notify.settings'>;

const HOURS = Array.from({ length: 24 }, (_, hour) => hour);
const clockWords = (hour: number) => `${String(hour).padStart(2, '0')}:00`;
/** A date on this computer's calendar, as a date field writes it. */
const dayOf = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
const daysAfter = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export function NotificationsView() {
  const t = useT();
  const client = useEngine();
  const settings = useResource('venture.notify.settings', {});
  const [view, setView] = useState<NotifySettingsView | null>(null);
  const shown = view ?? settings.data ?? null;

  /** Sends one change; the engine's answer replaces what is shown. A refusal is thrown for the tile to say. */
  async function change(params: Change): Promise<void> {
    const next = await client.request('venture.notify.settings', params);
    setView(next);
  }

  if (settings.error && !shown) return <p className={s.problem} role="alert">{t('business.failed', { message: settings.error.message })}</p>;
  if (!shown) return <p className={s.note}>{t('business.loading')}</p>;
  return (
    <div className={s.page}>
      <p className={n.said} data-settings-line="">{shown.line}</p>
      <div className={s.split} data-ratio="even">
        <Reach settings={shown} change={change} reread={() => { setView(null); settings.reload(); }} />
        <QuietTimes settings={shown} change={change} />
      </div>
      <KeepsRunning settings={shown} />
    </div>
  );
}

/** How alerts reach the owner: push on the hosted app, or the tray and a relay on this computer (the engine says which). */
function Reach({ settings, change, reread }: { settings: NotifySettingsView; change: (params: Change) => Promise<void>; reread: () => void }) {
  const t = useT();
  const pushKey = useResource('venture.notify.push.key', {});
  const relay = useResource('venture.notify.relay', {});
  const phone = pushKey.data !== undefined;
  // Why there are no phone alerts here, in the engine's words: this computer, or a hosted server without push keys.
  const noPhone = pushKey.error?.code === 'TIER_UNAVAILABLE' ? pushKey.error.message : null;
  return (
    <TileSection title={t('business.notify.reach')} meta={t('business.notify.countOnly')}>
      {!phone && !pushKey.error && <p className={s.note}>{t('business.loading')}</p>}
      {pushKey.error && !noPhone && <p className={s.problem}>{t('business.failed', { message: pushKey.error.message })}</p>}
      {phone && <PhonePush on={settings.push} reread={reread} />}
      {noPhone && <p className={s.line}>{noPhone}</p>}
      {/* The tray and the relay only where the engine answers for the relay (this computer). */}
      {relay.data && (
        <>
          <Tray on={settings.tray} change={change} />
          <Relay view={relay.data} />
        </>
      )}
      {relay.error && relay.error.code !== 'TIER_UNAVAILABLE' && <p className={s.problem}>{t('sheet.failed', { message: relay.error.message })}</p>}
    </TileSection>
  );
}

/**
 * The walkthrough for phone alerts in this browser. The browser is asked only from the press; its permission is read
 * again whenever it changes while the page is open. Turning on goes through push.subscribe (the engine turns push on
 * when a browser has subscribed; the switch alone is refused, PUSH_NOT_SUBSCRIBED).
 */
function PhonePush({ on, reread }: { on: boolean; reread: () => void }) {
  const t = useT();
  const client = useEngine();
  const browser = useBrowserPush();
  const supported = browser.supported();
  const [permission, setPermission] = useState<PushPermission>(() => browser.permission());
  const [here, setHere] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (!supported) return;
    let live = true;
    const read = () => {
      setPermission(browser.permission());
      void browser.current().then((subscription) => { if (live) setHere(subscription !== null); }, () => { if (live) setHere(false); });
    };
    read();
    const stop = browser.onPermission(read);
    return () => { live = false; stop(); };
  }, [browser, supported]);

  async function turnOn() {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const answer = await browser.ask();
      setPermission(answer);
      if (answer !== 'granted') return;
      const { publicKey } = await client.request('venture.notify.push.key', {});
      const subscription = await browser.subscribe(publicKey);
      const result = await client.request('venture.notify.push.subscribe', { subscription });
      setHere(true);
      setSaid(result.line);
      reread();
    } catch (error) {
      setProblem(t('business.notify.push.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  async function turnOff() {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    try {
      const endpoint = await browser.unsubscribe();
      setHere(false);
      if (endpoint) setSaid((await client.request('venture.notify.push.unsubscribe', { endpoint })).line);
      reread();
    } catch (error) {
      setProblem(t('business.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  let body;
  if (!supported) body = <p className={s.line}>{t('business.notify.push.unsupported')}</p>;
  else if (permission === 'denied') {
    body = (
      <>
        <p className={n.blocked} role="status">{t('business.notify.push.blocked')}</p>
        <p className={s.note}>{t('business.notify.push.unblock')}</p>
      </>
    );
  } else if (here && on && permission === 'granted') {
    body = (
      <>
        <p className={s.line}>{said ?? t('business.notify.push.onHere')}</p>
        <div className={s.buttons}><Button variant="secondary" disabled={busy} onClick={() => void turnOff()}>{t('business.notify.push.off')}</Button></div>
      </>
    );
  } else {
    body = (
      <>
        {said && <p className={s.line}>{said}</p>}
        <p className={s.note}>{t('business.notify.push.asks')}</p>
        <div className={s.buttons}><Button variant="primary" disabled={busy} onClick={() => void turnOn()}>{t('business.notify.push.on')}</Button></div>
      </>
    );
  }
  return (
    <>
      {body}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
      <p className={s.note}>{t('business.notify.push.awake')}</p>
    </>
  );
}

/** The tray switch on this computer: the count beside the clock. */
function Tray({ on, change }: { on: boolean; change: (params: Change) => Promise<void> }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  async function flip(next: boolean) {
    setBusy(true);
    setProblem(null);
    try { await change({ tray: next }); } catch (error) { setProblem(t('business.notify.failed', { message: messageOf(error) })); } finally { setBusy(false); }
  }
  return (
    <>
      <label className={s.agree}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(event) => void flip(event.currentTarget.checked)} />
        {t('business.notify.tray')}
      </label>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </>
  );
}

/** The owner's own relay on this computer: one https address that gets the count with each alert. Shown by host only. */
function Relay({ view }: { view: { relay: string | null; line: string } }) {
  const t = useT();
  const client = useEngine();
  const [said, setSaid] = useState<{ relay: string | null; line: string } | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = said ?? view;

  async function send(next: string | null) {
    setBusy(true);
    setProblem(null);
    try {
      setSaid(await client.request('venture.notify.relay', { url: next }));
      setUrl('');
    } catch (error) {
      setProblem(t('business.notify.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (url.trim()) void send(url.trim());
  }
  return (
    <form className={s.form} onSubmit={submit}>
      {shown && <p className={s.note}>{shown.line}</p>}
      <Field label={t('business.notify.relay')} hint={t('business.notify.relayHint')} type="url" inputMode="url" autoComplete="off" spellCheck={false} value={url} disabled={busy} onChange={(event) => setUrl(event.currentTarget.value)} />
      <div className={s.buttons}>
        <Button type="submit" variant="secondary" disabled={busy || !url.trim()}>{t('business.notify.relaySave')}</Button>
        {shown?.relay && <Button variant="quiet" disabled={busy} onClick={() => void send(null)}>{t('business.notify.relayRemove')}</Button>}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </form>
  );
}

/** Quiet hours and the digest hour (saved together), then the pause. */
function QuietTimes({ settings, change }: { settings: NotifySettingsView; change: (params: Change) => Promise<void> }) {
  const t = useT();
  const clock = useClock();
  const ids = useId();
  const [quiet, setQuiet] = useState(settings.quietHours !== null);
  const [from, setFrom] = useState(settings.quietHours?.from ?? '22:00');
  const [to, setTo] = useState(settings.quietHours?.to ?? '07:00');
  const [digest, setDigest] = useState(settings.digest ? String(settings.digest.hour) : 'off');
  const [until, setUntil] = useState('');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const today = clock();
  // W4 4J21: quiet hours and the digest, kept as a draft of exactly what Save sends to venture.notify.settings.
  const [touched, setTouched] = useState(false);
  const values = { quietHours: quiet ? { from, to } : null, digest: digest === 'off' ? null : { hour: Number(digest) } };
  const draft = useSettingsDraft<typeof values>('notifications', values, touched);
  function touch() { setTouched(true); setSaved(false); }

  async function run(params: Change) {
    setBusy(true);
    setSaved(false);
    setProblem(null);
    try {
      await change(params);
      return true;
    } catch (error) {
      setProblem(t('business.notify.failed', { message: error instanceof EngineError ? error.message : messageOf(error) }));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    if (await run(values)) { setSaved(true); setTouched(false); }
  }
  async function pause() {
    if (!until) return;
    // The pause ends as the chosen day begins on this computer's clock.
    const [year, month, day] = until.split('-').map(Number);
    if (await run({ pausedUntil: new Date(year!, month! - 1, day!).toISOString() })) setUntil('');
  }

  return (
    <TileSection title={t('business.notify.quiet')}>
      {draft.offer && !touched && (
        <DraftRecover
          offer={draft.offer}
          onRecover={(kept) => {
            setQuiet(kept.quietHours !== null);
            if (kept.quietHours) { setFrom(kept.quietHours.from); setTo(kept.quietHours.to); }
            setDigest(kept.digest ? String(kept.digest.hour) : 'off');
            setTouched(true);
            draft.taken();
          }}
          onDecline={draft.decline}
        />
      )}
      <form className={s.form} onSubmit={(event) => void save(event)}>
        <label className={s.agree}>
          <input type="checkbox" checked={quiet} disabled={busy} onChange={(event) => { setQuiet(event.currentTarget.checked); touch(); }} />
          {t('business.notify.quietHours')}
        </label>
        <p className={s.note}>{t('business.notify.quietHint')}</p>
        {quiet && (
          <div className={n.pair}>
            <Field label={t('business.notify.from')} type="time" value={from} disabled={busy} onChange={(event) => { setFrom(event.currentTarget.value); touch(); }} />
            <Field label={t('business.notify.to')} type="time" value={to} disabled={busy} onChange={(event) => { setTo(event.currentTarget.value); touch(); }} />
          </div>
        )}
        <div className={n.field}>
          <label htmlFor={`${ids}-digest`} className={n.label}>{t('business.notify.digest')}</label>
          <select id={`${ids}-digest`} className={n.select} value={digest} disabled={busy} aria-describedby={`${ids}-digest-hint`} onChange={(event) => { setDigest(event.currentTarget.value); touch(); }}>
            <option value="off">{t('business.notify.digestOff')}</option>
            {HOURS.map((hour) => <option key={hour} value={String(hour)}>{clockWords(hour)}</option>)}
          </select>
          <p id={`${ids}-digest-hint`} className={s.note}>{t('business.notify.digestHint')}</p>
        </div>
        <div className={s.buttons}>
          <Button type="submit" variant="primary" disabled={busy}>{t('business.notify.save')}</Button>
          {saved ? <span className={s.note} role="status">{t('business.notify.saved')}</span> : <DraftWord saved={draft.saved} refused={draft.refused} shown={touched} />}
        </div>
      </form>
      <div className={n.pause}>
        {settings.pausedUntil ? (
          <div className={s.buttons}><Button variant="secondary" disabled={busy} onClick={() => void run({ pausedUntil: null })}>{t('business.notify.resume')}</Button></div>
        ) : (
          <>
            <Field
              label={t('business.notify.pause')} hint={t('business.notify.pauseHint')} type="date" value={until} disabled={busy}
              min={dayOf(daysAfter(today, 1))} max={dayOf(daysAfter(today, 30))} onChange={(event) => setUntil(event.currentTarget.value)}
            />
            <div className={s.buttons}><Button variant="secondary" disabled={busy || !until} onClick={() => void pause()}>{t('business.notify.pauseButton')}</Button></div>
          </>
        )}
      </div>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </TileSection>
  );
}

/** What keeps running while Chausar is closed, from the engine's records. */
function KeepsRunning({ settings }: { settings: NotifySettingsView }) {
  const t = useT();
  // The hosted app answers the relay with TIER_UNAVAILABLE; there nothing runs while nobody has it open.
  const relay = useResource('venture.notify.relay', {});
  const hosted = relay.error?.code === 'TIER_UNAVAILABLE';
  return (
    <TileSection title={t('business.notify.running')}>
      {settings.keepsRunning.length > 0 ? (
        <ul className={n.running}>
          {settings.keepsRunning.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ) : (
        <p className={s.line}>{hosted ? t('business.notify.runningNoneHosted') : t('business.notify.runningNone')}</p>
      )}
    </TileSection>
  );
}
