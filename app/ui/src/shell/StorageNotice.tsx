import { useT } from '../text';
import { useEngine, useResource } from '../engine/context';
import { Icon } from '../parts/Icon';
import s from './StorageNotice.module.css';

/**
 * One line under a place's header while the open business is kept in experimental storage (catalogue U14: the
 * notice Keep shows, now also on Today, Work and Money, where an owner might issue something real). It reads the
 * engine's own custody view and says nothing until that answers, or when it fails, or when the business is in Postgres.
 * Hosted has its own practice label. Desktop encrypted files are beta-grade, including the desktop fake.
 */
export function StorageNotice() {
  const t = useT();
  const transport = useEngine().transport;
  const experimentalHost = transport === 'web';
  // Storage changes with the business, so it is read again when the queue changes, as Keep does; not on every run event.
  const custody = useResource('workspace.custody.get', {}, { skip: !experimentalHost, refreshOn: (event) => event.type === 'queue.changed' });
  if (!experimentalHost || custody.data?.business?.storage !== 'experimental-file') return null;
  return (
    <p className={s.notice} role="note">
      <Icon name="triangle-alert" size={16} className={s.icon} />
      <span>{t('business.experimental')}</span>
    </p>
  );
}
