import { useT } from '../text';
import type { ConnectorCardLite, PostingMode } from '../engine/types';
import { Icon } from './Icon';
import type { IconName } from './icons';
import s from './ConnectorLabel.module.css';

export type ConnectorLabelName = 'handoff' | 'read' | 'write' | 'planned';

/**
 * The honest label of a connector, from engine data only: the most it really does today (write, then read, then
 * handoff), or planned. The engine lists modes as handoff, read, write, so taking the first available one would call
 * the back office, which reads and writes, "Reads".
 */
export function connectorLabelOf(card: Pick<ConnectorCardLite, 'modes'>): ConnectorLabelName {
  for (const mode of ['write', 'read', 'handoff'] as const) if (card.modes.some((m) => m.mode === mode && m.status === 'available')) return mode;
  return 'planned';
}

/** Each label has its own icon, so the four never read alike even without colour. */
const LABEL_ICONS: Readonly<Record<ConnectorLabelName, IconName>> = {
  write: 'pencil',
  read: 'eye',
  handoff: 'arrow-left-right',
  planned: 'clock',
};

export interface ConnectorLabelProps {
  label: ConnectorLabelName;
  /** How a posting connector posts. */
  mode?: PostingMode | undefined;
  /** The engine's risk line; an owner-browser-session connector always shows one. */
  risk?: string | undefined;
}

/**
 * What a connector really does, in words: handoff, reads, writes or planned; for posting, its mode and risk. A label
 * that works is a solid chip; planned is an open, dashed chip (the look of everything that is not real yet), so the
 * two can never be mistaken for each other. A planned connector says only "Planned": how it would post and what that
 * risks belong to a channel that works, so they are left out. It is a label, never a control.
 */
export function ConnectorLabel({ label, mode, risk }: ConnectorLabelProps) {
  const t = useT();
  const live = label !== 'planned';
  const riskLine = !live ? undefined : risk ?? (mode === 'owner-browser-session' ? t('connector.risk.owner-browser-session') : undefined);
  return (
    <span className={s.connector} data-label={label}>
      <span className={s.word}><Icon name={LABEL_ICONS[label]} size={12} />{t(`connector.${label}`)}</span>
      {live && mode && <span className={s.mode}>{t(`connector.mode.${mode}`)}</span>}
      {riskLine && <span className={s.risk} data-risk=""><Icon name="triangle-alert" size={12} />{riskLine}</span>}
    </span>
  );
}
