import { useId, useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import type { TrackerCellLite, TrackerColumnLite, TrackerDetailLite, TrackerLite, TrackerRowLite } from '../../engine/types';
import { TrackerBoard } from './TrackerBoard';
import s from './Trackers.module.css';

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Work > Trackers (C7 task 20): trackers the owner makes, a content calendar, GST due dates. Each opens as a list that
 * reads as rows on a phone, or a board grouped by a choice column, where a card moves by a menu, not only by dragging.
 * Rows an agent added say so, with Undo. A receipt cell carries its figure from its receipt; an estimate cell always says
 * model estimate. Making a tracker from a starter asks a second time: it is standing configuration.
 */
export function Trackers() {
  const t = useT();
  const client = useEngine();
  const list = useResource('venture.trackers.list', {});
  const [open, setOpen] = useState<string | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const trackers = list.data?.trackers ?? [];
  const current = open ?? trackers[0]?.id ?? null;
  const unused = (list.data?.starters ?? []).filter((starter) => !trackers.some((tracker) => tracker.name === starter.name));
  async function start(id: string) {
    const starter = unused.find((item) => item.id === id);
    if (!starter) return;
    setProblem(null);
    try {
      const { tracker } = await client.request('venture.trackers.set', { tracker: { name: starter.name, columns: starter.columns, boardBy: starter.boardBy } });
      setOpen(tracker.id); list.reload();
    } catch (error) { setProblem(messageOf(error)); } finally { setAsking(null); }
  }
  return (
    <div className={s.trackers} data-trackers="">
      {list.error && !list.data && <p className={s.problem} role="alert">{list.error.message}</p>}
      {list.data && trackers.length === 0 && <p className={s.line}>{t('work.trackers.none')}</p>}
      {trackers.length > 1 && (
        <nav className={s.names} aria-label={t('work.trackers.title')}>
          {trackers.map((tracker) => <Button key={tracker.id} size="sm" variant="quiet" aria-current={tracker.id === current || undefined} onClick={() => setOpen(tracker.id)}>{tracker.name}</Button>)}
        </nav>
      )}
      {current && <TrackerView key={current} id={current} onChanged={list.reload} />}
      {unused.length > 0 && (
        <div className={s.starters}>
          {unused.map((starter) => asking === starter.id ? (
            <p key={starter.id} className={s.line}>
              {t('work.trackers.ask', { name: starter.name })}{' '}
              <Button size="sm" variant="quiet" onClick={() => setAsking(null)}>{t('approval.cancel')}</Button>{' '}
              <Button size="sm" onClick={() => void start(starter.id)}>{t('work.trackers.make')}</Button>
            </p>
          ) : <Button key={starter.id} size="sm" variant="quiet" onClick={() => setAsking(starter.id)}>{t('work.trackers.starter', { name: starter.name })}</Button>)}
        </div>
      )}
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </div>
  );
}

/** One tracker: the words of its cells, its rows and how to add one. */
function TrackerView({ id, onChanged }: { id: string; onChanged: () => void }) {
  const t = useT();
  const client = useEngine();
  const detail = useResource('venture.trackers.get', { id });
  const [board, setBoard] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const data = detail.data;
  const changed = () => { detail.reload(); onChanged(); };
  async function act(work: () => Promise<unknown>) {
    setProblem(null);
    try { await work(); changed(); } catch (error) { setProblem(messageOf(error)); }
  }
  const undo = (row: TrackerRowLite) => act(() => client.request('venture.trackers.rows.undo', { rowId: row.id }));
  const remove = (row: TrackerRowLite) => act(() => client.request('venture.trackers.rows.remove', { rowId: row.id }));
  const move = (row: TrackerRowLite, column: string, value: string) => act(() => client.request('venture.trackers.rows.edit', { rowId: row.id, cells: { [column]: value } }));
  if (!data) return detail.error ? <p className={s.problem} role="alert">{detail.error.message}</p> : null;
  const boardColumn = data.tracker.boardBy ? data.tracker.columns.find((column) => column.id === data.tracker.boardBy) : undefined;
  return (
    <section aria-label={data.tracker.name} className={s.tracker}>
      <div className={s.head}>
        <h2 className={s.name}>{data.tracker.name}</h2>
        {boardColumn && <Button size="sm" variant="quiet" onClick={() => setBoard(!board)}>{t(board ? 'work.trackers.asList' : 'work.trackers.asBoard')}</Button>}
      </div>
      {board && boardColumn
        ? <TrackerBoard detail={data} column={boardColumn} onMove={move} onUndo={undo} />
        : <TrackerList detail={data} onUndo={undo} onRemove={remove} />}
      <AddRow tracker={data.tracker} onAdded={changed} />
      {problem && <p className={s.problem} role="alert">{problem}</p>}
    </section>
  );
}

/** A cell's words: a receipt with its mark and figure, an estimate with its label. */
export function Cell({ cell }: { cell: TrackerCellLite }) {
  const t = useT();
  if (cell.receiptId) return <a className={s.receipt} href={`#/work?sheet=receipt:${encodeURIComponent(cell.receiptId)}`} data-receipt-cell=""><span data-num="">{cell.display}</span> <span className={s.mark}>{t('work.trackers.receipt')}</span></a>;
  if (cell.label) return <span data-estimate-cell=""><span data-content="">{cell.display}</span> <span className={s.mark}>{cell.label}</span></span>;
  return <span data-content="">{cell.display}</span>;
}

/** Who added an agent's row, with Undo. */
export function AddedBy({ row, onUndo }: { row: TrackerRowLite; onUndo: (row: TrackerRowLite) => void }) {
  const t = useT();
  if (!row.canUndo) return null;
  return <span className={s.added} data-added-by={row.addedBy}>{t('work.trackers.addedBy', { agent: row.addedByName ?? row.addedBy })} <Button size="sm" variant="quiet" onClick={() => onUndo(row)}>{t('work.trackers.undo')}</Button></span>;
}

function TrackerList({ detail, onUndo, onRemove }: { detail: TrackerDetailLite; onUndo: (row: TrackerRowLite) => void; onRemove: (row: TrackerRowLite) => void }) {
  const t = useT();
  const { tracker, rows } = detail;
  if (!rows.length) return <p className={s.line}>{t('work.trackers.empty')}</p>;
  const named = (id: string) => tracker.columns.find((column) => column.id === id)?.name ?? id;
  return (
    <ul className={s.rows} aria-label={t('work.trackers.rows')}>
      {rows.map((row) => (
        <li key={row.id} className={s.row} data-row={row.id}>
          <dl className={s.cells}>
            {row.cells.filter((cell) => cell.display !== '').map((cell) => (
              <div key={cell.column} className={s.cell}><dt>{named(cell.column)}</dt><dd><Cell cell={cell} /></dd></div>
            ))}
          </dl>
          <AddedBy row={row} onUndo={onUndo} />
          {!row.canUndo && <Button size="sm" variant="quiet" aria-label={t('work.trackers.removeRow')} onClick={() => onRemove(row)}>{t('work.trackers.remove')}</Button>}
        </li>
      ))}
    </ul>
  );
}

/** Add a row, folded until opened: the tracker's columns as plain fields; receipt and person cells come from their own places. */
function AddRow({ tracker, onAdded }: { tracker: TrackerLite; onAdded: () => void }) {
  const t = useT();
  const client = useEngine();
  const id = useId();
  const [values, setValues] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<string | null>(null);
  const fields = tracker.columns.filter((column) => column.kind !== 'receipt' && column.kind !== 'person');
  const set = (column: TrackerColumnLite, value: string) => setValues((now) => ({ ...now, [column.id]: value }));
  async function submit(event: FormEvent) {
    event.preventDefault();
    setProblem(null);
    try {
      const cells = Object.fromEntries(fields.map((column) => [column.id, column.kind === 'check' ? values[column.id] === 'yes' : values[column.id] ?? '']));
      await client.request('venture.trackers.rows.add', { trackerId: tracker.id, cells });
      setValues({}); onAdded();
    } catch (error) { setProblem(messageOf(error)); }
  }
  return (
    <details className={s.fold}>
      <summary>{t('work.trackers.add')}</summary>
      <form className={s.form} onSubmit={(event) => void submit(event)} aria-labelledby={id}>
        <span id={id} hidden>{t('work.trackers.add')}</span>
        {fields.map((column) => {
          if (column.kind === 'choice') return (
            <label key={column.id} className={s.select}><span>{column.name}</span>
              <select value={values[column.id] ?? ''} onChange={(event) => set(column, event.currentTarget.value)}>
                <option value="" />
                {(column.options ?? []).map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </label>
          );
          if (column.kind === 'check') return <label key={column.id} className={s.select}><input type="checkbox" checked={values[column.id] === 'yes'} onChange={(event) => set(column, event.currentTarget.checked ? 'yes' : '')} /> <span>{column.name}</span></label>;
          return <Field key={column.id} label={column.kind === 'estimate' ? t('work.trackers.estimateField', { name: column.name }) : column.name} type={column.kind === 'date' ? 'date' : 'text'} value={values[column.id] ?? ''} onChange={(event) => set(column, event.currentTarget.value)} />;
        })}
        <div><Button type="submit" variant="primary">{t('work.trackers.addIt')}</Button></div>
        {problem && <p className={s.problem} role="alert">{problem}</p>}
      </form>
    </details>
  );
}
