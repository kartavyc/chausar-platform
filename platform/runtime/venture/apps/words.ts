// Chausar venture launcher, mini apps (wave 6 package 6H1, D39): the words the engine and the fake engine both say,
// with no imports beyond the shared frame file, so the fake engine answers word for word.
import type { AppPermission } from './frame.ts';

/** What each permission lets an app do, as the permission screen says it. */
export const PERMISSION_WORDS: Readonly<Record<AppPermission, { verb: 'Read' | 'Keep' | 'Use' | 'Propose'; line: string; chip: string }>> = Object.freeze({
  clients: { verb: 'Read', line: 'Clients: their names', chip: 'Reads: Clients' },
  orders: { verb: 'Read', line: 'Orders: client, status and request', chip: 'Reads: Orders' },
  invoices: { verb: 'Read', line: 'Invoices: number, status and what is owed, each with a receipt', chip: 'Reads: Invoices' },
  notes: { verb: 'Keep', line: 'its own notes in Chausar', chip: 'Keeps notes' },
  calculator: { verb: 'Use', line: 'the calculator for amounts, each with a receipt', chip: 'Uses: Chausar calculator' },
  propose: { verb: 'Propose', line: 'cards on Today. You approve each one.', chip: 'Proposes cards' },
});

export const APP_NEVER_LINE = 'Use the internet, send or pay by itself, see other apps, or open files on your computer.';
export const APP_IDEAS: readonly string[] = Object.freeze(['Who owes me, by client', 'Weekly work planner', 'Price calculator for clients']);

/** Names for the reads an app makes, joined in plain words: "Clients and Invoices". */
const READ_NAMES: Readonly<Partial<Record<AppPermission, string>>> = Object.freeze({ clients: 'your Clients', orders: 'your Orders', invoices: 'your invoices' });
function joined(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** Chausar's reply in the making chat, written by code from what the app's code uses (never the model's words). */
export function madeLine(version: number, permissions: readonly AppPermission[]): string {
  const reads = permissions.flatMap(permission => READ_NAMES[permission] ?? []);
  const lead = version === 1 ? "Here's a first version." : `Here's version ${version}.`;
  const what = reads.length ? ` It reads ${joined(reads)}.` : ' It reads nothing from your business.';
  const asks = permissions.includes('propose')
    ? " It can't send anything by itself; anything it proposes becomes a card on Today for you to approve."
    : " It can't send anything by itself.";
  return `${lead}${what}${asks}`;
}

export const APP_LINES = Object.freeze({
  granted: (name: string) => `${name} can run now, with only what you allowed.`,
  revoked: (name: string) => `${name} is turned off. It asks again before it runs.`,
  restored: (version: number) => `Now on version ${version}. Undo goes back.`,
  pinned: 'Pinned to Today.',
  unpinned: 'Taken off Today.',
  removed: (name: string) => `${name} and its notes are deleted.`,
  proposed: 'On Today for your approval.',
  proposedAlready: 'It is on Today already.',
});

export const APP_ERRORS = Object.freeze({
  notFound: 'That app was not found.',
  needsAi: 'Connect your AI first. Your AI writes the app; Chausar checks it and runs it in a locked box.',
  refused: (reasons: readonly string[]) => `Chausar did not keep this version. ${reasons.join(' ')} Ask again in other words.`,
  notPassed: "The app your AI wrote did not pass Chausar's checks. Ask again in other words.",
  stale: 'This changed since you opened it. Read it again.',
  notAllowed: 'This app is not allowed to do that. You can change what it may do in Apps.',
  allowFirst: 'Allow this app first.',
  unknownTool: 'Chausar has no tool by that name for apps.',
  notesFull: 'This app keeps too many notes. Clear some first.',
  proposalsFull: 'This app has ten cards waiting on Today. Decide those first.',
  askEmpty: 'Say what the app should do, in up to 600 characters.',
  askSecret: 'Leave keys, passwords and id numbers out of an app request.',
  version: 'That version was not found.',
});
