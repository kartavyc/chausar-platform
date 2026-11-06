/**
 * The pipeline's four tiles (D-Clients `.stat`; the engine's 4E1 tiles): next steps this week (late, today, later),
 * drafts to send by channel, moved forward this week by stage, and won this month by name. Each value is the engine's
 * count with its count receipt. The engine's line under it shows for Next steps (late, today, later) and Won this month
 * (who); the drafts and moves breakdowns are read with their tile but not shown, as Has a draft and the board show them. The UI words the four labels by their ids,
 * in English and Hindi; a tile id it does not know keeps the engine's label.
 */

import { useT } from '../../text';
import type { IconName } from '../../parts/icons';
import { Receipt } from '../../parts/Receipt';
import { StatTile } from '../../parts/StatTile';
import type { StatTileView } from '../../engine/types';
import s from './Pipeline.module.css';

/** The lines shown at rest (D-Clients): how many next steps are late, today and later, and who was won this month. */
const SHOWN: ReadonlySet<string> = new Set(['next-steps', 'won']);
const KNOWN: Readonly<Record<string, IconName>> = { 'next-steps': 'calendar', drafts: 'file-pen', moved: 'arrow-right', won: 'check' };

export function PipelineTiles({ tiles }: { tiles: readonly StatTileView[] }) {
  const t = useT();
  if (tiles.length === 0) return null;
  return (
    <ul className={s.tiles} aria-label={t('clients.pipeline.tiles')}>
      {tiles.map((tile) => (
        <StatTile
          key={tile.id}
          as="li"
          label={Object.hasOwn(KNOWN, tile.id) ? t(`clients.pipeline.tile.${tile.id}`) : tile.label}
          icon={KNOWN[tile.id]}
          count={tile.value}
          side={<>{tile.receiptId && <Receipt id={tile.receiptId} />}{tile.line && !SHOWN.has(tile.id) && <span className="sr-only" data-tile-line="">{tile.line}</span>}</>}
          sub={tile.line && SHOWN.has(tile.id) ? <span data-tile-line="">{tile.line}</span> : undefined}
          className={s.tile}
        />
      ))}
    </ul>
  );
}
