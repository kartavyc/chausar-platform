import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { stateText } from '../../parts/states';
import type { GuidanceLineView } from '../../engine/types';
import { TileSection } from './shared';
import s from './Business.module.css';

/**
 * The guidance report on Business > Practice (W4 4J22a, from 4J16's venture.playbook.guidance; catalogue Q18): every
 * guidance line of the playbook in use and the check that can see it. At rest, how many a check has measured, how many
 * have no result yet and how many no check sees; each line, in its own words with its state word, one step away. A read: it
 * changes nothing. A playbook with no guidance lines shows nothing.
 */
export function GuidanceReport() {
  const t = useT();
  const report = useResource('venture.playbook.guidance', {});
  const lines = report.data?.lines ?? [];
  if (lines.length === 0) return null;
  const count = (state: GuidanceLineView['state']) => lines.filter((line) => line.state === state).length;
  return (
    <TileSection title={t('business.practice.guidance')}>
      <p className={s.line} data-guidance-summary="">
        {t('business.practice.guidance.summary', { measured: count('measured'), dark: count('dark'), unmeasured: count('unmeasured') })}
      </p>
      <details className={s.fold} data-fold="guidance">
        <summary>{t('business.practice.guidance.each')}</summary>
        <ul className={s.log}>
          {lines.map((line, i) => (
            <li key={`${line.stepId}:${i}`}>
              {/* The check's own id is code, so the line says only its state word and the guidance itself. */}
              {t('business.practice.guidance.lineNoCheck', { word: stateText(t, 'guidance', line.state), text: line.text })}
            </li>
          ))}
        </ul>
      </details>
    </TileSection>
  );
}
