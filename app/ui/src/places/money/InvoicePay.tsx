/**
 * Wave 6 money on the invoice sheet (6D1 to 6D3). How clients pay: the UPI QR code exactly as the engine drew it (the
 * UI only draws its squares), the UPI ID, the amount the engine wrote beside its receipt, the bank details, the file
 * and the share buttons that open the owner's own WhatsApp or mail app (the owner sends), and a Razorpay payment link,
 * labelled fixture-tested, made only after a second ask on the exact digest the engine sent. While a link waits, the
 * sheet asks the engine to check it every half minute (the engine asks Razorpay; no webhooks).
 *
 * One-shot A6: on the desktop, Email it and Share on WhatsApp go through the desktop (shareInvoice), which makes the file
 * and opens a mail draft with it attached, or WhatsApp (the desktop app first, else the web page). The sheet says what
 * opened and, when the file could not go with it, offers it in its folder; it never says anything was sent. On the web
 * each press asks the engine again (S7: the first file was kept, so an email added later was never used), and a failure
 * names the button.
 *
 * BillPart: a draft can bill part of its order instead (an advance, a milestone, a part payment or what is left), sent
 * as typed; the engine cuts it and refuses anything past the order's total.
 */

import { useEffect, useId, useRef, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { openSheet } from '../../shell/navigation';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Receipt } from '../../parts/Receipt';
import type { InvoicePdfView, InvoiceShareResult, InvoiceViewLite } from '../../engine/types';
import { copyText, performHandoff } from '../clients/handoff';
import { reserveTab } from '../connections/external';
import { messageOf } from './words';
import s from './Money.module.css';

type Changed = (next?: InvoiceViewLite) => void;
/** How often a waiting payment link is checked while the sheet is open. */
const CHECK_EVERY_MS = 30_000;

/** The engine's QR matrix as squares; nothing about the payment is worked out here. */
function QrCode({ rows, label }: { rows: string[]; label: string }) {
  const side = rows.length + 8;
  const path = rows.flatMap((row, y) => [...row].flatMap((cell, x) => (cell === '1' ? [`M${x + 4} ${y + 4}h1v1h-1z`] : []))).join('');
  return (
    <svg className={s.qr} role="img" aria-label={label} viewBox={`0 0 ${side} ${side}`} shapeRendering="crispEdges" focusable="false">
      <rect className={s.qrLight} width={side} height={side} />
      <path className={s.qrDark} d={path} />
    </svg>
  );
}

/** Saves bytes the engine sent as a file, from the owner's own click. */
function saveFile(file: Pick<InvoicePdfView, 'fileName' | 'contentBase64' | 'mimeType'>): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const bytes = Uint8Array.from(atob(file.contentBase64), (character) => character.charCodeAt(0));
  const url = URL.createObjectURL(new Blob([bytes], { type: file.mimeType }));
  const link = document.createElement('a');
  link.href = url;
  link.download = file.fileName;
  link.rel = 'noopener';
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return true;
}

export function HowToPay({ view, onChanged }: { view: InvoiceViewLite; onChanged: Changed }) {
  const t = useT();
  const engine = useEngine();
  const headId = useId();
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  /** A6: the file the desktop kept for the owner to attach themselves, shown in its folder on request. */
  const [kept, setKept] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const pay = view.howToPay;
  const { invoice } = view;
  const issued = invoice.number !== null && invoice.status !== 'draft' && invoice.status !== 'void';
  const waiting = pay?.payLink && (pay.payLink.status === 'created' || pay.payLink.status === 'partially_paid');

  useEffect(() => { if (asking) cancelRef.current?.focus(); }, [asking]);
  // While a link waits for payment, ask the engine to check it now and then; it records a payment once, with its receipt.
  useEffect(() => {
    if (!waiting) return undefined;
    const timer = setInterval(() => {
      void engine.request('venture.invoice.payLink', { invoiceId: invoice.id, action: 'check' }).then((next) => onChanged(next), () => undefined);
    }, CHECK_EVERY_MS);
    return () => clearInterval(timer);
  }, [waiting, engine, invoice.id, onChanged]);

  async function act(work: () => Promise<void>, failed = 'money-pay.failed') {
    setBusy(true);
    setProblem(null);
    setSaid(null);
    setKept(null);
    try { await work(); } catch (error) { setProblem(t(failed, { message: messageOf(error) })); }
    setBusy(false);
  }
  // A6 (S7): every press asks the engine again, so the file and its links follow the invoice and the client as they are now.
  const fileNow = (): Promise<InvoicePdfView> => engine.request('venture.invoice.pdf', { invoiceId: invoice.id });
  const save = () => act(async () => {
    const made = await fileNow();
    if (!saveFile(made)) { setProblem(t('money-pay.cantSave')); return; }
    setSaid(made.note ?? t('money-pay.saved', { name: made.fileName }));
  });
  /** A6: what the desktop opened, in words, and the file offered in its folder. */
  const shared = (result: InvoiceShareResult) => {
    const file = result.file;
    const line = result.how === 'whatsapp'
      ? t(result.opened === 'app' ? 'money-pay.wa.app' : 'money-pay.wa.web', { file })
      : t(result.opened === 'draft' ? (result.to ? 'money-pay.mail.draft' : 'money-pay.mail.draftNoTo') : result.opened === 'link' ? 'money-pay.mail.link' : 'money-pay.mail.none', { file: result.opened === 'draft' ? result.attached : file });
    setSaid(result.note ? `${line} ${result.note}` : line);
    // A6 round 1: on a draft too, since a mail app that opens it read-only leaves the owner to attach the file again.
    setKept(file);
  };
  const whatsapp = () => {
    if (engine.shareInvoice) { void act(async () => shared(await engine.shareInvoice!(invoice.id, 'whatsapp')), 'money-pay.whatsappFailed'); return; }
    // A web tab is reserved inside the click, before the engine answers.
    let tab: Window | null = null;
    try { tab = reserveTab(); } catch (error) { setSaid(null); setKept(null); setProblem(t('money-pay.whatsappFailed', { message: messageOf(error) })); return; }
    void act(async () => {
      try {
        const made = await fileNow();
        await performHandoff({ action: 'whatsapp', url: made.share.whatsappUrl } as Parameters<typeof performHandoff>[0], tab);
      } catch (error) { tab?.close(); throw error; }
      setSaid(t('money-pay.shareNote'));
    }, 'money-pay.whatsappFailed');
  };
  const email = () => act(async () => {
    if (engine.shareInvoice) { shared(await engine.shareInvoice(invoice.id, 'email')); return; }
    const made = await fileNow();
    await performHandoff({ action: 'mailto', url: made.share.mailtoUrl } as Parameters<typeof performHandoff>[0], null);
    setSaid(t('money-pay.shareNote'));
  }, 'money-pay.emailFailed');
  const showKept = async (name: string) => {
    // A6 round 1: a file that cannot be shown takes the line above with it, so no stale "opened" line sits over the problem.
    try { await engine.showShared?.(name); } catch (error) { setSaid(null); setKept(null); setProblem(t('money-pay.showFailed', { message: messageOf(error) })); }
  };
  const makeLink = (digest: string) => act(async () => {
    setAsking(false);
    onChanged(await engine.request('venture.invoice.payLink', { invoiceId: invoice.id, action: 'create', digest }));
  });
  const copy = (link: string) => act(async () => { if (await copyText(link)) setSaid(t('money-pay.copied')); else setProblem(t('money-pay.cantSave')); });

  return (
    <section className={s.block} aria-labelledby={headId} data-how-to-pay="">
      <h3 id={headId} className={s.blockTitle}>{t('money-pay.title')}</h3>
      {!pay ? (
        <div className={s.payRow}>
          <p className={s.quietLine}>{t('money-pay.none')}</p>
          <Button size="sm" onClick={(event) => openSheet('billing', 'settings', event.currentTarget)}>{t('money-pay.setUp')}</Button>
        </div>
      ) : (
        <>
          {pay.upi && (
            <div className={s.payUpi}>
              <QrCode rows={pay.upi.qr.rows} label={t('money-pay.qr', { number: pay.upi.reference })} />
              <dl className={s.payFacts} data-figure-group="">
                <div><dt>{t('money-pay.upiId')}</dt><dd className="mono" data-content="">{pay.upi.id}</dd></div>
                <div>
                  <dt>{t('money-pay.amount')}</dt>
                  <dd className="mono">{pay.upi.amount} <Receipt id={pay.upi.receiptId} amount={pay.upi.amount} /></dd>
                </div>
              </dl>
              <Button size="sm" variant="quiet" disabled={busy} onClick={() => void copy(pay.upi!.link)}>{t('money-pay.copyLink')}</Button>
              <p className={s.quietLine}>{t('money-pay.marked')}</p>
            </div>
          )}
          {pay.upiNote && <p className={s.quietLine} data-engine-line="">{pay.upiNote}</p>}
          {pay.bank && (
            <p className={s.sheetLine}>
              <span className={s.figureLabel}>{t('money-pay.bank')}</span>
              <span data-content="">{[t('money-pay.account', { name: pay.bank.accountName, number: pay.bank.accountNumber }), pay.bank.ifsc ? `IFSC ${pay.bank.ifsc}` : '', pay.bank.swift ? `SWIFT ${pay.bank.swift}` : '', pay.bank.bankName ?? ''].filter(Boolean).join(', ')}</span>
            </p>
          )}
          {pay.payLink && (
            <p className={s.sheetLine} data-pay-link={pay.payLink.status}>
              <span className={s.figureLabel}>{t('money-pay.link')} <span className={s.chipQuiet}>{t('money-pay.fixture')}</span></span>
              <span className="mono" data-content="">{pay.payLink.shortUrl}</span>
              <span>{t(`money-pay.linkStatus.${pay.payLink.status}`)}</span>
            </p>
          )}
          {pay.payLinkOffer && (asking ? (
            <div className={s.ask}>
              <p>{t('money-pay.linkAsk', { amount: pay.payLinkOffer.amount })} <span className={s.chipQuiet}>{t('money-pay.fixture')}</span></p>
              <div className={s.buttons}>
                <Button ref={cancelRef} size="sm" onClick={() => setAsking(false)}>{t('money-pay.cancel')}</Button>
                <Button size="sm" data-confirm="" disabled={busy} onClick={() => void makeLink(pay.payLinkOffer!.digest)}>{t('money-pay.linkConfirm')}</Button>
              </div>
            </div>
          ) : (
            <p className={s.payRow}>
              <Button size="sm" disabled={busy} onClick={() => setAsking(true)}>{t('money-pay.linkMake')}</Button>
              <span className={s.chipQuiet}>{t('money-pay.fixture')}</span>
            </p>
          ))}
          <p className={s.payRow}>
            <Button size="sm" variant="quiet" onClick={(event) => openSheet('billing', 'settings', event.currentTarget)}>{t('money-pay.change')}</Button>
          </p>
        </>
      )}
      {issued && (
        <div className={s.buttons}>
          <Button size="sm" disabled={busy} onClick={() => void save()}>{t('money-pay.saveFile')}</Button>
          <Button size="sm" disabled={busy} onClick={whatsapp}>{t('money-pay.whatsapp')}</Button>
          <Button size="sm" disabled={busy} onClick={() => void email()}>{t('money-pay.email')}</Button>
        </div>
      )}
      {said && <p className={s.notice} role="status" data-engine-line="">{said}</p>}
      {kept && engine.showShared && (
        <p className={s.payRow}>
          <Button size="sm" variant="quiet" onClick={() => void showKept(kept)}>{t(kept.endsWith('.pdf') ? 'money-pay.showPdf' : 'money-pay.showFile')}</Button>
        </p>
      )}
      {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </section>
  );
}

const KINDS = ['advance', 'milestone', 'partial', 'final'] as const;
type Kind = typeof KINDS[number];

/** On a draft: bill part of the order instead. On an issued part: bill what is left. Everything typed goes as typed. */
export function BillPart({ view, onChanged }: { view: InvoiceViewLite; onChanged: Changed }) {
  const t = useT();
  const engine = useEngine();
  const kindId = useId();
  const [kind, setKind] = useState<Kind>('advance');
  const [percent, setPercent] = useState('');
  const [amount, setAmount] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { invoice } = view;

  async function draft(part?: { kind: Kind; label?: string; percent?: string; amount?: string }) {
    setBusy(true);
    setProblem(null);
    try {
      onChanged(await engine.request('venture.invoice.prepare', { orderId: invoice.orderId, ...(part ? { part } : {}) }));
    } catch (error) {
      setProblem(t('money-pay.failed', { message: messageOf(error) }));
    }
    setBusy(false);
  }

  // The part's name only: its figures, and the order's total and what is billed, are on the receipt and the client copy.
  const partLine = invoice.part ? <p className={s.quietLine} data-part={invoice.part.kind}><span data-content="">{invoice.part.label}</span></p> : null;
  const restOpen = invoice.status !== 'draft' && invoice.part && invoice.part.kind !== 'final';

  return (
    <>
      {partLine}
      {restOpen && <p className={s.payRow}><Button size="sm" disabled={busy} onClick={() => void draft()}>{t('money-pay.part.rest')}</Button></p>}
      {invoice.status === 'draft' && (
        <details className={`${s.fold} ${s.block}`}>
          <summary>{t('money-pay.part.fold')}</summary>
          <div className={s.field}>
            <label htmlFor={kindId} className={s.fieldLabel}>{t('money-pay.part.kind')}</label>
            <select id={kindId} className={s.select} value={kind} disabled={busy} onChange={(event) => setKind(event.currentTarget.value as Kind)}>
              {KINDS.map((item) => <option key={item} value={item}>{t(`money-pay.part.${item}`)}</option>)}
            </select>
          </div>
          {(kind === 'advance' || kind === 'milestone') && <Field label={t('money-pay.part.percent')} value={percent} inputMode="decimal" autoComplete="off" disabled={busy} onChange={(event) => setPercent(event.currentTarget.value)} />}
          {kind === 'partial' && <Field label={t('money-pay.part.amount')} value={amount} inputMode="decimal" autoComplete="off" disabled={busy} onChange={(event) => setAmount(event.currentTarget.value)} />}
          {kind !== 'final' && <Field label={t('money-pay.part.label')} value={label} autoComplete="off" disabled={busy} onChange={(event) => setLabel(event.currentTarget.value)} />}
          <div className={s.buttons}>
            <Button size="sm" disabled={busy} onClick={() => void draft({
              kind, ...(label.trim() && kind !== 'final' ? { label: label.trim() } : {}),
              ...(kind === 'advance' || kind === 'milestone' ? { percent: percent.trim() } : {}), ...(kind === 'partial' ? { amount: amount.trim() } : {}),
            })}>{t('money-pay.part.draft')}</Button>
          </div>
          {problem && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
        </details>
      )}
      {problem && invoice.status !== 'draft' && <p className={s.refusal} role="status" data-engine-line="">{problem}</p>}
    </>
  );
}
