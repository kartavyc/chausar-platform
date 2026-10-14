/**
 * What it can do (WK-06): the written list of actions, so nothing is a surprise. A row
 * opens all eleven fields of its catalogue entry. Something not in the list goes on the
 * wanted list. Write status is shown apart from read status.
 */
import { useRef, useState, type FormEvent } from 'react';
import { State } from '../../patterns/States';
import { Sheet } from '../../parts/Sheet';
import { KeyValue } from '../../parts/KeyValue';
import { useAct, useReply } from './kit/reply.ts';
import { day } from './kit/format.ts';
import { Actions, Button, Note, Refusal, pageStyles } from './kit/Page';
import { partsOf, sheetOf, wanted, type CatalogueEntry, type CatalogueRow } from './contract.ts';
import { catalogueEntryFull, catalogueFull, type CatalogueEntryFull } from './contract-writeback.ts';
import { wbSay, wbWords, type WbKey } from './writeback-text.ts';
import { Frame, type WorkProps } from './shared.tsx';
import type { WorkWords } from './text.ts';
import s from './work.module.css';

export function entryPairs(e: CatalogueEntry, w: WorkWords, language: 'en' | 'hi') {
  const none = w.none;
  return [
    { name: w['e.system'], value: e.systemTitle },
    { name: w['e.description'], value: e.description },
    { name: w['e.kind'], value: w[`kind.${e.kind}`] },
    { name: w['e.waits'], value: e.waits ? w['waits.yes'] : w['waits.no'] },
    { name: w['e.tier'], value: w[`tier.${e.tier}`] },
    { name: w['e.status'], value: w[`status.${e.status}`] },
    { name: w['e.readStatus'], value: e.readStatus ?? none },
    { name: w['e.idempotency'], value: e.idempotency },
    { name: w['e.readBack'], value: e.readBack },
    { name: w['e.retry'], value: e.retryWindow ?? none },
    { name: w['e.expires'], value: e.expires === null ? none : day(e.expires, language) },
    ...writebackPairs(e, language),
  ];
}

/** The write-back fields of a catalogue row: its own reason, planned status, reference, lifetime, review, test and grants. */
function writebackPairs(e: CatalogueEntry & Partial<CatalogueEntryFull>, language: 'en' | 'hi') {
  const ww = wbWords(language); const out: { name: string; value: string }[] = [];
  if (e.waitsBecause) out.push({ name: ww['e.waitsBecause'], value: e.waitsBecause });
  if (e.plannedStatus) out.push({ name: ww['e.planned'], value: e.plannedStatus });
  if (e.businessReference) out.push({ name: ww['e.reference'], value: e.businessReference });
  if (e.approvalLifetime) out.push({ name: ww['e.lifetime'], value: e.approvalLifetime });
  if (e.reviewedOn) out.push({ name: ww['e.reviewed'], value: day(e.reviewedOn, language) });
  if (e.qualification) out.push({ name: ww['e.qualification'], value: ww[`q.${e.qualification}` as WbKey] });
  if (e.writeScore) out.push({ name: ww['e.score'], value: e.writeScore });
  if (e.undo) out.push({ name: ww['e.undo'], value: e.undo });
  if (e.connections !== undefined) {
    const lines = e.connections.map(c => wbSay(ww, c.write ? 'g.write' : 'g.read', { label: c.label, env: ww[`wb.env.${c.environment}` as WbKey] }));
    out.push({ name: ww['e.grants'], value: lines.length ? lines.join('; ') : ww['e.grantsNone'] });
  }
  return out;
}

function EntrySheet({ p, system, action, origin, onClose }: { p: WorkProps; system: string; action: string; origin: HTMLElement | null; onClose: () => void }) {
  const { loaded, reload } = useReply(p.host, 'approvals.catalogueEntry', { system, action }, catalogueEntryFull);
  if (loaded.phase !== 'ready') {
    return (
      <Sheet kind={p.w['entry.kind']} title={p.w['entry.kind']} onClose={onClose} origin={origin}>
        <State state={loaded.phase === 'refused' ? loaded.state : { kind: 'loading' }} action={loaded.phase === 'refused' ? { label: p.w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  return (
    <Sheet kind={p.w['entry.kind']} title={loaded.value.title} onClose={onClose} origin={origin}>
      <KeyValue pairs={entryPairs(loaded.value, p.w, p.language)} onReceipt={p.openReceipt} />
    </Sheet>
  );
}

function Wanted({ p }: { p: WorkProps }) {
  const { w } = p;
  const act = useAct(p.rpc);
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState('');
  const [what, setWhat] = useState('');
  const [done, setDone] = useState(false);
  const send = async (event: FormEvent) => {
    event.preventDefault();
    const out = await act.run('approvals.wanted', { system, text: what }, wanted);
    if (out.ok) { setDone(true); setOpen(false); setSystem(''); setWhat(''); }
  };
  if (done) return <Note>{w['wanted.done']}</Note>;
  if (!open) return <Actions><Button variant="link" onClick={() => setOpen(true)}>{w['wanted.open']}</Button></Actions>;
  return (
    <form className={s.form} onSubmit={e => void send(e)}>
      <label>{w['wanted.system']}<input value={system} required onChange={e => setSystem(e.currentTarget.value)} /></label>
      <label>{w['wanted.text']}<textarea rows={3} value={what} required onChange={e => setWhat(e.currentTarget.value)} /></label>
      <Actions>
        <Button submit variant="quiet" disabled={act.busy}>{w['wanted.send']}</Button>
        <Button variant="link" onClick={() => setOpen(false)}>{w.cancel}</Button>
      </Actions>
      <Refusal code={act.refusal} language={p.language} />
    </form>
  );
}

export function CanDoPage({ p }: { p: WorkProps }) {
  const { w, view } = p;
  const { loaded, reload } = useReply(p.host, 'approvals.catalogue', {}, catalogueFull);
  const ww = wbWords(p.language);
  const origin = useRef<HTMLElement | null>(null);
  const opened = p.address.sheet === undefined ? null : partsOf(p.address.sheet);
  const open = (r: CatalogueRow, el: HTMLElement) => { origin.current = el; p.navigate({ place: 'work', sub: 'cando', sheet: sheetOf(r.system, r.action) }); };
  const close = () => p.navigate({ place: 'work', sub: 'cando' });
  const columns = view === 'simple' ? (['col.action', 'col.system', 'col.status'] as const)
    : view === 'books' ? (['col.action', 'col.system', 'col.kind', 'col.waits', 'col.status', 'col.source', 'cando.score'] as const)
    : (['col.action', 'col.system', 'col.kind', 'col.waits', 'col.status'] as const);
  const cell = (r: CatalogueRow & { writeScore?: string | null }, k: typeof columns[number]) => {
    switch (k) {
      case 'col.action': return <button type="button" className={s.open} onClick={e => open(r, e.currentTarget)}>{r.title}</button>;
      case 'col.system': return r.systemTitle;
      case 'col.kind': return w[`kind.${r.kind}`];
      case 'col.waits': return r.waits ? w['waits.yes'] : w['waits.no'];
      case 'col.status': return w[`status.${r.status}`];
      case 'col.source': return w[`source.${r.source}`];
      case 'cando.score': return r.writeScore ?? '';
    }
  };
  return (
    <Frame p={p} title={w['cando.title']} loaded={loaded} reload={reload}>
      {c => (
        <div className={s.split} data-open={opened !== null && opened.length === 2 ? '' : undefined}>
          <div className={s.pane}>
            {c.rows.length === 0 ? <Note>{w['cando.empty']}</Note> : (
              <table className={[pageStyles.table, view === 'books' ? s.dense : ''].join(' ')}>
                <thead><tr>{columns.map(k => <th key={k} scope="col">{k === 'cando.score' ? ww[k] : w[k]}</th>)}</tr></thead>
                <tbody>{c.rows.map(r => <tr key={`${r.system}/${r.action}`}>{columns.map(k => <td key={k}>{cell(r, k)}</td>)}</tr>)}</tbody>
              </table>
            )}
            {!c.writeback.available && <Note>{w['cando.writebackMissing']}</Note>}
            {view !== 'simple' && <Note>{w['cando.readApart']}</Note>}
            {!p.viewer && <Wanted p={p} />}
          </div>
          {opened !== null && opened.length === 2 && (
            <EntrySheet key={p.address.sheet} p={p} system={opened[0] ?? ''} action={opened[1] ?? ''} origin={origin.current} onClose={close} />
          )}
        </div>
      )}
    </Frame>
  );
}
