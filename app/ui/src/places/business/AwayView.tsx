import { useState, type FormEvent } from 'react';
import { useLanguage, useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { refusalWords } from '../../parts/custody';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { AwayView as Away } from '../../engine/types';
import { TileSection, dayOf } from './shared';
import s from './Business.module.css';
import a from './AwayView.module.css';

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
  const language = useLanguage();
  const away = useResource('venture.away.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const [shown, setShown] = useState<Away | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const view = shown ?? away.data;

  async function set(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setProblem(null);
    setCopied(null);
    try {
      setShown(await client.request('venture.away.set', { from, to }));
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
  if (!view) return <p className={s.note}>{t('business.loading')}</p>;
  return (
    <div className={s.page}>
      <p className={s.lead}>{view.line}</p>
      <TileSection title={t('business.away.when')}>
        <form className={a.form} onSubmit={(event) => void set(event)}>
          <div className={a.days}>
            <Field label={t('business.away.from')} type="date" value={from} disabled={busy} required onChange={(event) => setFrom(event.currentTarget.value)} />
            <Field label={t('business.away.to')} type="date" value={to} disabled={busy} required onChange={(event) => setTo(event.currentTarget.value)} />
          </div>
          <div className={a.acts}>
            <Button type="submit" variant="primary" disabled={busy || !from || !to}>{t('business.away.set')}</Button>
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
                  <span className={a.when}>{dayOf(promise.due, language)}</span>
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
