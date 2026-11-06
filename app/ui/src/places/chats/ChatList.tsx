/**
 * "Your chats" (D-Chats `.cv-list`): New chat, a search box that filters the titles shown here (it asks the engine
 * nothing), then the engine's groups in its order (Pinned first, then Today, This week, Last week, Earlier), each
 * worded here from its key. A chat's title is the owner's own first question, so it is quoted words; its last line is
 * the engine's, with each amount it states a Figure with its receipt (ChiefThreadSummary.amounts), so the line sits
 * outside the chat's link (a receipt is a button of its own) and the link covers the row. The time is the clock time
 * for today, the weekday this week, the date before that.
 */

import { useId, useState, type ReactNode } from 'react';
import { useLanguage, useT, type Language } from '../../text';
import type { Resource } from '../../engine/context';
import type { ChiefLineAmount, ChiefThreadSummary, ChiefThreadsView } from '../../engine/types';
import { useClock } from '../../shell/clock';
import { Button } from '../../parts/Button';
import { Figure } from '../../parts/Figure';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import s from './Chats.module.css';

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };
const DAY_MS = 24 * 60 * 60 * 1000;

/** The day of a moment on this computer's calendar, as 2026-10-23. */
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

/** When a chat last moved, as the list writes it: 18:42 today, the weekday within six days, else the date. */
function whenOf(at: string, now: Date, language: Language): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  const locale = LOCALE[language];
  if (dayKey(date) === dayKey(now)) return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  if (now.getTime() - date.getTime() < 6 * DAY_MS) return new Intl.DateTimeFormat(locale, { weekday: 'short' }).format(date);
  return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short' }).format(date);
}

export interface ChatListProps {
  threads: Resource<ChiefThreadsView>;
  /** The chat open beside the list. */
  selected: string | undefined;
  onNew: () => void;
}

export function ChatList({ threads, selected, onNew }: ChatListProps) {
  const t = useT();
  const language = useLanguage();
  const clock = useClock();
  const titleId = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const groups = threads.data?.groups ?? [];
  const needle = query.trim().toLocaleLowerCase();
  const shown = groups
    .map((group) => ({ ...group, threads: needle ? group.threads.filter((thread) => thread.title.toLocaleLowerCase().includes(needle)) : group.threads }))
    .filter((group) => group.threads.length > 0);
  const now = clock();

  return (
    <nav className={s.list} aria-labelledby={titleId}>
      <div className={s.listHead}>
        <h2 id={titleId} className={s.listTitle}>{t('chats.list.title')}</h2>
        <Button variant="ink" size="sm" onClick={onNew}>
          <Icon name="plus" size={16} />
          {t('chats.list.new')}
        </Button>
      </div>
      <div className={s.search}>
        <Icon name="search" size={16} />
        <label className="sr-only" htmlFor={searchId}>{t('chats.list.search')}</label>
        <input id={searchId} className={s.searchInput} type="search" value={query} placeholder={t('chats.list.search')} autoComplete="off" onChange={(event) => setQuery(event.target.value)} />
      </div>
      <div className={s.groups}>
        {threads.error && !threads.data && <p className={s.problem} role="alert">{t('chats.failed', { message: threads.error.message })}</p>}
        {threads.data && groups.length === 0 && <p className={s.quiet}>{t('chats.list.none')}</p>}
        {needle !== '' && groups.length > 0 && shown.length === 0 && <p className={s.quiet}>{t('chats.list.noMatch')}</p>}
        {shown.map((group) => (
          <Group key={group.key} label={t(`chats.group.${group.key}`)} threads={group.threads} selected={selected} now={now} language={language} />
        ))}
      </div>
    </nav>
  );
}

function Group({ label, threads, selected, now, language }: { label: string; threads: readonly ChiefThreadSummary[]; selected: string | undefined; now: Date; language: Language }) {
  const t = useT();
  const headingId = useId();
  return (
    <section className={s.group} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.groupTitle}>{label}</h3>
      <ul className={s.threads}>
        {threads.map((thread) => {
          const here = thread.id === selected;
          return (
            <li key={thread.id} className={cx(s.chat, here && s.on)}>
              <span className={s.chatMark} aria-hidden="true"><Icon name="messages-square" size={16} /></span>
              <span className={s.chatText}>
                <a className={s.chatLink} href={`#/chats?thread=${encodeURIComponent(thread.id)}`} aria-current={here ? 'page' : undefined}>
                  <span className={s.chatTitle} data-content="">{thread.title}</span>
                  {thread.unread > 0 && <span className="sr-only">{t('chats.list.unread')}</span>}
                </a>
                {thread.lastLine && <span className={s.chatLine} data-last-line="">{withAmounts(thread.lastLine, thread.amounts)}</span>}
              </span>
              <span className={s.chatSide}>
                <time className={cx(s.chatTime, 'mono')} dateTime={thread.lastAt}>{whenOf(thread.lastAt, now, language)}</time>
                {thread.unread > 0 && <span className={s.unread} aria-hidden="true" />}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * The engine's line with each amount it names as a Figure with its receipt, cut at the offsets the engine sends, and
 * only where the words there are the amount's own (an offset that does not match is skipped).
 */
function withAmounts(line: string, amounts: readonly ChiefLineAmount[]) {
  const out: ReactNode[] = [];
  let at = 0;
  for (const amount of [...amounts].sort((a, b) => a.start - b.start)) {
    if (amount.start < at || line.slice(amount.start, amount.start + amount.length) !== amount.text) continue;
    if (amount.start > at) out.push(line.slice(at, amount.start));
    out.push(<Figure key={amount.start} value={amount.text} receiptId={amount.receiptId} />);
    at = amount.start + amount.length;
  }
  if (at < line.length) out.push(line.slice(at));
  return out;
}
