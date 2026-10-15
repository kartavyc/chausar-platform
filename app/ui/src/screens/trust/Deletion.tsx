/**
 * TR-13 Delete, and the deletion report (sheet `delete` on Vault). The owner chooses a
 * source id and types it again; the engine receives exactly `{ sourceId, confirmation }`.
 * Each place the data lived is reported deleted, pending, not possible or not built yet,
 * with the reason. Earlier reports can be exported.
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { useEngine, useSend } from './kit/engine.ts';
import { Group } from './kit/Screen';
import { Loads, Outcome, Refusal, dayText, powers, useClose, type P } from './common';
import { validateDeletion, validateDeletions, validateFile, validateSources, type DeletionReport } from './validate.ts';
import { DELETION, engineCodeWord, fill } from './words.ts';
import s from './Trust.module.css';

export function DeletionSheet({ p }: { p: P }) {
  const w = words(DELETION, p.language);
  const close = useClose(p);
  const { owner } = powers(p);
  const earlier = useEngine(p.rpc, 'trustx.deletions', {}, validateDeletions);
  return (
    <Sheet kind={w.reportTitle} title={w.title} onClose={close} origin={null}>
      <div className={s.stack}>
        {owner ? <DeleteForm p={p} onDone={earlier.reload} /> : <p className={s.quiet}>{w.ownerOnly}</p>}
        <Loads title={w.earlier} loaded={earlier.state}>
          {(items) => items.length === 0 ? <p className={s.quiet}>{w.none}</p> : <>{items.map((r) => <Report key={r.id} p={p} report={r} />)}</>}
        </Loads>
      </div>
    </Sheet>
  );
}

function DeleteForm({ p, onDone }: { p: P; onDone: () => void }) {
  const w = words(DELETION, p.language);
  const sources = useEngine(p.rpc, 'sources.list', {}, validateSources);
  const [sourceId, setSourceId] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const { sent, send } = useSend(p.rpc, validateDeletion);
  const problem = confirmation.length > 0 && confirmation !== sourceId ? w.mismatch : undefined;
  const listed = sources.state.kind === 'ready' && sources.state.value.length > 0 ? sources.state.value : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (sourceId.length === 0 || confirmation !== sourceId) return;
    const done = await send('trustx.deleteSource', { sourceId, confirmation });
    if (done !== null && p.live(p.address)) { setConfirmation(''); onDone(); }
  };
  return (
    <>
      <form className={s.stack} onSubmit={(e) => void submit(e)}>
        {listed !== null
          ? <Choice label={w.chooseSource} options={listed.map((x) => ({ value: x.sourceId, label: x.sourceId }))} value={sourceId === '' ? null : sourceId} onChange={setSourceId} />
          : <Field label={w.sourceField} value={sourceId} onChange={(e) => setSourceId(e.currentTarget.value.trim())} autoComplete="off" />}
        <Field label={w.again} value={confirmation} onChange={(e) => setConfirmation(e.currentTarget.value)} autoComplete="off" problem={problem} />
        <span><Button submit danger disabled={sent.kind === 'sending' || sourceId.length === 0 || confirmation !== sourceId}>{w.delete}</Button></span>
      </form>
      {sent.kind === 'refused' && <Outcome sent={sent} language={p.language} />}
      {sent.kind === 'done' && <Report p={p} report={sent.value} />}
    </>
  );
}

function Report({ p, report }: { p: P; report: DeletionReport }) {
  const w = words(DELETION, p.language);
  const { admin } = powers(p);
  const exp = useSend(p.rpc, validateFile);
  return (
    <Group title={fill(w.reportOf, { source: report.sourceId, date: dayText(report.at, p.language) })}>
      <table className={s.table} data-report={report.id}>
        <thead><tr><th scope="col">{w.place}</th><th scope="col">{w.state}</th><th scope="col">{w.reason}</th></tr></thead>
        <tbody>
          {report.rows.map((row, i) => (
            <tr key={`${row.place}-${i}`}><td>{engineCodeWord(p.language, 'place', row.code, row.place)}</td><td>{w[`state.${row.state}`]}</td><td>{row.reason}</td></tr>
          ))}
        </tbody>
      </table>
      {admin && <span><Button variant="quiet" onClick={() => void exp.send('trustx.exportDeletion', { id: report.id })} disabled={exp.sent.kind === 'sending'}>{w.export}</Button></span>}
      {exp.sent.kind === 'done' && <p className={s.status} role="status">{fill(w.exported, { name: exp.sent.value.name })}</p>}
      {exp.sent.kind === 'refused' && <Refusal code={exp.sent.code} language={p.language} />}
    </Group>
  );
}
