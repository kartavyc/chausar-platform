import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useClock, useOwnerZone } from '../../shell/clock';
import { instantIn } from '../../parts/when';
import { dayKeyIn, dayKeyPlus } from '../../../../../platform/runtime/owner-format';
import { Button } from '../../parts/Button';
import s from './Chats.module.css';

/**
 * One-shot C4 task 8: "Pick a time" under the snooze presets. A day and a time on the owner's clock (the business's
 * zone, never the computer's) become the instant the engine takes as `until`; a time already past shows the engine's
 * own refusal in place.
 */
export function PickTime({ busy, onPick }: { busy: boolean; onPick: (until: string) => Promise<string | null> }) {
  const t = useT();
  const zone = useOwnerZone();
  const clock = useClock();
  const dayId = useId();
  const timeId = useId();
  const [open, setOpen] = useState(false);
  const [day, setDay] = useState(() => dayKeyPlus(dayKeyIn(clock(), zone), 1));
  const [time, setTime] = useState('09:00');
  const [problem, setProblem] = useState<string | null>(null);

  async function pick(event: FormEvent) {
    event.preventDefault();
    const at = instantIn(day, time, zone);
    if (!at) { setProblem(t('chats.snooze.pickBoth')); return; }
    setProblem(await onPick(at.toISOString()));
  }

  if (!open) return <Button size="sm" variant="quiet" disabled={busy} onClick={() => setOpen(true)}>{t('chats.snooze.pick')}</Button>;
  return (
    <form className={s.pickTime} onSubmit={(event) => void pick(event)} aria-label={t('chats.snooze.pick')}>
      <label htmlFor={dayId}>{t('chats.snooze.day')}</label>
      <input id={dayId} type="date" value={day} onChange={(event) => { setDay(event.target.value); setProblem(null); }} />
      <label htmlFor={timeId}>{t('chats.snooze.time')}</label>
      <input id={timeId} type="time" value={time} onChange={(event) => { setTime(event.target.value); setProblem(null); }} />
      <Button size="sm" type="submit" disabled={busy}>{t('chats.thread.snooze')}</Button>
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </form>
  );
}
