/**
 * Shared pieces for the connectors-ext Books sub-places: the page frame and its states, the
 * lane's words, refusals in plain words, a table that drops detail columns in Simple, the twelve
 * month squares, and one read's envelope with Import and Set aside. Display only: every figure
 * arrives from the engine as exact text and is formatted, never computed here.
 */
import { useState, type ReactNode } from 'react';
import type { Address, Language, View } from '../../app/presentation.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { PageHeader } from '../../app/PageHeader';
import { State } from '../../patterns/States';
import { Button } from '../../parts/Button';
import { Label } from '../../parts/Label';
import { money } from '../../format/money.ts';
import { words as LANE, type CxKey } from '../../text/lanes/connectors-ext.ts';
import { fill } from '../work/kit/words.ts';
import { dayTime } from '../work/kit/format.ts';
import { NOT_BUILT_CODES, stateFor, useAct, type Loaded, type Outcome } from '../work/kit/reply.ts';
import type { Check } from '../work/kit/validate.ts';
import { envelope as envelopeCheck, waiting, type Envelope, type MonthState } from './contract.ts';
import s from './Connectors.module.css';

export type CxProps = PlaceRenderProps;
export type Cx = (key: CxKey, values?: Readonly<Record<string, string | number>>) => string;
export function useCx(language: Language): Cx {
  const table = LANE[language] ?? LANE.en;
  return (key, values) => fill(table[key], values);
}
const hasSay = (code: string): boolean => Object.hasOwn(LANE.en, `CX.say.${code}`);
export const sayKey = (code: string) => `CX.say.${code}` as CxKey;

/** Seats that may change a schedule or list a database's tables (engine permission `admin`). */
export const approves = (props: CxProps) => !props.viewer && (props.member.role === 'owner' || props.member.role === 'cofounder');
/** Seats that may prepare: read, import after review, make the Tally script. Anyone but a viewer. */
export const prepares = (props: CxProps) => !props.viewer && props.member.role !== 'viewer';

export const SUBS = ['scheduled', 'database', 'tally-export'] as const;
export type CxSub = typeof SUBS[number];
export const isCxSub = (value: string | undefined): value is CxSub => (SUBS as readonly string[]).includes(value ?? '');

/** A refusal in plain words: "not installed in this build" for a missing method, the lane's sentence when it has one, else the code. */
export function Say({ code, cx, what }: { code: string | null; cx: Cx; what?: string | undefined }) {
  if (code === null) return null;
  if (NOT_BUILT_CODES.has(code)) return <p className={s.note} role="status" data-state="not-built">{what ? cx('CX.notInstalledNamed', { what }) : cx('CX.notInstalled')}</p>;
  return <p className={s.amber} role="alert" data-code={code}>{hasSay(code) ? cx(sayKey(code)) : cx('CX.refusedCode', { code })}</p>;
}

/** The fixed state of a page that has nothing to show yet, or null when it is ready to draw. */
function PageState({ loads, reload, cx }: { loads: readonly Loaded<unknown>[]; reload?: (() => void) | undefined; cx: Cx }) {
  const refused = loads.find(l => l.phase === 'refused');
  if (refused && refused.phase === 'refused') {
    const state = stateFor(refused.code);
    if (state.kind === 'failed' || state.kind === 'not-built') {
      return (
        <div className={s.stack}>
          <Say code={refused.code} cx={cx} />
          {state.kind === 'failed' && reload && <div className={s.actions}><Button variant="link" onClick={reload}>{cx('CX.retry')}</Button></div>}
        </div>
      );
    }
    return <State state={state} />;
  }
  if (loads.some(l => l.phase === 'loading' && l.last === undefined)) return <p className={s.note} role="status">{cx('CX.reading')}</p>;
  return null;
}

const subName = (sub: CxSub | 'sources', cx: Cx) => sub === 'sources' ? cx('CX.nav.sources') : cx(`SH-01.sub.books.${sub}` as CxKey);

/** The page frame: where you are, the title, the Books sub-places this lane draws, then the page or its state. */
export function CxPage({ props, sub, title, count, loads, reload, children }: {
  props: CxProps; sub: CxSub; title: string; count?: string | undefined; loads: readonly Loaded<unknown>[]; reload?: (() => void) | undefined; children?: ReactNode;
}) {
  const cx = useCx(props.language);
  const state = <PageState loads={loads} reload={reload} cx={cx} />;
  const blocked = loads.some(l => l.phase === 'refused' || (l.phase === 'loading' && l.last === undefined));
  return (
    <div className={s.page} data-place="books" data-sub={sub} data-view={props.view}>
      <PageHeader where={`${cx('CX.books')} · ${subName(sub, cx)}`} title={title} count={count === undefined ? undefined : { exact: null, display: count }} />
      <nav aria-label={cx('CX.books')}>
        <ul className={s.subs}>
          {(['sources', ...SUBS] as const).map(id => (
            <li key={id}>
              <a className={s.sub} href={`#/books/${id}`} aria-current={id === sub ? 'page' : undefined}
                onClick={event => { event.preventDefault(); props.navigate({ place: 'books', sub: id }); }}>{subName(id, cx)}</a>
            </li>
          ))}
        </ul>
      </nav>
      {props.viewer && <p className={s.note}>{cx('CX.readOnly')}</p>}
      {blocked ? state : children}
    </div>
  );
}

export function Section({ title, children, label }: { title: string; children: ReactNode; label?: string }) {
  return <section className={s.section} aria-label={label ?? title}><h2 className={s.sectionTitle}>{title}</h2>{children}</section>;
}
export function Note({ children, tone }: { children: ReactNode; tone?: 'amber' }) {
  return <p className={tone === 'amber' ? s.amber : s.note}>{children}</p>;
}
export function Experimental({ cx }: { cx: Cx }) {
  return <p className={s.note}><Label kind="experimental" /> {cx('CX.experimental')}</p>;
}

export interface Column { head: string; num?: boolean; simple?: boolean }
/** A table that is denser in Books and drops the columns not marked `simple` in Simple. */
export function Table({ view, caption, columns, rows }: { view: View; caption: string; columns: readonly Column[]; rows: readonly { key: string; cells: readonly ReactNode[] }[] }) {
  const keep = columns.map(c => view !== 'simple' || c.simple === true);
  return (
    <table className={[s.table, s[`t-${view}`]].join(' ')}>
      <caption className="sr">{caption}</caption>
      <thead><tr>{columns.map((c, i) => keep[i] && <th key={c.head} scope="col" className={c.num ? s.num : undefined}>{c.head}</th>)}</tr></thead>
      <tbody>{rows.map(r => <tr key={r.key}>{r.cells.map((cell, i) => keep[i] && <td key={i} className={columns[i]?.num ? s.num : undefined}>{cell}</td>)}</tr>)}</tbody>
    </table>
  );
}

function monthName(ym: string, language: Language): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${ym}-01T00:00:00.000Z`));
}
/** Twelve small squares, oldest first. Each has its month and state in words; a month not loaded is never zero. */
export function MonthSquares({ months, language }: { months: readonly { month: string; status: MonthState }[]; language: Language }) {
  const cx = useCx(language);
  return (
    <ul className={s.months} aria-label={cx('CX.col.months')}>
      {months.map(m => {
        const name = cx('CX.monthSquare', { month: monthName(m.month, language), state: cx(`CX.month.${m.status}` as CxKey) });
        return <li key={m.month} role="img" aria-label={name} title={name} data-state={m.status}><span className={[s.square, s[`m-${m.status}`]].join(' ')} aria-hidden="true" /></li>;
      })}
    </ul>
  );
}

/** One figure a source recorded or Chausar counted: exact text, never computed. Missing is words. */
export function Exact({ value, unit, rows, cx }: { value: string | number | null | undefined; unit: string; rows?: boolean; cx: Cx }) {
  if (value === null || value === undefined) return <span className={s.missing}>{cx('CX.notKnown')}</span>;
  const digits = String(value);
  if (rows) return <span className="fig">{cx('CX.rowsValue', { n: digits })}</span>;
  if (unit === 'INR' && /^-?\d{1,30}$/.test(digits)) return <span className="fig">{money(digits)}</span>;
  if (/^[A-Z]{3}$/.test(unit)) return <span className="fig">{cx('CX.minorUnits', { value: digits, unit })}</span>;
  return <span className="fig">{unit ? `${digits} ${unit}` : digits}</span>;
}

const CHECK_KEYS = new Set(['source-total', 'source-row-count', 'closing-balance', 'opening-balance', 'running-balance']);

/** A change request whose reply is checked, and that is dropped when the address is no longer live. */
export function useLiveAct(props: CxProps) {
  const act = useAct(props.rpc);
  const address: Address = props.address;
  const run = async <T,>(method: string, payload: Record<string, unknown>, check: Check<T>): Promise<Outcome<T> | null> => {
    const outcome = await act.run(method, payload, check);
    return props.live(address) ? outcome : null;
  };
  return { busy: act.busy, refusal: act.refusal, run, clear: act.clear };
}

/**
 * One read's envelope: status in words, the checks with Chausar's figure and the source's own
 * figure side by side (exact strings, as sent), refusal or the one question, unmapped fields, and
 * Import or Set aside while it waits. Nothing from a refused or abstained read is offered for import.
 */
export function EnvelopeResult({ props, value, onChange }: { props: CxProps; value: Envelope; onChange: (next: Envelope) => void }) {
  const cx = useCx(props.language);
  const act = useLiveAct(props);
  const [setAside, setSetAside] = useState(false);
  const e = value;
  const unit = e.observed.unit;
  const settle = async (method: 'connectorsx.importCommit' | 'connectorsx.discard') => {
    const outcome = await act.run(method, { envelopeId: e.id }, envelopeCheck);
    if (outcome?.ok) { if (method === 'connectorsx.discard') setSetAside(true); onChange(outcome.value); }
  };
  const refusalWords = e.refusal ? (hasSay(e.refusal.code) ? cx(sayKey(e.refusal.code)) : e.refusal.reason) : null;
  return (
    <section className={s.stack} aria-label={cx('CX.env.title')} data-envelope={e.status}>
      <h2 className={s.sectionTitle}>{cx('CX.env.title')}</h2>
      {e.status === 'accepted' && <p>{cx('CX.env.accepted')}</p>}
      {(e.status === 'refused' || e.status === 'failed') && (
        <div className={s.stack}>
          <p className={s.amber} role="alert">{cx(e.status === 'refused' ? 'CX.env.refused' : 'CX.env.failed')}</p>
          {e.refusal && <p className={s.amber}>{refusalWords} <span className="fig">{cx('CX.env.code', { code: e.refusal.code })}</span>{e.refusal.line !== undefined && <> · {cx('CX.env.line', { line: e.refusal.line })}</>}</p>}
        </div>
      )}
      {e.status === 'abstained' && e.abstention && (
        <div className={s.stack}>
          <p>{cx('CX.env.abstained')}</p>
          <p>{e.abstention.question}</p>
          {e.abstention.options.length > 0 && <ul className={s.list} aria-label={cx('CX.env.choices')}>{e.abstention.options.map(o => <li key={o}>{o}</li>)}</ul>}
        </div>
      )}
      <p className={s.note}>{dayTime(e.fetchedAt, props.language)} · {e.operation} · {cx('CX.env.rows', { n: e.observed.rowCount, x: e.excludedRows })}</p>
      <Section title={cx('CX.checks')}>
        {e.checks.length === 0 ? <Note>{cx('CX.noChecks')}</Note> : (
          <Table view={props.view} caption={cx('CX.checks')} columns={[
            { head: cx('CX.col.check'), simple: true }, { head: cx('CX.col.ours'), num: true, simple: true }, { head: cx('CX.col.theirs'), num: true, simple: true }, { head: cx('CX.col.result') },
          ]} rows={e.checks.map((c, i) => ({ key: `${c.id}:${i}`, cells: [
            CHECK_KEYS.has(c.id) ? cx(`CX.check.${c.id}` as CxKey) : c.id,
            <Exact value={c.observed} unit={unit} rows={c.id === 'source-row-count'} cx={cx} />,
            <Exact value={c.expected} unit={unit} rows={c.id === 'source-row-count'} cx={cx} />,
            <span className={c.status === 'failed' ? s.amber : undefined}>{cx(`CX.result.${c.status}`)}</span>,
          ] }))} />
        )}
        {e.sourceTotals && Object.hasOwn(LANE.en, `CX.provenance.${e.sourceTotals.provenance}`) && <Note>{cx(`CX.provenance.${e.sourceTotals.provenance}` as CxKey)}</Note>}
      </Section>
      {e.unmappedFields.length > 0 && <Note>{cx('CX.env.unmapped', { fields: e.unmappedFields.join(', ') })}</Note>}
      {e.committed && <p role="status">{e.committed.duplicate || e.duplicate ? cx('CX.importedDuplicate') : cx('CX.imported', { n: e.committed.rows })}</p>}
      {setAside && !e.committed && <p role="status">{cx('CX.setAsideDone')}</p>}
      {waiting(e) && !setAside && (
        <div className={s.stack}>
          {e.pendingExpiresAt && <Note>{cx('CX.env.waitingUntil', { when: dayTime(e.pendingExpiresAt, props.language) })}</Note>}
          {prepares(props) && (
            <div className={s.actions}>
              <Button variant="filled" onClick={() => { void settle('connectorsx.importCommit'); }} disabled={act.busy}>{cx('CX.import')}</Button>
              <Button variant="link" onClick={() => { void settle('connectorsx.discard'); }} disabled={act.busy}>{cx('CX.setAside')}</Button>
            </div>
          )}
        </div>
      )}
      <Say code={act.refusal} cx={cx} />
    </section>
  );
}

export function valueOf<T>(loaded: Loaded<T>): T | undefined {
  return loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
}
export const styles = s;
