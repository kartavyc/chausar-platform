// C5 task 28: the words of Diagnostics in plain words, browser safe, so the fake engine says the same.

/** One sum: what Chausar was doing, for how long, and the receipt: every call or span that went into it, with its time. */
export type DiagnosticsRow = {
  key: string;
  label: string;
  ms: number;
  display: string;
  receipt: { source: 'tool-calls' | 'agent-jobs' | 'run-events'; items: { id: string; ms: number }[]; sumMs: number };
};
/** venture.diagnostics.today: code sums of the owner's today. Model calls are counted only: their records keep no finish time. */
export type DiagnosticsTodayView = { day: string; line: string; rows: DiagnosticsRow[]; modelCalls: number };

/** "Today Chausar spent most of its time waiting for Claude Code (3 min) and writing drafts (40 s)." */
export function diagnosticsLine(rows: readonly Pick<DiagnosticsRow, 'label' | 'display'>[], modelCalls: number): string {
  const [first, second] = rows;
  if (!first) return modelCalls > 0 ? `Today Chausar made ${modelCalls} AI ${modelCalls === 1 ? 'call' : 'calls'}.` : 'Nothing ran today.';
  const top = `${first.label} (${first.display})`;
  return `Today Chausar spent most of its time ${second ? `${top} and ${second.label} (${second.display})` : top}.`;
}
