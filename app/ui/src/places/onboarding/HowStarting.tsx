import { useId } from 'react';
import { useT } from '../../text';
import { cx } from '../../parts/cx';
import { Icon } from '../../parts/Icon';
import type { IconName } from '../../parts/icons';
import { Tile, TileHead } from '../../parts/Tile';
import s from './Onboarding.module.css';

/**
 * "How starting works" (D-Start's `.how`, `.hsteps`, `.hstep`): three numbered steps as icons and words. D drew a
 * miniature card in each step with made-up counts; Ink draws an icon instead, so no figure appears that the engine
 * did not send. The first step says "Describe or pick" only when there is a gallery to pick from.
 */
export function HowStarting({ picking }: { picking: boolean }) {
  const t = useT();
  const titleId = useId();
  const steps: { key: string; icon: IconName }[] = [
    { key: picking ? 'pick' : 'describe', icon: 'file-pen' },
    { key: 'plan', icon: 'file-text' },
    { key: 'approve', icon: 'check' },
  ];
  return (
    <Tile as="section" labelledBy={titleId}>
      <TileHead id={titleId} title={t('onboarding.how.title')} />
      <ol className={s.howSteps}>
        {steps.map((step, index) => (
          <li key={step.key} className={s.howStep}>
            <span className={s.howMark} aria-hidden="true">
              <span className={cx(s.howNumber, 'mono')}>{index + 1}</span>
              <span className={s.howIcon}><Icon name={step.icon} size={20} /></span>
            </span>
            <h3 className={s.howTitle}>{t(`onboarding.how.${step.key}.title`)}</h3>
            <p className={s.howLine}>{t(`onboarding.how.${step.key}.line`)}</p>
          </li>
        ))}
      </ol>
    </Tile>
  );
}
