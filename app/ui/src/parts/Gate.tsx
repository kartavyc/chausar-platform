import { useT } from '../text';
import { Icon } from './Icon';
import s from './Gate.module.css';

export interface GateProps {
  purpose: string;
  gate: 'auto' | 'hold';
  /** An always-ask step (money out, sending to a client or the public, deleting, prices, government portals). */
  floor: boolean;
  onChange?: ((gate: 'auto' | 'hold') => void) | undefined;
  disabled?: boolean | undefined;
}

const VALUES = ['auto', 'hold'] as const;

/**
 * A step's gate, D's `.gate`: both words, Auto and Hold, with the one in force filled. Auto runs without asking, Hold
 * waits for the owner. It is one switch: the words are drawn for the eye, and the switch's name (which holds both
 * words) and checked state say the same to a screen reader. People click the word they want, so a click on the word
 * already in force changes nothing and a click on the other word sets it; Space, Enter or a click elsewhere on the
 * switch toggles it. A floor step always asks: D's `.floor`, a lock and "Always asks you", with no switch.
 */
export function Gate({ purpose, gate, floor, onChange, disabled }: GateProps) {
  const t = useT();
  if (floor) {
    return (
      <span className={s.floor}>
        <Icon name="lock" size={14} />
        {t('gate.floor')}
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
      onClick={(event) => {
        const word = (event.target as Element).closest?.('[data-value]')?.getAttribute('data-value');
        const next = word === 'auto' || word === 'hold' ? word : auto ? 'hold' : 'auto';
        if (next !== gate) onChange?.(next);
      }}
    >
      {VALUES.map((value) => (
        <span key={value} className={s.option} data-value={value} data-on={value === gate ? '' : undefined} aria-hidden="true">
          {t(`gate.${value}`)}
        </span>
      ))}
    </button>
  );
}
