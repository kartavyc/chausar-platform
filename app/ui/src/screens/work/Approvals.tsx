/**
 * Approvals (WK-01): "Awaiting your review" with its count. Tier 2 first, then tier 1,
 * then prepare-only items last. Each row: what it is, who or what it touches, its tier
 * word, the amount as the request has it, who prepared it and the time left. Expired
 * items sit apart. Small tier 1 items can be looked at together (WK-03).
 */
import { useRef, useState } from 'react';
import type { Mark, RowItem } from '../../app/presentation.ts';
import { RowList } from '../../parts/RowList';
import { useReply } from './kit/reply.ts';
import { dayTime } from './kit/format.ts';
import { Actions, Button, Note, Section, pageStyles } from './kit/Page';
import { approvalList, idOf, sheetOf, TIERS, type ApprovalRow } from './contract.ts';
import { ApprovalPane } from './ApprovalPane.tsx';
import { GroupPane } from './GroupPane.tsx';
import { Frame, expiryNote, money, rowTitle, say, type WorkProps } from './shared.tsx';
import type { WorkWords } from './text.ts';
import s from './work.module.css';

export const MARK_OF: Readonly<Record<ApprovalRow['state'], Mark>> = {
  prepared: 'wait', approved: 'busy', executing: 'busy', verified: 'cha', unknown: 'unsure', rejected: 'off', blocked: 'off', cancelled: 'off',
};

/** Tier 2 first, tier 1, prepare-only last; the engine's order inside a tier is kept. */
export function inTierOrder(rows: readonly ApprovalRow[]): ApprovalRow[] {
  return TIERS.flatMap(tier => rows.filter(r => r.tier === tier));
}

function by(r: ApprovalRow, w: WorkWords): string | null {
  if (r.preparedBy === null) return null;
  return say(w, `by.${r.preparedBy.kind}`, { name: r.preparedBy.name });
}

export function ApprovalsPage({ p }: { p: WorkProps }) {
  const { w, language, view } = p;
  const [tick, setTick] = useState(0);
  const { loaded, reload } = useReply(p.host, 'approvals.list', {}, approvalList, String(tick));
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [groupIds, setGroupIds] = useState<readonly string[] | null>(null);
  const origin = useRef<HTMLElement | null>(null);
  const openId = p.address.sheet === undefined ? null : idOf(p.address.sheet);

  const open = (id: string, el: HTMLElement | null) => {
    origin.current = el;
    setGroupIds(null);
    p.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(id) });
  };
  const close = () => { setGroupIds(null); p.navigate({ place: 'work', sub: 'approvals' }); };
  const changed = () => setTick(n => n + 1);

  const note = (r: ApprovalRow, expired: boolean): string => {
    const left = expired ? (r.expiresAt === null ? null : say(w, 'approvals.expiredNote', { date: dayTime(r.expiresAt, language) })) : expiryNote(r.expiresAt, w, language);
    const parts = view === 'simple' ? [w[`tier.${r.tier}`], left] : [w[`tier.${r.tier}`], r.practice ? w.practice : null, r.touches, by(r, w), left];
    return parts.filter((part): part is string => part !== null).join(' · ');
  };
  const toRow = (r: ApprovalRow, expired = false): RowItem => {
    const amountWords = money(r.amount, language);
    const row: RowItem = { id: r.id, mark: expired ? 'off' : MARK_OF[r.state], what: rowTitle(r, w), note: note(r, expired) };
    return amountWords === null ? row : { ...row, asWritten: amountWords };
  };
  const groupable = (r: ApprovalRow) => r.tier === 'tier-1' && r.state === 'prepared' && !r.practice;

  return (
    <Frame p={p} title={w['approvals.title']} loaded={loaded} reload={reload} count={list => String(list.items.length)}>
      {list => {
        const items = inTierOrder(list.items);
        const pickable = !p.viewer && view !== 'simple' ? items.filter(groupable) : [];
        const sheetOpen = openId !== null || groupIds !== null;
        return (
          <div className={s.split} data-open={sheetOpen ? '' : undefined}>
            <div className={s.pane}>
              {items.length === 0 && <Note>{w['approvals.empty']}</Note>}
              {items.length > 0 && view === 'books' && (
                <table className={[pageStyles.table, s.dense].join(' ')}>
                  <thead>
                    <tr>{(['col.what', 'col.tier', 'col.touches', 'col.amount', 'col.by', 'col.created', 'col.expires', 'col.state'] as const).map(k => <th key={k} scope="col">{w[k]}</th>)}</tr>
                  </thead>
                  <tbody>
                    {items.map(r => (
                      <tr key={r.id} aria-current={r.id === openId ? 'true' : undefined}>
                        <td><button type="button" className={s.open} onClick={e => open(r.id, e.currentTarget)}>{rowTitle(r, w)}</button></td>
                        <td>{w[`tier.${r.tier}`]}{r.practice ? ` · ${w.practice}` : ''}</td>
                        <td>{r.touches ?? ''}</td>
                        <td className={pageStyles.num}>{money(r.amount, language) ?? ''}</td>
                        <td>{r.preparedBy?.name ?? ''}</td>
                        <td className={s.fig}>{dayTime(r.createdAt, language)}</td>
                        <td className={s.fig}>{r.expiresAt === null ? '' : dayTime(r.expiresAt, language)}</td>
                        <td>{w[`state.${r.state}`]}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {items.length > 0 && view !== 'books' && (
                <RowList rows={items.map(r => toRow(r))} selectedId={openId ?? undefined} onOpen={(id, el) => open(id, el)} onReceipt={p.openReceipt} />
              )}
              {list.snoozed > 0 && <Note>{say(w, 'approvals.snoozed', { n: list.snoozed })}</Note>}

              {pickable.length >= 2 && (
                <Section title={w['group.section']}>
                  <Note>{w['group.hint']}</Note>
                  <ul className={s.list}>
                    {pickable.map(r => (
                      <li key={r.id}>
                        <label className={s.pick}>
                          <input type="checkbox" checked={picked.includes(r.id)} disabled={!picked.includes(r.id) && picked.length >= 10}
                            onChange={e => { const on = e.currentTarget.checked; setPicked(prev => (on ? [...prev, r.id] : prev.filter(x => x !== r.id))); }} />
                          <span>{rowTitle(r, w)}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <Actions>
                    <Button variant="quiet" disabled={picked.length < 2} onClick={e => { origin.current = e.currentTarget; p.navigate({ place: 'work', sub: 'approvals' }); setGroupIds(picked); }}>
                      {say(w, 'group.open', { n: picked.length })}
                    </Button>
                  </Actions>
                </Section>
              )}

              {list.expired.length > 0 && (
                <Section title={w['approvals.expired']}>
                  <RowList rows={list.expired.map(r => toRow(r, true))} onOpen={(id, el) => open(id, el)} onReceipt={p.openReceipt} />
                </Section>
              )}
            </div>
            {groupIds !== null && openId === null && (
              <GroupPane key={groupIds.join(',')} p={p} ids={groupIds} origin={origin.current} onClose={close} onListChanged={() => { setPicked([]); changed(); }} />
            )}
            {openId !== null && <ApprovalPane key={openId} p={p} id={openId} origin={origin.current} onClose={close} onListChanged={changed} />}
          </div>
        );
      }}
    </Frame>
  );
}
