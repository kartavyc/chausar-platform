import type { ReactNode } from 'react';
import { useT, type T } from '../text';
import { Avatar, type AvatarState, type DeptId } from './Avatar';
import { cx } from './cx';
import { Icon } from './Icon';
import s from './StoriesRow.module.css';

/** One agent in the stories row: who it is, what its run is doing, and its step count when the run has one. */
export interface Story {
  id: string;
  name: string;
  /** From the agent's latest run: working (active), waiting (waits on the owner), failed, or idle. */
  state: AvatarState;
  /** The run's measured steps. A count is said as "3 of 5"; without one a working agent just says "Working". */
  progress?: { done: number; total: number } | 'indeterminate' | undefined;
  /** The department, when the engine sends one (W4 4A). Left out, no tint and no badge. */
  dept?: DeptId | undefined;
}

export interface StoriesRowProps {
  stories: readonly Story[];
  onOpen: (id: string) => void;
  /** The first story, before the agents (Chausar itself, W4 4C). Rendered only when given. */
  lead?: ReactNode;
  /** Adds the last item, "Add agent" (W4 4A). Rendered only when given. */
  onAdd?: (() => void) | undefined;
  /** The phone's horizontal row: one line that scrolls sideways and runs off the right edge. */
  scroll?: boolean | undefined;
  /** The list's name; "Your agents" when left out. */
  label?: string | undefined;
  className?: string | undefined;
}

type Tone = 'wait' | 'working' | 'fail' | 'plain';

interface StatusWords {
  /** The words under the avatar. */
  word: string;
  /** The button's name: the agent and the same state, as a sentence. */
  name: string;
  tone: Tone;
  /** A step count, set in DM Mono. */
  count: boolean;
}

function statusOf(t: T, story: Story): StatusWords {
  const { name, progress } = story;
  switch (story.state) {
    case 'waiting':
      return { word: t('story.status.waiting'), name: t('story.name.waiting', { name }), tone: 'wait', count: false };
    case 'working':
      if (progress && progress !== 'indeterminate') {
        const values = { name, done: progress.done, total: progress.total };
        return { word: t('story.status.progress', values), name: t('story.name.progress', values), tone: 'working', count: true };
      }
      return { word: t('story.status.working'), name: t('story.name.working', { name }), tone: 'working', count: false };
    case 'failed':
      return { word: t('story.status.failed'), name: t('story.name.failed', { name }), tone: 'fail', count: false };
    default:
      return { word: t('story.status.idle'), name: t('story.name.idle', { name }), tone: 'plain', count: false };
  }
}

/**
 * The stories row (D's `ul.stories`): every agent as a 60 px avatar with its status ring and department badge, its
 * name, and its state in words under it (amber "Needs you", green "Working" or "3 of 5", red "Stopped", plain
 * "Idle"). Each story is a button that opens the agent; its name says the agent and the state in one sentence, since
 * the ring is hidden from screen readers. The caller sorts the stories.
 */
export function StoriesRow({ stories, onOpen, lead, onAdd, scroll = false, label, className }: StoriesRowProps) {
  const t = useT();
  return (
    <ul className={cx(s.stories, className)} aria-label={label ?? t('story.label')} data-scroll={scroll ? '' : undefined}>
      {lead !== undefined && lead !== null && <li className={s.item}>{lead}</li>}
      {stories.map((story) => {
        const status = statusOf(t, story);
        return (
          <li key={story.id} className={s.item}>
            <button type="button" className={s.story} aria-label={status.name} onClick={() => onOpen(story.id)}>
              <Avatar name={story.name} dept={story.dept} state={story.state} badge size={60} />
              <span className={s.name}>{story.name}</span>
              <span className={cx(s.status, status.count && 'mono')} data-tone={status.tone} data-count={status.count ? '' : undefined}>{status.word}</span>
            </button>
          </li>
        );
      })}
      {onAdd && (
        <li className={s.item}>
          <button type="button" className={s.story} onClick={onAdd}>
            <span className={s.add} aria-hidden="true"><Icon name="plus" size={20} /></span>
            <span className={s.name}>{t('story.add')}</span>
          </button>
        </li>
      )}
    </ul>
  );
}
