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

/**
 * A step's gate: auto runs without asking, hold waits for the owner. A floor step always asks and has no switch. Both
 * take the same width and padding, so a list of steps shows Auto, Hold and Always asks you in one column.
 */
export function Gate({ purpose, gate, floor, onChange, disabled }: GateProps) {
  const t = useT();
  // The floor's words sit in the same column as Auto and Hold: an empty space where the switch would be.
  if (floor) {
    return (
      <span className={s.floor}>
        <span className={s.space} aria-hidden="true" />
        <span className={s.word}>{t('gate.floor')}</span>
      </span>
    );
  }
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
