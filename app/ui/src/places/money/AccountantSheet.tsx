/**
 * Invite your accountant (W4 4J7's 'books' share link, from the business menu; `?sheet=accountant:books`): a read-only
 * link to one month's invoices and payments, with the receipts behind their totals, for the owner's accountant. Making
 * the link is the owner's choice, inside the app; it lasts a week and can be taken back. On this computer the engine
 * keeps the link but cannot serve it (no public address), and says so in its own words: then Export for your CA is
 * the way to hand the month over. Chausar sends nothing: the owner shares the link themselves.
 */

import { useId, useState } from 'react';
import { useT } from '../../text';
import { useEngine } from '../../engine/context';
import { Button } from '../../parts/Button';
import { Sheet } from '../../parts/Sheet';
import type { ShareLink } from '../../engine/types';
import type { SheetComponentProps } from '../../shell/sheets';
import { copyText } from '../clients/handoff';
import { messageOf, monthBefore, useMoment, useMonthWords, useThisMonth } from './words';
import s from './Money.module.css';
import v from './MoneyViews.module.css';

export function AccountantSheet({ onClose, returnFocus }: SheetComponentProps) {
  const t = useT();
  const engine = useEngine();
  const monthId = useId();
  const moment = useMoment();
  const monthWords = useMonthWords();
  const thisMonth = useThisMonth();
  const months = [thisMonth, monthBefore(thisMonth), monthBefore(monthBefore(thisMonth))];
  const [month, setMonth] = useState(thisMonth);
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
      {!link && (
        <form className={s.form} noValidate onSubmit={(event) => { event.preventDefault(); void make(); }}>
          <div className={s.field}>
            <label htmlFor={monthId} className={s.fieldLabel}>{t('money.month')}</label>
            <select id={monthId} className={s.select} value={month} disabled={busy} onChange={(event) => setMonth(event.currentTarget.value)}>
              {months.map((item) => <option key={item} value={item}>{monthWords(item)}</option>)}
            </select>
          </div>
          <p className={s.quietLine}>{t('money.accountant.shows')}</p>
          <div className={s.buttons}>
            <Button variant="primary" type="submit" disabled={busy}>{t('money.accountant.make')}</Button>
          </div>
        </form>
      )}
      {link && (
        <div className={v.link}>
          {link.url
            ? (
              <p className={v.linkUrl}>
                <span className="mono" data-content="">{link.url}</span>
                <Button size="sm" variant="quiet" onClick={() => void copy(link.url!)}>{t('money.accountant.copy')}</Button>
              </p>
            )
            : link.reason && <p className={s.quietLine} data-engine-line="">{link.reason}</p>}
          <p className={s.quietLine}>{t('money.accountant.until', { when: moment(link.expiresAt) })}</p>
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
