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
import { ActionSheet, useSheet } from './Actions.tsx';
import { Dots } from './parts/Dots.tsx';
import { Frame, money, type WorkProps } from './shared.tsx';
import s from './work.module.css';

export function AfterRestorePage({ p }: { p: WorkProps }) {
  const { w, language, view } = p;
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.afterRestore', {}, afterRestore, String(tick));
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
            {r.notes.map((line, i) => <p key={i} className={s.meta}>{line}</p>)}
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
