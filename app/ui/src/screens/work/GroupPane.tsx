/**
 * A grouped approval (WK-03): small changes inside the workspace that can be undone,
 * up to ten, each with a tick and its before and after. One sheet, one approval per
 * item, and a result per item. The engine refuses a group with anything on the
 * always-waits list.
 */
import { useState } from 'react';
import { State } from '../../patterns/States';
import { Sheet } from '../../parts/Sheet';
import { Label } from '../../parts/Label';
import { useAct, useReply } from './kit/reply.ts';
import { Note, Refusal, pageStyles } from './kit/Page';
import { group, groupResults, pace, type GroupResults } from './contract.ts';
import { say, type WorkProps } from './shared.tsx';
import s from './work.module.css';

export interface GroupPaneProps { p: WorkProps; ids: readonly string[]; origin: HTMLElement | null; onClose: () => void; onListChanged: () => void }

export function GroupPane({ p, ids, origin, onClose, onListChanged }: GroupPaneProps) {
  const { w, language } = p;
  const { loaded, reload } = useReply(p.host, 'approvals.group', { ids }, group);
  const paceReply = useReply(p.host, 'approvals.pace', {}, pace);
  const act = useAct(p.rpc);
  const [unticked, setUnticked] = useState<ReadonlySet<string>>(new Set());
  const [results, setResults] = useState<GroupResults['results'] | null>(null);

  if (loaded.phase !== 'ready') {
    return (
      <Sheet kind={w['group.kind']} title={w['group.kind']} onClose={onClose} origin={origin}>
        <State state={loaded.phase === 'refused' ? loaded.state : { kind: 'loading' }} action={loaded.phase === 'refused' ? { label: w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  const g = loaded.value;
  const ticked = g.items.filter(item => !unticked.has(item.id));
  const approveAll = async () => {
    const out = await act.run('approvals.approveGroup', { items: ticked.map(item => ({ id: item.id, digest: item.digest })) }, groupResults);
    if (out.ok) { setResults(out.value.results); onListChanged(); }
  };
  const resultFor = (itemId: string) => results?.find(r => r.id === itemId);
  const warn = paceReply.loaded.phase === 'ready' && paceReply.loaded.value.warn ? paceReply.loaded.value.fastStreak : null;

  return (
    <Sheet kind={w['group.kind']} title={g.title} onClose={onClose} origin={origin}
      primary={results === null && ticked.length > 0 && !p.viewer ? { label: say(w, 'group.approve', { n: ticked.length }), onPress: () => void approveAll(), disabled: act.busy } : undefined}>
      <p className={s.meta}><Label kind="experimental" /> {w['group.undoable']}</p>
      {warn !== null && <Note>{say(w, 'pace.warn', { n: warn })}</Note>}
      <ul className={s.list}>
        {g.items.map(item => {
          const result = resultFor(item.id);
          return (
            <li key={item.id} className={s.block}>
              <label className={s.pick}>
                <input type="checkbox" checked={!unticked.has(item.id)} disabled={results !== null || p.viewer}
                  onChange={e => { const on = e.currentTarget.checked; setUnticked(prev => { const next = new Set(prev); if (on) next.delete(item.id); else next.add(item.id); return next; }); }} />
                <span>{item.title}</span>
              </label>
              {item.change.fields !== undefined && (
                <table className={pageStyles.table}>
                  <tbody>
                    {item.change.fields.map(f => <tr key={f.name}><th scope="row">{f.name}</th><td><s>{f.before}</s></td><td>{f.after}</td></tr>)}
                  </tbody>
                </table>
              )}
              {item.change.asWritten !== undefined && <pre className={s.asWritten}>{item.change.asWritten}</pre>}
              {result && <p className={s.meta} role="status">{result.ok ? w['group.ok'] : say(w, 'group.refused', { code: result.code ?? 'REQUEST_FAILED' })}</p>}
            </li>
          );
        })}
      </ul>
      <Refusal code={act.refusal} language={language} />
    </Sheet>
  );
}
