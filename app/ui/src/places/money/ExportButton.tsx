/**
 * Save the files, in the Share with your CA sheet (W4 4J4, U11 and P12; C4 T24): one month's invoices, credit notes,
 * payments and costs as a CSV file for the owner's accountant, with the receipts behind its totals. Chausar never sends
 * it anywhere.
 *
 * On the desktop the desktop asks the engine for the file and shows the system save dialog, which asks before it
 * replaces a file (saveMoneyExport), remembers the last folder and puts a read-me beside the files; a file that appeared
 * under the picked name meanwhile is left alone (EXPORT_EXISTS). The window hears how many files went to which folder
 * and holds an id for Show in folder, never a path. On the web and the hosted app the page asks the engine for the month's CSV (venture.money.export)
 * and offers it as a download, exactly as sent. The file is the engine's: the page never reads or changes a cell.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Icon } from '../../parts/Icon';
import { messageOf, useMonthWords } from './words';
import v from './MoneyViews.module.css';

type Said = { text: string; problem: boolean; id?: string | undefined };

/** Offers text as a file to save, without keeping it anywhere: a temporary address, clicked once, then let go. */
function download(name: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ExportButton({ month }: { month: string }) {
  const t = useT();
  const engine = useEngine();
  const monthWords = useMonthWords();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<Said | null>(null);
  /** 4J20: the signed receipts of the file just downloaded, offered as a second file (web and hosted). */
  const [receipts, setReceipts] = useState<{ name: string; text: string } | null>(null);

  async function exportMonth() {
    setBusy(true);
    setSaid(null);
    setReceipts(null);
    try {
      if (engine.saveMoneyExport) {
        const saved = await engine.saveMoneyExport(month);
        if (saved && saved.count && saved.folder) setSaid({ text: t('money.export.savedTo', { count: saved.count, folder: saved.folder }), problem: false, id: saved.id });
        else if (saved) setSaid({ text: saved.receipts ? t('money.export.savedBoth', { name: saved.name, receipts: saved.receipts }) : t('money.export.saved', { name: saved.name }), problem: false });
      } else {
        const file = await engine.request('venture.money.export', { month });
        // C4 (T24): the name in owner words, where the engine sends one.
        const name = file.ownerFileName ?? file.fileName;
        download(name, file.csv);
        setSaid({ text: t('money.export.downloaded', { name }), problem: false });
        if (file.receipts) setReceipts({ name: name.includes(', sales, ') ? name.replace(', sales, ', ', receipts, ').replace(/\.csv$/, '.json') : name.replace(/\.csv$/, '-receipts.json'), text: `${JSON.stringify(file.receipts, null, 2)}\n` });
      }
    } catch (error) {
      setSaid({ text: t('money.export.failed', { message: messageOf(error) }), problem: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={v.export}>
      <Button variant="primary" disabled={busy} title={t('money.export.label', { month: monthWords(month) })} onClick={() => void exportMonth()}>
        <Icon name="file-text" size={16} />
        {t('money.export.button')}
        <span className="sr-only">{t('money.export.month', { month: monthWords(month) })}</span>
      </Button>
      {receipts && <Button size="sm" variant="quiet" onClick={() => download(receipts.name, receipts.text, 'application/json')}>{t('money.export.receipts')}</Button>}
      {said && <span className={said.problem ? v.exportProblem : v.exportSaid} role="status" data-engine-line={said.problem ? '' : undefined}>{said.text}</span>}
      {said?.id && engine.showSavedExport && <Button size="sm" variant="quiet" onClick={() => { void engine.showSavedExport!(said.id!).catch((error: unknown) => setSaid({ text: t('money.export.failed', { message: messageOf(error) }), problem: true })); }}>{t('money.export.show')}</Button>}
    </span>
  );
}
