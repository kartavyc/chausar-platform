/**
 * FR-07 for a bank statement PDF, through the connectors-ext `imports.*` family:
 * `imports.preview` → the lines read, the opening and closing balance and whether the check
 * passed, then `imports.commit`. BringFile draws this only when `imports.readerStatus`
 * answered, so an engine without the family never offers PDF.
 *
 * - Password needed ("Used once, on this computer. Not kept."): the field is uncontrolled, read
 *   once on submit and emptied at once; the value goes straight to `imports.providePassword` and
 *   is never put in React state, storage or a log. A wrong password says so; no count is shown.
 * - Refused whole with the reason from the fixed list: a picture only, cut short, filtered, does
 *   not add up.
 * - The PDF reader not installed: its size, then Install (downloading and checking), done or failed.
 * Engine prose is never shown: fixed codes become words. Money is whole paise strings.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '../../app/text';
import { count } from '../../format/counts.ts';
import { money } from '../../format/money.ts';
import { Field } from '../../parts/Field';
import {
  PDF_WHOLE_REASONS, failureOf, sourceIdFor, validatePdfPreview, validateReaderStatus,
  type JourneyFailure, type JourneyPort, type PdfPreview, type ReaderStatus,
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

type Phase =
  | { readonly kind: 'reading' }
  | { readonly kind: 'password'; readonly wrong: boolean }
  | { readonly kind: 'reader'; readonly status: ReaderStatus; readonly installing: boolean; readonly failure: JourneyFailure | null }
  | { readonly kind: 'previewed'; readonly preview: PdfPreview }
  | { readonly kind: 'taking'; readonly preview: PdfPreview }
  | { readonly kind: 'taken'; readonly preview: PdfPreview }
  | { readonly kind: 'refused'; readonly code: string }
  | { readonly kind: 'failed'; readonly failure: JourneyFailure };

const code = (failure: JourneyFailure) => failure.kind === 'refused' ? failure.code : null;

export function PdfStatement({ rpc, file, onNeedsMeanings, onTaken }: PdfStatementProps) {
  const t = useT();
  const [phase, setPhase] = useState<Phase>({ kind: 'reading' });
  const generation = useRef(0);
  const sourceId = sourceIdFor(file.name);
  const request = { sourceId, kind: 'pdf' as const, bytesBase64: file.bytesBase64 };

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
      const reply = validatePdfPreview(await rpc.request('imports.preview', { sourceId, kind: 'pdf', bytesBase64: file.bytesBase64 }));
      if (token === generation.current) setPhase({ kind: 'previewed', preview: reply });
    } catch (error) {
      if (token !== generation.current) return;
      const failure = failureOf(error), refused = code(failure);
      if (refused === 'PASSWORD_REQUIRED' || refused === 'WRONG_PASSWORD') setPhase({ kind: 'password', wrong: refused === 'WRONG_PASSWORD' });
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
    try { await rpc.request('imports.providePassword', { sourceId, password: typed }); }
    catch (error) {
      if (token !== generation.current) return;
      const failure = failureOf(error);
      setPhase(code(failure) === 'WRONG_PASSWORD' ? { kind: 'password', wrong: true } : { kind: 'failed', failure });
      return;
    }
    if (token === generation.current) void preview();
  };

  const install = async (current: Extract<Phase, { kind: 'reader' }>) => {
    const token = ++generation.current;
    setPhase({ ...current, installing: true, failure: null });
    try {
      const status = validateReaderStatus(await rpc.request('imports.installReader', {}));
      if (token !== generation.current) return;
      if (status.state === 'installed') void preview();
      else setPhase({ kind: 'reader', status, installing: false, failure: { kind: 'refused', code: 'READER_NOT_INSTALLED' } });
    } catch (error) { if (token === generation.current) setPhase({ ...current, installing: false, failure: failureOf(error) }); }
  };

  const take = async (current: PdfPreview) => {
    const token = ++generation.current;
    setPhase({ kind: 'taking', preview: current });
    try {
      const reply = await rpc.request('imports.commit', request);
      if (token !== generation.current) return;
      // Only that it answered with a record is used; the facts drawn are the preview's.
      const answered = reply !== null && typeof reply === 'object' && !Array.isArray(reply);
      setPhase(answered ? { kind: 'taken', preview: current } : { kind: 'failed', failure: { kind: 'refused', code: 'INVALID_REPLY' } });
    } catch (error) { if (token === generation.current) setPhase({ kind: 'failed', failure: failureOf(error) }); }
  };

  const amount = (minor: string | null) => minor === null ? t('FR-07.pdf.unknown') : money(minor);
  const facts = (shown: PdfPreview) => (
    <ul className={s.groups} data-pdf-preview="">
      <li>{t('FR-07.pdf.lines', { count: shown.lines === null ? t('FR-07.pdf.unknown') : count(String(shown.lines)) })}</li>
      <li>{t('FR-07.pdf.opening', { amount: amount(shown.openingMinor) })}</li>
      <li>{t('FR-07.pdf.closing', { amount: amount(shown.closingMinor) })}</li>
      <li data-pdf-check={shown.check ?? 'unknown'}>{t(`FR-07.pdf.check.${shown.check ?? 'unknown'}`)}</li>
    </ul>
  );

  switch (phase.kind) {
    case 'reading': return <Status k="FR-07.pdf.reading" />;
    case 'password':
      return (
        <form className={s.section} data-file-password="" onSubmit={event => { event.preventDefault(); void sendPassword(event.currentTarget); }}>
          <h2 className={s.sectionTitle}>{t('FR-07.password.title')}</h2>
          <Field label={t('FR-07.password')} name="pdf-password" type="password" autoComplete="off" spellCheck={false}
            problem={phase.wrong ? t('FR-07.password.wrong') : undefined} />
          <Note k="FR-07.password.note" />
          <Actions><Act submit variant="filled" label="FR-07.password.send.btn" /></Actions>
        </form>
      );
    case 'reader': {
      const size = phase.status.sizeBytes;
      return (
        <div className={s.section} data-pdf-reader={phase.installing ? 'installing' : phase.status.state}>
          <p className={s.note}>{size === null ? t('FR-07.reader.missing.plain') : t('FR-07.reader.missing', { size: (size / 1_000_000).toFixed(1) })}</p>
          {phase.installing && <Status k="FR-07.reader.installing" />}
          {phase.failure !== null && <FailureLine failure={phase.failure} notBuilt="FR-07.reader.notBuilt" refused="FR-07.reader.failed" />}
          <Actions><Act variant="filled" label="FR-07.reader.install.btn" disabled={phase.installing} onClick={() => { void install(phase); }} /></Actions>
        </div>
      );
    }
    case 'previewed': case 'taking':
      return (
        <div className={s.section}>
          {facts(phase.preview)}
          <Actions><Act variant="filled" label="FR-07.pdf.take.btn" disabled={phase.kind === 'taking'} onClick={() => { if (phase.kind === 'previewed') void take(phase.preview); }} /></Actions>
          {phase.kind === 'taking' && <Status k="FR-07.pdf.taking" />}
        </div>
      );
    case 'taken':
      return (
        <div className={s.section} data-file-taken="">
          {facts(phase.preview)}
          <Status k="FR-07.pdf.taken" />
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
    case 'failed': return <FailureLine failure={phase.failure} notBuilt="FR-07.notBuilt" refused="FR-07.refused" />;
  }
}
