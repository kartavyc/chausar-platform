/**
 * BK-12 Customers, suppliers and items (list and record sheet), BK-20 what we hold,
 * BK-13 same customer or not, BK-14 sources that disagree.
 */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Section, Note, Refusal, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { day } from '../work/kit/format.ts';
import { conflictsReply, deletionPlanReply, deletionReport, holdingsReply, matchPair, matchesReply, precedence, recordView, searchReply } from './contract.ts';
import { useMoreWords } from './words-more.ts';
import type { DeletionReport } from './contract.ts';
import { BooksPage, BooksSheet, Link, Money, Recorded, Table, approves, fill, idOf, isOwner, prepares, sheetOf, styles as s, useWords, valueOf, type BooksProps } from './shared.tsx';
import { useAuditWords, type AuditKey, type AuditWords } from './words-audit.ts';
import { orderSheet } from './Trial.tsx';
import { AskAbout, TimelineMore } from './RecordMore.tsx';
import { dayIn, useZone } from './r4b-parts.tsx';
import { useR4bWords } from './words-r4b.ts';
import type { MatchPair } from './contract.ts';

type Kind = 'all' | 'customer' | 'supplier' | 'item';

export function Customers(props: BooksProps) {
  const w = useWords(props.language);
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [kind, setKind] = useState<Kind>('all');
  const payload = { ...(kind === 'all' ? {} : { kind }), ...(query ? { text: query } : {}) };
  const { loaded, reload } = useReply(props, 'records.search', payload, searchReply);
  const value = valueOf(loaded);
  const open = idOf(props.address.sheet);
  return (
    <BooksPage props={props} sub="customers" title={w['title.customers']} count={value ? String(value.records.length) : undefined} loaded={loaded} reload={reload}>
      <form className={s.form} role="search" onSubmit={(e: FormEvent) => { e.preventDefault(); setQuery(typed.trim()); }}>
        <Field label={w.search} value={typed} onChange={e => setTyped(e.target.value)} />
        <Choice<Kind> label={w.kindFilter} options={(['all', 'customer', 'supplier', 'item'] as const).map(k => ({ value: k, label: w[`kind.${k}`] }))} value={kind} onChange={setKind} />
        <Actions><Button submit>{w.find}</Button></Actions>
      </form>
      {value && (value.records.length === 0 ? <Note>{query ? w['empty.search'] : w['empty.customers']}</Note> : (
        <Table view={props.view} caption={w['title.customers']} columns={[
          { head: w['col.name'], simple: true }, { head: w['col.kind'], simple: true }, { head: w['col.sources'] }, { head: w['col.facts'], num: true },
        ]} rows={value.records.map(r => ({ key: r.id, cells: [
          <Link onPress={() => props.navigate({ place: 'books', sub: 'customers', sheet: sheetOf(r.id) })}>{r.name ?? w.noName}</Link>,
          w[`kind.${r.kind}`], r.sources.join(', '), String(r.facts),
        ] }))} />
      ))}
      {open !== null && <RecordSheet props={props} id={open} />}
    </BooksPage>
  );
}

const ANSWER = { yes: 'answer.yes', no: 'answer.no', 'not-asked': 'answer.not-asked' } as const;

function RecordSheet({ props, id }: { props: BooksProps; id: string }) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'records.get', { id }, recordView, id);
  const value = valueOf(loaded); const zone = useZone(props);
  return (
    <BooksSheet props={props} sub="customers" kind={w['sheet.record']} title={value ? value.name ?? w.noName : w['sheet.record']}>
      {loaded.phase === 'refused' && <Refusal code={loaded.code} language={props.language} />}
      {loaded.phase === 'loading' && !value && <Note>{w.reading}</Note>}
      {value && (
        <div className={s.stack}>
          {value.stoppedOn !== null && <p className={s.amber}>{fill(w.stopped, { when: day(value.stoppedOn, props.language) })}</p>}
          {/* BK-12 "ask about this record": through the frame's setAbout when it offers one (round 4); otherwise not built yet. */}
          <AskAbout props={props} id={value.id} name={value.name ?? value.id} />
          <Section title={w['rec.details']}>
            {value.details.length === 0 ? <Note>{w['empty.details']}</Note> : (
              <Table view={props.view} caption={w['rec.details']} columns={[{ head: w['col.field'], simple: true }, { head: w['col.value'], simple: true }, { head: w['col.source'] }]}
                rows={value.details.map((d, i) => ({ key: `${d.field}-${i}`, cells: [d.field, d.value, d.sourceId] }))} />
            )}
          </Section>
          <Section title={w['rec.owes']}>
            <p><Money value={value.owes.value} receiptId={value.owes.receiptId} language={props.language} onReceipt={props.openReceipt} /></p>
          </Section>
          <Section title={w['rec.timeline']}>
            {value.timeline.length === 0 ? <Note>{w['empty.timeline']}</Note> : (
              <Table view={props.view} caption={w['rec.timeline']} columns={[
                { head: w['col.when'], simple: true }, { head: w['col.kind'], simple: true }, { head: w['col.amount'], num: true, simple: true }, { head: w['col.source'] }, { head: w['col.ref'] },
              ]} rows={value.timeline.map((t, i) => ({ key: `${t.at}-${i}`, cells: [dayIn(t.at, props.language, zone), t.kind, <Recorded value={t.amount} language={props.language} />, t.sourceId, t.ref ?? w.none] }))} />
            )}
          </Section>
          <TimelineMore props={props} id={value.id} zone={zone} />
          <Section title={w['rec.optIn']}>
            <Table view={props.view} caption={w['rec.optIn']} columns={[{ head: w['col.channel'], simple: true }, { head: w['col.answer'], simple: true }, { head: w['col.source'] }, { head: w['col.when'] }]}
              rows={value.optIn.map(o => ({ key: o.channel, cells: [w[`channel.${o.channel}`], w[ANSWER[o.answer]], o.source ?? w.none, o.on ? day(o.on, props.language) : w.none] }))} />
            {!props.viewer && <OptInForm props={props} id={value.id} onDone={reload} />}
          </Section>
          <Holdings props={props} id={value.id} />
        </div>
      )}
    </BooksSheet>
  );
}

function OptInForm({ props, id, onDone }: { props: BooksProps; id: string; onDone: () => void }) {
  const w = useWords(props.language);
  const act = useAct(props.rpc);
  const [channel, setChannel] = useState<'mail' | 'whatsapp'>('mail');
  const [answer, setAnswer] = useState<'yes' | 'no'>('yes');
  const [source, setSource] = useState('');
  const [on, setOn] = useState('');
  const ready = source.trim().length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(on);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    if ((await act.run('records.setOptIn', { id, channel, answer, source: source.trim(), on }, recordView)).ok) onDone();
  };
  return (
    <form className={s.form} aria-label={w.recordAgreement} onSubmit={e => { void submit(e); }}>
      <Choice<'mail' | 'whatsapp'> label={w['col.channel']} options={[{ value: 'mail', label: w['channel.mail'] }, { value: 'whatsapp', label: w['channel.whatsapp'] }]} value={channel} onChange={setChannel} />
      <Choice<'yes' | 'no'> label={w['col.answer']} options={[{ value: 'yes', label: w['answer.yes'] }, { value: 'no', label: w['answer.no'] }]} value={answer} onChange={setAnswer} />
      <Field label={w.agreementSource} value={source} onChange={e => setSource(e.target.value)} />
      <Field label={w.agreementOn} type="date" value={on} onChange={e => setOn(e.target.value)} />
      <Actions><Button submit disabled={!ready || act.busy}>{w.recordAgreement}</Button></Actions>
      <Refusal code={act.refusal} language={props.language} />
    </form>
  );
}

function Holdings({ props, id }: { props: BooksProps; id: string }) {
  const w = useWords(props.language);
  const { loaded } = useReply(props, 'records.holdings', { id }, holdingsReply, id);
  const value = valueOf(loaded);
  return (
    <Section title={w.holdings}>
      {loaded.phase === 'refused' && (loaded.state.kind === 'not-built' ? <Note>{fill(w.notBuiltNamed, { what: w.holdings })}</Note> : <Refusal code={loaded.code} language={props.language} />)}
      {value && (value.stores.length === 0 ? <Note>{w['empty.holdings']}</Note> : (
        <Table view={props.view} caption={w.holdings} columns={[{ head: w['col.store'], simple: true }, { head: w['col.items'], num: true, simple: true }]}
          rows={value.stores.map(h => ({ key: h.store, cells: [h.store, String(h.count)] }))} />
      ))}
      {value && approves(props) && <DeleteFlow props={props} id={id} />}
    </Section>
  );
}

/**
 * BK-20 Delete: what each store will do, the customer id typed to confirm (deleting always
 * waits for a person), then the report per store. Stores the lane cannot empty say who can.
 */
function DeleteFlow({ props, id }: { props: BooksProps; id: string }) {
  const w = useWords(props.language); const m = useMoreWords(props.language); const k = useR4bWords(props.language);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [report, setReport] = useState<DeletionReport | null>(null);
  const act = useAct(props.rpc);
  if (!open) return <Actions><Button danger onClick={() => setOpen(true)}>{m['del.start']}</Button></Actions>;
  if (report) return (
    <div className={s.stack} data-deletion-report={report.id}>
      <h3>{m['del.report']}</h3>
      <p className={report.complete ? s.note : s.amber}>{report.complete ? m['del.complete'] : m['del.partial']}</p>
      <Table view={props.view} caption={m['del.report']} columns={[{ head: w['col.store'], simple: true }, { head: w['col.items'], num: true }, { head: m['del.col.state'], simple: true }, { head: m['del.col.reason'] }]}
        rows={report.rows.map(r => ({ key: r.store, cells: [r.store, String(r.count), <span data-state={r.state}>{m[r.state === 'nothing-held' ? 'del.nothing-held.done' : `del.${r.state}` as const]}</span>, r.reason ?? ''] }))} />
      {report.elsewhere && report.elsewhere.length > 0 && (
        <div data-deletion-elsewhere>
          <h4>{k['del.elsewhere']}</h4>
          <Table view={props.view} caption={k['del.elsewhere']} columns={[{ head: w['col.store'], simple: true }, { head: w['col.items'], num: true }, { head: m['del.col.state'], simple: true }, { head: m['del.col.reason'] }]}
            rows={report.elsewhere.map(r => ({ key: r.store, cells: [k[`del.elsewhere.${r.store}`], String(r.count), <span data-state={r.state}>{m[r.state === 'nothing-held' ? 'del.nothing-held.done' : 'del.not-possible']}</span>, r.reason ?? ''] }))} />
        </div>
      )}
      {report.derived && <Note>{fill(k['del.derived'], { stale: report.derived.staleMarked, model: report.derived.modelReceiptsRemoved, private: report.derived.privateRemoved })}</Note>}
    </div>
  );
  return <DeletePlan props={props} id={id} typed={typed} setTyped={setTyped} busy={act.busy} refusal={act.refusal} onCancel={() => setOpen(false)}
    onDelete={async () => { const outcome = await act.run('records.delete', { id, confirmation: typed }, deletionReport); if (outcome.ok) setReport(outcome.value); }} />;
}

const CORE_STORE_NAMES: readonly string[] = ['facts', 'receipts', 'answers', 'actions', 'conversations'];
function DeletePlan({ props, id, typed, setTyped, busy, refusal, onCancel, onDelete }: {
  props: BooksProps; id: string; typed: string; setTyped: (v: string) => void; busy: boolean; refusal: string | null; onCancel: () => void; onDelete: () => Promise<void>;
}) {
  const w = useWords(props.language); const m = useMoreWords(props.language); const k = useR4bWords(props.language);
  const { loaded, reload } = useReply(props, 'records.deletionPlan', { id }, deletionPlanReply, id);
  const plan = valueOf(loaded);
  if (loaded.phase === 'refused') return loaded.state.kind === 'not-built' ? <Note>{fill(w.notBuiltNamed, { what: w.deleteRequest })}</Note>
    : <span className={s.inline}><Refusal code={loaded.code} language={props.language} /><Button variant="link" onClick={reload}>{w.retry}</Button></span>;
  if (!plan) return <Note>{w.reading}</Note>;
  return (
    <div className={s.stack} data-deletion-plan>
      <h3>{m['del.plan']}</h3>
      <Table view={props.view} caption={m['del.plan']} columns={[{ head: w['col.store'], simple: true }, { head: w['col.items'], num: true }, { head: m['del.col.state'], simple: true }, { head: m['del.col.reason'] }]}
        rows={plan.stores.map(r => ({ key: r.store, cells: [r.store, String(r.count), <span data-state={r.state}>{m[`del.${r.state}`]}</span>,
          <>{r.reason ?? ''}{r.waiting !== undefined && r.waiting > 0 && <span data-waiting={r.waiting}>{r.reason ? ' ' : ''}{fill(k['del.waiting'], { n: r.waiting })}</span>}</>] }))} />
      {!plan.canDelete && plan.stores.some(r => r.state === 'needs-owner') && <p className={s.amber}>{m['del.notAvailable']}</p>}
      {plan.stores.some(r => r.state === 'needs-owner') && plan.sourceDeletion.available && <Note>{m['del.sourceDeletion']}</Note>}
      {plan.coreDeletion?.available === true && plan.canDelete && plan.stores.some(r => r.state === 'can-delete' && CORE_STORE_NAMES.includes(r.store)) && <><Note>{k['del.core']}</Note><Note>{k['del.coreVisible']}</Note></>}
      {plan.canDelete && (
        <form className={s.form} aria-label={m['del.start']} onSubmit={(e: FormEvent) => { e.preventDefault(); if (typed === id) void onDelete(); }}>
          <Note>{m['del.waits']}</Note>
          <Field label={fill(m['del.type'], { id })} value={typed} onChange={e => setTyped(e.target.value)} autoComplete="off" />
          <Actions><Button danger submit disabled={typed !== id || busy}>{m['del.confirm']}</Button><Button variant="link" onClick={onCancel}>{m['del.cancel']}</Button></Actions>
        </form>
      )}
      <Refusal code={refusal} language={props.language} />
    </div>
  );
}

const PAIR_STATE = { open: 'pair.open', joined: 'pair.joined', 'not-same': 'pair.not-same' } as const;

/** A relation or evidence code in the person's language; an unknown code is shown as it came. */
const said = (a: AuditWords, key: string) => Object.hasOwn(a, key) ? a[key as AuditKey] : key.slice(key.indexOf('.') + 1);
function badIdText(a: AuditWords, b: NonNullable<MatchPair['badIds']>[number]) {
  return b.length !== b.expected ? fill(a.badId, { kind: b.kind, n: b.length, expected: b.expected }) : fill(a.badIdFormat, { kind: b.kind });
}

export function Matches(props: BooksProps) {
  const w = useWords(props.language), a = useAuditWords(props.language);
  const [undone, setUndone] = useState<MatchPair | null>(null);
  const { loaded, reload } = useReply(props, 'records.matches', {}, matchesReply);
  const value = valueOf(loaded);
  const act = useAct(props.rpc);
  const can = approves(props);
  const decide = async (left: string, right: string, same: boolean) => { if ((await act.run('records.decideMatch', { left, right, same }, matchPair)).ok) reload(); };
  const undo = async (mergeId: string) => { const outcome = await act.run('records.undoMatch', { mergeId }, matchPair); if (outcome.ok) { setUndone(outcome.value); reload(); } };
  return (
    <BooksPage props={props} sub="matches" title={w['title.matches']} count={value ? String(value.pairs.length) : undefined} loaded={loaded} reload={reload}>
      {value && (value.pairs.length === 0 ? <Note>{w['empty.matches']}</Note> : (
        <Table view={props.view} caption={w['title.matches']} columns={[
          { head: w['col.pair'], simple: true }, { head: w['col.evidence'] }, { head: w['col.reason'], simple: true }, { head: w['col.state'], simple: true },
        ]} rows={value.pairs.map(p => ({ key: `${p.left}|${p.right}`, cells: [
          <span>{p.left} · {p.right}<br /><span className={s.note}>{said(a, `rel.${p.relation}`)}</span></span>,
          p.evidence.length ? <ul className={s.list}>{p.evidence.map((e, i) => <li key={i}>{said(a, `ev.${e}`)}</li>)}</ul> : <span className={s.missing}>{w.noEvidence}</span>,
          // The engine's sentence is English; the person reads the relation and any malformed tax id in their own language.
          <span className={s.stack}>
            {props.language === 'en' ? p.reason : said(a, `rel.${p.relation}`)}
            {(p.badIds ?? []).map((b, i) => <span key={i} className={s.amber} data-bad-id={b.kind}>{badIdText(a, b)}</span>)}
          </span>,
          <span className={s.inline}>
            {w[PAIR_STATE[p.state]]}
            {can && p.state === 'open' && <>
              <Button onClick={() => { void decide(p.left, p.right, true); }} disabled={act.busy}>{w.same}</Button>
              <Button onClick={() => { void decide(p.left, p.right, false); }} disabled={act.busy}>{w.notSame}</Button>
            </>}
            {can && p.state === 'joined' && p.mergeId !== null && <Button onClick={() => { if (p.mergeId !== null) void undo(p.mergeId); }} disabled={act.busy}>{w.undo}</Button>}
          </span>,
        ] }))} />
      ))}
      {undone && (
        <div role="status" className={s.stack} data-undone>
          <p>{(undone.cancelled ?? []).length > 0 ? fill(a.undoCancelled, { n: (undone.cancelled ?? []).length }) : a.undoNothing}</p>
          {(undone.notCancelled ?? []).length > 0 && <p className={s.amber}>{fill(a.undoNotCancelled, { n: undone.notCancelled!.length, ids: undone.notCancelled!.map(x => x.id).join(', ') })}</p>}
        </div>
      )}
      <Refusal code={act.refusal} language={props.language} />
    </BooksPage>
  );
}

export function Conflicts(props: BooksProps) {
  const w = useWords(props.language), a = useAuditWords(props.language);
  const { loaded, reload } = useReply(props, 'records.conflicts', {}, conflictsReply);
  const value = valueOf(loaded);
  const act = useAct(props.rpc);
  const setWinner = async (kind: string, first: string, all: readonly string[]) => {
    if ((await act.run('records.setPrecedence', { kind, sourceIds: [first, ...all.filter(x => x !== first)] }, precedence)).ok) reload();
  };
  return (
    <BooksPage props={props} sub="conflicts" title={w['title.conflicts']} count={value ? String(value.conflicts.length) : undefined} loaded={loaded} reload={reload}>
      {value && value.conflicts.length === 0 && <Note>{w['empty.conflicts']}</Note>}
      {value && value.conflicts.map(c => (
        <Section key={`${c.kind}:${c.entityId}`} title={fill(w.conflictTitle, { kind: c.kind, id: c.entityId })}>
          <div className={s.split}>
            {c.claims.map(claim => (
              <div key={claim.sourceId} className={s.figureBox}>
                <span className={s.figureName}>{claim.sourceId}{c.picked === claim.sourceId && <> · {w.picked}</>}</span>
                <ul className={s.list}>{Object.entries(claim.fields).map(([k, v]) => <li key={k}>{k}: {v}</li>)}</ul>
                {isOwner(props) && <Button variant="link" onClick={() => { void setWinner(c.kind, claim.sourceId, c.claims.map(x => x.sourceId)); }} disabled={act.busy}>{fill(w.makeWin, { source: claim.sourceId, kind: c.kind })}</Button>}
                {prepares(props) && c.picked !== claim.sourceId && (
                  <Button variant="link" onClick={() => props.navigate({ place: 'books', sub: 'trial', sheet: orderSheet(c.kind, [claim.sourceId, ...c.claims.map(x => x.sourceId).filter(x => x !== claim.sourceId)]) })}>
                    {fill(a.tryOrder, { source: claim.sourceId })}
                  </Button>
                )}
              </div>
            ))}
          </div>
          {/* No value is picked unless a rule picks one of these very claims. */}
          {c.picked === null ? <p className={s.amber}>{w.notAgreed}</p> : <Note>{fill(w.ruleUsed, { rule: c.rule ?? '' })} {fill(a.together, { source: c.picked })}</Note>}
        </Section>
      ))}
      {value && value.rules.length > 0 && (
        <Section title={w.rules}>
          <ul className={s.list}>{value.rules.map(r => <li key={r.kind}>{fill(w.ruleLine, { kind: r.kind, order: r.sourceIds.join(' › ') })}</li>)}</ul>
        </Section>
      )}
      <Refusal code={act.refusal} language={props.language} />
    </BooksPage>
  );
}
