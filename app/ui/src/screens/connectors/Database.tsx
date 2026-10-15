/**
 * `#/books/database`: the database road. A plain PostgreSQL, MySQL or SQLite connection, its
 * tables from the database's own catalogue (`connectorsx.plainDb.tables`), a read mapping built
 * from those names only (never SQL text), the read (`connectorsx.plainDb.read`) and its envelope,
 * checked against the database's own COUNT and SUM. Import waits for a person.
 */
import { useState, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Button } from '../../parts/Button';
import { useReply } from '../work/kit/reply.ts';
import type { CxKey } from '../../text/lanes/connectors-ext.ts';
import { connectionsReply, envelope, tablesReply, type Connection, type DbTable, type Envelope } from './contract.ts';
import { buildMapping, DATE_FORMATS, OPTIONAL, type DateFormat, type Engine, type Measure, type MoneyUnit } from './mapping.ts';
import { CxPage, EnvelopeResult, Experimental, Note, Say, Section, Table, approves, prepares, styles as s, useCx, useLiveAct, valueOf, type Cx, type CxProps } from './shared.tsx';

const engineOf = (c: Connection): Engine | null => {
  const value = c.settings?.['engine'];
  return value === 'postgres' || value === 'mysql' || value === 'sqlite' ? value : null;
};
export function Database(props: CxProps) {
  const cx = useCx(props.language);
  const conns = useReply(props, 'connectorsx.connections', {}, connectionsReply);
  const all = valueOf(conns.loaded);
  const rows = all?.filter(c => c.road === 'database') ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = rows.find(c => c.id === chosenId) ?? (rows.length === 1 ? rows[0]! : null);
  return (
    <CxPage props={props} sub="database" title={cx('CX.db.title')} count={all ? String(rows.length) : undefined} loads={[conns.loaded]} reload={conns.reload}>
      <Section title={cx('CX.db.title')} label={cx('CX.db.onlyReads')}>
        <Note>{cx('CX.db.onlyReads')}</Note>
        <Note>{cx('CX.db.password')}</Note>
        {props.view !== 'simple' && <Note>{cx('CX.db.aggregate')}</Note>}
        <Experimental cx={cx} />
      </Section>
      {all && (rows.length === 0 ? <Note>{cx('CX.db.empty')}</Note> : (
        <Table view={props.view} caption={cx('CX.db.title')} columns={[
          { head: cx('CX.col.connection'), simple: true }, { head: cx('CX.col.engine'), simple: true }, { head: cx('CX.col.company') }, { head: cx('CX.col.status') },
          ...(prepares(props) && rows.length > 1 ? [{ head: cx('CX.db.choose'), simple: true }] : []),
        ]} rows={rows.map(c => {
          const engine = engineOf(c);
          return { key: c.id, cells: [
            c.label, engine ? cx(`CX.engine.${engine}`) : <span className={s.missing}>{cx('CX.notKnown')}</span>, c.company, c.status === 'active' ? cx('CX.active') : cx('CX.paused'),
            ...(prepares(props) && rows.length > 1 ? [chosen?.id === c.id ? <span>{cx('CX.db.chosen')}</span> : <Button onClick={() => setChosenId(c.id)}>{cx('CX.db.choose')}</Button>] : []),
          ] };
        })} />
      ))}
      {chosen && !props.viewer && <ReadDatabase key={chosen.id} props={props} conn={chosen} cx={cx} />}
    </CxPage>
  );
}

function ReadDatabase({ props, conn, cx }: { props: CxProps; conn: Connection; cx: Cx }) {
  const act = useLiveAct(props);
  const [tables, setTables] = useState<readonly DbTable[] | null>(null);
  const [result, setResult] = useState<Envelope | null>(null);
  const engine = engineOf(conn);
  const list = async () => {
    const outcome = await act.run('connectorsx.plainDb.tables', { connectionId: conn.id }, tablesReply);
    if (outcome?.ok) setTables(outcome.value);
  };
  return (
    <Section title={conn.label}>
      {approves(props) ? (
        <div className={s.actions}><Button onClick={() => { void list(); }} disabled={act.busy || engine === null}>{act.busy && tables === null ? cx('CX.reading') : cx('CX.db.listTables')}</Button></div>
      ) : <Note>{cx('CX.db.tablesOwner')}</Note>}
      <Say code={act.refusal} cx={cx} />
      {tables && (tables.length === 0 ? <Note>{cx('CX.db.noTables')}</Note> : (
        <>
          {props.view !== 'simple' && (
            <Table view={props.view} caption={cx('CX.db.tables')} columns={[{ head: cx('CX.db.table'), simple: true }, { head: cx('CX.db.columnsOf', { n: '' }).trim() }]}
              rows={tables.map(t => ({ key: `${t.schema ?? ''}.${t.name}`, cells: [t.schema ? `${t.schema}.${t.name}` : t.name, cx('CX.db.columnsOf', { n: t.columns.length })] }))} />
          )}
          {prepares(props) && engine && <MappingFormView props={props} conn={conn} engine={engine} tables={tables} cx={cx} onRead={setResult} />}
        </>
      ))}
      {result && <EnvelopeResult props={props} value={result} onChange={setResult} />}
    </Section>
  );
}

function Select({ label, value, options, onChange, empty }: { label: string; value: string; options: readonly { value: string; label: string }[]; onChange: (v: string) => void; empty?: string }) {
  return (
    <label className={s.selectLabel}>{label}
      <select className={s.select} value={value} onChange={e => onChange(e.target.value)}>
        {empty !== undefined && <option value="">{empty}</option>}
        {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

function MappingFormView({ props, conn, engine, tables, cx, onRead }: { props: CxProps; conn: Connection; engine: Engine; tables: readonly DbTable[]; cx: Cx; onRead: (e: Envelope) => void }) {
  const act = useLiveAct(props);
  const key = (t: DbTable) => `${t.schema ?? ''}\u0000${t.name}`;
  const [tableKey, setTableKey] = useState(key(tables[0]!));
  const table = tables.find(t => key(t) === tableKey) ?? tables[0]!;
  const [columns, setColumns] = useState<Record<string, string>>({});
  const [measure, setMeasure] = useState<Measure>('money');
  const [moneyUnit, setMoneyUnit] = useState<MoneyUnit>('major');
  const [currency, setCurrency] = useState('INR');
  const [countUnit, setCountUnit] = useState('');
  const [constantKind, setConstantKind] = useState('invoice');
  const [kindValues, setKindValues] = useState('');
  const [statusValues, setStatusValues] = useState('');
  const [dateFormat, setDateFormat] = useState<DateFormat>('ISO');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const mapping = buildMapping({ engine, table, columns, measure, moneyUnit, currency, countUnit, constantKind, kindValues, statusValues, dateFormat, from, to });
  const names = table.columns.map(c => ({ value: c.name, label: props.view === 'books' ? `${c.name} (${c.type})` : c.name }));
  const column = (role: string, required: boolean) => (
    <Select key={role} label={cx(`CX.role.${role}` as CxKey)} value={columns[role] ?? ''} options={names} empty={required ? '' : cx('CX.db.pick')}
      onChange={v => setColumns(prev => { const next = { ...prev }; if (v) next[role] = v; else delete next[role]; return next; })} />
  );
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!mapping) return;
    const outcome = await act.run('connectorsx.plainDb.read', { connectionId: conn.id, mapping }, envelope);
    if (outcome?.ok) onRead(outcome.value);
  };
  const simple = props.view === 'simple';
  return (
    <form className={s.form} aria-label={cx('CX.db.mapping')} onSubmit={event => { void submit(event); }}>
      <h3 className={s.sectionTitle}>{cx('CX.db.mapping')}</h3>
      <Select label={cx('CX.db.table')} value={tableKey} options={tables.map(t => ({ value: key(t), label: t.schema ? `${t.schema}.${t.name}` : t.name }))} onChange={v => { setTableKey(v); setColumns({}); }} />
      {column('id', true)}
      {column('date', true)}
      <Choice<DateFormat> label={cx('CX.db.dateFormat')} options={DATE_FORMATS.map(f => ({ value: f, label: cx(`CX.date.${f}`) }))} value={dateFormat} onChange={setDateFormat} />
      <Choice<Measure> label={cx('CX.db.measure')} options={[{ value: 'money', label: cx('CX.measure.money') }, { value: 'count', label: cx('CX.measure.count') }]} value={measure} onChange={setMeasure} />
      {measure === 'money' ? (
        <>
          {column('amount', true)}
          <Choice<MoneyUnit> label={cx('CX.db.moneyUnit')} options={[{ value: 'major', label: cx('CX.unit.major') }, { value: 'minor', label: cx('CX.unit.minor') }]} value={moneyUnit} onChange={setMoneyUnit} />
          {!simple && column('currency', false)}
          {!columns['currency'] && <Field label={cx('CX.db.currency')} value={currency} onChange={e => setCurrency(e.target.value)} problem={/^[A-Z]{3}$/.test(currency.trim()) ? undefined : cx('CX.db.currencyHelp')} />}
        </>
      ) : (
        <>
          {column('quantity', true)}
          <Field label={cx('CX.db.countUnit')} value={countUnit} onChange={e => setCountUnit(e.target.value)} />
        </>
      )}
      {!simple && column('kind', false)}
      {columns['kind']
        ? <label className={s.selectLabel}>{cx('CX.db.kindValues')}<textarea className={s.area} value={kindValues} onChange={e => setKindValues(e.target.value)} /></label>
        : <Field label={cx('CX.db.kind')} value={constantKind} onChange={e => setConstantKind(e.target.value)} problem={constantKind.trim() ? undefined : cx('CX.db.kindHelp')} />}
      {!simple && (
        <>
          {column('status', false)}
          {columns['status'] && <label className={s.selectLabel}>{cx('CX.db.statusValues')}<textarea className={s.area} value={statusValues} onChange={e => setStatusValues(e.target.value)} /></label>}
          {OPTIONAL.map(role => column(role, false))}
        </>
      )}
      <div className={s.split} role="group" aria-label={cx('CX.db.period')}>
        <Field label={cx('CX.from')} type="date" value={from} onChange={e => setFrom(e.target.value)} />
        <Field label={cx('CX.to')} type="date" value={to} onChange={e => setTo(e.target.value)} problem={from && to && from > to ? cx('CX.periodHelp') : undefined} />
      </div>
      {!mapping && <Note>{cx('CX.db.incomplete')}</Note>}
      <div className={s.actions}><Button submit variant="filled" disabled={!mapping || act.busy}>{act.busy ? cx('CX.reading') : cx('CX.db.read')}</Button></div>
      <Say code={act.refusal} cx={cx} />
    </form>
  );
}
