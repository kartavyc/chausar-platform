import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { BankImportResult } from '../../engine/types';
import { SAMPLE_STATEMENT_PATH, STATEMENT_FORMATS } from '../../../../../platform/runtime/venture/build/bank-formats';
import type { SheetComponentProps } from '../../shell/sheets';
import s from './Connections.module.css';
import { FilePick } from '../../parts/FilePick';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** C4 (T28): "A, B and C", from the parser's own list. */
const banksWords = (): string => {
  const names = STATEMENT_FORMATS.map((format) => format.bank);
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/** The file's text, as it is. The engine reads the rows; nothing here reads an amount. */
function textOf(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

/**
 * Import a bank statement (venture.bank.import): the owner names the account and picks the CSV file the bank gave
 * them; the engine reads it, skips lines it already has and says which lines it could not read. No bank provider is
 * linked, so nothing reads the bank on its own and nothing here can move money.
 */
export function BankImportSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  return (
    <Sheet label={t('connections.bank.label')} title={t('connections.bank.title')} line={t('connections.bank.line')} onClose={onClose} returnFocus={returnFocus}>
      <BankImportForm />
    </Sheet>
  );
}

/** The import form on its own, so the bank account sheet holds it too (BankSheet.tsx). onImported runs after each import. */
export function BankImportForm({ onImported }: { onImported?: () => void }) {
  const t = useT();
  const client = useEngine();
  const [account, setAccount] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [result, setResult] = useState<BankImportResult | null>(null);
  const missing = !account.trim() && !file ? t('connections.bank.needBoth') : !file ? t('connections.bank.fileFirst') : !account.trim() ? t('connections.bank.accountFirst') : undefined;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!file) { setProblem(t('connections.bank.fileFirst')); return; }
    setBusy(true);
    setProblem(null);
    setResult(null);
    try {
      const csv = await textOf(file);
      setResult(await client.request('venture.bank.import', { csv, account: account.trim() }));
      onImported?.();
    } catch (error) {
      setProblem(messageOf(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className={s.form} onSubmit={(event) => void submit(event)}>
        <p className={s.said} data-banks="">
          {t('connections.bank.banks', { banks: banksWords() })}{' '}
          <a href={SAMPLE_STATEMENT_PATH} download="sample-bank-statement.csv">{t('connections.bank.sample')}</a>
        </p>
        <Field label={t('connections.bank.account')} hint={t('connections.bank.accountHint')} value={account} maxLength={60} autoComplete="off" onChange={(event) => setAccount(event.currentTarget.value)} />
        <FilePick label={t('connections.bank.file')} accept=".csv,text/csv" onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setResult(null); }} />
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <div className={s.buttons}><Button variant="primary" type="submit" disabled={busy} disabledReason={missing}>{t('connections.bank.import')}</Button></div>
      </form>
      {result && (
        <div role="status">
          <p className={s.said}>{result.line}</p>
          {result.rejected.length > 0 && (
            <ul className={s.rejected}>
              {result.rejected.map((line) => <li key={line.line}>{t('connections.bank.rejected', { line: line.line, reason: line.reason })}</li>)}
            </ul>
          )}
        </div>
      )}
    </>
  );
}
