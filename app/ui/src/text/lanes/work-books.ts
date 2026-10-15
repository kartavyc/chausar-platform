/** Words the work-books lane adds to the shared catalogue, in English and Hindi (same keys).
 *  Only the owning lane edits this file. Keys must not repeat a key in text/en.json or another lane's file. */
export const words: { readonly en: Readonly<Record<string, string>>; readonly hi: Readonly<Record<string, string>> } = {
  en: { 'SH-01.sub.work.reminders': 'Reminders' },
  hi: { 'SH-01.sub.work.reminders': 'याद-दिलाने वाले संदेश' },
};
