/**
 * W6 6H3 (D40): the page tool that opens the Arrange sheet for this place. An icon with its name for screen readers and
 * as a tip, so it adds no words to the page at rest.
 */

import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import type { LayoutPlace } from '../../engine/types';
import { Icon } from '../Icon';
import s from './Layout.module.css';

export function ArrangeButton({ place }: { place: LayoutPlace }) {
  const t = useT();
  return (
    <button type="button" className={s.tool} aria-label={t('layout.arrange')} title={t('layout.arrange')} onClick={(event) => openSheet('layout', place, event.currentTarget)}>
      <Icon name="sliders-horizontal" size={18} />
    </button>
  );
}
