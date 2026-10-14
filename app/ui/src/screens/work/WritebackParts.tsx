/**
 * The write-back parts of the approval sheet and the action record: the system and connection,
 * why it waits, write-back's notices, a customer reminder (WK-12) with its agreement, limits and
 * the owner's payment notes, and the files saved for a prepare-only item.
 */
import type { Language } from '../../app/presentation.ts';
import { KeyValue, type KeyValueProps, type Pair } from '../../parts/KeyValue';
import { amountText, day } from './kit/format.ts';
import { Note, pageStyles } from './kit/Page';
import type { Exported, Reminder, WbExtra } from './contract-writeback.ts';
import { wbKnown, wbSay, type WbKey, type WbWords } from './writeback-text.ts';
import s from './work.module.css';

export function wbPairs(extra: WbExtra, ww: WbWords): Pair[] {
  const pairs: Pair[] = [{ name: ww['wb.system'], value: extra.systemTitle }];
  if (extra.connection !== null) {
    const env = wbKnown(ww, `wb.env.${extra.connection.environment}`) ?? extra.connection.environment;
    const label = `${extra.connection.label} · ${env}`;
    pairs.push({ name: ww['wb.connection'], value: extra.connection.removed ? wbSay(ww, 'wb.removed', { label }) : label });
  }
  if (extra.waitsBecause) pairs.push({ name: ww['wb.waitsBecause'], value: extra.waitsBecause });
  return pairs;
}

/** Write-back's own notices (expired, prepared again, already done, looked first, cancelled). */
export function WbNotices({ notices, ww }: { notices: WbExtra['notices']; ww: WbWords }) {
  const kinds = [...new Set(notices.map(n => n.kind))];
  const lines = kinds.map(kind => wbKnown(ww, `wb.notice.${kind}`)).filter((line): line is string => line !== null);
  return <>{lines.map(line => <Note key={line}>{line}</Note>)}</>;
}

export function ReminderBlock({ reminder, ww, language, onReceipt }: { reminder: Reminder; ww: WbWords; language: Language; onReceipt: KeyValueProps['onReceipt'] }) {
  const r = reminder;
  return (
    <div className={s.block} data-part="reminder">
      <h3 className={s.h}>{ww['rem.title']}</h3>
      {r.blocked !== null && <Note>{wbSay(ww, 'rem.blocked', { reason: r.blocked.reason })}</Note>}
      {r.blocked !== null && r.blocked.code === 'FOLLOW_UP_NO_CONSENT' && <Note>{ww['rem.record']}</Note>}
      {r.stoppedOn !== null && <Note>{wbSay(ww, 'rem.stopped', { date: day(r.stoppedOn, language) })}</Note>}
      {r.asWritten !== null && <pre className={s.asWritten}>{r.asWritten}</pre>}
      <KeyValue pairs={[
        { name: ww['rem.link'], value: r.invoiceLink ?? ww['rem.noLink'] },
        ...(r.outstanding !== null ? [{ name: ww['rem.due'], value: amountText(r.outstanding, language), mono: true }] : []),
      ]} onReceipt={onReceipt} />
      <h4 className={s.h}>{ww['rem.agreement']}</h4>
      <table className={pageStyles.table}>
        <tbody>
          {r.agreement.map(a => (
            <tr key={a.channel}>
              <th scope="row">{ww[`rem.ch.${a.channel}` as WbKey]}</th>
              <td>{ww[`rem.ans.${a.answer}` as WbKey]}</td>
              <td>{a.source !== null && a.on !== null ? wbSay(ww, 'rem.from', { source: a.source, date: day(a.on, language) }) : a.on !== null ? wbSay(ww, 'rem.fromDate', { date: day(a.on, language) }) : a.source ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {r.caps !== null && (
        <>
          {r.caps.reached && <Note>{wbSay(ww, 'rem.capReached', { n: r.caps.preparedOnDay })}</Note>}
          {!r.caps.reached && r.caps.customerReached && r.caps.customerOnDay > 1 && <Note>{ww['rem.customerCap']}</Note>}
          <p className={s.meta}>{wbSay(ww, 'rem.caps', { perCustomer: r.caps.perCustomer, perDay: r.caps.perDay, n: r.caps.preparedOnDay })}</p>
        </>
      )}
      {r.notes !== null && r.notes.length > 0 && (
        <div data-part="payment-notes">
          <h4 className={s.h}>{ww['rem.notes']}</h4>
          {r.notes.map(n => (
            <div key={n.id} className={s.block}>
              <p>{language === 'hi' ? n.text.hi : n.text.en}</p>
              <p className={s.meta}>{wbSay(ww, 'rem.source', { source: n.source })} · {wbSay(ww, 'rem.checked', { date: day(n.checkedOn, language) })} · {ww['rem.notLegal']}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function SavedFiles({ saved, ww }: { saved: Exported; ww: WbWords }) {
  return (
    <div className={s.block} role="status">
      <p className={s.meta}>{ww['file.saved']}</p>
      <ul className={s.list}>
        {saved.files.map(f => <li key={f.path}><code>{f.path}</code> <span className={s.meta}>{wbSay(ww, 'file.bytes', { n: f.bytes })}</span></li>)}
      </ul>
    </div>
  );
}
