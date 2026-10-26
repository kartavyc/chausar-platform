import { useT } from '../text';
import type { EngineStatus, Transport } from '../engine/types';
import { Icon } from './Icon';
import type { IconName } from './icons';
import s from './StatusLine.module.css';

/** The icon beside each problem's words: a failure, a wait for pairing, a wait for the engine. */
const ICONS: Readonly<Record<Exclude<EngineStatus['state'], 'ok'>, IconName>> = {
  offline: 'triangle-alert',
  'session-ended': 'triangle-alert',
  error: 'triangle-alert',
  unpaired: 'lock',
  starting: 'clock',
};

/** One thin line at the top when something is wrong with the engine or the session, on the failed or waiting
 *  ground with an icon beside the words. Nothing when all is well, except on the fake engine, which always says its
 *  data is a sample, quietly. */
export function StatusLine({ status, transport }: { status: EngineStatus; transport: Transport }) {
  const t = useT();
  if (status.state === 'ok') {
    return transport === 'fake' ? <div className={s.line} data-state="fake" role="status">{t('status.fake')}</div> : null;
  }
  const words =
    status.state === 'offline' ? t('status.offline')
      : status.state === 'session-ended' ? t('status.sessionEnded')
        : status.state === 'unpaired' ? t('status.unpaired')
          : status.state === 'starting' ? t('status.starting')
            : t('status.error', { message: status.message });
  const urgent = status.state !== 'starting';
  return (
    <div className={s.line} data-state={status.state} role={urgent ? 'alert' : 'status'}>
      <Icon name={ICONS[status.state]} size={14} />
      {words}
    </div>
  );
}
