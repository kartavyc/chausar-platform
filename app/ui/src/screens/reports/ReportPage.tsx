/**
 * RP-02 A report page: the page as it will print, in a sheet. Every number is a figure
 * that opens its receipt, balances carry Dr or Cr, each section's gaps are printed beside
 * its total, a projection sits apart under its own label, and notes carry their source,
 * the date it was checked and "not legal advice". The report's language is chosen here;
 * the page prints, and exports to Excel, CSV and HTML (PDF goes through Print). The period
 * is chosen here too (the financial year to date unless changed) and goes to the page and to
 * every export; the screen checks the dates, the engine works out every figure.
 */
import { useState } from 'react';
import type { Language } from '../../app/presentation.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { Figure } from '../../parts/Figure';
import { Label } from '../../parts/Label';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { count } from '../../format/index.ts';
import { useEngine, useSend } from '../trust/kit/engine.ts';
import { Note, screenState } from '../trust/kit/Screen';
import { day, refusal, when } from './shared';
import { httpsUrl, validateExportedFile, validatePage, type PageSection, type ReportPage as Page } from './validate.ts';
import { WORDS, fill, type Words } from './words.ts';
import { PERIOD_KINDS, defaultChoice, indiaToday, periodOf, type Period, type PeriodChoice, type PeriodKind } from './period.ts';
import s from './Reports.module.css';
import p from './ReportPage.module.css';

type Format = 'xlsx' | 'csv' | 'html' | 'pdf' | 'tally';
const FORMATS: readonly Format[] = ['xlsx', 'csv', 'html', 'pdf', 'tally'];

export interface ReportPageSheetProps extends PlaceRenderProps {
  pack: string;
  page: string;
  origin: HTMLElement | null;
  onClose: () => void;
}

export function ReportPageSheet({ pack, page, origin, onClose, language, view, viewer, member, rpc, openReceipt }: ReportPageSheetProps) {
  const w = words(WORDS, language);
  const [lang, setLang] = useState<Language>(language);
  const [today] = useState(() => indiaToday());
  const [applied, setApplied] = useState<{ kind: PeriodKind; period: Period | undefined }>({ kind: 'fytd', period: undefined });
  const asked = { pack, page, language: lang, ...(applied.period !== undefined ? { period: applied.period } : {}) };
  const { state } = useEngine(rpc, 'reportsx.page', asked, validatePage, `${pack}.${page}`);
  const exporter = useSend(rpc, validateExportedFile);
  const readOnly = viewer || member.role === 'viewer';
  const title = state.kind === 'ready' ? state.value.title : w.pageKind;
  const print = () => window.print();

  return (
    <Sheet kind={w.pageKind} title={title} onClose={onClose} origin={origin}>
      <div className={[s.stack, p.noPrint].join(' ')}>
        <Choice<Language> label={w.language} options={[{ value: 'en', label: w.english }, { value: 'hi', label: w.hindi }]} value={lang}
          onChange={(next) => { setLang(next); exporter.clear(); }} />
        <PeriodPicker w={w} today={today} onApply={(kind, period) => { setApplied({ kind, period }); exporter.clear(); }} />
        <div className={s.actions}>
          <Button onClick={print}>{w.print}</Button>
          {!readOnly && state.kind === 'ready' && FORMATS.map((format) => (
            <Button key={format} disabled={exporter.sent.kind === 'sending'}
              onClick={() => { void exporter.send('reportsx.export', { ...asked, format }); }}>
              {`${w.exportTo} · ${w[`fmt.${format}`]}`}
            </Button>
          ))}
        </div>
        {readOnly && <Note>{w.viewerNoExport}</Note>}
        {exporter.sent.kind === 'sending' && <Note status>{w.making}</Note>}
        {exporter.sent.kind === 'refused' && (
          <div className={s.stack} role="status">
            <p className={s.say}>{refusal(exporter.sent.code, w)}</p>
            {exporter.sent.code === 'PDF_USES_PRINT' && <div><Button variant="link" onClick={print}>{w.print}</Button></div>}
          </div>
        )}
        {exporter.sent.kind === 'done' && (
          <div className={s.stack} role="status">
            <p className={s.say}>{fill(w.fileMade, { name: exporter.sent.value.name })}</p>
            <p className={s.quiet}>{fill(w.fileSize, { size: count(String(exporter.sent.value.bytes)) })}</p>
            <p className={[s.quiet, s.code].join(' ')}>{fill(w.checkNumber, { check: exporter.sent.value.sha256 })}</p>
            <p className={s.quiet}>{w.notEncrypted} {w.textCells}</p>
          </div>
        )}
      </div>
      {state.kind === 'ready' ? <PrintedPage page={state.value} w={w} language={language} view={view} openReceipt={openReceipt} periodKind={applied.kind} /> : <State state={screenState(state)} />}
    </Sheet>
  );
}

/** RP-02's period control: the financial year to date, last financial year, a month, a quarter, or from and to. */
function PeriodPicker({ w, today, onApply }: { w: Words; today: string; onApply: (kind: PeriodKind, period: Period | undefined) => void }) {
  const [choice, setChoice] = useState<PeriodChoice>(() => defaultChoice(today));
  const [problem, setProblem] = useState<string | null>(null);
  const set = (part: Partial<PeriodChoice>) => { setChoice((c) => ({ ...c, ...part })); setProblem(null); };
  const apply = () => {
    const result = periodOf(choice, today);
    if (!result.ok) { setProblem(w[`period.${result.problem}`]); return; }
    setProblem(null); onApply(choice.kind, result.period);
  };
  return (
    <form className={s.stack} aria-label={w.period} onSubmit={(e) => { e.preventDefault(); apply(); }}>
      <Choice<PeriodKind> label={w.period} options={PERIOD_KINDS.map((k) => ({ value: k, label: w[`period.${k}`] }))} value={choice.kind} onChange={(kind) => set({ kind })} />
      {choice.kind === 'month' && <Field label={w.periodMonth} type="month" value={choice.month} onChange={(e) => set({ month: e.currentTarget.value })} />}
      {choice.kind === 'quarter' && (
        <>
          <Field label={w.periodFyStart} inputMode="numeric" maxLength={4} value={choice.fyStart} onChange={(e) => set({ fyStart: e.currentTarget.value.trim() })} />
          <Choice<PeriodChoice['quarter']> label={w.periodQuarter} options={(['1', '2', '3', '4'] as const).map((q) => ({ value: q, label: w[`quarter.${q}`] }))}
            value={choice.quarter} onChange={(quarter) => set({ quarter })} />
        </>
      )}
      {choice.kind === 'custom' && (
        <>
          <Field label={w.periodFrom} type="date" value={choice.from} onChange={(e) => set({ from: e.currentTarget.value })} />
          <Field label={w.periodTo} type="date" value={choice.to} onChange={(e) => set({ to: e.currentTarget.value })} />
        </>
      )}
      {problem !== null && <Note status>{problem}</Note>}
      <div><Button submit>{w.periodShow}</Button></div>
    </form>
  );
}

function PrintedPage({ page, w, language, view, openReceipt, periodKind }: { page: Page; w: Words; language: Language; view: PlaceRenderProps['view']; openReceipt: (id: string) => void; periodKind: PeriodKind }) {
  const facts = page.sections.filter((x) => !x.projection), projections = page.sections.filter((x) => x.projection);
  return (
    <article className={p.page} lang={page.language}>
      {page.markings.length > 0 && (
        <p className={p.markings}>{`${w.markings}: ${page.markings.map((m) => w[`marking.${m}`]).join(' · ')}`}</p>
      )}
      <h3 className={p.pageTitle}>{page.title}</h3>
      <p className={s.quiet}>
        {page.period !== null
          ? fill(w.periodHead, { kind: w[`period.${periodKind}`], period: fill(w.periodLine, { from: day(page.period.from, language), to: day(page.period.to, language) }) })
          : w.noPeriod}
        {' · '}{fill(w.madeAt, { when: when(page.generatedAt, w, language) })}
      </p>
      {page.state !== 'ready-tested' && <p className={s.say}>{page.state === 'not-started' ? w.pageNotStarted : w['state.ready-untested']}</p>}
      {facts.map((section) => <Section key={section.id} section={section} w={w} view={view} openReceipt={openReceipt} />)}
      {projections.length > 0 && (
        <section className={p.projection} aria-label={w.projection}>
          <p className={p.projectionHead}><Label kind="projection" /> <span className={s.quiet}>{w.projectionNote}</span></p>
          {projections.map((section) => <Section key={section.id} section={section} w={w} view={view} openReceipt={openReceipt} />)}
        </section>
      )}
      {page.gaps.length > 0 && (
        <section className={p.block}>
          <h4 className={p.sectionTitle}>{w.pageGaps}</h4>
          <ul className={s.plain}>{page.gaps.map((gap, i) => <li key={i}>{gap}</li>)}</ul>
        </section>
      )}
      {page.notes.length > 0 && (
        <section className={p.block}>
          <h4 className={p.sectionTitle}>{w.notes}</h4>
          {page.notes.map((note) => {
            const href = note.source !== null ? httpsUrl(note.source.url) : null;
            return (
              <div key={note.id} className={p.note}>
                <p className={s.say}>{note.text}</p>
                {note.source !== null && (
                  <p className={s.quiet}>
                    {fill(w.source, { title: note.source.title })}{' '}
                    {href !== null ? <a href={href} target="_blank" rel="noopener noreferrer">{note.source.url}</a> : <span>{note.source.url}</span>}
                    {' · '}{fill(w.checkedOn, { date: day(note.source.checkedOn, language) })}
                  </p>
                )}
                {note.notLegalAdvice && <p className={s.quiet}>{w.notLegal}</p>}
              </div>
            );
          })}
        </section>
      )}
      {page.disclaimer !== null && <p className={p.disclaimer}>{page.disclaimer}</p>}
      <footer className={p.footer}>
        {page.footer.checkCode !== null
          ? <span className={s.code}>{fill(w.footerCheck, { code: page.footer.checkCode })}</span>
          : <span>{w.footerNone}</span>}
        {page.footer.at !== null && <span>{fill(w.footerAt, { when: when(page.footer.at, w, language) })}</span>}
      </footer>
      {view === 'books' && page.receiptIds.length > 0 && (
        <section className={[p.block, p.noPrint].join(' ')}>
          <h4 className={p.sectionTitle}>{w.receipts}</h4>
          <div className={s.actions}>
            {page.receiptIds.map((id) => <Button key={id} variant="link" className={s.code} onClick={() => openReceipt(id)}>{id}</Button>)}
          </div>
        </section>
      )}
    </article>
  );
}

function Section({ section, w, view, openReceipt }: { section: PageSection; w: Words; view: PlaceRenderProps['view']; openReceipt: (id: string) => void }) {
  return (
    <section className={p.block}>
      <h4 className={p.sectionTitle}>{section.title}</h4>
      <table className={s.table}>
        <tbody>
          {section.lines.map((line, i) => {
            const last = i === section.lines.length - 1;
            return (
              <tr key={line.id}>
                <th scope="row" className={p.lineLabel}>
                  {line.label}
                  {view === 'books' && <span className={[s.quiet, s.code].join(' ')}> {fill(w.lineId, { id: line.id })}</span>}
                </th>
                <td className={p.amount}><Figure value={line.figure} onReceipt={openReceipt} /></td>
                <td className={p.side}>{line.side !== null ? w[line.side] : ''}</td>
                <td className={p.gapCell}>
                  {last && section.gaps.map((gap, k) => <span key={k} className={p.gapBeside}>{fill(w.gap, { gap })}</span>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {section.lines.length === 0 && section.gaps.map((gap, k) => <p key={k} className={p.gapBeside}>{fill(w.gap, { gap })}</p>)}
    </section>
  );
}
