import { useResource } from '../engine/context';
import { Icon } from '../parts/Icon';
import s from './StorageNotice.module.css';

/**
 * One line under a place's header while the owner has paused the open business (W4 4F3; Pause all in the business
 * menu): the engine's own line from venture.get ("Paused by you. No new work starts until you unpause."). Nothing
 * while it is not paused, until venture.get answers, or when it fails. Shown on Today and Work.
 */
export function PausedNote() {
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const paused = venture.data?.paused;
  if (!paused) return null;
  return (
    <p className={s.notice} role="note" data-paused="">
      <Icon name="clock" size={16} className={s.icon} />
      <span>{paused.line}</span>
    </p>
  );
}
