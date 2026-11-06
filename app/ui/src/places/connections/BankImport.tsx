import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { BankImportResult } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import s from './Connections.module.css';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
        <Field label={t('connections.bank.account')} hint={t('connections.bank.accountHint')} value={account} maxLength={60} autoComplete="off" onChange={(event) => setAccount(event.currentTarget.value)} />
        <Field label={t('connections.bank.file')} type="file" accept=".csv,text/csv" onChange={(event) => { setFile(event.currentTarget.files?.[0] ?? null); setResult(null); }} />
        {problem && <p className={s.problem} role="alert">{problem}</p>}
        <div className={s.buttons}><Button variant="primary" type="submit" disabled={busy}>{t('connections.bank.import')}</Button></div>
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
