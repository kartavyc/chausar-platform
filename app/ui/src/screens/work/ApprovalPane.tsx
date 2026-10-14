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
import { actionView, approvalDetail, dropped, pace, practice, snoozed, type ActionView, type ApprovalDetail, type Practice } from './contract.ts';
import { ActionPane } from './ActionPane.tsx';
import { JobCardView, jobFacts } from './JobCard.tsx';
import { KeyValue } from '../../parts/KeyValue';
import { expiryNote, money, say, stepItems, type WorkProps } from './shared.tsx';
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
  const change: ApprovalChange = {
    ...(d.change.asWritten !== undefined ? { asWritten: d.change.asWritten } : {}),
    ...(d.change.fields !== undefined ? { fields: d.change.fields } : {}),
  };
  const out: { -readonly [K in keyof Approval]: Approval[K] } = {
    approvalId: d.id, kind: d.kind, state: d.state, what: d.title, target, change,
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
  const { loaded, reload } = useReply(p.host, 'approvals.get', { id }, approvalDetail);
  const paceReply = useReply(p.host, 'approvals.pace', {}, pace, p.viewer ? 'off' : 'on');
  const act = useAct(p.rpc);
  const [notice, setNotice] = useState<WorkKey | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [dropping, setDropping] = useState(false);
  const [after, setAfter] = useState<ActionView | null>(null);
  const [tried, setTried] = useState<Practice | null>(null);

  if (after) return <ActionPane p={p} view={after} origin={origin} onClose={onClose} onView={setAfter} />;
  const d = loaded.phase === 'ready' ? loaded.value : loaded.phase === 'loading' ? loaded.last : undefined;
  if (d === undefined) {
    const state = loaded.phase === 'refused' ? loaded.state : { kind: 'loading' as const };
    return (
      <Sheet kind={w['approvals.title']} title={w['approvals.title']} onClose={onClose} origin={origin}>
        <State state={state} action={loaded.phase === 'refused' ? { label: w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  const amountWords = money(d.amount, language);

  const approve = async (secondAsk: boolean) => {
    setNotice(null);
    if (d.practice) {
      const out = await act.run('approvals.practice', { id: d.id }, practice);
      if (out.ok) setTried(out.value);
      return;
    }
    const out = await act.run('approvals.approve', secondAsk ? { id: d.id, digest: d.digest, secondAsk: true } : { id: d.id, digest: d.digest }, approvalDetail);
    if (!out.ok) {
      if (out.code === 'PREVIEW_CHANGED') { act.clear(); setNotice('blocked.changed'); reload(); }
      return;
    }
    onListChanged();
    if (out.value.source !== 'action') { setNotice('approved'); reload(); return; }
    const done = await act.run('approvals.execute', { id: out.value.id }, actionView);
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
    const out = await act.run('approvals.resolveUnknown', { id: d.id, result }, actionView);
    if (out.ok) setAfter(out.value);
  };

  const warn = paceReply.loaded.phase === 'ready' && paceReply.loaded.value.warn ? paceReply.loaded.value.fastStreak : null;

  return (
    <div className={s.pane}>
      {d.practice && <p className={s.meta}><Label kind="practice" /> {w['practice.note']}</p>}
      {warn !== null && <Note>{say(w, 'pace.warn', { n: warn })}</Note>}
      <ApprovalSheet approval={toApproval(d, p)} origin={origin} onClose={onClose} onReceipt={p.openReceipt}
        onApprove={() => void approve(false)}
        onSecondAsk={() => { if (d.practice) void approve(false); else { setNotice(null); setConfirming(true); } }}
        onNotNow={() => void notNow()}
        onChange={d.change.asWritten !== undefined ? () => setEditing(d.change.asWritten ?? '') : undefined}
        onDrop={() => setDropping(true)}
        onDownloadPrepared={() => setNotice('file.notBuilt')}
        onCheckUnknown={(approvalId, result) => void resolve(approvalId, result)} />
      {notice !== null && <p className={s.meta} role="status">{w[notice]}</p>}
      <Refusal code={act.refusal} language={language} />

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
      {d.snoozedUntil !== undefined && <Note>{say(w, 'snoozedUntil', { when: dayTime(d.snoozedUntil, language) })}</Note>}
    </div>
  );
}
