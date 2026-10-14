/**
 * FR-07 Bring a file. The desktop host picks the file (`pickFile`); in a browser a plain file
 * input is the fallback. Either way the file's text or bytes go only to the engine's own
 * preview and import methods (`sources.preview`/`sources.import` for CSV,
 * `sources.workbookPreview`/`sources.workbookImport` for Excel).
 *
 * The first rows are shown as plain text: cell text is data. The engine checks the file
 * against the source system's own row count and total, so a cut or filtered file is caught;
 * the result says how many rows were taken, flagged and refused, and a file refused whole
 * says why from the fixed list. For a layout the standard recipe does not know, "Pick your
 * columns" builds a data-only recipe from the person's choices.
 *
 * A bank statement PDF is offered only when the engine answers `imports.readerStatus` (the
 * connectors-ext `imports.*` family); it is then read by `PdfStatement`, which also asks for the
 * PDF's password. A sheet has no password path: an encrypted workbook (recognised by its first
 * bytes before anything is sent, or `ENCRYPTED_ZIP` from the engine) shows "password needed"
 * with the not-built words and no field.
 *
 * The engine reads a file only against agreed meanings. If it answers `DICTIONARY_REQUIRED`
 * the file is held by the journey and read again right after the meanings are agreed.
 */

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { count } from '../../format/counts.ts';
import { money } from '../../format/money.ts';
import { Field } from '../../parts/Field';
import {
  failureOf, fileProblems, firstRows, formatOf, pickedRecipe, problemsByCode, rupeesToPaise, sourceIdFor, splitCsvLine, unknownLayout, validateImport, validatePreview,
  validateReaderStatus, type ColumnRole, type DateFormat, type ExpectedTotals, type ImportResult, type JourneyFailure, type JourneyPort, type MappingRecipe, type SheetPreview,
} from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status, StepHeader } from './JourneyParts';
import { ProposedMeanings } from './ProposedMeanings';
import type { ProposalsOutcome } from './proposals.ts';
import { PdfStatement } from './PdfStatement';
import s from './Journey.module.css';

export type PickedFile =
  | { readonly name: string; readonly format: 'csv'; readonly content: string }
  | { readonly name: string; readonly format: 'xlsx'; readonly bytesBase64: string }
  | { readonly name: string; readonly format: 'pdf'; readonly bytesBase64: string };

export interface BringFileProps {
  readonly rpc: JourneyPort;
  /** The desktop host's file chooser. Without it a browser file input is drawn. */
  readonly pickFile?: (() => Promise<PickedFile | null>) | undefined;
  /** A file held while the meanings are agreed. */
  readonly held: PickedFile | null;
  readonly onHold: (file: PickedFile | null) => void;
  readonly meaningsAgreed: boolean;
  /** The workspace name, for the scope of a picked-columns recipe. */
  readonly company: string;
  readonly onTaken: () => void;
  readonly onWaits: () => void;
  /** FR-07's "Proposed meanings (draft)" after the file is taken. Absent: the list is not drawn. */
  readonly propose?: ((file: PickedFile) => Promise<ProposalsOutcome>) | undefined;
}

type Phase =
  | { readonly kind: 'idle' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'previewed'; readonly preview: SheetPreview; readonly recipe: MappingRecipe | null; readonly totals: ExpectedTotals | null }
  | { readonly kind: 'taking'; readonly preview: SheetPreview; readonly recipe: MappingRecipe | null; readonly totals: ExpectedTotals | null }
  | { readonly kind: 'taken'; readonly result: ImportResult }
  | { readonly kind: 'password' }
  | { readonly kind: 'pdf' }
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'failed'; readonly failure: JourneyFailure };

const ROLES: readonly ColumnRole[] = ['date', 'customer', 'amount', 'invoice', 'ignore'];
const DATE_FORMATS: readonly DateFormat[] = ['ISO', 'DMY'];
const KNOWN_REASONS: ReadonlySet<string> = new Set(['MISSING_VALUE', 'INVALID_DATE', 'AMBIGUOUS_DATE', 'UNKNOWN_KIND', 'UNKNOWN_STATUS', 'DUPLICATE_SOURCE_ROW', 'CURRENCY_MISMATCH', 'OUTSIDE_SCOPE']);
const WHOLE_SENTENCES: ReadonlySet<string> = new Set(['SOURCE_ROW_MISMATCH', 'SOURCE_TOTAL_MISMATCH', 'SOURCE_TOTALS_REQUIRED', 'UNMAPPED_FIELDS']);

/** An encrypted Office file is an OLE compound file (D0 CF 11 E0 A1 B1 1A E1), not the ZIP an .xlsx is. */
export function encryptedOfficeFile(bytesBase64: string): boolean {
  let head: string;
  try { head = atob(bytesBase64.slice(0, 12)); } catch { return false; }
  const magic = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  return head.length >= magic.length && magic.every((byte, index) => head.charCodeAt(index) === byte);
}

function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let index = 0; index < bytes.length; index += 0x8000) binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  return btoa(binary);
}

/** The browser fallback: the chosen file's text or bytes, held only to hand to the engine. */
async function fromInput(file: File, pdf: boolean): Promise<PickedFile | null> {
  const format = formatOf(file.name, pdf);
  if (format === 'csv') return { name: file.name, format, content: await file.text() };
  if (format === 'xlsx' || format === 'pdf') return { name: file.name, format, bytesBase64: base64Of(new Uint8Array(await file.arrayBuffer())) };
  return null;
}

export function BringFile({ rpc, pickFile, held, onHold, meaningsAgreed, company, onTaken, onWaits, propose }: BringFileProps) {
  const t = useT();
  const inputId = useId();
  const dateName = useId();
  const [file, setFile] = useState<PickedFile | null>(held);
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' });
  const [rowsText, setRowsText] = useState('');
  const [amountText, setAmountText] = useState('');
  const [totalsProblem, setTotalsProblem] = useState<string | null>(null);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [roles, setRoles] = useState<Record<string, ColumnRole>>({});
  const [dateFormat, setDateFormat] = useState<DateFormat>('ISO');
  const [columnsProblem, setColumnsProblem] = useState(false);
  const generation = useRef(0);
  const resumed = useRef(false);
  // PDF is offered only when this engine reads PDFs.
  const [pdf, setPdf] = useState(false);
  useEffect(() => {
    let live = true;
    void rpc.request('imports.readerStatus', {}).then(reply => { validateReaderStatus(reply); if (live) setPdf(true); }, () => {});
    return () => { live = false; };
  }, [rpc]);

  const preview = useCallback(async (chosen: PickedFile, recipe: MappingRecipe | null, totals: ExpectedTotals | null) => {
    const token = ++generation.current;
    if (chosen.format === 'pdf') { setPhase({ kind: 'pdf' }); return; }
    if (chosen.format === 'xlsx' && encryptedOfficeFile(chosen.bytesBase64)) { setPhase({ kind: 'password' }); return; }
    setPhase({ kind: 'reading' });
    const sourceId = sourceIdFor(chosen.name);
    const extra = { ...(recipe === null ? {} : { recipe }), ...(totals === null ? {} : { expectedTotals: totals }) };
    try {
      const reply = chosen.format === 'csv'
        ? await rpc.request('sources.preview', { sourceId, format: 'csv', content: chosen.content, ...extra })
        : await rpc.request('sources.workbookPreview', { sourceId, bytesBase64: chosen.bytesBase64, ...extra });
      if (token !== generation.current) return;
      const checked = validatePreview(reply);
      setPhase({ kind: 'previewed', preview: checked, recipe, totals });
      if (unknownLayout(checked) && chosen.format === 'csv' && recipe === null) setColumnsOpen(true);
    } catch (error) {
      if (token !== generation.current) return;
      const failure = failureOf(error);
      if (failure.kind === 'refused' && failure.code === 'DICTIONARY_REQUIRED' && !meaningsAgreed) { onHold(chosen); onWaits(); return; }
      if (failure.kind === 'refused' && failure.code === 'ENCRYPTED_ZIP') { setPhase({ kind: 'password' }); return; }
      setPhase({ kind: 'failed', failure });
    }
  }, [rpc, meaningsAgreed, onHold, onWaits]);

  // A file held for the meanings is read as soon as they are agreed.
  useEffect(() => {
    if (resumed.current || held === null || !meaningsAgreed) return;
    resumed.current = true;
    void preview(held, null, null);
  }, [held, meaningsAgreed, preview]);
  useEffect(() => () => { generation.current++; }, []);

  const begin = (chosen: PickedFile | null) => {
    setColumnsOpen(false); setRoles({}); setTotalsProblem(null); setColumnsProblem(false); setRowsText(''); setAmountText('');
    onHold(null);
    if (chosen === null || (chosen.format === 'pdf' && !pdf)) { setFile(null); setPhase({ kind: 'unsupported' }); return; }
    setFile(chosen);
    void preview(chosen, null, null);
  };

  const choose = async () => {
    if (pickFile === undefined) return;
    try { const chosen = await pickFile(); if (chosen !== null) begin(chosen); }
    catch (error) { setPhase({ kind: 'failed', failure: failureOf(error) }); }
  };

  const take = async (current: Extract<Phase, { kind: 'previewed' }>) => {
    if (file === null) return;
    const token = ++generation.current;
    setPhase({ ...current, kind: 'taking' });
    const sourceId = sourceIdFor(file.name);
    const extra = { ...(current.recipe === null ? {} : { recipe: current.recipe }), ...(current.totals === null ? {} : { expectedTotals: current.totals }) };
    try {
      if (file.format === 'pdf') return;
      const reply = file.format === 'csv'
        ? await rpc.request('sources.import', { sourceId, format: 'csv', content: file.content, ...extra })
        : await rpc.request('sources.workbookImport', { sourceId, bytesBase64: file.bytesBase64, ...extra });
      if (token !== generation.current) return;
      setPhase({ kind: 'taken', result: validateImport(reply) });
    } catch (error) { if (token === generation.current) setPhase({ kind: 'failed', failure: failureOf(error) }); }
  };

  const checkWithTotals = (current: Extract<Phase, { kind: 'previewed' }>) => {
    if (file === null) return;
    const rows = rowsText.trim();
    if (!/^(0|[1-9][0-9]{0,8})$/.test(rows)) { setTotalsProblem('FR-07.totals.rowsBad'); return; }
    const paise = rupeesToPaise(amountText);
    if (paise === null) { setTotalsProblem('FR-07.totals.amountBad'); return; }
    setTotalsProblem(null);
    void preview(file, current.recipe, { rowCount: Number.parseInt(rows, 10), amountMinor: paise });
  };

  const applyColumns = (current: Extract<Phase, { kind: 'previewed' }>, columns: readonly string[]) => {
    if (file === null) return;
    const recipe = pickedRecipe(columns, roles, dateFormat, company);
    if (recipe === null) { setColumnsProblem(true); return; }
    setColumnsProblem(false); setColumnsOpen(false);
    void preview(file, recipe, current.totals);
  };

  const chooser = pickFile !== undefined
    ? <Actions><Act variant={file === null ? 'filled' : 'quiet'} label={file === null ? 'FR-07.pick.btn' : 'FR-07.another.btn'} onClick={() => { void choose(); }} /></Actions>
    : (
      <div className={s.section}>
        <label htmlFor={inputId} className={s.sectionTitle}>{t('FR-07.input')}</label>
        <div><input id={inputId} type="file" accept={pdf ? '.csv,.txt,.xlsx,.pdf' : '.csv,.txt,.xlsx'} onChange={event => {
          const chosen = event.currentTarget.files?.[0];
          if (chosen === undefined) return;
          void fromInput(chosen, pdf).then(begin, error => setPhase({ kind: 'failed', failure: failureOf(error) }));
        }} /></div>
      </div>
    );

  const columns = file?.format === 'csv' ? splitCsvLine(file.content.replace(/^\uFEFF/, '').split(/\r?\n/)[0] ?? '') : [];

  return (
    <section data-first-run-screen="file">
      <StepHeader step={4} title="FR-07.title" lede="FR-07.lede" />
      {held !== null && meaningsAgreed && phase.kind === 'reading' && <Status k="FR-07.held" />}
      {phase.kind !== 'taken' && chooser}
      {file !== null && <p className={s.question} data-file-name="">{t('FR-07.name', { name: file.name })}</p>}
      {file !== null && phase.kind !== 'taken' && file.format !== 'pdf' && (file.format === 'csv'
        ? (
          <div className={s.sheetWrap}>
            <h2 className={s.sectionTitle}>{t('FR-07.rows')}</h2>
            <table className={s.sheet} data-first-rows="">
              <tbody>
                {firstRows(file.content).map((cells, row) => (
                  <tr key={row}>{cells.map((cell, index) => <td key={index}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        )
        : <Note k="FR-07.noRows" />)}
      {phase.kind === 'reading' && <Status k="FR-07.reading" />}
      {phase.kind === 'unsupported' && <Note k={pdf ? 'FR-07.notSupported.pdf' : 'FR-07.notSupported'} role="alert" />}
      {phase.kind === 'pdf' && file?.format === 'pdf' && (
        <PdfStatement key={file.name} rpc={rpc} file={file} onTaken={() => { onHold(null); onTaken(); }}
          onNeedsMeanings={() => { if (meaningsAgreed) setPhase({ kind: 'failed', failure: { kind: 'refused', code: 'DICTIONARY_REQUIRED' } }); else { onHold(file); onWaits(); } }} />
      )}
      {phase.kind === 'failed' && <FailureLine failure={phase.failure} notBuilt="FR-07.notBuilt" refused="FR-07.refused" />}
      {phase.kind === 'password' && (
        <div className={s.section} data-file-password="not-built">
          <h2 className={s.sectionTitle}>{t('FR-07.password.title')}</h2>
          <p className={s.status} role="status" data-first-run-not-built="">{t('FR-07.password.notBuilt')}</p>
          <Note k="FR-07.password.copy" />
        </div>
      )}
      {(phase.kind === 'previewed' || phase.kind === 'taking') && (() => {
        const { preview: checked, recipe, totals } = phase;
        const whole = fileProblems(checked.problems);
        const rowGroups = problemsByCode(checked.problems);
        const refusedWhole = whole.some(code => code !== 'SOURCE_TOTALS_REQUIRED') || rowGroups.length > 0;
        return (
          <>
            <p className={s.note} data-recipe="">{t(recipe === null ? 'FR-07.recipe.standard' : 'FR-07.recipe.picked', { state: t(`FR-07.state.${checked.qualification}`) })}</p>
            {checked.accepted
              ? <p className={s.status} role="status">{t('FR-07.wouldTake', { count: count(String(checked.coverage.importedRows)) })}</p>
              : (
                <div className={s.section} data-file-refused={refusedWhole ? 'whole' : 'totals'}>
                  {refusedWhole && <p className={s.problem} role="alert">{t('FR-07.whole')}</p>}
                  {whole.map(code => (
                    <p key={code} className={s.status} data-whole-reason={code}>
                      {code === 'SOURCE_ROW_MISMATCH' && totals !== null
                        ? t('FR-07.whole.SOURCE_ROW_MISMATCH', { expected: count(String(totals.rowCount)), found: count(String(checked.coverage.sourceRows)) })
                        : code === 'SOURCE_TOTAL_MISMATCH' && totals !== null
                          ? t('FR-07.whole.SOURCE_TOTAL_MISMATCH', { expected: money(totals.amountMinor), found: money(checked.totalsMinor) })
                          : WHOLE_SENTENCES.has(code) && code !== 'SOURCE_ROW_MISMATCH' && code !== 'SOURCE_TOTAL_MISMATCH' ? t(`FR-07.whole.${code}`) : t('FR-07.whole.other', { code })}
                    </p>
                  ))}
                </div>
              )}
            <ul className={s.groups} data-result-groups="">
              <li>{t('FR-07.group.taken', { count: count(String(checked.coverage.importedRows)) })}</li>
              <li>{t('FR-07.group.flagged')}</li>
              <li>
                {rowGroups.length === 0
                  ? t('FR-07.group.refused', { count: count(String(checked.coverage.rejectedRows)) })
                  : (
                    <details>
                      <summary>{t('FR-07.group.refused', { count: count(String(checked.coverage.rejectedRows)) })}</summary>
                      <ul>
                        {rowGroups.map(group => (
                          <li key={group.code}>{t('FR-07.problemRows', {
                            rows: group.rows.slice(0, 20).join(', '),
                            reason: KNOWN_REASONS.has(group.code) ? t(`FR-07.reason.${group.code}`) : t('FR-07.reason.other', { code: group.code }),
                          })}</li>
                        ))}
                      </ul>
                    </details>
                  )}
              </li>
            </ul>
            {file?.format === 'csv' && !columnsOpen && rowGroups.length > 0 && phase.kind === 'previewed' && (
              <Actions><Act variant="link" label="FR-07.pickColumns.btn" onClick={() => setColumnsOpen(true)} /></Actions>
            )}
            {columnsOpen && phase.kind === 'previewed' && (file?.format === 'csv'
              ? (
                <form className={s.section} data-pick-columns="" onSubmit={event => { event.preventDefault(); applyColumns(phase, columns); }}>
                  <h2 className={s.sectionTitle}>{t('FR-07.columns.title')}</h2>
                  <p className={s.note}>{t('FR-07.columns.lede')}</p>
                  <ul className={s.rows}>
                    {columns.map((column, index) => (
                      <li key={`${column}-${index}`} className={s.row}>
                        <label className={s.rowLine}>
                          <span className={s.rowName}>{t('FR-07.column', { name: column })}</span>
                          <select className={s.select} value={roles[column] ?? 'ignore'} onChange={event => { const value = event.currentTarget.value; if ((ROLES as readonly string[]).includes(value)) setRoles(current => ({ ...current, [column]: value as ColumnRole })); }}>
                            {ROLES.map(role => <option key={role} value={role}>{t(`FR-07.role.${role}`)}</option>)}
                          </select>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <fieldset style={{ border: 0, padding: 0, margin: 'var(--sp3) 0 0' }}>
                    <legend className={s.note}>{t('FR-07.dateFormat')}</legend>
                    {DATE_FORMATS.map(form => (
                      <label key={form} className={s.radioRow}>
                        <input type="radio" name={dateName} value={form} checked={dateFormat === form} onChange={() => setDateFormat(form)} />
                        <span className="fig">{t(`FR-07.dateFormat.${form}`)}</span>
                      </label>
                    ))}
                  </fieldset>
                  {columnsProblem && <p className={s.problem} role="alert">{t('FR-07.columns.need')}</p>}
                  <Actions><Act submit label="FR-07.columns.use.btn" /></Actions>
                </form>
              )
              : <Note k="FR-07.columns.csvOnly" />)}
            {!checked.accepted && rowGroups.length === 0 && phase.kind === 'previewed' && (
              <form className={s.section} data-source-totals="" onSubmit={event => { event.preventDefault(); checkWithTotals(phase); }}>
                <h2 className={s.sectionTitle}>{t('FR-07.totals.title')}</h2>
                <p className={s.note}>{t('FR-07.totals.lede')}</p>
                <div className={s.fields}>
                  <Field label={t('FR-07.totals.rows')} value={rowsText} onChange={event => setRowsText(event.currentTarget.value)} inputMode="numeric" autoComplete="off" />
                  <Field label={t('FR-07.totals.amount')} prefix="₹" value={amountText} onChange={event => setAmountText(event.currentTarget.value)} inputMode="decimal" autoComplete="off" />
                </div>
                {totalsProblem !== null && <p className={s.problem} role="alert">{t(totalsProblem)}</p>}
                <Actions><Act submit variant="filled" label="FR-07.check.btn" /></Actions>
              </form>
            )}
            {checked.accepted && (
              <Actions><Act variant="filled" label="FR-07.take.btn" disabled={phase.kind === 'taking'} onClick={() => { if (phase.kind === 'previewed') void take(phase); }} /></Actions>
            )}
            {phase.kind === 'taking' && <Status k="FR-07.taking" />}
          </>
        );
      })()}
      {phase.kind === 'taken' && (
        <div className={s.section} data-file-taken="">
          <ul className={s.groups} data-result-groups="">
            <li>{t('FR-07.group.taken', { count: count(String(phase.result.coverage.importedRows)) })}</li>
            <li>{t('FR-07.group.flagged')}</li>
            <li>{t('FR-07.group.refused', { count: count(String(phase.result.coverage.rejectedRows)) })}</li>
          </ul>
          {phase.result.duplicate && <Note k="FR-07.duplicate" />}
          {file !== null && propose !== undefined && <ProposedMeanings file={file} propose={propose} />}
          <Actions><Act variant="filled" label="FR.journey.continue.btn" onClick={onTaken} /></Actions>
        </div>
      )}
    </section>
  );
}
