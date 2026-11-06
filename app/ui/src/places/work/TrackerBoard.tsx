import { useT } from '../../text';
import type { TrackerColumnLite, TrackerDetailLite, TrackerRowLite } from '../../engine/types';
import { AddedBy, Cell } from './Trackers';
import s from './Trackers.module.css';

/**
 * C7 task 20: a tracker as a board, grouped by one choice column. A card moves by a menu, so the keyboard and a phone do
 * everything a mouse does. Rows with no answer in that column stand first under "Not set". Nothing here animates.
 */
export function TrackerBoard({ detail, column, onMove, onUndo }: { detail: TrackerDetailLite; column: TrackerColumnLite; onMove: (row: TrackerRowLite, column: string, value: string) => void; onUndo: (row: TrackerRowLite) => void }) {
  const t = useT();
  const options = column.options ?? [];
  const valueOf = (row: TrackerRowLite) => row.cells.find((cell) => cell.column === column.id)?.value ?? '';
  const stacks: [string, TrackerRowLite[]][] = [['', detail.rows.filter((row) => !options.includes(String(valueOf(row))))], ...options.map((option): [string, TrackerRowLite[]] => [option, detail.rows.filter((row) => valueOf(row) === option)])];
  return (
    <div className={s.board} data-board="">
      {stacks.filter(([option, rows]) => option !== '' || rows.length > 0).map(([option, rows]) => (
        <section key={option} className={s.stack} aria-label={option || t('work.trackers.notSet')}>
          <h3 className={s.stackName}>{option || t('work.trackers.notSet')}</h3>
          <ul className={s.cards}>
            {rows.map((row) => {
              const words = row.cells.filter((cell) => cell.column !== column.id && cell.display !== '');
              return (
                <li key={row.id} className={s.card} data-card-row={row.id}>
                  {words.map((cell) => <div key={cell.column}><Cell cell={cell} /></div>)}
                  <label className={s.select}>
                    <span>{t('work.trackers.moveTo')}</span>
                    <select value={String(valueOf(row))} onChange={(event) => onMove(row, column.id, event.currentTarget.value)}>
                      {!options.includes(String(valueOf(row))) && <option value="">{t('work.trackers.notSet')}</option>}
                      {options.map((one) => <option key={one} value={one}>{one}</option>)}
                    </select>
                  </label>
                  <AddedBy row={row} onUndo={onUndo} />
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
