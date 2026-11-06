import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useOwnerZone } from '../../shell/clock';
import { useEngine, useResource } from '../../engine/context';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { AwayView as Away } from '../../engine/types';
import { TileSection, dayOf } from './shared';
import { useLocalToday } from '../../parts/when';
import { quickDates, type QuickDates } from './away-dates';
import s from './Business.module.css';
import a from './AwayView.module.css';
import { LoadingPlace } from '../../parts/Skeleton';

/**
 * Away (W4 4F3; catalogue O4; venture.away.get and venture.away.set): the owner says which days they will be away and
 * the engine lists, from its records only, what falls due between them, what keeps running, how many things wait on
 * Today, and a reply with the owner's real days for them to paste into the auto-reply of their own mail app. Chausar
 * sends nothing; Copy only copies the words. Every line is the engine's; the page words only its own labels and the
 * count. While the owner is away no new work starts on its own (the engine refuses it).
 */
export function AwayView() {
  const t = useT();
  const client = useEngine();
  const zone = useOwnerZone();
  const away = useResource('venture.away.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [shown, setShown] = useState<Away | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  // C5 task 2: what falls due between the days picked, before Set (venture.away.preview, a read).
  const [preview, setPreview] = useState<{ from: string; to: string; items: Away['promises'] } | null>(null);
  const today = useLocalToday();
  const view = shown ?? away.data;

  async function look(nextFrom: string, nextTo: string) {
    setPreview(null);
    if (!nextFrom || !nextTo || nextFrom > nextTo) return;
    try {
      const found = await client.request('venture.away.preview', { from: nextFrom, to: nextTo });
      setPreview(found);
    } catch {
      // The setter says why when the owner presses Set; the preview stays quiet.
    }
  }

  function pick(dates: QuickDates) {
    setFrom(dates.from);
    setTo(dates.to);
    void look(dates.from, dates.to);
  }

  async function set(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setCopied(null);
    try {
      setShown(await client.request('venture.away.set', { from, to }));
      setPreview(null);
    } catch (error) {
      setProblem(t('business.away.failed', { message: refusalWords(error, t) }));
    } finally {
      setBusy(false);
    }
  }

  // C4 task 40 (C5 asks for it): the owner clears the days at once; the engine ends Away and keeps when.
  async function clear() {
    setBusy(true);
    setProblem(null);
    setCopied(null);
    try {
      setShown(await client.request('venture.away.set', { clear: true }));
    } catch (error) {
      setProblem(t('business.away.failed', { message: refusalWords(error, t) }));
    } finally {
      setBusy(false);
    }
  }

  async function copy(text: string) {
    try {
      if (!navigator.clipboard) throw new Error('no clipboard');
      await navigator.clipboard.writeText(text);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  }

  if (away.error && !view) return <p className={s.problem} role="alert">{t('business.failed', { message: away.error.message })}</p>;
  if (!view) return <LoadingPlace shape="settings" />;
  return (
    <div className={s.page}>
      <p className={s.lead}>{view.line}</p>
      <TileSection title={t('business.away.when')}>
        <form className={a.form} onSubmit={(event) => void set(event)}>
          <div className={a.quick} role="group" aria-label={t('business.away.quick')}>
            {quickDates(today()).map((dates) => (
              <button key={dates.id} type="button" className={a.chip} aria-pressed={from === dates.from && to === dates.to} disabled={busy} onClick={() => pick(dates)}>{t(`business.away.quick.${dates.id}`)}</button>
            ))}
          </div>
          <div className={a.days}>
            <Field label={t('business.away.from')} type="date" value={from} disabled={busy} required onChange={(event) => { const next = event.currentTarget.value; setFrom(next); void look(next, to); }} />
            <Field label={t('business.away.to')} type="date" value={to} disabled={busy} required onChange={(event) => { const next = event.currentTarget.value; setTo(next); void look(from, next); }} />
          </div>
          {preview && preview.from === from && preview.to === to && (
            <section aria-label={t('business.away.preview')}>
              {preview.items.length === 0 ? <p className={s.line}>{t('business.away.noneDue')}</p> : (
                <ul className={a.list}>
                  {preview.items.map((item, i) => (
                    <li key={`${item.due}:${i}`} className={a.item}>
                      <span className={a.when}>{dayOf(item.due, zone)}</span>
                      <span>{item.line}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <div className={a.acts}>
            {view.away && <Button disabled={busy} onClick={() => void clear()}>{t('business.away.clear')}</Button>}
            <Button type="submit" variant="primary" disabled={busy} disabledReason={!from || !to ? t('business.away.pickBoth') : undefined}>{t('business.away.set')}</Button>
          </div>
          {problem && <p className={s.problem} role="status">{problem}</p>}
        </form>
      </TileSection>
      {view.away && (
        <TileSection title={t('business.away.due')}>
          {view.promises.length === 0 ? <p className={s.line}>{t('business.away.noneDue')}</p> : (
            <ul className={a.list}>
              {view.promises.map((promise, i) => (
                <li key={`${promise.due}:${i}`} className={a.item}>
                  <span className={a.when}>{dayOf(promise.due, zone)}</span>
                  <span>{promise.line}</span>
                </li>
              ))}
            </ul>
          )}
        </TileSection>
      )}
      {view.keepsRunning.length > 0 && (
        <TileSection title={t('business.away.running')}>
          {/* The engine's rule while away, in the screen's words: nothing new starts on its own; routines wait on Today. */}
          <p className={s.line}>{t('business.away.rule')}</p>
          <ul className={a.list}>{view.keepsRunning.map((line, i) => <li key={i} className={a.item}>{line}</li>)}</ul>
        </TileSection>
      )}
      {view.autoReply && (
        <TileSection title={t('business.away.reply')}>
          <p className={s.line}>{t('business.away.replyLine')}</p>
          {/* The reply is for the owner's own mail app: its words are quoted content, never a message Chausar sends. */}
          <p className={a.reply} data-content="">{view.autoReply}</p>
          <div className={a.acts}>
            <Button onClick={() => void copy(view.autoReply!)}>{t('business.copy')}</Button>
          </div>
          {copied && <p className={copied === 'yes' ? s.line : s.problem} role="status">{t(copied === 'yes' ? 'business.away.copied' : 'business.away.copyFailed')}</p>}
        </TileSection>
      )}
    </div>
  );
}
