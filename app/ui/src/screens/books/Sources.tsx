/** BK-01 Sources, BK-02 one source (sheet), BK-06 fields no recipe covers. */
import { Label } from '../../parts/Label';
import { Section, Note, Refusal, Actions } from '../work/kit/Page';
import { useAct, useReply } from '../work/kit/reply.ts';
import { dayTime, day } from '../work/kit/format.ts';
import { anyObject, sourceReply, sourcesReply, unmappedReply, type SourceRow } from './contract.ts';
import { BooksPage, BooksSheet, ConfirmButton, Link, MonthSquares, Recorded, Table, fill, idOf, isOwner, sheetOf, styles as s, useWords, valueOf, type BooksProps, type W } from './shared.tsx';

const WAY = { files: 'way.files', 'signed-in': 'way.signed-in', 'this-computer': 'way.this-computer' } as const;

function lookAt(row: SourceRow, w: W): string {
  if (!row.connected) return w.notConnected;
  const parts: string[] = [];
  if (row.refused > 0) parts.push(fill(w.refusedFiles, { n: row.refused }));
  if (row.unmapped > 0) parts.push(fill(w.unmappedHere, { n: row.unmapped }));
  return parts.length ? parts.join(' · ') : w.nothingToLook;
}

export function Sources(props: BooksProps) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'books.sources', {}, sourcesReply);
  const value = valueOf(loaded);
  const open = idOf(props.address.sheet);
  return (
    <BooksPage props={props} sub="sources" title={w['title.sources']} count={value ? String(value.rows.length) : undefined} loaded={loaded} reload={reload}>
      {value && (value.rows.length === 0 ? <Note>{w['empty.sources']}</Note> : (
        <Table view={props.view} caption={w['title.sources']} columns={[
          { head: w['col.source'], simple: true }, { head: w['col.way'] }, { head: w['col.scope'] }, { head: w['col.lastRead'], simple: true },
          { head: w['col.months'], simple: true }, { head: w['col.lookAt'] },
        ]} rows={value.rows.map(row => ({ key: row.sourceId, cells: [
          <span className={s.inline}>
            <Link onPress={() => props.navigate({ place: 'books', sub: 'sources', sheet: sheetOf(row.sourceId) })}>{row.system}</Link>
            {row.experimental && <Label kind="experimental" />}
          </span>,
          w[WAY[row.way]], row.scope ?? w.wholeBusiness,
          row.lastReadAt ? dayTime(row.lastReadAt, props.language) : w.neverRead,
          <MonthSquares months={row.months} language={props.language} />,
          lookAt(row, w),
        ] }))} />
      ))}
      {value && value.unmappedFields > 0 && (
        <p className={s.note}><Link onPress={() => props.navigate({ place: 'books', sub: 'unmapped' })}>{fill(w.unmappedLink, { n: value.unmappedFields })}</Link></p>
      )}
      {value && !value.freshness.available && <Note>{fill(w.notBuiltNamed, { what: w.freshness })}</Note>}
      {open !== null && <SourceSheet props={props} sourceId={open} onRemoved={reload} />}
    </BooksPage>
  );
}

function SourceSheet({ props, sourceId, onRemoved }: { props: BooksProps; sourceId: string; onRemoved: () => void }) {
  const w = useWords(props.language);
  const { loaded } = useReply(props, 'books.source', { sourceId }, sourceReply, sourceId);
  const act = useAct(props.rpc);
  const value = valueOf(loaded);
  const close = () => props.navigate({ place: 'books', sub: 'sources' });
  const remove = async () => {
    const outcome = await act.run('sources.delete', { id: sourceId }, anyObject);
    if (outcome.ok) { onRemoved(); close(); }
  };
  return (
    <BooksSheet props={props} sub="sources" kind={w['sheet.source']} title={value?.row.system ?? w['sheet.source']}>
      {loaded.phase === 'refused' && <Refusal code={loaded.code} language={props.language} />}
      {loaded.phase === 'loading' && !value && <Note>{w.reading}</Note>}
      {value && (
        <div className={s.stack}>
          <Note>{w[WAY[value.row.way]]} · {value.row.lastReadAt ? fill(w.lastReadOn, { when: dayTime(value.row.lastReadAt, props.language) }) : w.neverRead}</Note>
          <MonthSquares months={value.row.months} language={props.language} />
          <Section title={w['src.kinds']}>
            {value.kinds.length === 0 ? <Note>{w['empty.kinds']}</Note> : (
              <Table view={props.view} caption={w['src.kinds']} columns={[{ head: w['col.kind'], simple: true }, { head: w['col.rows'], num: true, simple: true }]}
                rows={value.kinds.map(k => ({ key: k.kind, cells: [k.kind, String(k.rows)] }))} />
            )}
          </Section>
          <Section title={w['src.reads']}>
            {value.reads.length === 0 ? <Note>{w['empty.reads']}</Note> : (
              <Table view={props.view} caption={w['src.reads']} columns={[
                { head: w['col.when'], simple: true }, { head: w['col.format'] }, { head: w['col.rows'], num: true }, { head: w['col.sourceTotal'], num: true, simple: true }, { head: w['col.reconciled'] },
              ]} rows={value.reads.map(r => ({ key: r.id, cells: [dayTime(r.at, props.language), r.format, String(r.rows), <Recorded value={r.totals} language={props.language} />, r.reconciled ? w.yes : w.no] }))} />
            )}
          </Section>
          <Section title={w['src.refusals']}>
            {value.refusals.length === 0 ? <Note>{w['empty.refusals']}</Note> : (
              <ul className={s.list}>{value.refusals.map((r, i) => <li key={`${r.at}-${i}`}>{day(r.at, props.language)} · <span className="fig">{r.codes.join(', ')}</span></li>)}</ul>
            )}
          </Section>
          <Section title={w['src.unmapped']}>
            {value.unmappedFields.length === 0 ? <Note>{w['empty.unmappedHere']}</Note> : <ul className={s.list}>{value.unmappedFields.map(f => <li key={f}>{f}</li>)}</ul>}
          </Section>
          {!props.viewer && (
            <Section title={w['src.do']}>
              <Note>{fill(w.notBuiltNamed, { what: w.readNowSignIn })}</Note>
              {isOwner(props) && (
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

export function Unmapped(props: BooksProps) {
  const w = useWords(props.language);
  const { loaded, reload } = useReply(props, 'books.unmapped', {}, unmappedReply);
  const value = valueOf(loaded);
  return (
    <BooksPage props={props} sub="unmapped" title={w['title.unmapped']} count={value ? String(value.fields.length) : undefined} loaded={loaded} reload={reload}>
      {value && (value.fields.length === 0 ? <Note>{w['empty.unmapped']}</Note> : (
        <Table view={props.view} caption={w['title.unmapped']} columns={[
          { head: w['col.field'], simple: true }, { head: w['col.type'] }, { head: w['col.filled'], simple: true }, { head: w['col.sources'] },
        ]} rows={value.fields.map(f => ({ key: `${f.field}:${f.sourceIds.join(',')}`, cells: [
          f.field, w[`type.${f.type}`],
          f.filled === null ? <span className={s.missing}>{w['filled.unknown']}</span> : fill(w.filledOf, { n: f.filled.rows, of: f.filled.of }),
          f.sourceIds.join(', '),
        ] }))} />
      ))}
      {value && value.fields.length > 0 && !props.viewer && <Note>{fill(w.notBuiltNamed, { what: w.mapField })}</Note>}
    </BooksPage>
  );
}
