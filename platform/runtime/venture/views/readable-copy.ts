// C5 task 22: a readable copy of the business left on this computer. A day after the owner exported it, Today asks once:
// delete it, or keep it. Delete removes exactly that file; Keep it dismisses that file for good. Worded and decided here;
// the note lives beside the custody files (workspace-custody.ts) and holds kind and time only.
import { check, type Context, type State } from '../../contracts.ts';
import type { VentureDeps, VentureRecord } from '../contracts.ts';
import type { W4Decision, W4Outcome, W4RowItem } from './queue-w4.ts';

const DAY_MS = 86_400_000;
const FILE_OF = /^readable-copy:(.+)$/;

/** One row per readable copy a day old or more. */
export async function readableCopyRows(deps: VentureDeps, _ctx: Context, _state: State, _venture: VentureRecord): Promise<W4RowItem[]> {
  if (!deps.workspace?.readableExports) return [];
  const now = deps.clock().getTime();
  let copies: { file: string; at: string }[];
  try { copies = await deps.workspace.readableExports(); } catch { return []; }
  return copies.filter(copy => now - Date.parse(copy.at) >= DAY_MS).map(copy => ({
    kind: 'notice', subject: `readable-copy:${copy.file}`, version: 'waiting', createdAt: copy.at,
    title: 'A readable copy of this business is still on this computer. Delete it?',
    line: 'Anyone who opens that file can read your whole business.',
    notice: { probe: 'readable-copy', severity: 'medium', link: '#/business/keep', file: copy.file },
    actions: [{ id: 'deny', label: 'Keep it', primary: false }, { id: 'approve', label: 'Delete', primary: true, secondAsk: true }],
  }));
}

/** Delete or Keep it, on exactly the file the row named. */
export async function decideReadableCopy(deps: VentureDeps, _ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const file = FILE_OF.exec(decision.subject)?.[1];
  check(file && deps.workspace?.deleteReadable && deps.workspace.keepReadable, 'RESOLVED_ELSEWHERE', 'That copy is not on this computer any more.');
  if (decision.action === 'approve') {
    await deps.workspace!.deleteReadable!(file!);
    return { line: 'The readable copy is deleted.' };
  }
  await deps.workspace!.keepReadable!(file!);
  return { line: 'Kept. Chausar won\'t ask about this copy again.' };
}
