/** BK-07 Meanings, BK-08 a meaning (sheet with its draft), BK-10 starter packs, BK-19 GST mode. */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Label } from '../../parts/Label';
import { Section, Note, Refusal, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { dayTime } from '../work/kit/format.ts';
import { discardReply, draft as draftCheck, gstReply, meaningReply, meaningsReply, packsReply, publishReply, type Definition, type Draft } from './contract.ts';
import { useR2 } from './words-r2.ts';
import { BooksPage, BooksSheet, Link, Table, approves, fill, idOf, sheetOf, styles as s, useWords, valueOf, type BooksProps, type W } from './shared.tsx';

const ORIGIN = { core: 'origin.core', pack: 'origin.pack', you: 'origin.you' } as const;
const WORD_STATE = { published: 'state.published', draft: 'state.draft', clash: 'state.clash' } as const;

export function Meanings(props: BooksProps) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'books.meanings', {}, meaningsReply);
  const value = valueOf(loaded);
  const open = idOf(props.address.sheet);
  const sheetFor = (name: string) => props.navigate({ place: 'books', sub: 'meanings', sheet: sheetOf(name) });
  return (
    <BooksPage props={props} sub="meanings" title={w['title.meanings']} count={value ? String(value.words.length) : undefined} loaded={loaded} reload={reload}>
      {value && (
        <>
          {value.dictionary === null
            ? <Note>{w['dict.none']}</Note>
            : <Note>{fill(w['dict.version'], { version: String(value.dictionary.version), by: value.dictionary.publishedBy, when: dayTime(value.dictionary.publishedAt, props.language), pack: value.dictionary.pack })}</Note>}
          {value.words.length === 0 ? <Note>{w['empty.meanings']}</Note> : (
            <Table view={props.view} caption={w['title.meanings']} columns={[
              { head: w['col.word'], simple: true }, { head: w['col.meaning'], simple: true }, { head: w['col.origin'] }, { head: w['col.state'] },
            ]} rows={value.words.map(word => ({ key: word.name, cells: [
              <Link onPress={() => sheetFor(word.name)}>{word.label}</Link>,
              word.meaning,
              w[ORIGIN[word.origin]],
              <span className={word.state === 'clash' ? s.amber : undefined}>{w[WORD_STATE[word.state]]}</span>,
            ] }))} />
          )}
          {value.drafts.length > 0 && (
            <Section title={w['drafts']}>
              <ul className={s.list}>{value.drafts.map(d => (
                <li key={d.id}><Link onPress={() => sheetFor(d.name)}>{d.name}</Link> · {d.change} · {fill(w.byWhom, { name: d.author })}</li>
              ))}</ul>
            </Section>
          )}
          {!props.viewer && <DraftForm props={props} onDone={reload} />}
          <Gst props={props} />
        </>
      )}
      {open !== null && <MeaningSheet props={props} name={open} onChanged={reload} />}
    </BooksPage>
  );
}

function definitionText(d: Definition, w: W): string {
  return fill(w.definitionLine, { meaning: d.meaning, kind: d.kind, field: d.field, nulls: d.nulls === 'exclude' ? w['nulls.exclude'] : w['nulls.reject'] });
}

function Reviews({ d, w }: { d: Draft; w: W }) {
  if (d.reviews.length === 0) return <Note>{w.notReviewed}</Note>;
  return <ul className={s.list}>{d.reviews.map((r, i) => (
    <li key={`${r.by}-${i}`}>{r.kind === 'ai-opinion' ? fill(w.aiOpinion, { by: r.by }) : fill(w.cosignedBy, { by: r.by, role: r.role })}</li>
  ))}</ul>;
}

function MeaningSheet({ props, name, onChanged }: { props: BooksProps; name: string; onChanged: () => void }) {
  const w = useWords(props.language), r2 = useR2(props.language);
  const { loaded, reload } = useReply(props, 'books.meaning', { name }, meaningReply, name);
  const act = useAct(props.rpc);
  const [note, setNote] = useState<string | null>(null);
  const value = valueOf(loaded);
  const d = value?.draft ?? null;
  const done = (message: string) => { setNote(message); reload(); onChanged(); };
  const publish = async (draft: Draft) => {
    const outcome = await act.run('books.publish', { draftId: draft.id, digest: draft.digest }, publishReply);
    if (outcome.ok) done(fill(w.published, { version: String(outcome.value.version), n: outcome.value.staleAnswers }));
  };
  const cosign = async (draft: Draft) => { if ((await act.run('books.cosign', { draftId: draft.id, digest: draft.digest }, draftCheck)).ok) done(w.cosigned); };
  const discard = async (draft: Draft) => { if ((await act.run('books.discard', { draftId: draft.id }, discardReply)).ok) done(w.discarded); };
  const live = d !== null && (d.state === 'draft' || d.state === 'cosigned');
  return (
    <BooksSheet props={props} sub="meanings" kind={w['sheet.meaning']} title={value?.word?.label ?? d?.after?.label ?? name}
      actions={live && d && !props.viewer ? (
        <>
          {approves(props) && d.checks.ok && <Button variant="filled" onClick={() => { void publish(d); }} disabled={act.busy}>{w.publish}</Button>}
          {d.state === 'draft' && <Button onClick={() => { void cosign(d); }} disabled={act.busy}>{w.cosign}</Button>}
          <Button danger onClick={() => { void discard(d); }} disabled={act.busy}>{w.discard}</Button>
        </>
      ) : undefined}>
      {loaded.phase === 'refused' && <Refusal code={loaded.code} language={props.language} />}
      {loaded.phase === 'loading' && !value && <Note>{w.reading}</Note>}
      {value && (
        <div className={s.stack}>
          {value.word ? <p>{definitionText(value.word, w)}</p> : <Note>{w['word.none']}</Note>}
          {value.origin && <Note>{w[ORIGIN[value.origin]]}</Note>}
          {d && (
            <Section title={fill(w.draftState, { state: w[`draft.${d.state}`] })}>
              <div className={s.split}>
                <div><Note>{w.oldRule}</Note><p className={s.struck}>{d.before ? definitionText(d.before, w) : w.noRule}</p></div>
                <div><Note>{w.newRule}</Note><p>{d.after ? definitionText(d.after, w) : w.removesWord}</p></div>
              </div>
              <p>{d.change}</p>
              <Note>{fill(w.affects, { n: d.affects.savedAnswers })}</Note>
              {d.affects.calculations.length > 0 && <ul className={s.list}>{d.affects.calculations.map(c => <li key={c}>{c}</li>)}</ul>}
              <Reviews d={d} w={w} />
              {d.checks.ok ? <Note>{w.checksPassed}</Note> : <p className={s.amber}>{fill(w.checksFailed, { code: d.checks.code ?? w.noCode })}</p>}
              {!props.viewer && live && (d.before && d.after
                ? <Note><Label kind="experimental" /> <Link onPress={() => props.navigate({ place: 'books', sub: 'trial', sheet: sheetOf(d.id) })}>{r2.tryCopy}</Link></Note>
                : <Note><Label kind="experimental" /> {r2.tryCopyCannot}</Note>)}
              {note && <p role="status">{note}</p>}
              <Refusal code={act.refusal} language={props.language} />
            </Section>
          )}
          {!d && note && <p role="status">{note}</p>}
          {value.history.length > 0 && (
            <Section title={w.releases}>
              <ul className={s.list}>{value.history.map(h => (
                <li key={`${h.version}`}>{fill(w.release, { version: String(h.version), by: h.publishedBy, when: dayTime(h.publishedAt, props.language) })} · {h.meaning}</li>
              ))}</ul>
            </Section>
          )}
          {!props.viewer && !live && <DraftForm props={props} name={name} start={value.word} onDone={() => { reload(); onChanged(); }} />}
        </div>
      )}
    </BooksSheet>
  );
}

function DraftForm({ props, name: fixedName, start, onDone }: { props: BooksProps; name?: string; start?: Definition | null; onDone: () => void }) {
  const w = useWords(props.language);
  const act = useAct(props.rpc);
  const [name, setName] = useState(fixedName ?? '');
  const [label, setLabel] = useState(start?.label ?? '');
  const [meaning, setMeaning] = useState(start?.meaning ?? '');
  const [kind, setKind] = useState(start?.kind ?? '');
  const [field, setField] = useState(start?.field ?? '');
  const [nulls, setNulls] = useState<'exclude' | 'reject'>(start?.nulls ?? 'exclude');
  const [sent, setSent] = useState(false);
  const ready = [name, label, meaning, kind, field].every(v => v.trim().length > 0);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!ready) return;
    const outcome = await act.run('books.draft', { name: name.trim(), definition: { label: label.trim(), meaning: meaning.trim(), kind: kind.trim(), field: field.trim(), nulls } }, draftCheck);
    if (outcome.ok) { setSent(true); onDone(); }
  };
  return (
    <Section title={fixedName ? w.changeWord : w.startDraft}>
      <form className={s.form} onSubmit={event => { void submit(event); }} aria-label={fixedName ? w.changeWord : w.startDraft}>
        {!fixedName && <Field label={w['f.name']} value={name} onChange={e => setName(e.target.value)} />}
        <Field label={w['f.label']} value={label} onChange={e => setLabel(e.target.value)} />
        <Field label={w['f.meaning']} value={meaning} onChange={e => setMeaning(e.target.value)} />
        <Field label={w['f.kind']} value={kind} onChange={e => setKind(e.target.value)} />
        <Field label={w['f.field']} value={field} onChange={e => setField(e.target.value)} />
        <Choice<'exclude' | 'reject'> label={w['f.nulls']} options={[{ value: 'exclude', label: w['nulls.exclude'] }, { value: 'reject', label: w['nulls.reject'] }]} value={nulls} onChange={setNulls} />
        <Actions><Button submit disabled={!ready || act.busy}>{w.saveDraft}</Button></Actions>
        {sent && <p role="status">{w.draftSaved}</p>}
        <Refusal code={act.refusal} language={props.language} />
      </form>
    </Section>
  );
}

function Gst({ props }: { props: BooksProps }) {
  const w = useWords(props.language);
  const { loaded } = useReply(props, 'books.gst', {}, gstReply);
  const value = valueOf(loaded);
  return (
    <Section title={w.gstTitle}>
      {loaded.phase === 'refused' && (loaded.state.kind === 'not-built' ? <Note>{fill(w.notBuiltNamed, { what: w.gstTitle })}</Note> : <Refusal code={loaded.code} language={props.language} />)}
      {value && <p>{value.gstMode === null ? <span className={s.missing}>{w.gstNotSet}</span> : fill(w.gstMode, { mode: value.gstMode })}</p>}
      {value && !value.rates.available && <Note>{fill(w.notBuiltNamed, { what: w.rates })}</Note>}
    </Section>
  );
}

export function Packs(props: BooksProps) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'books.packs', {}, packsReply);
  const value = valueOf(loaded);
  return (
    <BooksPage props={props} sub="packs" title={w['title.packs']} count={value ? String(value.packs.length) : undefined} loaded={loaded} reload={reload}>
      {value && (value.packs.length === 0 ? <Note>{w['empty.packs']}</Note> : (
        <Table view={props.view} caption={w['title.packs']} columns={[{ head: w['col.pack'], simple: true }, { head: w['col.state'], simple: true }, { head: w['col.meanings'], num: true }]}
          rows={value.packs.map(p => ({ key: p.pack, cells: [p.label, p.state === 'in-use' ? w['pack.in-use'] : w['pack.available'], String(p.meanings)] }))} />
      ))}
    </BooksPage>
  );
}
