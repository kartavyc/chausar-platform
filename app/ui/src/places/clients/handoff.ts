/**
 * Handing a draft to the owner's own app (Ink v2 wave 4, 4E4; the engine's network/handoff.ts): Chausar never sends.
 * venture.outreach.open answers one handoff and this file performs it: a mail link opens the owner's mail app (on the
 * desktop through the preload's checked open, which accepts one mail link; on the web as a mailto address); LinkedIn
 * copies the text first, then opens the profile; WhatsApp opens wa.me with the text filled in; a message too long for
 * one link is copied for the owner to paste. Nothing is recorded until the owner taps "I sent it"
 * (venture.outreach.sent).
 *
 * A draft sheet is named by its person and the draft (`outreach:<person id>:<draft id>`): the engine lists a person's
 * drafts on their sheet (venture.network.person), so the draft opens again after a reload.
 */

import type { EngineClient, LawfulBasis, OutreachChannel, OutreachHandoff, OutreachKind, OutreachSentChannel, OutreachView } from '../../engine/types';
import { EngineError } from '../../engine/types';
import { onDesktop, openExternal } from '../connections/external';

/** The channel a send is recorded on, for each draft channel (the engine's SENT_OF). */
export const SENT_OF: Readonly<Record<OutreachChannel, OutreachSentChannel>> = { email: 'own-mailbox', linkedin: 'linkedin', whatsapp: 'whatsapp' };

const kept = new WeakMap<EngineClient, Map<string, OutreachView>>();

/**
 * Keeps a draft no person's sheet lists (an invoice reminder, 4J20), as the engine answered it, for the draft sheet:
 * memory only. Drafts to people are read back from the engine instead.
 */
export function keepDraft(client: EngineClient, view: OutreachView): void {
  const drafts = kept.get(client) ?? new Map<string, OutreachView>();
  drafts.set(view.id, view);
  kept.set(client, drafts);
}

/** A draft kept in this session, or undefined. */
export function keptDraft(client: EngineClient, id: string): OutreachView | undefined {
  return kept.get(client)?.get(id);
}

/**
 * What the owner asked a draft to say, beyond its kind and channel: their own words, the lawful basis and the postal
 * address. A draft again on another channel carries them, and a cold one opens the draft form with them filled in, so
 * the owner's words are never lost. Memory only, by draft id, or by `card:<id>` for the form a cold draft opens.
 */
export interface DraftAsk { kind: OutreachKind; channel: OutreachChannel; language: 'en' | 'hi'; about?: string; basis?: LawfulBasis; postalAddress?: string }
const asks = new WeakMap<EngineClient, Map<string, DraftAsk>>();

export function keepAsk(client: EngineClient, key: string, ask: DraftAsk): void {
  const kept = asks.get(client) ?? new Map<string, DraftAsk>();
  kept.set(key, ask);
  asks.set(client, kept);
}

/** What a draft was asked to say, or undefined (a draft made before this session, or by another place). */
export function askOf(client: EngineClient, key: string): DraftAsk | undefined {
  return asks.get(client)?.get(key);
}

/** The card sheet tab that opens its draft form with a kind and a channel picked (`write-<kind>-<channel>`). */
export const writeTab = (kind: OutreachKind, channel: OutreachChannel) => `write-${kind}-${channel}`;

/** The kind and channel a `write-<kind>-<channel>` tab picks, or null. */
export function parseWriteTab(tab: string | undefined): { kind: OutreachKind; channel: OutreachChannel } | null {
  const match = /^write-([a-z-]+)-(email|linkedin|whatsapp)$/.exec(tab ?? '');
  return match ? { kind: match[1] as OutreachKind, channel: match[2] as OutreachChannel } : null;
}

/** The draft sheet's id: the person whose sheet lists the draft, and the draft. */
export const draftSheetId = (personId: string, draftId: string) => `${personId}:${draftId}`;

/** A draft sheet's person and draft, or only the draft (a link from before the person was named). */
export function parseDraftSheetId(id: string): { personId: string | null; draftId: string } {
  const at = id.lastIndexOf(':');
  return at > 0 ? { personId: id.slice(0, at), draftId: id.slice(at + 1) } : { personId: null, draftId: id };
}

interface Bridge { openExternal?: (url: string) => Promise<void> }

/** Opens a mail link: through the desktop's checked open, or as the page's own mailto address on the web. */
async function openMail(url: string): Promise<void> {
  if (onDesktop()) {
    const open = (window as Window & { chausar?: Bridge }).chausar?.openExternal;
    if (typeof open !== 'function') throw new EngineError('NO_EXTERNAL_OPEN', "This window can't open links yet.");
    await open(url);
    return;
  }
  window.location.assign(url);
}

/** Copies text to the clipboard; false when the page may not. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (!navigator.clipboard?.writeText) return false;
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Whether a handoff opens a web page (so a web tab is reserved inside the click, before the engine answers). */
export const opensPage = (channel: OutreachChannel) => channel !== 'email';

/**
 * Does what a handoff says. Answers 'copied' when the owner pastes the text themselves (copy, and LinkedIn's text),
 * 'copy-failed' when the page could not copy it (the sheet then shows the text to copy by hand), else 'opened'.
 * A reserved tab that is not used is closed.
 */
export async function performHandoff(handoff: OutreachHandoff, tab: Window | null): Promise<'opened' | 'copied' | 'copy-failed'> {
  if (handoff.action === 'mailto') {
    tab?.close();
    await openMail(handoff.url);
    return 'opened';
  }
  if (handoff.action === 'whatsapp') {
    await openExternal(handoff.url, tab);
    return 'opened';
  }
  if (handoff.action === 'linkedin') {
    const copied = await copyText(handoff.text);
    await openExternal(handoff.profileUrl, tab);
    return copied ? 'opened' : 'copy-failed';
  }
  tab?.close();
  return (await copyText(handoff.text)) ? 'copied' : 'copy-failed';
}

/** The text a handoff carries, for the owner to copy by hand when the page could not. */
export function handoffText(handoff: OutreachHandoff): string | null {
  return handoff.action === 'linkedin' || handoff.action === 'copy' ? handoff.text : null;
}

/** The channel a handoff opens, for "I sent it" when the sheet has no draft view to read it from. */
export function channelOf(handoff: OutreachHandoff): OutreachChannel | null {
  if (handoff.action === 'mailto') return 'email';
  if (handoff.action === 'linkedin') return 'linkedin';
  if (handoff.action === 'whatsapp') return 'whatsapp';
  return null;
}
