/**
 * `#/books/tally-export`: Tally on another computer. The person chooses a Tally connection, the
 * register, the period, its ledgers and the base currency; `connectorsx.tally.exporter` makes a
 * read-only PowerShell script and a one-page guide, offered as files to save and the guide drawn
 * here. The answer file the script wrote comes back through `connectorsx.tally.importExport`
 * and its envelope waits for Import or Set aside like any other read.
 */
import { useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import { Field } from '../../parts/Field';
import { Choice } from '../../parts/Choice';
import { Button } from '../../parts/Button';
import type { Language } from '../../app/presentation.ts';
import { useReply } from '../work/kit/reply.ts';
import { dayTime } from '../work/kit/format.ts';
import { connectionsReply, envelope, exporterReply, type Connection, type Envelope, type ExporterReply } from './contract.ts';
import { CxPage, EnvelopeResult, Experimental, Note, Say, Section, Table, prepares, styles as s, useCx, useLiveAct, valueOf, type Cx, type CxProps } from './shared.tsx';

/** The largest answer file accepted here; the engine checks it again. */
export const ANSWER_FILE_MAX_BYTES = 20 * 1024 * 1024;
type Register = 'sales' | 'purchase';
const thisMonth = () => { const today = new Date().toISOString().slice(0, 10); return { from: `${today.slice(0, 7)}-01`, to: today }; };
export const ledgerLines = (text: string): string[] => text.split('\n').map(line => line.trim()).filter(Boolean);

export function TallyExport(props: CxProps) {
  const cx = useCx(props.language);
  const conns = useReply(props, 'connectorsx.connections', {}, connectionsReply);
  const all = valueOf(conns.loaded);
  const rows = all?.filter(c => c.group === 'tally') ?? [];
  const [chosenId, setChosenId] = useState<string | null>(null);
  const chosen = rows.find(c => c.id === chosenId) ?? rows[0] ?? null;
  return (
    <CxPage props={props} sub="tally-export" title={cx('CX.tx.title')} count={all ? String(rows.length) : undefined} loads={[conns.loaded]} reload={conns.reload}>
      <Section title={cx('CX.tx.title')} label={cx('CX.tx.intro')}>
        <Note>{cx('CX.tx.intro')}</Note>
        <Experimental cx={cx} />
      </Section>
      {all && (rows.length === 0 ? <Note>{cx('CX.tx.empty')}</Note> : (
        <>
          {props.view !== 'simple' && (
            <Table view={props.view} caption={cx('CX.tx.connection')} columns={[{ head: cx('CX.col.connection'), simple: true }, { head: cx('CX.col.company') }, { head: cx('CX.col.status') }]}
              rows={rows.map(c => ({ key: c.id, cells: [c.label, c.company, c.status === 'active' ? cx('CX.active') : cx('CX.paused')] }))} />
          )}
          {prepares(props) && (
            <>
              {rows.length > 1 && <Choice<string> label={cx('CX.tx.connection')} options={rows.map(c => ({ value: c.id, label: `${c.label} · ${c.company}` }))} value={chosen?.id ?? null} onChange={setChosenId} />}
              {chosen && <Exporter key={chosen.id} props={props} conn={chosen} cx={cx} />}
              {chosen && <BringBack key={`back:${chosen.id}`} props={props} conn={chosen} cx={cx} />}
            </>
          )}
        </>
      ))}
    </CxPage>
  );
}

function Exporter({ props, conn, cx }: { props: CxProps; conn: Connection; cx: Cx }) {
  const act = useLiveAct(props);
  const [register, setRegister] = useState<Register>('sales');
  const [range, setRange] = useState(thisMonth);
  const [ledgers, setLedgers] = useState('');
  const [base, setBase] = useState('INR');
  const [made, setMade] = useState<ExporterReply | null>(null);
  const periodOk = !!range.from && !!range.to && range.from <= range.to;
  const baseOk = /^[A-Z]{3}$/.test(base.trim());
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!periodOk || !baseOk) return;
    const outcome = await act.run('connectorsx.tally.exporter', { connectionId: conn.id, register, period: { from: range.from, to: range.to }, ledgers: ledgerLines(ledgers), baseCurrency: base.trim() }, exporterReply);
    if (outcome?.ok) setMade(outcome.value);
  };
  return (
    <Section title={cx('CX.tx.make')}>
      <form className={s.form} aria-label={cx('CX.tx.make')} onSubmit={event => { void submit(event); }}>
        <Choice<Register> label={cx('CX.tx.register')} options={[{ value: 'sales', label: cx('CX.reg.sales') }, { value: 'purchase', label: cx('CX.reg.purchase') }]} value={register} onChange={setRegister} />
        <div className={s.split}>
          <Field label={cx('CX.from')} type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} />
          <Field label={cx('CX.to')} type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} problem={periodOk ? undefined : cx('CX.periodHelp')} />
        </div>
        <label className={s.selectLabel}>{cx('CX.tx.ledgers')}<textarea className={s.area} value={ledgers} onChange={e => setLedgers(e.target.value)} /></label>
        <Field label={cx('CX.tx.base')} value={base} onChange={e => setBase(e.target.value)} problem={baseOk ? undefined : cx('CX.tx.baseHelp')} />
        <div className={s.actions}><Button submit variant="filled" disabled={act.busy || !periodOk || !baseOk}>{act.busy ? cx('CX.tx.making') : cx('CX.tx.make')}</Button></div>
        <Say code={act.refusal} cx={cx} what={cx('CX.tx.exporter')} />
      </form>
      {made && <Made props={props} made={made} cx={cx} />}
    </Section>
  );
}

/** A text file the person saves, as a Blob behind a plain download link; released when it leaves the page. */
function useFileUrl(content: string, type: string): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    const next = URL.createObjectURL(new Blob([content], { type }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [content, type]);
  return url;
}

function Made({ props, made, cx }: { props: CxProps; made: ExporterReply; cx: Cx }) {
  const [language, setLanguage] = useState<Language>(props.language);
  const guide = made.guide[language];
  const scriptUrl = useFileUrl(made.script, 'text/plain;charset=utf-8');
  const guideUrl = useFileUrl(guide, 'text/plain;charset=utf-8');
  return (
    <div className={s.stack} data-tally-export={made.exportId}>
      <p role="status">{cx('CX.tx.ready')}</p>
      <Note>{cx('CX.tx.expires', { when: dayTime(made.expiresAt, props.language) })}</Note>
      <div className={s.actions}>
        {scriptUrl && <a href={scriptUrl} download={made.fileName} data-download="script">{cx('CX.tx.save', { name: made.fileName })}</a>}
        {guideUrl && <a href={guideUrl} download={made.guideFileName} data-download="guide">{cx('CX.tx.save', { name: made.guideFileName })}</a>}
      </div>
      <Section title={cx('CX.tx.guide')}>
        <Choice<Language> label={cx('CX.tx.guideLanguage')} options={[{ value: 'en', label: cx('CX.lang.en') }, { value: 'hi', label: cx('CX.lang.hi') }]} value={language} onChange={setLanguage} />
        {/* The guide is plain text from the engine, drawn as a text node with its line breaks kept. */}
        <pre className={s.guide} lang={language} data-guide={language}>{guide}</pre>
      </Section>
    </div>
  );
}

function BringBack({ props, conn, cx }: { props: CxProps; conn: Connection; cx: Cx }) {
  const act = useLiveAct(props);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<Envelope | null>(null);
  const pick = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    setProblem(null);
    if (!file) return;
    if (file.size > ANSWER_FILE_MAX_BYTES) { setProblem(cx('CX.tx.tooBig')); return; }
    const text = await file.text();
    if (!props.live(props.address)) return;
    const outcome = await act.run('connectorsx.tally.importExport', { connectionId: conn.id, text }, envelope);
    if (outcome?.ok) setResult(outcome.value);
  };
  return (
    <Section title={cx('CX.tx.back')}>
      <Note>{cx('CX.tx.backNote')}</Note>
      <label className={s.selectLabel}>{cx('CX.tx.file')}
        <input type="file" accept=".json,application/json,.txt,text/plain" onChange={event => { void pick(event); }} disabled={act.busy} />
      </label>
      {act.busy && <p className={s.note} role="status">{cx('CX.tx.checking')}</p>}
      {problem && <p className={s.amber} role="alert">{problem}</p>}
      <Say code={act.refusal} cx={cx} what={cx('CX.tx.importer')} />
      {result && <EnvelopeResult props={props} value={result} onChange={setResult} />}
    </Section>
  );
}
