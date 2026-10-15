/** BK-01 Sources, BK-02 one source (sheet), BK-06 fields no recipe covers. */
import { useState, type FormEvent } from 'react';
import { Label } from '../../parts/Label';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Section, Note, Refusal, Actions, Button } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { dayTime, day } from '../work/kit/format.ts';
import { rupeesToPaise } from '../work/StartJob.tsx';
import { anyObject, connectionView, disconnectReply, envelopeView, proposalView, signInReply, sourceReply, sourcesReply, unmappedReply, type EnvelopeView, type SourceRow } from './contract.ts';
import { BooksPage, BooksSheet, ConfirmButton, Link, MonthSquares, Recorded, Table, approves, fill, idOf, isOwner, prepares, sheetOf, styles as s, useWords, valueOf, type BooksProps, type W } from './shared.tsx';
import { EnvelopeCard, Say, TotalText, r2Styles } from './r2-parts.tsx';
import { useR2, type R2 } from './words-r2.ts';
import { useAuditWords } from './words-audit.ts';
import { LaneLinks, SourceMore, TallyCompaniesPart } from './r4a-parts.tsx';

const WAY = { files: 'way.files', 'signed-in': 'way.signed-in', 'this-computer': 'way.this-computer' } as const;

function lookAt(row: SourceRow, w: W, r: R2, language: BooksProps['language']): string {
  if (!row.connected) return w.notConnected;
  const parts: string[] = [];
  if (row.connection?.status === 'paused') parts.push(r['conn.paused']);
  if (row.lastFailure) parts.push(fill(r.lastFailure, { when: day(row.lastFailure.at, language), code: row.lastFailure.code ?? r.noCode }));
  if (row.stale) parts.push(r.staleWord);
  if (row.refused > 0) parts.push(fill(w.refusedFiles, { n: row.refused }));
  if (row.unmapped > 0) parts.push(fill(w.unmappedHere, { n: row.unmapped }));
  return parts.length ? parts.join(' · ') : w.nothingToLook;
}

export function Sources(props: BooksProps) {
  const w = useWords(props.language), r = useR2(props.language), a = useAuditWords(props.language);
  const { loaded, reload } = useReply(props, 'books.sources', {}, sourcesReply);
  const value = valueOf(loaded);
  const open = idOf(props.address.sheet);
  return (
    <BooksPage props={props} sub="sources" title={w['title.sources']} count={value ? String(value.rows.length) : undefined} loaded={loaded} reload={reload}
      aside={<Button onClick={() => props.navigate({ place: 'books', sub: 'add' })}>{r.addSource}</Button>}>
      {value && (value.rows.length === 0 ? <Note>{w['empty.sources']}</Note> : (
        <Table view={props.view} caption={w['title.sources']} columns={[
          { head: w['col.source'], simple: true }, { head: w['col.way'] }, { head: w['col.scope'] }, { head: w['col.lastRead'], simple: true },
          { head: w['col.months'], simple: true }, { head: w['col.lookAt'] },
        ]} rows={value.rows.map(row => ({ key: row.sourceId, cells: [
          <span className={s.inline}>
            <Link onPress={() => props.navigate({ place: 'books', sub: 'sources', sheet: sheetOf(row.sourceId) })}>{row.system}</Link>
            {row.experimental && <Label kind="experimental" />}
            {/* Simple drops "what to look at": the states that matter most stay beside the name. */}
            {props.view === 'simple' && !row.connected && <span className={s.missing}>{w.notConnected}</span>}
            {props.view === 'simple' && row.connection?.status === 'paused' && <span className={s.note}>{a['src.paused']}</span>}
            {props.view === 'simple' && row.lastFailure && <span className={s.amber}>{a['src.failedRead']}</span>}
          </span>,
          w[WAY[row.way]], row.scope ?? w.wholeBusiness,
          row.lastReadAt ? dayTime(row.lastReadAt, props.language) : w.neverRead,
          <MonthSquares months={row.months} language={props.language} />,
          lookAt(row, w, r, props.language),
        ] }))} />
      ))}
      {value && value.unmappedFields > 0 && (
        <p className={s.note}><Link onPress={() => props.navigate({ place: 'books', sub: 'unmapped' })}>{fill(w.unmappedLink, { n: value.unmappedFields })}</Link></p>
      )}
      {value && !value.freshness.available && <Note>{fill(w.notBuiltNamed, { what: w.freshness })}</Note>}
      {/* Round 4: scheduled reads, the database road and Tally on another computer are connectors-ext's own Books places. */}
      <LaneLinks props={props} lanes={['connectors-ext']} />
      {open !== null && <SourceSheet props={props} sourceId={open} onChanged={reload} />}
    </BooksPage>
  );
}

function SourceSheet({ props, sourceId, onChanged }: { props: BooksProps; sourceId: string; onChanged: () => void }) {
  const w = useWords(props.language), r = useR2(props.language);
  const { loaded, reload } = useReply(props, 'books.source', { sourceId }, sourceReply, sourceId);
  const act = useAct(props.rpc);
  const value = valueOf(loaded);
  const close = () => props.navigate({ place: 'books', sub: 'sources' });
  const remove = async () => {
    const outcome = await act.run('sources.delete', { id: sourceId }, anyObject);
    if (outcome.ok) { onChanged(); close(); }
  };
  const conn = value?.connection ?? null;
  return (
    <BooksSheet props={props} sub="sources" kind={w['sheet.source']} title={value?.row.system ?? w['sheet.source']}>
      {loaded.phase === 'refused' && <Refusal code={loaded.code} language={props.language} />}
      {loaded.phase === 'loading' && !value && <Note>{w.reading}</Note>}
      {value && (
        <div className={s.stack}>
          <Note>{w[WAY[value.row.way]]} · {value.row.lastReadAt ? fill(w.lastReadOn, { when: dayTime(value.row.lastReadAt, props.language) }) : w.neverRead}</Note>
          <MonthSquares months={value.row.months} language={props.language} />
          <SourceMore props={props} sourceId={sourceId} />
          {conn && <ConnectionPart props={props} conn={conn} onChanged={() => { reload(); onChanged(); }} onRemoved={() => { onChanged(); if (value.kinds.length === 0) close(); else reload(); }} />}
          <Section title={w['src.kinds']}>
            {value.kinds.length === 0 ? <Note>{w['empty.kinds']}</Note> : (
              <Table view={props.view} caption={w['src.kinds']} columns={[{ head: w['col.kind'], simple: true }, { head: w['col.rows'], num: true, simple: true }]}
                rows={value.kinds.map(k => ({ key: k.kind, cells: [k.kind, String(k.rows)] }))} />
            )}
          </Section>
          {(value.reads.length > 0 || !conn) && (
            <Section title={w['src.reads']}>
              {value.reads.length === 0 ? <Note>{w['empty.reads']}</Note> : (
                <Table view={props.view} caption={w['src.reads']} columns={[
                  { head: w['col.when'], simple: true }, { head: w['col.format'] }, { head: w['col.rows'], num: true }, { head: w['col.sourceTotal'], num: true, simple: true }, { head: w['col.reconciled'] },
                ]} rows={value.reads.map(x => ({ key: x.id, cells: [dayTime(x.at, props.language), x.format, String(x.rows), <Recorded value={x.totals} language={props.language} />, x.reconciled ? w.yes : w.no] }))} />
              )}
            </Section>
          )}
          {conn && <ReadHistory props={props} envelopes={value.envelopes ?? []} />}
          <Section title={w['src.refusals']}>
            {value.refusals.length === 0 ? <Note>{w['empty.refusals']}</Note> : (
              <ul className={s.list}>{value.refusals.map((x, i) => <li key={`${x.at}-${i}`}>{day(x.at, props.language)} · <span className="fig">{x.codes.join(', ')}</span></li>)}</ul>
            )}
          </Section>
          <Section title={w['src.unmapped']}>
            {value.unmappedFields.length === 0 ? <Note>{w['empty.unmappedHere']}</Note> : <ul className={s.list}>{value.unmappedFields.map(f => <li key={f}>{f}</li>)}</ul>}
          </Section>
          {!props.viewer && (
            <Section title={w['src.do']}>
              {!conn && (value.connectors?.available ? <Note>{r['say.CONNECTION_REQUIRED']}</Note> : <Note>{fill(w.notBuiltNamed, { what: w.readNowSignIn })}</Note>)}
              {isOwner(props) && (!conn || value.kinds.length + value.reads.length > 0) && (
                <Actions>
                  <ConfirmButton label={w.remove} confirm={fill(w.removeConfirm, { name: value.row.system })} keep={w.keep} onConfirm={() => { void remove(); }} disabled={act.busy} />
                </Actions>
              )}
              <Refusal code={act.refusal} language={props.language} />
            </Section>
          )}
        </div>
      )}
    </BooksSheet>
  );
}

type Conn = NonNullable<NonNullable<ReturnType<typeof sourceReply>['connection']>>;
const thisMonth = () => { const d = new Date(); const ym = d.toISOString().slice(0, 7); return { from: `${ym}-01`, to: d.toISOString().slice(0, 10) }; };

/** BK-02 actions on a connection: read now, import after review, pause, sign in again, remove. */
function ConnectionPart({ props, conn, onChanged, onRemoved }: { props: BooksProps; conn: Conn; onChanged: () => void; onRemoved: () => void }) {
  const w = useWords(props.language), r = useR2(props.language);
  const act = useAct(props.rpc);
  const [envelope, setEnvelope] = useState<EnvelopeView | null>(null);
  const [signIn, setSignIn] = useState<ReturnType<typeof signInReply> | null>(null);
  const [operation, setOperation] = useState(conn.operations[0]?.id ?? '');
  const [range, setRange] = useState(thisMonth);
  const [total, setTotal] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const read = async (event: FormEvent) => {
    event.preventDefault();
    const minor = total.trim() ? rupeesToPaise(total) : null;
    if (total.trim() && minor === null) return;
    const outcome = await act.run('books.readNow', { sourceId: conn.sourceId, operation, period: range, ...(minor ? { reportTotals: { total: minor } } : {}) }, envelopeView);
    if (outcome.ok) { setEnvelope(outcome.value); onChanged(); }
  };
  const settle = async (method: 'books.importRead' | 'books.discardRead') => {
    if (!envelope) return;
    const outcome = await act.run(method, { envelopeId: envelope.id }, envelopeView);
    if (outcome.ok) { setEnvelope(outcome.value); onChanged(); }
  };
  const pause = async () => { if ((await act.run('books.pause', { sourceId: conn.sourceId, paused: conn.status === 'active' }, connectionView)).ok) onChanged(); };
  const again = async () => { const outcome = await act.run('books.signIn', { sourceId: conn.sourceId }, signInReply); if (outcome.ok) setSignIn(outcome.value); };
  const disconnect = async () => {
    const outcome = await act.run('books.disconnect', { sourceId: conn.sourceId }, disconnectReply);
    if (outcome.ok) { setNote(outcome.value.factsKept ? `${r.connectionRemoved} ${r.factsKept}` : r.connectionRemoved); onRemoved(); }
  };
  return (
    <Section title={r.connection}>
      <Note>{fill(r.wayIn, { way: r[`road.${conn.road}`] })} · {conn.status === 'active' ? r['conn.active'] : r['conn.paused']} · {conn.company}</Note>
      {prepares(props) && conn.status === 'active' && (conn.operations.length === 0 ? <Note>{r.noReadsOffered}</Note> : (
        <form className={s.form} aria-label={r.readNow} onSubmit={event => { void read(event); }}>
          {conn.operations.length > 1 && <Choice<string> label={r.whatToRead} options={conn.operations.map(o => ({ value: o.id, label: o.label }))} value={operation} onChange={setOperation} />}
          {conn.operations.find(o => o.id === operation)?.limitation && <Note>{conn.operations.find(o => o.id === operation)!.limitation}</Note>}
          <div className={s.split}>
            <Field label={r.from} type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} />
            <Field label={r.to} type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} />
          </div>
          <Field label={r.reportTotal} inputMode="decimal" prefix="₹" value={total} onChange={e => setTotal(e.target.value)} problem={total.trim() && rupeesToPaise(total) === null ? r.reportTotalHelp : undefined} />
          <Actions><Button submit disabled={act.busy || !operation}>{act.busy ? r.reading : r.readNow}</Button></Actions>
        </form>
      ))}
      {envelope && (
        <div className={s.stack}>
          <EnvelopeCard envelope={envelope} language={props.language} />
          {envelope.waiting && prepares(props) && (
            <Actions>
              <Button variant="filled" onClick={() => { void settle('books.importRead'); }} disabled={act.busy}>{r.import}</Button>
              <Button variant="link" onClick={() => { void settle('books.discardRead'); }} disabled={act.busy}>{r.setAside}</Button>
            </Actions>
          )}
        </div>
      )}
      {approves(props) && (
        <Actions>
          <Button onClick={() => { void pause(); }} disabled={act.busy}>{conn.status === 'active' ? r.pause : r.resume}</Button>
          <Button onClick={() => { void again(); }} disabled={act.busy}>{r.signInAgain}</Button>
          <ConfirmButton label={r.removeConnection} confirm={fill(r.removeConnectionConfirm, { name: conn.label })} keep={w.keep} onConfirm={() => { void disconnect(); }} disabled={act.busy} />
        </Actions>
      )}
      {signIn && (signIn.method === 'browser' ? (
        <div className={s.stack}>
          <p>{r.signInBrowser}</p>
          <p className={s.note}>{r.signInCopy}</p>
          {/* Shown as text; the screen never opens a browser by itself. The host opens it on the person's press. */}
          <p className={r2Styles.address}>{signIn.url}</p>
          {props.openLink && <Actions><Button onClick={() => props.openLink?.(signIn.url)}>{r.signInOpen}</Button></Actions>}
          {signIn.expiresInSeconds > 0 && <Note>{fill(r.signInExpires, { n: Math.round(signIn.expiresInSeconds / 60) })}</Note>}
          {signIn.note && <Note>{signIn.note}</Note>}
        </div>
      ) : <p>{signIn.instruction}</p>)}
      {conn.group === 'tally' && conn.road === 'interface' && <TallyCompaniesPart props={props} sourceId={conn.sourceId} />}
      {note && <p role="status">{note}</p>}
      <Say code={act.refusal} language={props.language} />
    </Section>
  );
}

function ReadHistory({ props, envelopes }: { props: BooksProps; envelopes: readonly EnvelopeView[] }) {
  const r = useR2(props.language), w = useWords(props.language);
  return (
    <Section title={r.history}>
      {envelopes.length === 0 ? <Note>{r['empty.history']}</Note> : (
        <Table view={props.view} caption={r.history} columns={[
          { head: w['col.when'], simple: true }, { head: r['col.what'] }, { head: r['col.status'], simple: true }, { head: w['col.rows'], num: true },
          { head: r['col.ours'], num: true }, { head: r['col.theirs'], num: true, simple: true },
        ]} rows={envelopes.map(e => ({ key: e.id, cells: [
          dayTime(e.at, props.language), e.operation,
          <span className={e.status === 'accepted' ? undefined : s.amber}>{r[`status.${e.status}`]}{e.refusal ? ` · ${e.refusal.code}` : e.abstention ? ` · ${e.abstention.reason}` : ''}</span>,
          String(e.rows), <TotalText value={e.total.ours} measure={e.total.measure} unit={e.total.unit} />, <TotalText value={e.total.theirs} measure={e.total.measure} unit={e.total.unit} />,
        ] }))} />
      )}
    </Section>
  );
}

export function Unmapped(props: BooksProps) {
  const w = useWords(props.language), r = useR2(props.language);
  const { loaded, reload } = useReply(props, 'books.unmapped', {}, unmappedReply);
  const value = valueOf(loaded);
  const [mapping, setMapping] = useState<{ field: string; sourceId: string } | null>(null);
  return (
    <BooksPage props={props} sub="unmapped" title={w['title.unmapped']} count={value ? String(value.fields.length) : undefined} loaded={loaded} reload={reload}>
      {value && (value.fields.length === 0 ? <Note>{w['empty.unmapped']}</Note> : (
        <Table view={props.view} caption={w['title.unmapped']} columns={[
          { head: w['col.field'], simple: true }, { head: w['col.type'] }, { head: w['col.filled'], simple: true }, { head: w['col.sources'] }, { head: w['col.do'], simple: true },
        ]} rows={value.fields.map(f => ({ key: `${f.field}:${f.recipeId ?? ''}:${f.sourceIds.join(',')}`, cells: [
          f.field, w[`type.${f.type}`],
          f.filled === null ? <span className={s.missing}>{w['filled.unknown']}</span> : fill(w.filledOf, { n: f.filled.rows, of: f.filled.of }),
          f.sourceIds.join(', '),
          f.origin === 'connector'
            ? (f.recipeId ? <Link onPress={() => props.navigate({ place: 'books', sub: 'recipes', sheet: sheetOf(`r:${f.recipeId}`) })}>{r.connectorField}</Link> : r.connectorField)
            : prepares(props) && f.mappable !== false && f.sourceIds[0] ? <Button onClick={() => setMapping({ field: f.field, sourceId: f.sourceIds[0]! })}>{r.mapThis}</Button> : null,
        ] }))} />
      ))}
      {mapping && <MapField props={props} field={mapping.field} sourceId={mapping.sourceId} />}
    </BooksPage>
  );
}

const TYPES = ['string', 'money', 'date', 'integer', 'boolean'] as const;
/** BK-06 "Map this field": the person names the meaning; the learning lane's grammar decides what can be true. */
function MapField({ props, field, sourceId }: { props: BooksProps; field: string; sourceId: string }) {
  const r = useR2(props.language);
  const act = useAct(props.rpc);
  const [target, setTarget] = useState('');
  const [type, setType] = useState<typeof TYPES[number]>('string');
  const ok = /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(target.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!ok) return;
    const outcome = await act.run('books.mapField', { sourceId, field, target: target.trim(), type }, proposalView);
    if (outcome.ok) props.navigate({ place: 'books', sub: 'recipes', sheet: sheetOf(`p:${outcome.value.id}`) });
  };
  return (
    <Section title={`${r.mapThis}: ${field}`}>
      <form className={s.form} aria-label={r.mapThis} onSubmit={event => { void submit(event); }}>
        <Field label={r.mapMeaning} value={target} onChange={e => setTarget(e.target.value)} />
        <Choice<typeof TYPES[number]> label={r.mapType} options={TYPES.map(t => ({ value: t, label: r[`type.${t}`] }))} value={type} onChange={setType} />
        <Actions><Button submit disabled={!ok || act.busy}>{r.propose}</Button></Actions>
        <Say code={act.refusal} language={props.language} />
      </form>
    </Section>
  );
}
