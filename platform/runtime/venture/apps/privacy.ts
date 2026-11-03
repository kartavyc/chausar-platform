// Chausar venture launcher, mini apps (wave 6, 6H1 / D39, DPDP): what Forget clears from an app.
// An app's notes are its own storage, so a note that names a forgotten person (by a name their files gave, one of their
// addresses, or their client id) is removed. The making chat keeps each message's time and version, but a message that
// names them becomes the erased line. Forget emits privacy.forgotten itself; this adds no event.
import type { MiniAppRecord } from '../contracts.ts';
import type { VentureTx } from '../records.ts';

export const APP_ERASED_LINE = 'Erased: it named someone you asked Chausar to forget.';

export function eraseAppNaming(tx: VentureTx, clientIds: ReadonlySet<string>, handles: ReadonlySet<string>, mentions: (value: unknown) => boolean): void {
  const named = (text: string) => {
    const lower = text.toLowerCase();
    return mentions(text) || [...clientIds].some(id => text.includes(id)) || [...handles].some(handle => handle.length >= 3 && lower.includes(handle.toLowerCase()));
  };
  for (const record of tx.list('venture-mini-app') as MiniAppRecord[]) {
    const notes = Object.fromEntries(Object.entries(record.notes).filter(([key, value]) => !named(key) && !named(value)));
    const messages = record.messages.map(message => (message.text !== APP_ERASED_LINE && named(message.text) ? { ...message, text: APP_ERASED_LINE } : message));
    const notesChanged = Object.keys(notes).length !== Object.keys(record.notes).length;
    const messagesChanged = messages.some((message, index) => message !== record.messages[index]);
    if (notesChanged || messagesChanged) tx.replace<MiniAppRecord>({ ...record, notes, messages });
  }
}
