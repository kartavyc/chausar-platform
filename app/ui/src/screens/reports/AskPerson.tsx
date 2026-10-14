/**
 * RP-08 Ask a person, a sheet of the exports page: a question, an optional receipt id and
 * a reason make one file for the person's own accountant or CA. The app sends nothing.
 */
import { useState } from 'react';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import type { PlaceRenderProps } from '../../places/types.ts';
import { words } from '../../places/types.ts';
import { useSend } from '../trust/kit/engine.ts';
import { Note } from '../trust/kit/Screen';
import { refusal } from './shared';
import { SHEET_ID, validateAskPerson } from './validate.ts';
import { WORDS, fill } from './words.ts';
import s from './Reports.module.css';

export interface AskPersonSheetProps extends PlaceRenderProps { origin: HTMLElement | null; onClose: () => void }

export function AskPersonSheet({ language, member, viewer, rpc, origin, onClose }: AskPersonSheetProps) {
  const w = words(WORDS, language);
  const [question, setQuestion] = useState('');
  const [receiptId, setReceiptId] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const maker = useSend(rpc, validateAskPerson);
  const readOnly = viewer || member.role === 'viewer';

  const make = () => {
    const q = question.trim(), r = reason.trim(), id = receiptId.trim();
    if (q.length === 0) return setProblem(w.needQuestion);
    if (r.length === 0) return setProblem(w.needReason);
    if (id.length > 0 && !SHEET_ID.test(id)) return setProblem(w.badReceipt);
    setProblem(null);
    void maker.send('reportsx.askPerson', id.length > 0 ? { question: q, reason: r, receiptId: id } : { question: q, reason: r });
  };

  return (
    <Sheet kind={w.exports} title={w.ask} onClose={onClose} origin={origin}>
      <div className={s.stack}>
        <Note>{w.askNote}</Note>
        <p className={s.say}>{w.sendsNothing}</p>
        {readOnly ? <Note>{w.askReadOnly}</Note> : (
          <form className={s.stack} onSubmit={(e) => { e.preventDefault(); make(); }}>
            <Field label={w.question} value={question} maxLength={4000} onChange={(e) => setQuestion(e.currentTarget.value)} />
            <Field label={w.receiptId} value={receiptId} maxLength={200} onChange={(e) => setReceiptId(e.currentTarget.value)} />
            <Field label={w.reason} value={reason} maxLength={2000} onChange={(e) => setReason(e.currentTarget.value)} />
            {problem !== null && <Note status>{problem}</Note>}
            {maker.sent.kind === 'refused' && <Note status>{refusal(maker.sent.code, w)}</Note>}
            <div><Button variant="filled" submit disabled={maker.sent.kind === 'sending'}>{maker.sent.kind === 'sending' ? w.making : w.make}</Button></div>
          </form>
        )}
        {maker.sent.kind === 'done' && (
          <div className={s.stack} role="status">
            <p className={s.say}>{fill(w.fileName, { name: maker.sent.value.file.name })}</p>
            <p className={[s.quiet, s.code].join(' ')}>{fill(w.checkNumber, { check: maker.sent.value.file.sha256 })}</p>
            <p className={s.quiet}>{w.sendsNothing}</p>
          </div>
        )}
      </div>
    </Sheet>
  );
}
