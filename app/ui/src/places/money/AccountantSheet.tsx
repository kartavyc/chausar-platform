import { messageOf } from '../../../../../platform/shared/errors.ts';
/**
 * Share with your CA (C4 T24; `?sheet=accountant:books`, from For your CA and the business menu's Invite your accountant):
 * the one sheet, with two ways to hand one month over. Save the files (ExportButton.tsx), and Make a link (W4 4J7's 'books'
 * share link: a read-only link to the month's invoices and payments, with the receipts behind their totals). Making the
 * link is the owner's choice, inside the app; it lasts a week and can be taken back. Links open only on the hosted app, so
 * on the desktop there is no Make a link at all. Where a page cannot serve one (a local web page) the engine says so in
 * its own words. Chausar sends nothing: the owner shares the files or the link themselves.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { Field } from '../../parts/Field';
import { Button } from '../../parts/Button';
import { Sheet } from '../../parts/Sheet';
import type { ShareLink } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { copyText } from '../clients/handoff';
import { ExportButton } from './ExportButton';
import { monthBefore, useMoment, useMonthWords, useThisMonth } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';
import { Select } from '../../parts/Select';

export function AccountantSheet({ id, onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const monthId = useId();
  const moment = useMoment();
  const monthWords = useMonthWords();
  const thisMonth = useThisMonth();
  // C5 task 17: Today's row opens the sheet on the month its pack is for (`accountant:2026-11`).
  const asked = /^\d{4}-\d{2}$/.test(id) ? id : null;
  const recent = [thisMonth, monthBefore(thisMonth), monthBefore(monthBefore(thisMonth))];
  const months = asked && !recent.includes(asked) ? [...recent, asked] : recent;
  const [month, setMonth] = useState(asked ?? thisMonth);
  const [link, setLink] = useState<ShareLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);

  async function make() {
    setBusy(true);
    setSaid(null);
    try {
      setLink(await engine.request('venture.share.create', { kind: 'books', month }));
    } catch (error) {
      setSaid({ text: t('money.accountant.failed', { message: messageOf(error) }), problem: true });
    }
    setBusy(false);
  }

  /** Copies the link for the owner to send their accountant; Chausar sends nothing. */
  async function copy(url: string) {
    setSaid(await copyText(url) ? { text: t('money.accountant.copied'), problem: false } : { text: t('money.accountant.copyFailed'), problem: true });
  }

  async function revoke(id: string) {
    setBusy(true);
    try {
      await engine.request('venture.share.revoke', { id });
      setLink(null);
      setSaid({ text: t('money.accountant.revoked'), problem: false });
    } catch (error) {
      setSaid({ text: t('money.accountant.failed', { message: messageOf(error) }), problem: true });
    }
    setBusy(false);
  }

  return (
    <Sheet label={t('money.accountant.label')} title={t('money.accountant.title')} line={t('money.accountant.line')} onClose={onClose} returnFocus={returnFocus}>
      <SendToCa month={month} />
      <MonthlyPack />
      {!link && (
        <div className={s.form}>
          <div className={s.field}>
            <label htmlFor={monthId} className={s.fieldLabel}>{t('money.month')}</label>
            <Select id={monthId} className={s.select} value={month} disabled={busy} onChange={(event) => setMonth(event.currentTarget.value)}>
              {months.map((item) => <option key={item} value={item}>{monthWords(item)}</option>)}
            </Select>
          </div>
          <p className={s.quietLine}>{t('money.export.holds')}</p>
          <div className={s.buttons}><ExportButton month={month} /></div>
          {/* C4 T24 (A4 row 29): a link opens only on the hosted app; the desktop never offers one. */}
          {!engine.saveMoneyExport && (
            <>
              <p className={s.quietLine}>{t('money.accountant.shows')}</p>
              <div className={s.buttons}>
                <Button disabled={busy} onClick={() => void make()}>{t('money.accountant.make')}</Button>
              </div>
            </>
          )}
        </div>
      )}
      {link && (
        <div className={v.link}>
          {link.url
            ? (
              <p className={v.linkUrl}>
                <span data-code="" className="mono" data-content="">{link.url}</span>
                <Button size="sm" variant="quiet" onClick={() => void copy(link.url!)}>{t('money.accountant.copy')}</Button>
              </p>
            )
            : link.reason && <p className={s.quietLine} data-engine-line="">{link.reason}</p>}
          {/* One-shot A4 (row 29): how long a link stays open is said only for a link that opens. */}
          {link.url && <p className={s.quietLine}>{t('money.accountant.until', { when: moment(link.expiresAt) })}</p>}
          {!link.url && <p className={s.quietLine}>{t('money.accountant.export')}</p>}
          <div className={s.buttons}>
            <Button disabled={busy} onClick={() => void revoke(link.id)}>{t('money.accountant.revoke')}</Button>
          </div>
        </div>
      )}
      {said && <p className={said.problem ? s.refusal : s.notice} role="status" data-engine-line={said.problem ? '' : undefined}>{said.text}</p>}
    </Sheet>
  );
}

/**
 * C5 task 16: remember the CA, then Send to my CA in one step: a confirm that names what leaves and to whom, then the
 * desktop opens a mail draft with the month's file attached (or WhatsApp). Chausar sends nothing; the words say so.
 */
function SendToCa({ month }: { month: string }) {
  const t = useT();
  const engine = useEngine();
  const contact = useResource('venture.accountant.get', {});
  const monthWords = useMonthWords();
  const [email, setEmail] = useState<string | null>(null);
  const [whatsapp, setWhatsapp] = useState<string | null>(null);
  const [asking, setAsking] = useState<'email' | 'whatsapp' | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ text: string; problem: boolean } | null>(null);
  const shownEmail = email ?? contact.data?.email ?? '';
  const shownWhatsapp = whatsapp ?? contact.data?.whatsapp ?? '';

  async function keep() {
    setBusy(true);
    setSaid(null);
    try {
      await engine.request('venture.accountant.set', { email: shownEmail.trim() || null, whatsapp: shownWhatsapp.trim() || null });
      contact.reload();
      setEmail(null);
      setWhatsapp(null);
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true });
    }
    setBusy(false);
  }
  async function send(how: 'email' | 'whatsapp') {
    if (!engine.sharePack) return;
    setBusy(true);
    setSaid(null);
    try {
      const done = await engine.sharePack(month, how);
      setSaid(done.opened === 'none' ? { text: t('money.ca.noMailApp'), problem: true } : { text: t(how === 'email' ? 'money.ca.draftReady' : 'money.ca.whatsappReady'), problem: false });
      // C5 task 17: that month's row on Today has done its job. It says nothing here if there is none.
      if (done.opened !== 'none') void engine.request('venture.accountant.pack.done', { month }).catch(() => undefined);
    } catch (error) {
      setSaid({ text: messageOf(error), problem: true });
    }
    setAsking(null);
    setBusy(false);
  }
  const saved = contact.data;
  const to = asking === 'email' ? saved?.email : saved?.whatsapp;
  return (
    <section className={s.form} aria-label={t('money.ca.label')}>
      <Field label={t('money.ca.email')} type="email" autoComplete="off" value={shownEmail} disabled={busy} onChange={(event) => setEmail(event.currentTarget.value)} />
      <Field label={t('money.ca.whatsapp')} inputMode="tel" autoComplete="off" value={shownWhatsapp} disabled={busy} onChange={(event) => setWhatsapp(event.currentTarget.value)} />
      <div className={s.buttons}>
        <Button variant="quiet" disabled={busy} onClick={() => void keep()}>{t('money.ca.keep')}</Button>
        {engine.sharePack && saved?.email && <Button disabled={busy} onClick={() => setAsking('email')}>{t('money.ca.send')}</Button>}
        {engine.sharePack && saved?.whatsapp && <Button variant="quiet" disabled={busy} onClick={() => setAsking('whatsapp')}>{t('money.ca.sendWhatsapp')}</Button>}
      </div>
      {asking && (
        <div className={s.ask}>
          <p>{t('money.ca.ask', { month: monthWords(month), to: to ?? '' })}</p>
          <div className={s.buttons}>
            <Button onClick={() => setAsking(null)}>{t('money.accountant.cancel')}</Button>
            <Button variant="primary" disabled={busy} onClick={() => void send(asking)}>{t(asking === 'email' ? 'money.ca.openDraft' : 'money.ca.openWhatsapp')}</Button>
          </div>
        </div>
      )}
      {said && <p className={said.problem ? s.failed : s.quietLine} role="status" data-engine-line="">{said.text}</p>}
    </section>
  );
}

/** C5 task 17: the standing order: last month's files saved on this computer on the 1st, with one row on Today. */
function MonthlyPack() {
  const t = useT();
  const engine = useEngine();
  const schedule = useResource('venture.accountant.schedule.get', {});
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!schedule.data) return null;
  const { on } = schedule.data;
  async function set(next: boolean) {
    setBusy(true);
    setProblem(null);
    try { await engine.request('venture.accountant.schedule.set', { on: next }); }
    catch (error) { setProblem(messageOf(error)); }
    schedule.reload();
    setBusy(false);
  }
  return (
    <section className={s.form} aria-label={t('money.pack.label')}>
      <label className={v.packSwitch}>
        <input type="checkbox" checked={on} disabled={busy} onChange={(event) => void set(event.currentTarget.checked)} />
        {t('money.pack.label')}
      </label>
      {on && <p className={s.quietLine}>{t('money.pack.line')}</p>}
      {problem && <p className={s.failed} role="alert" data-engine-line="">{problem}</p>}
    </section>
  );
}
