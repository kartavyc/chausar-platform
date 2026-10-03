/**
 * Label: a fixed word in small capitals in the number face (main design, part 7).
 * Known facts, guesses, what-ifs, projections and stale answers each carry their own.
 * A figure's own labels are the seven canonical qualifications; a screen may also label
 * a statement with one of the broader words.
 */

import type { StatementLabel } from '../app/presentation.ts';
import { useT } from '../app/text';
import s from './Label.module.css';

export interface LabelProps {
  kind: StatementLabel;
  className?: string | undefined;
}

export function Label({ kind, className }: LabelProps) {
  const t = useT();
  const tone = kind === 'guess' || kind === 'stale' || kind === 'late' ? s.amber : '';
  return <span className={[s.label, tone, className].filter(Boolean).join(' ')}>{t(`LABEL.${kind}`)}</span>;
}
