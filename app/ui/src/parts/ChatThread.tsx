import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { useLanguage, useT, type Language, type T } from '../text';
import { Avatar, ChausarAvatar, type DeptId } from './Avatar';
import { cx } from './cx';
import { Icon } from './Icon';
import { ModelEstimate } from './ModelEstimate';
import { rich } from './rich';
import s from './ChatThread.module.css';

/** One thing in a thread, oldest first. `at` is the engine's ISO time; the part writes the day and the time. */
export type ThreadEntry =
  | { kind: 'owner'; id: string; at: string; text: string }
  /** The agent's words. `estimate` when they carry a model-written figure with no receipt (spec 5.4). */
  | {
    kind: 'agent'; id: string; at: string; text: string; estimate?: boolean | undefined;
    /** W4 4B3: the message drawn from its typed parts (words, a figure with its receipt, a model estimate) in place of
     *  `text`; the caller marks quoted words `data-content` itself. */
    body?: ReactNode;
  }
  /** A run, folded to one row (spec 5.2). Its tick rows (`steps`, the Steps part) open from the row. */
  | {
    kind: 'run'; id: string; at: string; title: string; state: 'done' | 'failed' | 'active' | 'waiting';
    done: number; total?: number | 'indeterminate' | undefined; duration?: string | undefined; steps?: ReactNode;
  }
  /** Anything the caller draws on the agent's side: a DiffCard, a preview, a run card with Run again. */
  | { kind: 'card'; id: string; at: string; node: ReactNode };

export interface ChatThreadProps {
  /** Who the owner is talking to: an agent, or Chausar itself as chief of staff (`chausar`). */
  agent: { name: string; dept?: DeptId | undefined; chausar?: boolean | undefined };
  entries: readonly ThreadEntry[];
  /**
   * W4 4B3: earlier pages the owner asked for ("Show earlier messages"), drawn before `entries` in a part of the log
   * that is not read out, so loading them never re-announces old messages.
   */
  older?: readonly ThreadEntry[] | undefined;
  /** "Today" and "Yesterday" are worked out from this; left out, now. */
  now?: Date | undefined;
  /** Left out, the computer's own zone. */
  timeZone?: string | undefined;
  className?: string | undefined;
}

const LOCALE: Record<Language, string> = { en: 'en-IN', hi: 'hi-IN' };
const DAY_MS = 24 * 60 * 60 * 1000;
/** How close to the bottom, in px, still counts as reading the newest messages. */
const NEAR_BOTTOM = 64;

/** The calendar day of a moment in the zone, as 2026-10-23, so two moments can be compared as days. */
function dayKey(date: Date, timeZone: string | undefined): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

type Block =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'owner'; entry: Extract<ThreadEntry, { kind: 'owner' }> }
  | { kind: 'agent'; key: string; entries: Exclude<ThreadEntry, { kind: 'owner' }>[] };

/** Day separators, then each owner message alone and each run of agent-side entries under one avatar. */
function blocksOf(entries: readonly ThreadEntry[], t: T, language: Language, now: Date, timeZone: string | undefined): Block[] {
  const today = dayKey(now, timeZone);
  const yesterday = dayKey(new Date(now.getTime() - DAY_MS), timeZone);
  const dayFormat = new Intl.DateTimeFormat(LOCALE[language], { timeZone, day: 'numeric', month: 'short' });
  const blocks: Block[] = [];
  let lastDay = '';
  for (const entry of entries) {
    const date = new Date(entry.at);
    const key = Number.isNaN(date.getTime()) ? lastDay : dayKey(date, timeZone);
    if (key !== lastDay) {
      const label = key === today ? t('thread.today') : key === yesterday ? t('thread.yesterday') : dayFormat.format(date);
      blocks.push({ kind: 'day', key, label });
      lastDay = key;
    }
    const previous = blocks[blocks.length - 1];
    if (entry.kind === 'owner') blocks.push({ kind: 'owner', entry });
    else if (previous?.kind === 'agent') previous.entries.push(entry);
    else blocks.push({ kind: 'agent', key: entry.id, entries: [entry] });
  }
  return blocks;
}

/**
 * A conversation with one agent, or with Chausar (D's `.cp-body`, `.mine`, `.bub`, `.from`, `.fold`, `.day`): the
 * owner's messages on the right on the selected ground, the agent's on the left under its avatar, each with its
 * time in DM Mono, runs folded to one row that opens their steps, and anything else the caller draws (a DiffCard,
 * a preview) in line. It is a polite live log, so a new message is read out without moving focus. When a new entry
 * arrives it follows it only if the owner was already at the bottom; someone reading older messages stays put.
 * Each message sets its own direction (`dir="auto"`), so a reply in a right-to-left script reads right.
 */
export function ChatThread({ agent, entries, older, now, timeZone, className }: ChatThreadProps) {
  const t = useT();
  const language = useLanguage();
  const log = useRef<HTMLDivElement>(null);
  const timeFormat = new Intl.DateTimeFormat(LOCALE[language], { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const timeOf = (at: string) => {
    const date = new Date(at);
    return Number.isNaN(date.getTime()) ? null : <time className={cx(s.time, 'mono')} dateTime={at}>{timeFormat.format(date)}</time>;
  };
  const pinned = useRef(true);
  const onScroll = () => {
    const el = log.current;
    if (el) pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM;
  };
  const newest = entries[entries.length - 1]?.id;
  useEffect(() => {
    if (log.current && pinned.current) log.current.scrollTop = log.current.scrollHeight;
  }, [newest]);

  const blocks = blocksOf(entries, t, language, now ?? new Date(), timeZone);
  const olderBlocks = blocksOf(older ?? [], t, language, now ?? new Date(), timeZone);
  return (
    <div ref={log} className={cx(s.thread, className)} role="log" aria-live="polite" aria-label={t('thread.label', { name: agent.name })} onScroll={onScroll}>
      {blocks.length === 0 && olderBlocks.length === 0 && <p className={s.empty}>{t('thread.empty')}</p>}
      {olderBlocks.length > 0 && <div className={s.older} aria-live="off" data-older="">{olderBlocks.map(drawBlock)}</div>}
      {blocks.map(drawBlock)}
    </div>
  );

  function drawBlock(block: Block) {
    if (block.kind === 'day') return <p key={`day-${block.key}`} className={s.day} data-day="">{block.label}</p>;
    if (block.kind === 'owner') {
      return (
        <div key={block.entry.id} className={s.mine} data-from="owner">
          <span className="sr-only">{t('thread.fromYou')}</span>
          <p className={s.mineText} dir="auto" data-content="">{block.entry.text}</p>
          {timeOf(block.entry.at)}
        </div>
      );
    }
    return (
      <div key={block.key} className={s.from}>
        {agent.chausar ? <ChausarAvatar size={28} /> : <Avatar name={agent.name} dept={agent.dept} size={28} />}
        <div className={s.fromBody}>
          {block.entries.map((entry) => {
            if (entry.kind === 'agent') {
              const time = timeOf(entry.at);
              return (
                <div key={entry.id} className={s.theirs} data-from="agent">
                  <span className="sr-only">{t('thread.from', { name: agent.name })}</span>
                  {entry.body === undefined
                    ? <p className={s.bubble} dir="auto" data-content="">{entry.text}</p>
                    : <div className={s.bubble} dir="auto">{entry.body}</div>}
                  {(time || entry.estimate) && <p className={s.meta}>{time}{entry.estimate && <ModelEstimate />}</p>}
                </div>
              );
            }
            if (entry.kind === 'run') return <RunFold key={entry.id} run={entry} />;
            return <div key={entry.id} className={s.card}>{entry.node}</div>;
          })}
        </div>
      </div>
    );
  }
}

function RunFold({ run }: { run: Extract<ThreadEntry, { kind: 'run' }> }) {
  const t = useT();
  const id = useId();
  const [open, setOpen] = useState(false);
  const title = <b className={s.foldTitle}>{run.title}</b>;
  const words =
    run.state === 'failed' ? rich(t, 'thread.runFailed', {}, { title })
    : run.state === 'waiting' ? rich(t, 'thread.runWaiting', {}, { title })
    : run.state === 'done' ? rich(t, 'thread.runDone', { count: run.done }, { title })
    : run.total === undefined || run.total === 'indeterminate' ? rich(t, 'thread.runWorking', {}, { title })
    : rich(t, 'thread.runActive', { done: run.done, total: run.total }, { title });
  const mark = (
    <span className={s.tick} data-state={run.state} aria-hidden="true">
      {run.state === 'done' && <Icon name="check" size={12} />}
      {run.state === 'failed' && <Icon name="x" size={12} />}
    </span>
  );
  const body = (
    <>
      {mark}
      <span className={s.foldText}>{words}</span>
      {run.duration && <span className={cx(s.duration, 'mono')}>{run.duration}</span>}
    </>
  );
  if (run.steps === undefined || run.steps === null) {
    return <div className={s.fold} data-run={run.state}>{body}</div>;
  }
  return (
    <div className={s.foldWrap} data-run={run.state}>
      <button type="button" className={cx(s.fold, s.foldButton)} aria-expanded={open} aria-controls={id} onClick={() => setOpen((was) => !was)}>
        {body}
        <Icon name="chevron-down" size={16} className={s.chevron} />
      </button>
      {open && <div id={id} className={s.steps} role="group" aria-label={t('thread.steps', { title: run.title })}>{run.steps}</div>}
    </div>
  );
}
