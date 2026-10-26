import { useId } from 'react';
import { useT } from '../../text';
import { useResource } from '../../engine/context';
import { ProgressBar } from '../../parts/ProgressBar';
import { Tile, TileHead } from '../../parts/Tile';
import s from './Onboarding.module.css';

/**
 * "Resume setup" (catalogue U18): when the open business's setup is not finished, a quiet tile with how far it is
 * (`venture.get` done and total, the engine's own counts) and a link to its setup rows on Today. Nothing
 * shows on the first run (no business is open) or once setup is done. The names of the steps left wait for W4 4J8.
 */
export function ResumeSetup() {
  const t = useT();
  const titleId = useId();
  const venture = useResource('venture.get', {}, { refreshOn: (event) => event.type === 'queue.changed' });
  const view = venture.data;
  if (!view || view.total <= 0 || view.done >= view.total) return null;
  return (
    <Tile as="section" labelledBy={titleId} pad="compact" className={s.resume}>
      <TileHead
        id={titleId}
        title={t('onboarding.resume.title', { name: view.venture.workingName })}
        more={{ href: '#/today?show=setup', label: t('onboarding.resume.go') }}
      />
      <ProgressBar progress={{ done: view.done, total: view.total }} />
    </Tile>
  );
}
