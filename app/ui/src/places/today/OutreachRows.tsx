/**
 * Today's follow-up and reply cards and the "Add notes" notice after a call (Ink v2 wave 4, 4E4; the engine's
 * network/followup-rows.ts and inbound-rows.ts). The engine sends each row's parts (who, the due day and days late, the
 * channel and the drafted nudge; why a reply waits and on whom) so the screen says it in its own words, in English
 * and Hindi; the lines that carry more than the parts (a mail's day, a domain's warning) stay the engine's.
 *
 * Their primaries are not decisions: a follow-up's handoff (Open in Mail, Open in LinkedIn, Open WhatsApp) opens the
 * owner's own app with the nudge filled in (venture.outreach.open), or, with no nudge drafted, leads to the card; a
 * reply's "Reply in Mail" opens the owner's mail app to that address; "Add notes" opens the notes sheet. "I sent it"
 * and the reply's own answers are decisions, sent through Today's decide like any other. Chausar never sends. What a
 * handoff did is said on the card, kept for the session only (memory).
 */

import { useSyncExternalStore } from 'react';
import { CATALOGUES, useT, type T } from '../../text';
import { useEngine } from '../../engine/context';
import { navigate, openSheet } from '../../shell/navigation';
import type { EngineClient, OutreachChannel, QueueAction, QueueRow } from '../../engine/types';
import { reserveTab } from '../connections/external';
import { handoffText, opensPage, performHandoff } from '../clients/handoff';
import { codeOf, messageOf } from '../clients/network';
import { NeverContactLost } from '../clients/NeverContactLost';
import s from './OutreachRows.module.css';

type Note = { text: string; problem: boolean; code: string; copy: string | null };
/** The notes of one engine client (so two windows or two tests never share them). Memory only. */
type Notes = { map: Map<string, Note>; listeners: Set<() => void> };
const kept = new WeakMap<EngineClient, Notes>();
function notesOf(client: EngineClient): Notes {
  let notes = kept.get(client);
  if (!notes) { notes = { map: new Map(), listeners: new Set() }; kept.set(client, notes); }
  return notes;
}
function sayTo(client: EngineClient, rowId: string, note: Note | null) {
  const notes = notesOf(client);
  if (note) notes.map.set(rowId, note); else notes.map.delete(rowId);
  for (const listener of [...notes.listeners]) listener();
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** A mail address the owner's mail app takes: one address, nothing else in it. */
const MAIL = /^[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9-]{1,63}(\.[A-Za-z0-9-]{1,63})+$/;

/** A reply in the owner's own mail app: to the address the mail came from, its subject, and a drafted answer if any. */
function replyLink(to: string, subject: string | null, body: string | null): string | null {
  if (!MAIL.test(to)) return null;
  const query = [
    ...(subject ? [`subject=${encodeURIComponent(/^re:/i.test(subject) ? subject : `Re: ${subject}`)}`] : []),
    ...(body ? [`body=${encodeURIComponent(body)}`] : []),
  ].join('&');
  return `mailto:${encodeURIComponent(to).replace(/%40/g, '@')}${query ? `?${query}` : ''}`;
}

/**
 * Today's "open" on a follow-up, reply or notes card: true when this handled it (it is never a decision). The rest of
 * Today's actions go on as before.
 */
export function useOutreachOpen(): (row: QueueRow, action: QueueAction) => boolean {
  const engine = useEngine();
  const t = useT();
  const say = (rowId: string, note: Note | null) => sayTo(engine, rowId, note);
  return (row, action) => {
    if (action.id !== 'open') return false;
    if (row.kind === 'followup' && row.followup) {
      const { draftId, channel, cardId } = row.followup;
      if (!draftId || !channel) {
        navigate({ place: 'clients', sub: 'pipeline', query: {}, sheet: { kind: 'card', id: cardId } });
        return true;
      }
      void openNudge(row.id, draftId, channel);
      return true;
    }
    if (row.kind === 'reply' && row.reply) {
      const link = row.reply.from ? replyLink(row.reply.from, row.reply.subject, row.reply.draft) : null;
      if (!link) { say(row.id, { text: t('today.reply.noAddress'), problem: true, code: '', copy: null }); return true; }
      void (async () => {
        try {
          await performHandoff({ action: 'mailto', url: link, line: '' }, null);
          say(row.id, { text: t('today.reply.opened'), problem: false, code: '', copy: null });
        } catch (error) {
          say(row.id, { text: messageOf(error), problem: true, code: codeOf(error), copy: null });
        }
      })();
      return true;
    }
    if (row.kind === 'notice' && row.reply?.reason === 'meeting-notes' && row.reply.eventId) {
      openSheet('call-notes', row.reply.eventId);
      return true;
    }
    return false;
  };

  async function openNudge(rowId: string, draftId: string, channel: OutreachChannel) {
    say(rowId, null);
    let tab: Window | null = null;
    try {
      tab = opensPage(channel) ? reserveTab() : null;
      const handoff = await engine.request('venture.outreach.open', { draftId });
      const done = await performHandoff(handoff, tab);
      say(rowId, { text: handoff.line, problem: false, code: '', copy: done === 'copy-failed' ? handoffText(handoff) : null });
    } catch (error) {
      tab?.close();
      say(rowId, { text: messageOf(error), problem: true, code: codeOf(error), copy: null });
    }
  }
}

/** What a handoff from this card did, said on the card: the engine's line, or its refusal. */
function OutreachNote({ note }: { note: Note }) {
  return (
    <div className={s.note}>
      {note.copy && <p className={s.copy} data-content="">{note.copy}</p>}
      {note.code === 'NEVER_CONTACT_LOST' ? <NeverContactLost /> : <p className={note.problem ? s.problem : s.said} role="status">{note.text}</p>}
    </div>
  );
}

/** Whether a card is one of 4E4's (its note goes in the card's preview place). */
export const isOutreachRow = (row: QueueRow) => row.kind === 'followup' || row.kind === 'reply' || (row.kind === 'notice' && row.reply?.reason === 'meeting-notes');

/**
 * 4Z2: the engine's fixed button words (queue actions: "Read", "Approve", "Send to CA") keyed back to the screen's own
 * text, so a Hindi screen says them in Hindi. English reads exactly the engine's words; a label not in the list stays
 * the engine's.
 */
const ACTION_KEYS: ReadonlyMap<string, string> = new Map(
  Object.entries(CATALOGUES.en).filter(([key, value]) => key.startsWith('today.action.') && typeof value === 'string').map(([key, value]) => [value as string, key]),
);
export function actionWords(label: string, t: T): string {
  const key = ACTION_KEYS.get(label);
  return key ? t(key) : label;
}

/**
 * A follow-up or reply card in the screen's own words, from the row's parts; the digest and every id stay as they came.
 * A reply's line and a notice's title keep the engine's words where they say more than the parts. Every other card's
 * buttons are worded from the engine's fixed labels (4Z2).
 */
export function wordedRow(row: QueueRow, t: T): QueueRow {
  if(row.kind==='notice'&&row.id.includes('watch-source:')){const failed=row.title==='Review a source read problem';return{...row,title:t(failed?'pb-r5.notice.failedTitle':'pb-r5.notice.changedTitle'),line:t(failed?'pb-r5.notice.failedLine':'pb-r5.notice.changedLine'),actions:row.actions.map(a=>({...a,label:a.id==='open'?t('pb-r5.notice.open'):a.id==='later'?t('pb-r5.notice.later'):a.label}))};}
  if (row.kind === 'notice' && row.id.includes('social-revision:')) {
    return { ...row, title: t('pb-social-due.title'), line: t('pb-social-due.line'), actions: row.actions.map(action => ({ ...action, label: action.id === 'open' ? t('pb-social-due.open') : action.id === 'later' ? t('pb-social-due.later') : action.label })) };
  }

  if (row.kind === 'followup' && row.followup) {
    const { name, company, daysLate, channel, draftId } = row.followup;
    const who = company ? t('today.followup.who', { name, company }) : name;
    const when = daysLate === 0 ? t('today.followup.dueToday') : t('today.followup.late', { count: daysLate });
    const nudge = draftId && channel ? t(`today.followup.drafted.${channel}`) : t('today.followup.noDraft');
    return {
      ...row,
      title: t('today.followup.title', { name }),
      line: t('today.followup.line', { who, when, nudge }),
      actions: row.actions.map((action) => ({
        ...action,
        label: action.id === 'sent' ? t('today.followup.sent')
          : action.id === 'open' ? (draftId && channel ? t(`today.followup.open.${channel}`) : t('today.followup.openCard')) : action.label,
      })),
    };
  }
  if (row.kind === 'reply' && row.reply) {
    const { reason, name, company, topics } = row.reply;
    const first = firstOf(name);
    const title = reason === 'confirm' ? (company ? t('today.reply.confirm', { name: first, company }) : t('today.reply.confirmName', { name: first }))
      : reason === 'talking' ? t('today.reply.talking', { name: first })
        : reason === 'owner-reply' ? t(`today.reply.topic.${topics[0] ?? 'price'}`, { name: first })
          : reason === 'bot-question' ? t('today.reply.bot', { name: first }) : row.title;
    const LABELS: Partial<Record<string, string>> = {
      'open': t('today.reply.replyInMail'), 'Yes, it is': t('today.reply.yes'), 'No': t('today.reply.no'), 'Move to Talking': t('today.reply.moveTalking'),
      'Not now': t('today.reply.notNow'), 'Done': t('today.reply.done'),
      // An opt-out's and a dead domain's answers (inbound-rows.ts), in the screen's words.
      'Block and close': t('today.reply.blockAndClose'), 'Block them too': t('today.reply.blockToo'), 'Close as Lost': t('today.reply.closeLost'),
      'Keep the card': t('today.reply.keepCard'), 'Block the domain': t('today.reply.blockDomain'), 'Only the address': t('today.reply.onlyAddress'),
    };
    return {
      ...row, title,
      actions: row.actions.map((action) => ({ ...action, label: (action.id === 'open' ? LABELS.open : LABELS[action.label]) ?? action.label })),
    };
  }
  if (row.kind === 'notice' && row.reply?.reason === 'meeting-notes') {
    return {
      ...row,
      actions: row.actions.map((action) => ({ ...action, label: action.id === 'open' ? t('today.reply.notes.add') : action.id === 'deny' ? t('today.reply.notes.none') : action.label })),
    };
  }
  // The same row when no word changes (English), so a card's row keeps its identity from render to render.
  if (row.actions.every((action) => actionWords(action.label, t) === action.label)) return row;
  return { ...row, actions: row.actions.map((action) => ({ ...action, label: actionWords(action.label, t) })) };
}

/** The card's preview place on a follow-up, reply or notes card: what its handoff did, once it did something. */
export function useOutreachPreview(row: QueueRow) {
  const engine = useEngine();
  const notes = notesOf(engine);
  const subscribe = (listener: () => void) => { notes.listeners.add(listener); return () => { notes.listeners.delete(listener); }; };
  const note = useSyncExternalStore(subscribe, () => notes.map.get(row.id), () => undefined);
  return isOutreachRow(row) && note ? <OutreachNote note={note} /> : undefined;
}
