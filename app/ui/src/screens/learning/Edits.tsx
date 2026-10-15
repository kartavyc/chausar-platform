/**
 * Dictionary edits: small typed edits that passed the hand-worked answer key wait here for the
 * owner. Each row names the edit, its answer-key result before and after, and whether it went
 * stale. Approve opens a sheet naming exactly the change; only that sheet's button sends
 * `learningx.editApprove {id, digest}`. Edits that failed the key are shown as never approvable.
 */
import { useState } from 'react';
import { useAct, useReply } from '../work/kit/reply.ts';
import { editApproveReply, editRejectReply, editsProposeReply, editsReply, type EditApproveReply, type EditView } from './contract.ts';
import {
  Button, CaseMarks, ConfirmSheet, Part, Refused, editText, day, isOwner, passedOf, prepares, styles as s, useLx, valueOf, type LearningProps,
} from './shared.tsx';

const FILTERS = ['awaiting-review', 'failed-answer-key', 'all'] as const;
type Filter = typeof FILTERS[number];
type Asking = { readonly edit: EditView; readonly decision: 'approve' | 'reject' };

export function Edits(props: LearningProps) {
  const lx = useLx();
  const [filter, setFilter] = useState<Filter>('awaiting-review');
  const { loaded, reload } = useReply(props, 'learningx.edits', filter === 'all' ? {} : { status: filter }, editsReply);
  const act = useAct(props.rpc);
  const [asking, setAsking] = useState<Asking | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const value = valueOf(loaded);
  const owner = isOwner(props);

  const look = async () => {
    setSaid(null);
    const outcome = await act.run('learningx.editsPropose', {}, editsProposeReply);
    if (!outcome.ok) return;
    const items = outcome.value.items;
    setSaid(lx('edits.looked', { found: String(items.filter(item => item.status === 'awaiting-review').length), failed: String(items.filter(item => item.status === 'failed-answer-key').length) }));
    reload();
  };
  const decide = async () => {
    if (asking === null) return;
    const { edit, decision } = asking;
    // Exactly the reviewed edit and its digest; nothing else goes with it.
    const outcome = decision === 'approve'
      ? await act.run('learningx.editApprove', { id: edit.id, digest: edit.digest }, editApproveReply)
      : await act.run('learningx.editReject', { id: edit.id, digest: edit.digest }, editRejectReply);
    setAsking(null);
    if (!outcome.ok) return;
    setSaid(decision === 'approve' ? approvedText(outcome.value as EditApproveReply) : lx('edits.rejected'));
    reload();
  };
  const approvedText = (reply: EditApproveReply) => reply.published
    ? lx('edits.published')
    : lx('edits.notPublished', { failing: reply.failing.join(', ') || lx('none') });

  return (
    <Part title={lx('section.edits')} loaded={loaded} reload={reload}>
      <p className={s.note}>{lx('edits.intro')}</p>
      <div className={s.inline} role="group" aria-label={lx('edits.filter')}>
        {FILTERS.map(f => <Button key={f} variant="link" aria-pressed={filter === f} onClick={() => setFilter(f)}>{lx(`edits.filter.${f}`)}</Button>)}
        {prepares(props) && <Button onClick={() => { void look(); }} disabled={act.busy}>{lx('edits.look')}</Button>}
      </div>
      {said !== null && <p className={s.note} role="status">{said}</p>}
      <Refused code={act.refusal} />
      {value && (value.items.length === 0
        ? <p className={s.note}>{lx(filter === 'awaiting-review' ? 'edits.empty' : 'edits.emptyAll')}</p>
        : (
          <ul className={s.rows} aria-label={lx('section.edits')}>
            {value.items.map(edit => (
              <EditRow key={edit.id} props={props} edit={edit} owner={owner} busy={act.busy}
                onAsk={decision => { setSaid(null); setAsking({ edit, decision }); }} />
            ))}
          </ul>
        ))}
      {asking !== null && (
        <ConfirmSheet kind={lx('edits.sheetKind')} busy={act.busy}
          title={lx(asking.decision === 'approve' ? 'edits.approveTitle' : 'edits.rejectTitle')}
          confirm={lx(asking.decision === 'approve' ? 'edits.approveConfirm' : 'edits.rejectConfirm')}
          onConfirm={() => { void decide(); }} onClose={() => setAsking(null)}>
          <p className={s.change}>{editText(asking.edit.edit, lx)}</p>
          {asking.edit.edit.edit === 'add-definition' && <p>{asking.edit.edit.definition.meaning}</p>}
          <p>{lx('edits.onVersion', { version: String(asking.edit.baseVersion) })}</p>
          <p>{lx('edits.keyLine', { before: passedOf(asking.edit.before), after: passedOf(asking.edit.after), total: String(asking.edit.after.length) })}</p>
          <p className={s.note}>{lx(asking.decision === 'approve' ? 'edits.approveNote' : 'edits.rejectNote')}</p>
          {props.view === 'books' && <p className={[s.note, s.code].join(' ')}>{lx('digest', { digest: asking.edit.digest })}</p>}
        </ConfirmSheet>
      )}
    </Part>
  );
}

function EditRow({ props, edit, owner, busy, onAsk }: { props: LearningProps; edit: EditView; owner: boolean; busy: boolean; onAsk: (decision: 'approve' | 'reject') => void }) {
  const lx = useLx();
  const failedKey = edit.status === 'failed-answer-key';
  const waiting = edit.status === 'awaiting-review';
  return (
    <li className={s.row} data-edit={edit.id} data-status={edit.status}>
      <p className={s.change}>{editText(edit.edit, lx)}</p>
      {edit.edit.edit === 'add-definition' && props.view !== 'simple' && <p className={s.note}>{edit.edit.definition.meaning}</p>}
      <p className={s.inline}>
        <span className={failedKey ? s.amberWord : s.word}>{lx(`status.${edit.status}`)}</span>
        {edit.stale && <span className={s.amberWord} data-stale="">{lx('edits.stale')}</span>}
        {edit.evidence.origin === 'model' && <span className={s.word}>{lx('edits.fromModel')}</span>}
      </p>
      <p>{lx('edits.keyLine', { before: passedOf(edit.before), after: passedOf(edit.after), total: String(edit.after.length) })}</p>
      {edit.failing.length > 0 && <p className={s.amber}>{lx('edits.failing', { cases: edit.failing.join(', ') })}</p>}
      {edit.regressions.length > 0 && <p className={s.amber}>{lx('edits.regressions', { cases: edit.regressions.join(', ') })}</p>}
      {failedKey && <p className={s.amber}>{lx('edits.neverApprovable')}</p>}
      {edit.stale && <p className={s.amber}>{lx('edits.staleNote')}</p>}
      {props.view !== 'simple' && <p className={s.note}>{lx(`evidence.${edit.evidence.origin}`, { count: String(edit.evidence.count) })}</p>}
      {props.view === 'books' && <CaseMarks cases={edit.after} />}
      {props.view === 'books' && <p className={[s.note, s.code].join(' ')}>{lx('digest', { digest: edit.digest })}</p>}
      {edit.decidedAt && <p className={s.note}>{lx('edits.decidedOn', { date: day(edit.decidedAt, props.language) })}</p>}
      {owner && waiting && (
        <p className={s.inline}>
          {!edit.stale && <Button onClick={() => onAsk('approve')} disabled={busy}>{lx('edits.approve')}</Button>}
          <Button variant="link" onClick={() => onAsk('reject')} disabled={busy}>{lx('edits.reject')}</Button>
        </p>
      )}
      {!owner && waiting && !props.viewer && <p className={s.note}>{lx('edits.ownerDecides')}</p>}
    </li>
  );
}
