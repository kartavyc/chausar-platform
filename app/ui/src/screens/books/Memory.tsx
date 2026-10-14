/** BK-17 Memory: what Chausar believes, each line with its source, edit and delete. */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Note, Refusal, Actions, Button, Section } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { forgetReply, memoryLine, memoryReply, type MemoryLine } from './contract.ts';
import { BooksPage, ConfirmButton, Link, Table, approves, fill, styles as s, useWords, valueOf, type BooksProps } from './shared.tsx';
import { useR2, type R2Key } from './words-r2.ts';

type Kind = MemoryLine['kind'];
const KINDS: readonly Kind[] = ['preference', 'claim', 'conversation', 'working-context'];

export function Memory(props: BooksProps) {
  const w = useWords(props.language), r2 = useR2(props.language);
  const [outside, setOutside] = useState(false);
  const { loaded, reload } = useReply(props, 'books.memory', outside ? { outsideOnly: true } : {}, memoryReply);
  const value = valueOf(loaded);
  const act = useAct(props.rpc);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const run = async (method: string, payload: Record<string, unknown>) => {
    const outcome = await act.run<unknown>(method, payload, method === 'books.forget' ? forgetReply : memoryLine);
    if (outcome.ok) { setEditing(null); reload(); }
  };
  const lineCell = (m: MemoryLine) => {
    if (editing === m.id) {
      return (
        <form className={s.form} aria-label={w.editLine} onSubmit={(e: FormEvent) => { e.preventDefault(); if (draft.trim()) void run('books.memoryEdit', { id: m.id, text: draft.trim() }); }}>
          <Field label={w.editLine} value={draft} onChange={e => setDraft(e.target.value)} />
          <Actions><Button submit disabled={!draft.trim() || act.busy}>{w.save}</Button><Button variant="link" onClick={() => setEditing(null)}>{w.keep}</Button></Actions>
        </form>
      );
    }
    return (
      <span className={s.stack}>
        <span>{m.text}</span>
        {m.origin === 'business-profile' && <span className={s.note}>{fill(r2.profileLine, { field: Object.hasOwn(r2, `pf.${m.field}`) ? r2[`pf.${m.field}` as R2Key] : m.field ?? '' })}</span>}
        {m.source === 'outside-content' && <span className={s.amber}>{w.neverObeyed}</span>}
        {props.view !== 'simple' && m.earlier.length > 0 && (
          <ul className={s.list} aria-label={w.earlier}>{m.earlier.map((e, i) => <li key={`${e.at}-${i}`}><span className={s.struck}>{e.text}</span> · {day(e.at, props.language)}</li>)}</ul>
        )}
      </span>
    );
  };
  const source = (m: MemoryLine) => m.source === 'computed' && m.receiptId !== null
    ? <Link onPress={() => { if (m.receiptId !== null) props.openReceipt(m.receiptId); }}>{w['source.computed']}</Link>
    : w[`source.${m.source}`];
  const controls = (m: MemoryLine) => !approves(props) ? null : m.readOnly ? (
    <span className={s.inline}>
      <span className={s.note}>{r2.profileReadOnly}</span>
      <ConfirmButton label={w.delete} confirm={w.deleteConfirm} keep={w.keep} onConfirm={() => { void run('books.forget', { id: m.id }); }} disabled={act.busy} />
    </span>
  ) : (
    <span className={s.inline}>
      {m.status === 'proposed' && <Button onClick={() => { void run('books.memoryConfirm', { id: m.id }); }} disabled={act.busy}>{w.confirm}</Button>}
      <Button variant="link" onClick={() => { setEditing(m.id); setDraft(m.text); }} disabled={act.busy}>{w.edit}</Button>
      <ConfirmButton label={w.delete} confirm={w.deleteConfirm} keep={w.keep} onConfirm={() => { void run('books.forget', { id: m.id }); }} disabled={act.busy} />
    </span>
  );
  return (
    <BooksPage props={props} sub="memory" title={w['title.memory']} count={value ? String(value.lines.length) : undefined} loaded={loaded} reload={reload}>
      <Choice<'all' | 'outside'> label={w.show} options={[{ value: 'all', label: w.allLines }, { value: 'outside', label: w.fromOutside }]} value={outside ? 'outside' : 'all'} onChange={v => setOutside(v === 'outside')} />
      {value && (value.lines.length === 0 ? <Note>{outside ? w['empty.outside'] : w['empty.memory']}</Note> : (
        <Table view={props.view} caption={w['title.memory']} columns={[
          { head: w['col.line'], simple: true }, { head: w['col.kind'] }, { head: w['col.status'], simple: true }, { head: w['col.source'] },
          { head: w['col.learned'] }, { head: w['col.confirmed'] }, ...(approves(props) ? [{ head: w['col.do'], simple: true }] : []),
        ]} rows={value.lines.map(m => ({ key: m.id, cells: [
          lineCell(m), w[`mkind.${m.kind}`], w[`status.${m.status}`], source(m), day(m.learnedAt, props.language),
          m.confirmedAt === null ? <span className={s.missing}>{w.notConfirmed}</span> : day(m.confirmedAt, props.language),
          ...(approves(props) ? [controls(m)] : []),
        ] }))} />
      ))}
      <Refusal code={act.refusal} language={props.language} />
      {approves(props) && <AddLine props={props} onDone={reload} />}
    </BooksPage>
  );
}

function AddLine({ props, onDone }: { props: BooksProps; onDone: () => void }) {
  const w = useWords(props.language);
  const act = useAct(props.rpc);
  const [text, setText] = useState('');
  const [kind, setKind] = useState<Kind>('preference');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if ((await act.run('books.remember', { text: text.trim(), kind }, memoryLine)).ok) { setText(''); onDone(); }
  };
  return (
    <Section title={w.addLine}>
      <form className={s.form} aria-label={w.addLine} onSubmit={e => { void submit(e); }}>
        <Field label={w.lineText} value={text} onChange={e => setText(e.target.value)} />
        <Choice<Kind> label={w['col.kind']} options={KINDS.map(k => ({ value: k, label: w[`mkind.${k}`] }))} value={kind} onChange={setKind} />
        <Actions><Button submit disabled={!text.trim() || act.busy}>{w.addLine}</Button></Actions>
        <Refusal code={act.refusal} language={props.language} />
      </form>
    </Section>
  );
}
