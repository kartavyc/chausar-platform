/**
 * "Your chats" (D-Chats `.cv-list`): New chat, a search box (from two characters it asks venture.find, which reads the
 * titles and what was said, and shows the matching line in place of the last one; while the answer loads, the titles
 * here are filtered in the browser), then the engine's groups in its order (Pinned first, then Today, This week, Last week, Earlier), each
 * worded here from its key. A chat's title is the owner's own first question, so it is quoted words; its last line is
 * the engine's, with each amount it states a Figure with its receipt (ChiefThreadSummary.amounts), so the line sits
 * outside the chat's link (a receipt is a button of its own) and the link covers the row. The time is the clock time
 * for today, the weekday this week, the date before that. W6 6G1: Snoozed comes last, each with when it comes back;
 * settled chats are not listed; a quiet link beside the title says how many and opens Settled chats.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useResource, type Resource } from '../../engine/context';
import type { ChiefThreadSummary, ChiefThreadsView, FindItem, VentureRunEvent } from '../../engine/types';
import { wordsOf } from '../../../../../platform/runtime/venture/views/find-core';
import { FIND_WAIT_MS, useResting } from '../../shell/find/useFind';
import { useClock, useOwnerZone } from '../../shell/clock';
import { dayKeyIn, formatDay, formatTime, weekdayIn } from '../../../../../platform/runtime/owner-format';
import { Button } from '../../parts/Button';
import { LineWithAmounts } from '../../parts/LineWithAmounts';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import s from './Chats.module.css';

const DAY_MS = 24 * 60 * 60 * 1000;
/** As many chats as a find may answer. */
const FOUND_CHATS = 20;
const FIND_EVENTS = (event: VentureRunEvent) => event.type === 'chief.message' || event.type === 'queue.changed';
type FoundChat = Extract<FindItem, { kind: 'chat' }>;

/** When a chat last moved, in the owner's zone: 6:42 pm today, the weekday within six days, else the date (B2). */
function whenOf(at: string, now: Date, zone: string): string {
  const date = new Date(at);
  if (Number.isNaN(date.getTime())) return '';
  if (dayKeyIn(date, zone) === dayKeyIn(now, zone)) return formatTime(date, zone);
  if (now.getTime() - date.getTime() < 6 * DAY_MS) return weekdayIn(date, zone);
  return formatDay(date, zone, 'short');
}

export interface ChatListProps {
  threads: Resource<ChiefThreadsView>;
  /** The chat open beside the list. */
  selected: string | undefined;
  onNew: () => void;
}

export function ChatList({ threads, selected, onNew }: ChatListProps) {
  const t = useT();
  const zone = useOwnerZone();
  const clock = useClock();
  const titleId = useId();
  const searchId = useId();
  const [query, setQuery] = useState('');
  const groups = threads.data?.groups ?? [];
  const settled = threads.data?.settled.length ?? 0;
  const needle = query.trim().toLocaleLowerCase();
  const rested = useResting(query, FIND_WAIT_MS);
  const asking = rested === query && wordsOf(rested).length > 0;
  const find = useResource('venture.find', { text: rested, kinds: ['chat'], limit: FOUND_CHATS }, { skip: wordsOf(rested).length === 0, refreshOn: FIND_EVENTS });
  // The engine's answer once it is for these words; until then, or if it fails, the titles filter here.
  const found = asking && !find.loading && !find.error && find.data
    ? new Map((find.data.groups[0]?.items ?? []).map((item) => [item.id, item as FoundChat]))
    : null;
  const shown = groups
    .map((group) => ({
      ...group,
      threads: found ? group.threads.filter((thread) => found.has(thread.id)) : needle ? group.threads.filter((thread) => thread.title.toLocaleLowerCase().includes(needle)) : group.threads,
    }))
    .filter((group) => group.threads.length > 0);
  const oldFound = found ? [...found.values()].filter((chat) => chat.state === 'settled').length : 0;
  const now = clock();

  return (
    <nav className={s.list} aria-labelledby={titleId}>
      <div className={s.listHead}>
        <h2 id={titleId} className={s.listTitle}>{t('chats.list.title')}</h2>
        {/* 6G1: settled chats leave the list for Settled chats in the business pages (D42: the archive lives in Settings). */}
        {settled > 0 && needle === '' && (
          <a className={s.settledLink} href="#/business/chats" aria-label={t('chats.list.settled', { count: settled })} title={t('chats.list.settled', { count: settled })}>
            <Icon name="history" size={16} />
          </a>
        )}
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
        {threads.data && groups.length === 0 && settled === 0 && <p className={s.quiet}>{t('chats.list.none')}</p>}
        {needle !== '' && (groups.length > 0 || settled > 0) && shown.length === 0 && oldFound === 0 && <p className={s.quiet}>{t('chats.list.noMatch')}</p>}
        {oldFound > 0 && <a className={s.quiet} href="#/business/chats">{t('chats.list.oldFound', { count: oldFound })}</a>}
        {shown.map((group) => (
          <Group key={group.key} label={t(`chats.group.${group.key}`)} threads={group.threads} selected={selected} now={now} zone={zone} snoozed={group.key === 'snoozed'} found={found} />
        ))}
      </div>
    </nav>
  );
}

/** snoozed (6G1): the Snoozed group shows when each chat comes back instead of when it last moved. */
function Group({ label, threads, selected, now, zone, snoozed, found }: { label: string; threads: readonly ChiefThreadSummary[]; selected: string | undefined; now: Date; zone: string; snoozed: boolean; found: ReadonlyMap<string, FoundChat> | null }) {
  const t = useT();
  const headingId = useId();
  return (
    <section className={s.group} aria-labelledby={headingId}>
      <h3 id={headingId} className={s.groupTitle}>{label}</h3>
      <ul className={s.threads}>
        {threads.map((thread) => {
          const here = thread.id === selected;
          // A chat found by what was said shows that line in place of its last one.
          const snippet = found?.get(thread.id)?.snippet ?? null;
          const line = snippet?.line ?? thread.lastLine;
          const amounts = snippet?.amounts ?? thread.amounts;
          return (
            <li key={thread.id} className={cx(s.chat, here && s.on)}>
              <span className={s.chatMark} aria-hidden="true"><Icon name="messages-square" size={16} /></span>
              <span className={s.chatText}>
                <a className={s.chatLink} href={`#/chats?thread=${encodeURIComponent(thread.id)}`} aria-current={here ? 'page' : undefined}>
                  <span className={s.chatTitle} data-content="">{thread.title}</span>
                  {thread.unread > 0 && <span className="sr-only">{t('chats.list.unread')}</span>}
                </a>
                {line && <span className={s.chatLine} data-last-line=""><LineWithAmounts line={line} amounts={amounts} /></span>}
              </span>
              <span className={s.chatSide}>
                {snoozed && thread.snoozedUntil ? (
                  <span className={s.chatTime}>
                    <span className="sr-only">{t('chats.list.wakes')} </span>
                    <time dateTime={thread.snoozedUntil}>{whenOf(thread.snoozedUntil, now, zone)}</time>
                  </span>
                ) : (
                  <time className={s.chatTime} dateTime={thread.lastAt}>{whenOf(thread.lastAt, now, zone)}</time>
                )}
                {thread.unread > 0 && <span className={s.unread} aria-hidden="true" />}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
