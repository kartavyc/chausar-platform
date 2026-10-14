/**
 * FR-07 for a bank statement PDF, through the connectors-ext `imports.*` family, with the shapes of
 * docs/lanes/connectors-ext.md "FR-07 contract": `imports.preview` → the envelope and its `fr07`
 * result (the lines read, the opening and closing balance and whether the check passed), then
 * `imports.commit` with that envelope → the rows taken, or that it was taken before. BringFile
 * draws this only when `imports.readerStatus` answered, so an engine without the family never
 * offers PDF.
 *
 * - Password needed ("Used once, on this computer. Not kept."): the field is uncontrolled, read
 *   once on submit and emptied at once; the value goes straight to `imports.providePassword` and
 *   is never put in React state, storage or a log. The engine holds it for one preview, which then
 *   says whether it opened the file. A wrong password says so; no count is shown.
 * - Refused whole: thrown (a picture only, not a PDF, a line that cannot be read, too many pages)
 *   or by content (cut short; filtered, with both totals; does not add up, at line N), and where
 *   the refused file is kept.
 * - A statement read from a picture by OCR is labelled experimental.
 * - The PDF reader not installed: the text reader, OCR and the reason, in words. Installing is not
 *   possible from here in this build; the engine refuses it and the screen says so plainly.
 * Engine prose is never shown: fixed codes become words. Money is whole paise strings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { count } from '../../format/counts.ts';
import { money } from '../../format/money.ts';
import { Field } from '../../parts/Field';
import {
  PDF_COMMIT_REFUSALS, PDF_WHOLE_REASONS, READER_INSTALL_REFUSALS, READER_REASONS, failureOf, sourceIdFor,
  validatePasswordHeld, validatePdfCommit, validatePdfPreview, validateReaderStatus,
  type Fr07Result, type JourneyFailure, type JourneyPort, type PdfPreview, type PdfTotal, type ReaderStatus,
} from './journey-contracts.ts';
import { Act, Actions, FailureLine, Note, Status } from './JourneyParts';
import s from './Journey.module.css';

export interface PdfStatementProps {
  readonly rpc: JourneyPort;
  readonly file: { readonly name: string; readonly bytesBase64: string };
  /** The engine reads files only against agreed meanings: hold the file for them. */
  readonly onNeedsMeanings: () => void;
  readonly onTaken: () => void;
}

type PasswordProblem = 'wrong' | 'invalid' | null;
type Phase =
  | { readonly kind: 'reading' }
  | { readonly kind: 'password'; readonly problem: PasswordProblem }
  | { readonly kind: 'reader'; readonly status: ReaderStatus; readonly installing: boolean; readonly failure: JourneyFailure | null }
  | { readonly kind: 'previewed'; readonly preview: PdfPreview; readonly commitFailure: JourneyFailure | null }
  | { readonly kind: 'taking'; readonly preview: PdfPreview }
  | { readonly kind: 'taken'; readonly preview: PdfPreview; readonly result: Fr07Result }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'failed'; readonly failure: JourneyFailure };

const code = (failure: JourneyFailure) => failure.kind === 'refused' ? failure.code : null;

export function PdfStatement({ rpc, file, onNeedsMeanings, onTaken }: PdfStatementProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const generation = useRef(0);
  const sourceId = sourceIdFor(file.name);

  const readerPhase = useCallback(async (token: number) => {
    try {
      const status = validateReaderStatus(await rpc.request('imports.readerStatus', {}));
      if (token === generation.current) setPhase({ kind: 'reader', status, installing: false, failure: null });
    } catch (error) { if (token === generation.current) setPhase({ kind: 'failed', failure: failureOf(error) }); }
  }, [rpc]);

  const preview = useCallback(async () => {
    const token = ++generation.current;
    setPhase({ kind: 'reading' });
    try {
      const reply = validatePdfPreview(await rpc.request('imports.preview', { sourceId, kind: 'pdf', bytesBase64: file.bytesBase64 }), sourceId);
      if (token !== generation.current) return;
      setPhase(reply.fr07.state === 'imported'
        ? { kind: 'taken', preview: reply, result: reply.fr07 }
        : { kind: 'previewed', preview: reply, commitFailure: null });
    } catch (error) {
      if (token !== generation.current) return;
      const failure = failureOf(error), refused = code(failure);
      if (refused === 'PASSWORD_REQUIRED' || refused === 'WRONG_PASSWORD') setPhase({ kind: 'password', problem: refused === 'WRONG_PASSWORD' ? 'wrong' : null });
      else if (refused === 'READER_NOT_INSTALLED') void readerPhase(token);
      else if (refused === 'DICTIONARY_REQUIRED') onNeedsMeanings();
      else if (refused !== null && PDF_WHOLE_REASONS.has(refused)) setPhase({ kind: 'refused', code: refused });
      else setPhase({ kind: 'failed', failure });
    }
  }, [rpc, sourceId, file.bytesBase64, readerPhase, onNeedsMeanings]);

  useEffect(() => { void preview(); return () => { generation.current++; }; }, [preview]);

  const sendPassword = async (form: HTMLFormElement) => {
    const field = form.elements.namedItem('pdf-password');
    // Read once and emptied at once; the value lives only in this call.
    const typed = field instanceof HTMLInputElement ? field.value : '';
    if (field instanceof HTMLInputElement) field.value = '';
    if (typed.length === 0) return;
    const token = ++generation.current;
    setPhase({ kind: 'reading' });
    try { validatePasswordHeld(await rpc.request('imports.providePassword', { sourceId, password: typed }), sourceId); }
    catch (error) {
      if (token !== generation.current) return;
      const failure = failureOf(error), refused = code(failure);
      setPhase(refused === 'PASSWORD_INVALID' ? { kind: 'password', problem: 'invalid' } : { kind: 'failed', failure });
      return;
    }
    // The engine holds it for this one preview, which says whether it opened the file.
    if (token === generation.current) void preview();
  };

  const install = async (current: Extract<Phase, { kind: 'reader' }>) => {
    const token = ++generation.current;
    setPhase({ ...current, installing: true, failure: null });
    let failure: JourneyFailure;
    try {
      await rpc.request('imports.installReader', {});
      // This build never installs from here: an answer is not this contract.
      failure = { kind: 'refused', code: 'INVALID_REPLY' };
    } catch (error) { failure = failureOf(error); }
    if (token === generation.current) setPhase({ ...current, installing: false, failure });
  };

  const take = async (current: PdfPreview) => {
    const token = ++generation.current;
    setPhase({ kind: 'taking', preview: current });
    try {
      const result = validatePdfCommit(await rpc.request('imports.commit', { sourceId, envelopeId: current.envelopeId }), current.envelopeId, sourceId);
      if (token === generation.current) setPhase({ kind: 'taken', preview: current, result });
    } catch (error) {
      if (token !== generation.current) return;
      const failure = failureOf(error), refused = code(failure);
      setPhase(refused !== null && PDF_COMMIT_REFUSALS.has(refused) ? { kind: 'previewed', preview: current, commitFailure: failure } : { kind: 'failed', failure });
    }
  };

  const amount = (minor: string | null) => minor === null ? t('FR-07.pdf.unknown') : money(minor);
  const totalText = (value: PdfTotal) => value === null ? t('FR-07.pdf.unknown') : value.kind === 'money' ? money(value.minor) : t('FR-07.pdf.lineCount', { count: count(String(value.count)) });
  const ocrLabel = (shown: Fr07Result) => shown.readByOcr && <p className={s.note} data-pdf-ocr="">{t('FR-07.pdf.ocr')}</p>;
  const facts = (shown: Fr07Result) => (
    <ul className={s.groups} data-pdf-preview="">
      <li>{t('FR-07.pdf.lines', { count: count(String(shown.linesRead)) })}</li>
      <li>{t('FR-07.pdf.opening', { amount: amount(shown.openingMinor) })}</li>
      <li>{t('FR-07.pdf.closing', { amount: amount(shown.closingMinor) })}</li>
      <li data-pdf-check={shown.checkPassed ? 'passed' : 'failed'}>{t(shown.checkPassed ? 'FR-07.pdf.check.passed' : 'FR-07.pdf.check.failed')}</li>
    </ul>
  );
  const again = <Act label="FR-07.pdf.again.btn" onClick={() => { void preview(); }} />;

  switch (phase.kind) {
    case 'reading': return <Status k="FR-07.pdf.reading" />;
    case 'password':
      return (
        <form className={s.section} data-file-password="" onSubmit={event => { event.preventDefault(); void sendPassword(event.currentTarget); }}>
          <h2 className={s.sectionTitle}>{t('FR-07.password.title')}</h2>
          <Field label={t('FR-07.password')} name="pdf-password" type="password" autoComplete="off" spellCheck={false}
            problem={phase.problem === null ? undefined : t(phase.problem === 'wrong' ? 'FR-07.password.wrong' : 'FR-07.password.invalid')} />
          <Note k="FR-07.password.note" />
          <Actions><Act submit variant="filled" label="FR-07.password.send.btn" /></Actions>
        </form>
      );
    case 'reader': {
      const reason = phase.status.reason;
      const failure = phase.failure, refused = failure === null ? null : code(failure);
      return (
        <div className={s.section} data-pdf-reader={phase.installing ? 'installing' : phase.status.status}>
          <p className={s.note}>{t(phase.status.status === 'installed' ? 'FR-07.reader.installed' : 'FR-07.reader.missing')}</p>
          <ul className={s.groups}>
            <li data-pdf-reader-text={String(phase.status.pdfText)}>{t(phase.status.pdfText ? 'FR-07.reader.text.yes' : 'FR-07.reader.text.no')}</li>
            <li data-pdf-reader-ocr={String(phase.status.pdfOcr)}>{t(phase.status.pdfOcr ? 'FR-07.reader.ocr.yes' : 'FR-07.reader.ocr.no')}</li>
            {reason !== null && <li data-pdf-reader-reason={reason}>{READER_REASONS.has(reason) ? t(`FR-07.reader.reason.${reason}`) : t('FR-07.reader.reason.other', { code: reason })}</li>}
          </ul>
          {failure !== null && (refused !== null && READER_INSTALL_REFUSALS.has(refused)
            ? <p className={s.status} role="status" data-reader-install={refused}>{t(`FR-07.reader.install.${refused}`)}</p>
            : <FailureLine failure={failure} notBuilt="FR-07.reader.notBuilt" refused="FR-07.reader.failed" />)}
          <Actions>
            <Act variant="filled" label="FR-07.reader.install.btn" disabled={phase.installing} onClick={() => { void install(phase); }} />
            {again}
          </Actions>
        </div>
      );
    }
    case 'previewed': case 'taking': {
      const shown = phase.preview.fr07;
      if (shown.state === 'refused') {
        return (
          <div className={s.section} data-file-refused="whole" data-whole-reason={shown.reason ?? shown.code ?? 'REFUSED'}>
            <p className={s.problem} role="alert">{t('FR-07.whole')}</p>
            {shown.reason !== null
              ? <p className={s.status}>{t(`FR-07.pdf.whole.${shown.reason}`)}</p>
              : shown.code !== null && <p className={s.status}>{t('FR-07.pdf.whole.other', { code: shown.code })}</p>}
            {shown.reason === 'FILTERED' && shown.totals !== null && (
              <p className={s.status} data-pdf-totals="">{t('FR-07.pdf.totals', { expected: totalText(shown.totals.expected), observed: totalText(shown.totals.observed) })}</p>
            )}
            {shown.line !== null && <p className={s.status} data-pdf-line={String(shown.line)}>{t('FR-07.pdf.atLine', { line: count(String(shown.line)) })}</p>}
            {ocrLabel(shown)}
            <p className={s.note} data-pdf-kept="">{t('FR-07.pdf.kept')}</p>
          </div>
        );
      }
      const failure = phase.kind === 'previewed' ? phase.commitFailure : null, refused = failure === null ? null : code(failure);
      return (
        <div className={s.section}>
          {ocrLabel(shown)}
          {facts(shown)}
          {shown.state === 'question' && <p className={s.status} data-pdf-question="">{t('FR-07.pdf.question')}</p>}
          {refused !== null && <p className={s.problem} role="alert" data-pdf-commit={refused}>{t(`FR-07.pdf.commit.${refused}`)}</p>}
          <Actions>
            {shown.state === 'checked' && refused === null && (
              <Act variant="filled" label="FR-07.pdf.take.btn" disabled={phase.kind === 'taking'} onClick={() => { if (phase.kind === 'previewed') void take(phase.preview); }} />
            )}
            {refused !== null && again}
          </Actions>
          {phase.kind === 'taking' && <Status k="FR-07.pdf.taking" />}
        </div>
      );
    }
    case 'taken':
      return (
        <div className={s.section} data-file-taken="">
          {ocrLabel(phase.preview.fr07)}
          {facts(phase.preview.fr07)}
          <Status k="FR-07.pdf.taken" />
          {phase.result.imported !== null && (phase.result.imported.duplicate
            ? <p className={s.note} data-pdf-duplicate="">{t('FR-07.pdf.duplicate')}</p>
            : <p className={s.note} data-pdf-rows={String(phase.result.imported.rows)}>{t('FR-07.pdf.rows', { count: count(String(phase.result.imported.rows)) })}</p>)}
          <Actions><Act variant="filled" label="FR.journey.continue.btn" onClick={onTaken} /></Actions>
        </div>
      );
    case 'refused':
      return (
        <div className={s.section} data-file-refused="whole" data-whole-reason={phase.code}>
          {phase.code !== 'PICTURE_ONLY' && <p className={s.problem} role="alert">{t('FR-07.whole')}</p>}
          <p className={s.status}>{t(`FR-07.pdf.whole.${phase.code}`)}</p>
        </div>
      );
    case 'failed':
      return code(phase.failure) === 'OPEN_DESKTOP'
        ? <p className={s.problem} role="alert" data-pdf-open-desktop="">{t('FR-07.pdf.openDesktop')}</p>
        : <FailureLine failure={phase.failure} notBuilt="FR-07.notBuilt" refused="FR-07.refused" />;
  }
}
