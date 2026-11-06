/**
 * One-shot C6 task 5 (SCREENS 95): on a paid invoice, a thank-you receipt the owner sends on WhatsApp, and the same
 * receipt saved. Chausar sends nothing: on the desktop, the desktop keeps the file and opens WhatsApp with the words; on
 * the web, the engine's link opens and the file downloads on its own press. The words and the file are the engine's,
 * made by code from the payment. The sheet says what opened, never that anything was sent.
 *
 * Seam: C4 task 20 records the share ("Opened in WhatsApp to share the receipt, 3 Nov") through venture.invoice.shared.
 */

import { useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import type { InvoicePdfView, InvoiceViewLite, ReceiptShareResult } from '../../engine/types';
import { performHandoff } from '../clients/handoff';
import { reserveTab } from '../connections/external';
import { saveFile } from './InvoicePay';
import { messageOf } from './words';
import s from './Money.module.css';

export function ThankYou({ view }: { view: InvoiceViewLite }) {
  const t = useT();
  const engine = useEngine();
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [kept, setKept] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The newest payment that came in: the one that cleared the invoice. A cheque still waiting has no receipt yet.
  const payment = view.payments.filter((item) => item.state !== 'pending').at(-1);
  if (!view.paidInFull || !payment) return null;
  const paymentId = payment.id;

  async function act(work: () => Promise<void>) {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    setKept(null);
    try { await work(); } catch (error) { setProblem(t('money-pay.receipt.failed', { message: messageOf(error) })); }
    setBusy(false);
  }
  const fileNow = (): Promise<InvoicePdfView> => engine.request('venture.payment.receipt', { paymentId });
  const shared = (result: ReceiptShareResult) => {
    const line = t(result.how === 'save' ? 'money-pay.receipt.saved' : 'money-pay.receipt.opened', { file: result.file });
    setSaid(result.note ? `${line} ${result.note}` : line);
    setKept(result.file);
  };
  const whatsapp = () => {
    if (engine.shareReceipt) { void act(async () => shared(await engine.shareReceipt!(paymentId, 'whatsapp'))); return; }
    // A web tab is reserved inside the click, before the engine answers.
    let tab: Window | null = null;
    try { tab = reserveTab(); } catch (error) { setProblem(t('money-pay.receipt.failed', { message: messageOf(error) })); return; }
    void act(async () => {
      try {
        const made = await fileNow();
        await performHandoff({ action: 'whatsapp', url: made.share.whatsappUrl } as Parameters<typeof performHandoff>[0], tab);
      } catch (error) { tab?.close(); throw error; }
      setSaid(t('money-pay.receipt.openedWeb'));
    });
  };
  const save = () => void act(async () => {
    if (engine.shareReceipt) { shared(await engine.shareReceipt(paymentId, 'save')); return; }
    const made = await fileNow();
    if (!saveFile(made)) { setProblem(t('money-pay.cantSave')); return; }
    setSaid(made.note ?? t('money-pay.receipt.saved', { file: made.fileName }));
  });
  const showKept = async (name: string) => {
    try { await engine.showShared?.(name); } catch (error) { setSaid(null); setKept(null); setProblem(t('money-pay.showFailed', { message: messageOf(error) })); }
  };

  return (
    <div className={s.block} data-thank-you="">
      <div className={s.buttons}>
        <Button size="sm" disabled={busy} onClick={whatsapp}>{t('money-pay.receipt.whatsapp')}</Button>
        <Button size="sm" disabled={busy} onClick={save}>{t('money-pay.receipt.save')}</Button>
      </div>
      {said && <p className={s.notice} role="status" data-engine-line="">{said}</p>}
      {kept && engine.showShared && (
        <p className={s.payRow}>
          <Button size="sm" variant="quiet" onClick={() => void showKept(kept)}>{t(kept.endsWith('.pdf') ? 'money-pay.showPdf' : 'money-pay.showFile')}</Button>
        </p>
      )}
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </div>
  );
}
