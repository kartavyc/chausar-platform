/**
 * Actions (WK-05): the true record of everything Chausar did or was asked to do, newest
 * first, as a time line: what, to whom, the amount, the five steps as five small dots,
 * who approved and through which channel. One opens to its request, read-back and rule.
 */
import { useRef, useState } from 'react';
import { State } from '../../patterns/States';
import { Sheet } from '../../parts/Sheet';
import { useReply } from './kit/reply.ts';
import { LIVE, useLive } from './R4Parts.tsx';
import { dayTime } from './kit/format.ts';
import { Note, pageStyles } from './kit/Page';
import { idOf, ledger, sheetOf } from './contract.ts';
import { actionRecord, type ActionRecord } from './contract-writeback.ts';
import { ActionPane } from './ActionPane.tsx';
import { Dots } from './parts/Dots.tsx';
import { Frame, money, type WorkProps, type WorkSub } from './shared.tsx';
import s from './work.module.css';

/** One action's sheet, read by its id. Shared by the record and the after-restore list. */
export function ActionSheet({ p, id, origin, onClose, onChanged }: { p: WorkProps; id: string; origin: HTMLElement | null; onClose: () => void; onChanged: () => void }) {
  const { loaded, reload } = useReply(p.host, 'approvals.action', { id }, actionRecord);
  useLive(p, LIVE.action, reload);
  const [fresh, setFresh] = useState<ActionRecord | null>(null);
  const view = fresh ?? (loaded.phase === 'ready' ? loaded.value : null);
  if (view === null) {
    return (
      <Sheet kind={p.w['action.kind']} title={p.w['action.kind']} onClose={onClose} origin={origin}>
        <State state={loaded.phase === 'refused' ? loaded.state : { kind: 'loading' }} action={loaded.phase === 'refused' ? { label: p.w.checkAgain, onPress: reload } : undefined} />
      </Sheet>
    );
  }
  return <ActionPane p={p} view={view} origin={origin} onClose={onClose} onView={v => { setFresh(v); onChanged(); }} />;
}

export function useSheet(p: WorkProps, sub: WorkSub) {
  const origin = useRef<HTMLElement | null>(null);
  const openId = p.address.sheet === undefined ? null : idOf(p.address.sheet);
  return {
    origin, openId,
    open: (id: string, el: HTMLElement | null) => { origin.current = el; p.navigate({ place: 'work', sub, sheet: sheetOf(id) }); },
    close: () => p.navigate({ place: 'work', sub }),
  };
}

export function ActionsPage({ p }: { p: WorkProps }) {
  const { w, language, view } = p;
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.ledger', {}, ledger, String(tick));
  const sheet = useSheet(p, 'actions');
  return (
    <Frame p={p} title={w['actions.title']} loaded={loaded} reload={reload}>
      {({ items }) => (
        <div className={s.split} data-open={sheet.openId !== null ? '' : undefined}>
          <div className={s.pane}>
            {items.length === 0 && <Note>{w['actions.empty']}</Note>}
            {items.length > 0 && view === 'books' && (
              <table className={[pageStyles.table, s.dense].join(' ')}>
                <thead><tr>{(['col.when', 'col.what', 'col.touches', 'col.amount', 'col.steps', 'col.approvedBy', 'col.channel', 'col.would'] as const).map(k => <th key={k} scope="col">{w[k]}</th>)}</tr></thead>
                <tbody>
                  {items.map(a => (
                    <tr key={a.id}>
                      <td className={s.fig}>{dayTime(a.createdAt, language)}</td>
                      <td><button type="button" className={s.open} onClick={e => sheet.open(a.id, e.currentTarget)}>{a.title}</button></td>
                      <td>{a.touches ?? ''}</td>
                      <td className={pageStyles.num}>{money(a.amount, language) ?? ''}</td>
                      <td><Dots steps={a.steps} w={w} /></td>
                      <td>{a.approvedBy ?? ''}</td>
                      <td>{a.channel === null ? '' : w[`channel.${a.channel}`]}</td>
                      <td>{a.wouldHaveDone === null ? '' : w[`would.${a.wouldHaveDone}`]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {items.length > 0 && view !== 'books' && (
              <ol className={s.list}>
                {items.map(a => {
                  const amountWords = money(a.amount, language);
                  const meta = view === 'simple' ? [dayTime(a.createdAt, language)]
                    : [dayTime(a.createdAt, language), a.touches, amountWords, a.approvedBy, a.channel === null ? null : w[`channel.${a.channel}`]];
                  return (
                    <li key={a.id} className={s.item}>
                      <div>
                        <button type="button" className={s.open} aria-current={a.id === sheet.openId ? 'true' : undefined} onClick={e => sheet.open(a.id, e.currentTarget)}>{a.title}</button>
                        <p className={s.meta}>{meta.filter((m): m is string => m !== null).join(' · ')}</p>
                      </div>
                      <Dots steps={a.steps} w={w} />
                    </li>
                  );
                })}
              </ol>
            )}
          </div>
          {sheet.openId !== null && <ActionSheet key={sheet.openId} p={p} id={sheet.openId} origin={sheet.origin.current} onClose={sheet.close} onChanged={() => setTick(n => n + 1)} />}
        </div>
      )}
    </Frame>
  );
}
