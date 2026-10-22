import { useId, useState, type ReactNode } from 'react';
import { useT } from '../text';
import s from './Provenance.module.css';

/**
 * An evidence-backed value: a dotted underline, and its source on hover and on keyboard focus. Esc hides the source
 * without moving focus.
 */
export function Provenance({ source, children }: { source: string; children: ReactNode }) {
  const t = useT();
  const tipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const open = (hovered || focused) && !dismissed;
  return (
    <span
      className={s.value}
      tabIndex={0}
      aria-describedby={tipId}
      onMouseEnter={() => { setHovered(true); setDismissed(false); }}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => { setFocused(true); setDismissed(false); }}
      onBlur={() => setFocused(false)}
      onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); setDismissed(true); } }}
    >
      <span className={s.text}>{children}</span>
      <span id={tipId} role="tooltip" className={s.tip} hidden={!open}>{t('provenance.source', { source })}</span>
    </span>
  );
}
