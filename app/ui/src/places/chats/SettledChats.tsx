/**
 * Business > Settled chats (#/business/chats), wave 6 package 6G1 (D42: the archive lives in Settings). The owner picks
 * how many quiet days before a chat settles on its own (Never is 0), and sees each settled chat with why it settled: by
 * them, or after the quiet days. Open reads it (every message and receipt kept); Reopen brings it back to the list.
 * Every change shows the engine's words with Undo. The list and the quiet days come from venture.chief.threads.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useDay } from '../../parts/when';
import { useEngine, useResource } from '../../engine/context';
import type { ChiefThreadStateInput, ChiefThreadSummary, VentureRunEvent } from '../../engine/types';
import { Button } from '../../parts/Button';
import { TileSection, messageOf } from '../business/shared';
import { ChangeNotice } from './ChangeNotice';
import s from './Chats.module.css';

/** The quiet-day choices; the owner's own number, when it is another, is offered too. */
const DAY_CHOICES = [3, 7, 14, 30] as const;
const LIST_EVENTS = (event: VentureRunEvent) => event.type === 'chief.message';

/** A change in the engine's words, and what Undo does. */
type Change = { line: string; undo: () => Promise<void> };

export function SettledChats() {
  const t = useT();
  const day = useDay('short');
  const engine = useEngine();
  const threads = useResource('venture.chief.threads', {}, { refreshOn: LIST_EVENTS });
  const daysId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [change, setChange] = useState<Change | null>(null);

  const settled = threads.data?.settled ?? [];
  const days = threads.data?.settleAfterDays ?? null;
  const choices = days === null || days === 0 || (DAY_CHOICES as readonly number[]).includes(days) ? [...DAY_CHOICES] : [...DAY_CHOICES, days].sort((a, b) => a - b);

  async function run(work: () => Promise<Change>) {
    setBusy(true);
    setProblem(null);
    try {
      setChange(await work());
      threads.reload();
    } catch (error) {
      setProblem(t('chats.change.failed', { message: messageOf(error) }));
    } finally {
      setBusy(false);
    }
  }

  /** Sets the chat's state; its Undo sends the request the engine returned, and that answer has its own Undo. */
  const stateChange = async (input: ChiefThreadStateInput): Promise<Change> => {
    const result = await engine.request('venture.chief.thread.state', input);
    return { line: result.line, undo: () => run(() => stateChange(result.undo)) };
  };
  const daysChange = async (next: number): Promise<Change> => {
    const result = await engine.request('venture.chief.settle.set', { days: next });
    return { line: result.line, undo: () => run(() => daysChange(result.undo)) };
  };

  const dateOf = (at: string) => day(at);
  const why = (thread: ChiefThreadSummary) => (thread.settled?.by === 'owner'
    ? t('chats.archive.byOwner', { date: dateOf(thread.settled.at) })
    : t('chats.archive.byQuiet', { date: dateOf(thread.settled?.at ?? ''), count: days ?? 0 }));

  return (
    <>
      <TileSection title={t('chats.archive.after')}>
        {days !== null && (
          <div className={s.choice}>
            <label className={s.choiceLabel} htmlFor={daysId}>{t('chats.archive.after')}</label>
            <select id={daysId} className={s.choiceSelect} value={String(days)} disabled={busy}
              onChange={(event) => { const next = Number(event.currentTarget.value); void run(() => daysChange(next)); }}>
              {choices.map((count) => <option key={count} value={String(count)}>{t('chats.archive.days', { count })}</option>)}
              <option value="0">{t('chats.archive.never')}</option>
            </select>
          </div>
        )}
        <p className={s.quiet}>{t('chats.archive.note')}</p>
      </TileSection>
      <TileSection title={t('chats.archive.list')}>
        {change && <ChangeNotice line={change.line} busy={busy} onUndo={() => void change.undo()} />}
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        {threads.error && !threads.data && <p className={s.problem} role="alert">{t('chats.failed', { message: threads.error.message })}</p>}
        {threads.data && settled.length === 0 && <p className={s.quiet}>{t('chats.archive.none')}</p>}
        {settled.length > 0 && (
          <ul className={s.archive} aria-label={t('chats.archive.list')}>
            {settled.map((thread) => (
              <li key={thread.id} className={s.archiveRow}>
                <span className={s.archiveText}>
                  <a className={s.archiveTitle} href={`#/chats?thread=${encodeURIComponent(thread.id)}`} data-content="">{thread.title}</a>
                  <span className={s.quiet}>{why(thread)}</span>
                </span>
                <Button size="sm" disabled={busy} onClick={() => void run(() => stateChange({ threadId: thread.id, state: 'active' }))}>{t('chats.archive.reopen')}</Button>
              </li>
            ))}
          </ul>
        )}
      </TileSection>
    </>
  );
}
