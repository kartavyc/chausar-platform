/**
 * Small pieces the Money place shares. Nothing here reads, parses or changes an amount: a figure is shown exactly as
 * the engine wrote it, beside the receipt or invoice that explains it.
 */

import { useId, type ReactNode } from 'react';
import { useT } from '../../text';
import { openSheet } from '../../shell/navigation';
import type { EngineError } from '../../engine/types';
import s from './Money.module.css';

/** A figure exactly as the engine wrote it: in mono, or in the body face when the engine wrote it as a phrase
 *  ("₹60.10 this month (includes estimates)", "No price"), so words never set in a typewriter face. */
export function Figure({ children }: { children: string }) {
  const phrase = /[A-Za-zऀ-ॿ]{3}/.test(children);
  return <span className={phrase ? `${s.figure} ${s.phrase}` : `${s.figure} mono`} data-figure="">{children}</span>;
}

/**
 * The engine's rupee figure beside a dollar one, as it wrote it with the owner's own rate ("₹20.88 at ₹83.50 per $1
 * (your rate, set 23 Oct 2026)"). Nothing when the owner set no rate: then spend is in dollars only.
 */
export function Rupees({ text }: { text?: string }) {
  return text ? <> · <span className={s.note}>{text}</span></> : null;
}

/** An invoice number that opens the invoice beside the list, where each of its figures sits with its receipt. */
export function InvoiceRef({ id, number }: { id: string; number: string }) {
  const t = useT();
  return (
    <button type="button" className={`${s.ref} mono`} data-invoice={id} aria-label={t('money.invoiceRef', { number })} onClick={(event) => openSheet('invoice', id, event.currentTarget)}>
      {number}
    </button>
  );
}

export function Failed({ error }: { error: EngineError }) {
  const t = useT();
  return <p className={s.failed} role="status">{t('money.failed', { message: error.message })}</p>;
}

/** A titled part of a page: a small grey heading and what sits under it. */
export function Section({ title, children }: { title: string; children: ReactNode }) {
  const id = useId();
  return (
    <section className={s.section} aria-labelledby={id}>
      <h2 id={id} className={s.heading}>{title}</h2>
      {children}
    </section>
  );
}
