import { useT } from '../text';
import s from './Gate.module.css';

export interface GateProps {
  purpose: string;
  gate: 'auto' | 'hold';
  /** An always-ask step (money out, sending to a client or the public, deleting, prices, government portals). */
  floor: boolean;
  onChange?: ((gate: 'auto' | 'hold') => void) | undefined;
  disabled?: boolean | undefined;
}

/** A step's gate: auto runs without asking, hold waits for the owner. A floor step always asks and has no switch. */
export function Gate({ purpose, gate, floor, onChange, disabled }: GateProps) {
  const t = useT();
  if (floor) return <span className={s.floor}>{t('gate.floor')}</span>;
  const auto = gate === 'auto';
  return (
    <button
      type="button"
      role="switch"
      aria-checked={auto}
      aria-label={t('gate.label', { step: purpose })}
      className={s.gate}
      data-gate={gate}
      disabled={disabled}
      onClick={() => onChange?.(auto ? 'hold' : 'auto')}
    >
      <span className={s.track} aria-hidden="true"><span className={s.knob} /></span>
      <span className={s.word}>{auto ? t('gate.auto') : t('gate.hold')}</span>
    </button>
  );
}
