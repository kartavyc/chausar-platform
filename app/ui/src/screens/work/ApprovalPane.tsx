/**
 * The approval sheet (WK-02) through the shared ApprovalSheet, built only from the
 * prepared request the engine sent, then what happens after Approve (WK-04).
 * Variants: a message (the text as it will go), a record change (before and after),
 * money (Approve asks once more: type the amount), prepare only, a voucher preview, a
 * proposed job (its card), and practice (sends nothing).
 */
import { useState, type FormEvent } from 'react';
import type { Approval, ApprovalChange } from '../../app/presentation.ts';
import { ApprovalSheet } from '../../patterns/ApprovalSheet';
import { State } from '../../patterns/States';
import { Sheet } from '../../parts/Sheet';
import { Steps } from '../../parts/Steps';
import { Label } from '../../parts/Label';
import { useAct, useReply } from './kit/reply.ts';
import { amountText, day, dayTime } from './kit/format.ts';
import { Actions, Button, Note, Refusal, pageStyles } from './kit/Page';
import { approvalDetail, dropped, pace, snoozed, type ApprovalDetail } from './contract.ts';
import { actionRecord, approvalSheet, exported, practiceRun, type ActionRecord, type ApprovalSheetReply, type Exported } from './contract-writeback.ts';
import { sheetOf } from './contract.ts';
import { jobWords } from './text-jobs.ts';
import { ReminderBlock, SavedFiles, WbNotices, wbPairs } from './WritebackParts.tsx';
import { wbKnown, wbSay, wbWords } from './writeback-text.ts';
import { ActionPane } from './ActionPane.tsx';
import { practiceR4, type PracticeR4 } from './contract-r4.ts';
import { CorePracticeBlock } from './R4Parts.tsx';
import { r4Words, sayR4 } from './text-r4.ts';
import { sheetOf as bookSheet } from '../books/shared.tsx';
import { JobCardView, jobFacts } from './JobCard.tsx';
import { KeyValue } from '../../parts/KeyValue';
import { expiryNote, fieldName, fieldValue, money, rowTitle, say, stepItems, type WorkProps } from './shared.tsx';
import type { WorkKey, WorkWords } from './text.ts';
import s from './work.module.css';

export function toApproval(d: ApprovalDetail, p: Pick<WorkProps, 'w' | 'language' | 'viewer'>): Approval {
  const { w, language } = p;
  const target: { name: string; value: string }[] = [{ name: w['f.tier'], value: w[`tier.${d.tier}`] }];
  if (d.touches !== null) target.push({ name: w['f.touches'], value: d.touches });
  const amountWords = money(d.amount, language);
  if (amountWords !== null) target.push({ name: w['f.amount'], value: amountWords });
  target.push({ name: w['f.reason'], value: reasonWords(d.reason, w) });
  const expiry = d.expiresAt === null ? null : expiryNote(d.expiresAt, w, language);
  // This lane's own fixed lines and field names are said in the reader's language; text from the books or another lane is shown as it came.
  const change: ApprovalChange = {
    ...(d.change.asWritten !== undefined ? { asWritten: d.change.key === 'acceptance' ? w['fixed.acceptance'] : d.change.asWritten } : {}),
    ...(d.change.fields !== undefined ? { fields: d.change.fields.map(f => ({ name: fieldName(f.name, w), before: fieldValue(f.name, f.before, w, language), after: fieldValue(f.name, f.after, w, language) })) } : {}),
  };
  const out: { -readonly [K in keyof Approval]: Approval[K] } = {
    approvalId: d.id, kind: d.kind, state: d.state, what: rowTitle(d, w), target, change,
    steps: stepItems(d.steps, language),
    note: expiry === null ? w['note.plain'] : say(w, 'note.expires', { when: expiry }),
    readOnly: p.viewer || d.readOnly, prepareOnly: d.prepareOnly, needsSecondAsk: d.needsSecondAsk, can: d.can,
  };
  if (d.preparedBy !== null) out.preparedBy = d.preparedBy.name;
  if (d.blocked) {
    const text = d.blocked.kind === 'expired'
      ? say(w, 'blocked.expired', { date: d.expiresAt === null ? w.none : day(d.expiresAt, language) })
      : say(w, `blocked.${d.blocked.kind}` as WorkKey, { code: d.blocked.code });
    out.blocked = { kind: d.blocked.kind, text };
  }
  return out;
}

function reasonWords(reason: string, w: WorkWords): string {
  const key = `reason.${reason}`;
  return Object.hasOwn(w, key) ? w[key as WorkKey] : reason;
}

/** Digits and the decimal point only, so "₹12,500" and "12500" read the same. */
const digits = (value: string) => value.replace(/[^\d.]/g, '').replace(/\.0*$/, '');

export interface ApprovalPaneProps {
  p: WorkProps;
  id: string;
  origin: HTMLElement | null;
  onClose: () => void;
  onListChanged: () => void;
}

export function ApprovalPane({ p, id, origin, onClose, onListChanged }: ApprovalPaneProps) {
  const { w, language } = p;
  const { loaded, reload } = useReply(p.host, 'approvals.get', { id }, approvalSheet);
  const ww = wbWords(language);
  const paceReply = useReply(p.host, 'approvals.pace', {}, pace, p.viewer ? 'off' : 'on');
  const act = useAct(p.rpc);
  const [notice, setNotice] = useState<WorkKey | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [after, setAfter] = useState<ActionRecord | null>(null);
  const [tried, setTried] = useState<ReturnType<typeof practiceRun> | null>(null);
  const [practised, setPractised] = useState<PracticeR4 | null>(null);
  const r4 = r4Words(language);
  const [passphrase, setPassphrase] = useState<string | null>(null);
  const [saved, setSaved] = useState<Exported | null>(null);
  const [saving, setSaving] = useState(false);
  // A proposed job from job extensions leaves the queue once approved: its reply is shown in place of a reload.
  const [shown, setShown] = useState<ApprovalSheetReply | null>(null);

  if (after) return <ActionPane p={p} view={after} origin={origin} onClose={onClose} onView={setAfter} />;
  const d = shown ?? (loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined);
  if (d === undefined) {
    const state = loaded.phase === 'refused' ? loaded.state : { kind: 'loading' as const };
    return (
      <Sheet kind={w['approvals.title']} title={w['approvals.title']} onClose={onClose} origin={origin}>
        <State state={state} action={loaded.phase === 'refused' ? { label: w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  const amountWords = money(d.amount, language);

  const approve = async (secondAsk: boolean, reauth?: string) => {
    setNotice(null);
    if (d.practice && d.source !== 'writeback') {
      const out = await act.run('approvals.practice', { id: d.id }, practiceRun);
      if (out.ok) setTried(out.value);
      return;
    }
    const payload: Record<string, unknown> = secondAsk ? { id: d.id, digest: d.digest, secondAsk: true } : { id: d.id, digest: d.digest };
    if (reauth !== undefined) payload.reauth = reauth;
    const out = await act.run('approvals.approve', payload, approvalSheet);
    if (!out.ok) {
      if (out.code === 'PREVIEW_CHANGED') { act.clear(); setNotice('blocked.changed'); reload(); }
      return;
    }
    onListChanged();
    if (out.value.source === 'proposal') { setShown(out.value); return; }
    if (out.value.source !== 'action' && out.value.source !== 'writeback') { setNotice('approved'); reload(); return; }
    const done = await act.run('approvals.execute', { id: out.value.id }, actionRecord);
    if (done.ok) setAfter(done.value); else reload();
  };
  const confirmMoney = (event: FormEvent) => {
    event.preventDefault();
    if (amountWords !== null && digits(typed) !== digits(amountWords)) { setNotice('money.mismatch'); return; }
    setConfirming(false); setTyped('');
    void approve(true);
  };
  const notNow = async () => {
    const out = await act.run('approvals.notNow', { id: d.id }, snoozed);
    if (out.ok) { onListChanged(); onClose(); }
  };
  const drop = async () => {
    const out = await act.run('approvals.drop', { id: d.id }, dropped);
    if (out.ok) { onListChanged(); onClose(); }
  };
  const saveChange = async (event: FormEvent) => {
    event.preventDefault();
    if (editing === null) return;
    const out = await act.run('approvals.change', { id: d.id, payload: { asWritten: editing } }, approvalDetail);
    if (out.ok) { setEditing(null); onListChanged(); reload(); }
  };
  const resolve = async (_approvalId: string, result: 'check' | 'was-sent' | 'was-not-sent') => {
    const out = await act.run('approvals.resolveUnknown', { id: d.id, result }, actionRecord);
    if (out.ok) setAfter(out.value);
  };
  /** Prepare only: the exact prepared file and a checklist, saved on this computer. */
  const download = async () => {
    setNotice(null); setSaving(true);
    const out = await act.run('approvals.exportPrepared', { id: d.id }, exported);
    setSaving(false);
    if (out.ok) setSaved(out.value);
  };
  const tryIt = async () => {
    const out = await act.run('approvals.practice', { id: d.id }, practiceRun);
    if (out.ok) setTried(out.value);
  };
  /** WK-02: a core action's practice: checked by its own operation, never run. */
  const practiseCore = async () => {
    const out = await act.run('approvals.practice', { id: d.id }, practiceR4);
    if (out.ok) setPractised(out.value);
  };
  const passphraseAsked = d.secondAsk?.by === 'passphrase';
  // The owner's vault passphrase, or the approver's own approval secret (core-gateway-auth), as the engine says.
  const ownSecret = d.secondAsk?.whose === 'own-secret';
  const reminderRecord = d.reminder?.recordId ?? null;
  const zone = d.reminder?.caps?.timeZone ?? null;
  const confirmPassphrase = (event: FormEvent) => {
    event.preventDefault();
    if (!passphrase) { setNotice(null); return; }
    const typedPassphrase = passphrase; setPassphrase(null);
    void approve(true, typedPassphrase);
  };

  const warn = paceReply.loaded.phase === 'ready' && paceReply.loaded.value.warn ? paceReply.loaded.value.fastStreak : null;

  return (
    <div className={s.pane}>
      {d.practice && <p className={s.meta}><Label kind="practice" /> {w['practice.note']}</p>}
      {warn !== null && <Note>{say(w, 'pace.warn', { n: warn })}</Note>}
      <ApprovalSheet approval={toApproval(d, p)} origin={origin} onClose={onClose} onReceipt={p.openReceipt}
        onApprove={() => void approve(false)}
        onSecondAsk={() => { if (d.practice && d.source !== 'writeback') void approve(false); else if (passphraseAsked) { setNotice(null); setPassphrase(''); } else { setNotice(null); setConfirming(true); } }}
        onNotNow={() => void notNow()}
        onChange={d.change.asWritten !== undefined ? () => setEditing(d.change.asWritten ?? '') : undefined}
        onDrop={() => setDropping(true)}
        onDownloadPrepared={() => void download()}
        onCheckUnknown={(approvalId, result) => void resolve(approvalId, result)} />
      {notice !== null && <p className={s.meta} role="status">{w[notice]}</p>}
      <Refusal code={act.refusal} language={language} />
      {saving && <p className={s.meta} role="status">{ww['file.saving']}</p>}
      {saved && <SavedFiles saved={saved} ww={ww} />}
      {d.writeback && (
        <div className={s.block} data-part="writeback">
          <KeyValue pairs={wbPairs(d.writeback, ww)} onReceipt={p.openReceipt} />
          <WbNotices notices={d.writeback.notices} ww={ww} />
          {d.source === 'writeback' && d.state === 'prepared' && !p.viewer && !d.readOnly && !d.prepareOnly && (
            <Actions><Button variant="link" disabled={act.busy} onClick={() => void tryIt()}>{ww['wb.practice']}</Button></Actions>
          )}
        </div>
      )}
      {d.source === 'action' && d.state === 'prepared' && !p.viewer && !d.readOnly && !d.prepareOnly && (
        <Actions><Button variant="link" disabled={act.busy} onClick={() => void practiseCore()}>{r4['practice.try']}</Button></Actions>
      )}
      {practised && (practised.available ? <CorePracticeBlock tried={practised} language={language} r={r4} /> : <Note>{w['practice.unavailable']}</Note>)}
      {d.reminder && <ReminderBlock reminder={d.reminder} ww={ww} language={language} onReceipt={p.openReceipt}
        recordLabel={reminderRecord !== null ? r4['rem.openRecord'] : undefined}
        zoneLine={zone !== null && d.reminder.caps?.day ? sayR4(r4, 'rem.capsZone', { day: day(d.reminder.caps.day, language), zone }) : undefined}
        onRecord={p.viewer ? undefined : () => p.navigate(reminderRecord !== null ? { place: 'books', sub: 'customers', sheet: bookSheet(reminderRecord) } : { place: 'books', sub: 'customers' })} />}

      {passphrase !== null && (
        <form className={[s.block, s.form].join(' ')} role="dialog" aria-label={ownSecret ? r4['secret.title'] : ww['pass.title']} onSubmit={confirmPassphrase}>
          <h3 className={s.h}>{ownSecret ? r4['secret.title'] : ww['pass.title']}</h3>
          <Note>{ownSecret ? r4['secret.note'] : ww['pass.note']}</Note>
          <label>{ownSecret ? r4['secret.field'] : ww['pass.field']}
            <input type="password" value={passphrase} autoComplete="current-password" onChange={e => setPassphrase(e.currentTarget.value)} aria-label={ownSecret ? r4['secret.field'] : ww['pass.field']} />
          </label>
          <Actions>
            <Button submit variant="quiet" disabled={act.busy || passphrase.length === 0}>{ww['pass.go']}</Button>
            <Button variant="link" onClick={() => setPassphrase(null)}>{w.cancel}</Button>
          </Actions>
        </form>
      )}

      {confirming && (
        <form className={[s.block, s.form].join(' ')} role="dialog" aria-label={w['money.title']} onSubmit={confirmMoney}>
          <h3 className={s.h}>{w['money.title']}</h3>
          {amountWords === null ? <Note>{w['money.plain']}</Note> : (
            <label>{say(w, 'money.type', { amount: amountWords })}
              <input value={typed} inputMode="decimal" autoComplete="off" onChange={e => setTyped(e.currentTarget.value)} aria-label={w['money.field']} />
            </label>
          )}
          <Actions>
            <Button submit variant="quiet" disabled={act.busy}>{w['money.go']}</Button>
            <Button variant="link" onClick={() => { setConfirming(false); setTyped(''); }}>{w.cancel}</Button>
          </Actions>
        </form>
      )}

      {editing !== null && (
        <form className={[s.block, s.form].join(' ')} onSubmit={e => void saveChange(e)}>
          <h3 className={s.h}>{w['change.title']}</h3>
          <Note>{w['change.note']}</Note>
          <label>{w['change.title']}<textarea rows={6} value={editing} onChange={e => setEditing(e.currentTarget.value)} /></label>
          <Actions>
            <Button submit variant="quiet" disabled={act.busy}>{w['change.save']}</Button>
            <Button variant="link" onClick={() => setEditing(null)}>{w.cancel}</Button>
          </Actions>
        </form>
      )}

      {dropping && (
        <div className={s.block} role="alertdialog" aria-label={w['drop.ask']}>
          <Note>{w['drop.ask']}</Note>
          <Actions>
            <Button variant="quiet" danger disabled={act.busy} onClick={() => void drop()}>{w['drop.yes']}</Button>
            <Button variant="link" onClick={() => setDropping(false)}>{w.keep}</Button>
          </Actions>
        </div>
      )}

      {tried && (
        <div className={s.block}>
          <p className={s.meta}><Label kind="practice" /> {w['practice.done']}</p>
          {!tried.available && <Note>{w['practice.unavailable']}</Note>}
          {tried.outcome !== undefined && wbKnown(ww, `practice.outcome.${tried.outcome}`) !== null && <Note>{wbKnown(ww, `practice.outcome.${tried.outcome}`)}</Note>}
          {tried.requests !== undefined && <p className={s.meta}>{wbSay(ww, 'practice.requests', { n: tried.requests })}</p>}
          {tried.wouldSend !== null && <><Note>{w['practice.wouldSend']}</Note><pre className={s.asWritten}>{tried.wouldSend}</pre></>}
          {tried.steps.length > 0 && <Steps steps={stepItems(tried.steps, language)} />}
        </div>
      )}

      {d.voucher && (
        <div className={s.block}>
          <h3 className={s.h}>{w['voucher.title']}</h3>
          <p className={s.meta}>{say(w, 'voucher.head', { type: d.voucher.type, number: d.voucher.number ?? w['voucher.noNumber'], date: day(d.voucher.date, language) })}</p>
          <table className={pageStyles.table}>
            <thead><tr><th scope="col">{w['voucher.ledger']}</th><th scope="col" className={pageStyles.num}>{w['voucher.debit']}</th><th scope="col" className={pageStyles.num}>{w['voucher.credit']}</th></tr></thead>
            <tbody>
              {d.voucher.lines.map((line, i) => (
                <tr key={`${line.ledger}-${i}`}>
                  <th scope="row">{line.ledger}</th>
                  <td className={pageStyles.num}>{line.debit === null ? '' : amountText(line.debit, language)}</td>
                  <td className={pageStyles.num}>{line.credit === null ? '' : amountText(line.credit, language)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Note>{w['voucher.note']}</Note>
        </div>
      )}

      {d.job && (
        <>
          <KeyValue pairs={jobFacts(d.job, w['job.proposed'], w, language)} onReceipt={p.openReceipt} />
          <JobCardView card={d.job} w={w} language={language} onReceipt={p.openReceipt} simple={p.view === 'simple'} />
        </>
      )}
      {shown !== null && (
        <div className={s.block} role="status">
          <Note>{jobWords(language)['approved.job']}</Note>
          {shown.approvedJobId !== undefined && <Actions><Button variant="link" onClick={() => p.navigate({ place: 'work', sub: 'jobs', sheet: sheetOf(shown.approvedJobId!.replace(/^job:/, '')) })}>{jobWords(language)['approved.openJob']}</Button></Actions>}
        </div>
      )}
      {d.snoozedUntil !== undefined && <Note>{say(w, 'snoozedUntil', { when: dayTime(d.snoozedUntil, language) })}</Note>}
    </div>
  );
}
