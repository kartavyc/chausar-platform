// Chausar venture launcher, runs across businesses (Ink v2 wave 4, package 4J6): venture.runs.across, for Work's runs
// across the businesses on this computer. The open business is counted live; each other one from the summary the
// engine saved when it was last open (money/across.ts), "as of" then. Counts only: no run's purpose or agent words.
// A business that opens with a passphrase shows no counts.
import type { Context } from '../../contracts.ts';
import type { AcrossLeftOut, AcrossRunsView, VentureDeps } from '../contracts.ts';
import { exactPayload, readVenture } from '../records.ts';
import { queueListHandler } from './queue.ts';
import { asOfLine, asOfWords, listWords, nameOf, notCountedWords, OPEN_LINE, readSnapshots, runCounts, withheld } from '../money/across.ts';

type RunsRow = AcrossRunsView['businesses'][number];

/**
 * venture.runs.across {} (read): working, waiting and stopped runs and what needs the owner, for the open business
 * now and each other one as saved; the line adds the counts it could read and names the businesses it could not.
 * totals and notCounted say the same in parts, so a screen can word it in Hindi.
 */
export async function runsAcross(deps: VentureDeps, ctx: Context, payload: unknown): Promise<AcrossRunsView> {
  exactPayload(payload, []);
  const { venture } = readVenture(deps, ctx);
  const runs = await runCounts(deps, ctx);
  const needsYou = (await queueListHandler(deps, ctx, {})).needsYou;
  const rows: RunsRow[] = [{
    businessId: deps.workspace?.current().id ?? 'open', name: venture.workingName, open: true, locked: false, asOf: null, line: OPEN_LINE, lineKey: 'open',
    ...runs, needsYou,
  }];
  const left: AcrossLeftOut[] = [];
  for (const read of await readSnapshots(deps)) {
    const name = nameOf(read), hidden = withheld(read), snapshot = read.snapshot;
    if (hidden || !snapshot) {
      const shown = hidden ?? { line: '', key: 'none' as const, why: 'none' as const };
      rows.push({ businessId: read.id, name, open: false, locked: read.read === 'locked', asOf: null, line: shown.line, lineKey: shown.key, working: null, waiting: null, stopped: null, needsYou: null });
      left.push({ businessId: read.id, name, why: shown.why, month: null });
      continue;
    }
    rows.push({ businessId: read.id, name, open: false, locked: false, asOf: snapshot.asOf, line: asOfLine(asOfWords(snapshot.asOf, venture.country)), lineKey: 'as-of', ...snapshot.runs, needsYou: snapshot.needsYou });
  }
  const shown = rows.filter(row => row.working !== null);
  const total = (key: 'working' | 'waiting' | 'stopped' | 'needsYou') => shown.reduce((sum, row) => sum + (row[key] ?? 0), 0);
  const totals = { working: total('working'), waiting: total('waiting'), stopped: total('stopped'), needsYou: total('needsYou'), businesses: shown.length };
  const parts = [`${totals.working} running`, `${totals.waiting} waiting`, ...(totals.stopped ? [`${totals.stopped} stopped`] : []), `${totals.needsYou} need you`];
  const where = shown.length === 1 ? 'in 1 business' : `across ${shown.length} businesses`;
  return { businesses: rows, line: `${listWords(parts)} ${where}.${notCountedWords(left)}`, totals, notCounted: left };
}
