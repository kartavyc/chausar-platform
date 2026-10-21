import { useT } from '../text';
import type { ConnectorCardLite, PostingMode } from '../engine/types';
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

export interface ConnectorLabelProps {
  label: ConnectorLabelName;
  /** How a posting connector posts. */
  mode?: PostingMode | undefined;
  /** The engine's risk line; an owner-browser-session connector always shows one. */
  risk?: string | undefined;
}

/** What a connector really does, in words: handoff, reads, writes or planned; for posting, its mode and risk. */
export function ConnectorLabel({ label, mode, risk }: ConnectorLabelProps) {
  const t = useT();
  const riskLine = risk ?? (mode === 'owner-browser-session' ? t('connector.risk.owner-browser-session') : undefined);
  return (
    <span className={s.connector} data-label={label}>
      <span className={s.word}>{t(`connector.${label}`)}</span>
      {mode && <span className={s.mode}>{t(`connector.mode.${mode}`)}</span>}
      {riskLine && <span className={s.risk}>{riskLine}</span>}
    </span>
  );
}
