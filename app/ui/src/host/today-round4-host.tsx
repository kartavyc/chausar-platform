/**
 * The host's round 4 Today wiring, kept out of bootstrap.tsx: the checked reads, the projection
 * into Today's data, the intents the screens call, the rail count and the two sheets (grouped
 * stepping and a document from the phone). bootstrap.tsx only calls this hook and places what it
 * returns. Every engine reply is checked before it is used; a refused or failed write changes
 * nothing on the screen but its own words.
 */
import { useState, type ReactNode } from 'react';
import type { Address, Count, Language, View } from '../app/presentation.ts';
import type { PlaceId } from '../app/presentation.ts';
import type { PlaceRpc } from '../places/types.ts';
import type { CashSaveResult, TodayData, TodayIntents } from '../screens/today/TodayData.ts';
import { GroupStepper } from '../screens/today/GroupStepper.tsx';
import { PhoneDocumentSheet } from '../screens/today/PhoneDocumentSheet.tsx';
import { sheetOf } from '../screens/work/contract.ts';
import { isClosingReply } from '../bridge/todayx-contract.ts';
import { groupWords, projectRound4, round4Open, rupeesToPaise, todayRailCount, useRound4Reads, type Round4Open } from './today-round4.ts';

export type Round4SheetKind = 'today-group' | 'today-document';
export const ROUND4_SHEETS: readonly Round4SheetKind[] = ['today-group', 'today-document'];

export interface Round4HostInput {
  readonly rpc: PlaceRpc;
  readonly contextKey: string;
  readonly language: Language;
  readonly view: View;
  readonly role: 'owner' | 'cofounder' | 'accountant' | 'viewer';
  readonly navigate: (address: Address) => void;
  /** Opens one of the two sheets at the current address, with focus returning to `origin`. */
  readonly openSheet: (kind: Round4SheetKind, origin: HTMLElement | null) => void;
  /** The frame's reads again (the closing row after a cash save or a switch). */
  readonly rereadFrame: () => void;
  readonly onReceipt: (receiptId: string) => void;
}

export interface Round4Host {
  project(data: TodayData): TodayData;
  intents(base: TodayIntents): TodayIntents;
  counts(data: TodayData): Partial<Record<PlaceId, Count>> | undefined;
  /** The open sheet's content, or null when this kind is not one of these sheets. */
  content(kind: string, origin: HTMLElement | null, onClose: () => void): ReactNode | null;
}

export function useTodayRound4Host(input: Round4HostInput): Round4Host {
  const r4 = useRound4Reads(input.rpc, input.contextKey);
  /** What the open sheet shows, fixed when it opened: a reread that drops the row never empties the sheet. */
  const [target, setTarget] = useState<{ readonly open: Round4Open; readonly title: string } | null>(null);
  const changed = () => { r4.reread(); input.rereadFrame(); };
  const approver = input.role === 'owner' || input.role === 'cofounder';

  /** A joined row opens its approval in Work, its group here, or its document here. Returns whether it was one. */
  const open = (rowId: string, origin: HTMLElement | null): boolean => {
    const opened = round4Open(r4.reads.review, rowId);
    if (opened === null) return rowId.startsWith('r4:');
    if (opened.kind === 'approval') { input.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(opened.id) }); return true; }
    const group = opened.kind === 'group' ? r4.reads.review?.groups.find(g => g.ids.join() === opened.ids.join()) : undefined;
    setTarget({ open: opened, title: group ? groupWords(group, input.language) : '' });
    input.openSheet(opened.kind === 'group' ? 'today-group' : 'today-document', origin);
    return true;
  };
  /** Saves the typed cash and says what happened: `invalid` when it is not a plain amount, `failed` on a refusal or a reply that does not check. */
  const saveCash = async (text: string): Promise<CashSaveResult> => {
    const paise = rupeesToPaise(text), day = r4.reads.cash?.day;
    if (paise === null) return 'invalid';
    if (day === undefined) return 'failed';
    try {
      const reply = await input.rpc.request('todayx.cash.save', { day, paise });
      if (r4.setCash(reply)) { input.rereadFrame(); return 'saved'; }
    } catch { /* refused or failed: said below */ }
    r4.reread();
    return 'failed';
  };
  const setClosing = (on: boolean) => {
    input.rpc.request('todayx.closing.set', { on }).then(reply => { if (isClosingReply(reply)) input.rereadFrame(); }, () => input.rereadFrame());
  };

  return {
    project: data => projectRound4(data, r4.reads, { language: input.language, view: input.view, role: input.role, navigate: input.navigate }),
    intents: base => ({
      ...base,
      onReview: (rowId, origin) => { if (!open(rowId, origin)) base.onReview(rowId, origin); },
      onOpenQueueRow: (rowId, origin) => { if (!open(rowId, origin)) base.onOpenQueueRow?.(rowId, origin); },
      // Cash is told by the owner (or a cofounder): the engine refuses any other seat, so the field is not offered.
      ...(r4.reads.cash !== null && approver ? { onSaveClosing: saveCash } : {}),
      ...(approver ? { onSetClosing: setClosing } : {}),
    }),
    counts: data => { const count = todayRailCount(data); return count === undefined ? undefined : { today: count }; },
    content: (kind, origin, onClose) => {
      const opened = target?.open;
      if (kind === 'today-group' && opened?.kind === 'group') {
        return <GroupStepper key={opened.ids.join()} ids={opened.ids} title={target!.title} rpc={input.rpc} language={input.language}
          viewer={input.role === 'viewer'} origin={origin} onClose={onClose} onChanged={r4.reread} onReceipt={input.onReceipt}
          onOpenInWork={id => input.navigate({ place: 'work', sub: 'approvals', sheet: sheetOf(id) })} />;
      }
      if (kind === 'today-document' && opened?.kind === 'document') {
        return <PhoneDocumentSheet key={opened.documentId} documentId={opened.documentId} channel={opened.channel} rpc={input.rpc} origin={origin} onClose={onClose} onChanged={changed} />;
      }
      return null;
    },
  };
}
