/**
 * One action through to its true result (WK-04), and its full record (WK-05): the five
 * steps with the time each was reached, the request, the read-back compared field by
 * field, the rule that allowed it and who said what. An unknown result is checked before
 * anything else: "Not sure it went out." with Check again, It was sent, It was not sent.
 */
import { useState } from 'react';
import { Sheet } from '../../parts/Sheet';
import { Steps } from '../../parts/Steps';
import { KeyValue, type Pair } from '../../parts/KeyValue';
import { useAct } from './kit/reply.ts';
import { dayTime } from './kit/format.ts';
import { Actions, Button, Note, Refusal, pageStyles } from './kit/Page';
import { approvalDetail, sheetOf } from './contract.ts';
import { actionRecord, type ActionRecord } from './contract-writeback.ts';
import { WbNotices } from './WritebackParts.tsx';
import { wbWords } from './writeback-text.ts';
import { money, say, stepItems, type WorkProps } from './shared.tsx';
import { known, type WorkKey } from './text.ts';
import s from './work.module.css';

export interface ActionPaneProps {
  p: WorkProps;
  view: ActionRecord;
  origin: HTMLElement | null;
  onClose: () => void;
  /** A newer view of the same action, after a check or an answer. */
  onView: (view: ActionRecord) => void;
}

export function ActionPane({ p, view, origin, onClose, onView }: ActionPaneProps) {
  const { w, language } = p;
  const act = useAct(p.rpc);
  const [noReverse, setNoReverse] = useState(false);
  const unsure = view.state === 'unknown' || view.steps.some(st => st.state === 'unsure');
  const canResolve = !p.viewer && unsure && (view.can.includes('resolve') || view.can.includes('reconcile'));
  const amountWords = money(view.amount, language);

  const resolve = async (result: 'check' | 'was-sent' | 'was-not-sent') => {
    const out = await act.run('approvals.resolveUnknown', { id: view.id, result }, actionRecord);
    if (out.ok) onView(out.value);
  };
  const reverse = async () => {
    setNoReverse(false);
    const out = await act.run('approvals.reverse', { id: view.id }, approvalDetail);
    if (out.ok) p.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(out.value.id) });
    else if (out.code === 'REVERSAL_NOT_AVAILABLE') { setNoReverse(true); act.clear(); }
  };

  const ww = wbWords(language);
  const facts: Pair[] = [{ name: w['f.system'], value: view.writeback?.systemTitle ?? view.system }];
  if (view.writeback?.connection) facts.push({ name: ww['wb.connection'], value: view.writeback.connection.label });
  if (view.touches !== null) facts.push({ name: w['f.touches'], value: view.touches });
  if (amountWords !== null) facts.push({ name: w['f.amount'], value: amountWords, mono: true });
  if (view.approvedBy !== null) facts.push({ name: w['f.approvedBy'], value: view.approvedBy });
  if (view.channel !== null) facts.push({ name: w['f.channel'], value: w[`channel.${view.channel}`] });
  if (view.wouldHaveDone !== null && p.view !== 'simple') facts.push({ name: w['f.would'], value: w[`would.${view.wouldHaveDone}`] });
  facts.push({ name: w['f.created'], value: dayTime(view.createdAt, language), mono: true });
  if (view.settledAt !== null) facts.push({ name: w['f.settled'], value: dayTime(view.settledAt, language), mono: true });
  const request = Object.entries(view.request).map(([name, value]) => ({ name, value }));

  return (
    <Sheet kind={w['action.kind']} title={view.title} onClose={onClose} origin={origin}
      actions={!p.viewer && view.can.includes('reverse') ? <Button variant="link" onClick={() => void reverse()} disabled={act.busy}>{w.reverse}</Button> : undefined}>
      <KeyValue pairs={facts} onReceipt={p.openReceipt} />
      <Steps steps={stepItems(view.steps, language)} />
      {view.notice !== undefined && <Note>{view.notice.message}</Note>}
      {view.writeback && view.notice === undefined && <WbNotices notices={view.writeback.notices} ww={ww} />}
      {view.writeback?.settledBy && view.state !== 'unknown' && <p className={s.meta}>{ww[view.writeback.settledBy === 'person' ? 'wb.settled.person' : 'wb.settled.system']}</p>}
      {view.state === 'verified' && <Note>{w.recorded}</Note>}
      {unsure && <Note>{w.unsure}</Note>}
      {canResolve && (
        <Actions>
          <Button variant="quiet" disabled={act.busy} onClick={() => void resolve('check')}>{w.checkAgain}</Button>
          <Button variant="link" disabled={act.busy} onClick={() => void resolve('was-sent')}>{w.wasSent}</Button>
          <Button variant="link" disabled={act.busy} onClick={() => void resolve('was-not-sent')}>{w.wasNotSent}</Button>
        </Actions>
      )}
      {view.attestation !== null && <Note>{say(w, `attest.${view.attestation.said}` as WorkKey, { by: view.attestation.by, at: dayTime(view.attestation.at, language) })}</Note>}
      {p.view !== 'simple' && request.length > 0 && (
        <div className={s.block}>
          <h3 className={s.h}>{w.request}</h3>
          <KeyValue pairs={request} onReceipt={p.openReceipt} />
        </div>
      )}
      {p.view !== 'simple' && (
        <div className={s.block}>
          <h3 className={s.h}>{w.readBack}</h3>
          {view.readBack === null ? <Note>{w['rb.none']}</Note> : (
            <table className={pageStyles.table}>
              <thead><tr><th scope="col">{w['rb.field']}</th><th scope="col">{w['rb.asked']}</th><th scope="col">{w['rb.found']}</th><th scope="col"><span className="sr">{w['col.state']}</span></th></tr></thead>
              <tbody>
                {view.readBack.map(rb => (
                  <tr key={rb.field}>
                    <th scope="row">{rb.field}</th><td>{rb.asked}</td><td>{rb.found ?? w['rb.notFound']}</td>
                    <td>{rb.same ? w['rb.same'] : w['rb.different']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <Note>{say(w, 'rule', { rule: known(w, `reason.${view.rule}`) ?? view.rule })}</Note>
        </div>
      )}
      {view.can.includes('reverse') && !p.viewer && <Note>{w['reverse.note']}</Note>}
      {noReverse && <Note>{w['reverse.none']}</Note>}
      <Refusal code={act.refusal} language={language} />
    </Sheet>
  );
}
