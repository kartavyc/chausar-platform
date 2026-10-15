/**
 * After a restore (WK-15): the actions that may have gone out after the backup was made,
 * each with Check. Sending stays closed until the list is empty. The engine's notes about
 * deletions that came back are shown as they are, never hidden.
 */
import { useState } from 'react';
import { useAct, useReply } from './kit/reply.ts';
import { dayTime } from './kit/format.ts';
import { Button, Note, Refusal } from './kit/Page';
import { actionView, afterRestore } from './contract.ts';
import { reapplied, restoreR4 } from './contract-r4.ts';
import { Actions } from './kit/Page';
import { r4Words, sayR4 } from './text-r4.ts';
import { useLive, LIVE } from './R4Parts.tsx';
import { ActionSheet, useSheet } from './Actions.tsx';
import { Dots } from './parts/Dots.tsx';
import { Frame, money, type WorkProps } from './shared.tsx';
import { known } from './text.ts';
import s from './work.module.css';

export function AfterRestorePage({ p }: { p: WorkProps }) {
  const { w, language, view } = p;
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.afterRestore', {}, (v, path) => ({ ...afterRestore(v, path), ...restoreR4(v, path) }), String(tick));
  useLive(p, LIVE.action, reload);
  const r4 = r4Words(language);
  const [again, setAgain] = useState<ReturnType<typeof reapplied> | null>(null);
  const [typed, setTyped] = useState('');
  const reapply = async () => { const out = await act.run('approvals.reapplyDeletions', { confirmation: typed }, reapplied); if (out.ok) { setAgain(out.value); setTyped(''); setTick(n => n + 1); } };
  const approver = !p.viewer && (p.member.role === 'owner' || p.member.role === 'cofounder');
  const act = useAct(p.rpc);
  const sheet = useSheet(p, 'after-restore');
  const check = async (id: string) => {
    const out = await act.run('approvals.resolveUnknown', { id, result: 'check' }, actionView);
    if (out.ok) setTick(n => n + 1);
  };
  return (
    <Frame p={p} title={w['restore.title']} loaded={loaded} reload={reload} count={r => String(r.items.length)}>
      {r => (
        <div className={s.split} data-open={sheet.openId !== null ? '' : undefined}>
          <div className={s.pane}>
            <Note>{r.sendingClosed ? w['restore.closed'] : w['restore.open']}</Note>
            {r.notes.map((line, i) => { const k = r.noteKeys?.[i]; return <p key={i} className={s.meta}>{(k !== undefined ? known(w, `restore.note.${k}`) : null) ?? line}</p>; })}
            {r.deletions?.available === true ? (
              <div className={s.block} data-part="reapply">
                <p className={s.meta}>{r4['restore.reapplyNote']}</p>
                {r.deletions.cameBack !== undefined && <p className={s.meta}>{sayR4(r4, 'restore.cameBack', { n: r.deletions.cameBack })}</p>}
                {approver && (
                  <Actions>
                    <label>{r4['restore.confirm']} <input value={typed} onChange={e => setTyped(e.currentTarget.value)} aria-label={r4['restore.confirm']} /></label>
                    <Button variant="quiet" disabled={act.busy || typed.trim().length === 0} onClick={() => void reapply()}>{r4['restore.reapply']}</Button>
                  </Actions>
                )}
                {again !== null && <p role="status">{sayR4(r4, 'restore.reapplied', { n: again.reapplied })}</p>}
                {again?.kinds?.filter(k => k.remaining > 0).map(k => <p key={k.kind} className={s.meta}>{sayR4(r4, 'restore.remaining', { n: k.remaining, reason: k.reason ?? k.state })}</p>)}
              </div>
            ) : view !== 'simple' && <p className={s.meta}>{w['restore.deletions']}</p>}
            {r.items.length === 0 ? <Note>{w['restore.empty']}</Note> : (
              <ul className={s.list}>
                {r.items.map(a => {
                  const meta = [dayTime(a.createdAt, language), view === 'simple' ? null : a.touches, view === 'simple' ? null : money(a.amount, language), w[`state.${a.state}`]];
                  return (
                    <li key={a.id} className={s.item}>
                      <div>
                        <button type="button" className={s.open} onClick={e => sheet.open(a.id, e.currentTarget)}>{a.title}</button>
                        <p className={s.meta}>{meta.filter((m): m is string => m !== null).join(' · ')}</p>
                        {view !== 'simple' && <Dots steps={a.steps} w={w} />}
                      </div>
                      {!p.viewer && <Button variant="quiet" disabled={act.busy} onClick={() => void check(a.id)}>{w.check}</Button>}
                    </li>
                  );
                })}
              </ul>
            )}
            <Refusal code={act.refusal} language={language} />
          </div>
          {sheet.openId !== null && <ActionSheet key={sheet.openId} p={p} id={sheet.openId} origin={sheet.origin.current} onClose={sheet.close} onChanged={() => setTick(n => n + 1)} />}
        </div>
      )}
    </Frame>
  );
}
