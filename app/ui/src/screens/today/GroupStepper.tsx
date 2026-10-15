/**
 * Grouped approval stepping from a Today summary row (TD-01 "3 payment reminders", WK-03): one
 * approval per item, shown one after another ("1 of 3") in the ApprovalSheet's group variant.
 *
 * Every item is read again with the work-books lane's `approvals.get` { id } and drawn only from
 * that checked reply; Approve sends `approvals.approve` { id, digest } for that one item and Not now
 * sends `approvals.notNow` { id }. Each press moves to the next item. An item that asks again before
 * it goes (money, or a second ask) is never approved from here: it offers "Open in Work", where the
 * full sheet asks. An item that is no longer waiting (`INVALID_APPROVAL_STATE`, `NOT_FOUND`,
 * `APPROVAL_EXPIRED`) says so and the stepping goes on. An item whose preview changed is read again
 * and its new preview shown, to be approved afresh. Any other refusal says it could not be done,
 * with its code, and the item stays waiting. At the end, one line per item says what happened to it.
 * Nothing is approved together.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Language } from '../../app/presentation.ts';
import type { PlaceRpc } from '../../places/types.ts';
import { useT } from '../../app/text';
import { ApprovalSheet } from '../../patterns/ApprovalSheet';
import { State } from '../../patterns/States';
import { Sheet } from '../../parts/Sheet';
import { Button } from '../../parts/Button';
import { approvalSheet, type ApprovalSheetReply } from '../work/contract-writeback.ts';
import { toApproval } from '../work/ApprovalPane.tsx';
import { workWords } from '../work/text.ts';
import { InvalidReply } from '../work/kit/validate.ts';
import s from './Today.module.css';

export type StepOutcome = 'approved' | 'later' | 'gone' | 'failed' | 'open-in-work' | 'seen';
export interface GroupStepperProps {
  readonly ids: readonly string[];
  /** The summary row's words ("3 messages to send"). */
  readonly title: string;
  readonly rpc: PlaceRpc;
  readonly language: Language;
  readonly viewer: boolean;
  readonly origin: HTMLElement | null;
  readonly onClose: () => void;
  /** Something changed: Today reads its rows again. */
  readonly onChanged: () => void;
  /** Opens one item in Work, Approvals, where its full sheet asks again. */
  readonly onOpenInWork: (id: string) => void;
  readonly onReceipt: (receiptId: string) => void;
}

type Load = { readonly phase: 'loading' } | { readonly phase: 'ready'; readonly detail: ApprovalSheetReply; readonly changed?: true }
  | { readonly phase: 'gone'; readonly code: string } | { readonly phase: 'failed'; readonly code: string };
/** The only refusals that mean the item is no longer waiting. */
const GONE = new Set(['INVALID_APPROVAL_STATE', 'NOT_FOUND', 'APPROVAL_EXPIRED']);
const refused = (code: string): Load => GONE.has(code) ? { phase: 'gone', code } : { phase: 'failed', code };
const codeOf = (error: unknown) => {
  if (error instanceof InvalidReply) return 'INVALID_REPLY';
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : 'REQUEST_FAILED';
};

export function GroupStepper(p: GroupStepperProps) {
  const t = useT();
  const w = workWords(p.language);
  const [index, setIndex] = useState(0);
  const [load, setLoad] = useState<Load>({ phase: 'loading' });
  const [outcomes, setOutcomes] = useState<Readonly<Record<string, StepOutcome>>>({});
  const [codes, setCodes] = useState<Readonly<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [asks, setAsks] = useState(false);
  const generation = useRef(0);
  const done = index >= p.ids.length;
  const id = p.ids[index];

  const read = useCallback(async (at: string, changed = false) => {
    const mine = ++generation.current;
    setLoad({ phase: 'loading' }); setAsks(false);
    try {
      const detail = approvalSheet(await p.rpc.request('approvals.get', { id: at }), 'approval');
      if (mine === generation.current) setLoad(detail.id === at ? { phase: 'ready', detail, ...(changed ? { changed: true as const } : {}) } : { phase: 'failed', code: 'INVALID_REPLY' });
    } catch (error) {
      if (mine === generation.current) setLoad(refused(codeOf(error)));
    }
  }, [p.rpc]);
  useEffect(() => { if (id !== undefined) void read(id); return () => { generation.current++; }; }, [id, read]);

  const next = (outcome: StepOutcome, code?: string) => {
    if (id === undefined) return;
    if (code !== undefined) setCodes(current => ({ ...current, [id]: code }));
    setOutcomes(current => ({ ...current, [id]: current[id] === 'approved' || current[id] === 'later' ? current[id]! : outcome }));
    setIndex(i => i + 1);
  };
  const act = async (method: 'approvals.approve' | 'approvals.notNow', payload: Record<string, unknown>, outcome: StepOutcome) => {
    if (busy) return;
    setBusy(true);
    try {
      await p.rpc.request(method, payload);
      p.onChanged();
      next(outcome);
    } catch (error) {
      const code = codeOf(error);
      // A changed preview is read again so what is shown, and approved, is what is current.
      if (code === 'PREVIEW_CHANGED' && id !== undefined) void read(id, true);
      else setLoad(refused(code));
    } finally { setBusy(false); }
  };

  if (done) {
    return (
      <Sheet kind={t('SHEET.kind.approval')} title={p.title} onClose={p.onClose} origin={p.origin}>
        <p>{t('FT4.group.done', { total: String(p.ids.length) })}</p>
        <ul className={s.groupResults} data-group-results="">
          {p.ids.map((item, i) => (
            <li key={item} data-outcome={outcomes[item] ?? 'seen'}>
              {t('WK-02.groupPosition', { index: String(i + 1), total: String(p.ids.length) })}{' '}
              {outcomes[item] === 'approved' ? t('FT4.group.approved') : outcomes[item] === 'later' ? t('FT4.group.later') : outcomes[item] === 'gone' ? t('FT4.group.gone') : outcomes[item] === 'failed' ? t('FT4.group.failed', { code: codes[item] ?? 'REQUEST_FAILED' }) : outcomes[item] === 'open-in-work' ? t('FT4.group.secondAsk') : t('STEPSTATE.waiting-for-you')}
            </li>
          ))}
        </ul>
      </Sheet>
    );
  }
  const position = { index: String(index + 1), total: String(p.ids.length) };
  const onAdjacent = (delta: -1 | 1) => setIndex(i => Math.min(p.ids.length - 1, Math.max(0, i + delta)));
  if (load.phase !== 'ready') {
    return (
      <Sheet kind={t('SHEET.kind.approval')} title={p.title} position={position} onClose={p.onClose} onAdjacent={onAdjacent} origin={p.origin}
        actions={load.phase === 'gone' ? <Button variant="quiet" onClick={() => next('gone')}>{t('FT4.group.next')}</Button>
          : load.phase === 'failed' ? <Button variant="quiet" onClick={() => next('failed', load.code)}>{t('FT4.group.next')}</Button> : undefined}>
        {load.phase === 'loading' ? <State state={{ kind: 'loading' }} />
          : load.phase === 'gone' ? <p role="status" data-gone={load.code}>{t('FT4.group.gone')}</p>
          : <p role="alert" data-failed={load.code}>{t('FT4.group.failed', { code: load.code })}</p>}
      </Sheet>
    );
  }
  const d = load.detail;
  const approval = { ...toApproval(d, { w, language: p.language, viewer: p.viewer }), group: { index: position.index, total: position.total, canBeUndone: d.tier === 'tier-1' } };
  return (
    <div data-group-step={position.index}>
      {load.changed && <p className={s.groupAsk} role="status" data-changed="">{t('FT4.group.changed')}</p>}
      <ApprovalSheet approval={approval} position={position} origin={p.origin} onClose={p.onClose} onAdjacent={onAdjacent} onReceipt={p.onReceipt}
        onApprove={() => void act('approvals.approve', { id: d.id, digest: d.digest }, 'approved')}
        onSecondAsk={() => setAsks(true)}
        onNotNow={() => void act('approvals.notNow', { id: d.id }, 'later')} />
      {asks && (
        <div className={s.groupAsk} role="status">
          <p>{t('FT4.group.secondAsk')}</p>
          <Button variant="quiet" onClick={() => { next('open-in-work'); p.onOpenInWork(d.id); }}>{t('FT4.group.openWork')}</Button>
        </div>
      )}
      {d.state !== 'prepared' && <Button variant="quiet" onClick={() => next('gone')}>{t('FT4.group.next')}</Button>}
    </div>
  );
}
