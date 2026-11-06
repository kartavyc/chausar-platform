// Chausar venture launcher, agents (wave 6 package 6G2, D43): the words retiring an agent uses, with no imports, so the
// engine (agents/retired.ts, agents/retire.ts) and the app's fake engine (app/ui/src/engine/fake-retire.ts) say exactly
// the same thing.

/** The handover target that means the owner takes the agent's open work. */
export const OWNER_HANDOVER = 'owner';
/** What a name reads with on Today and on receipts once its agent is retired. */
export const RETIRED_SUFFIX = ' (retired)';
/** Why a retired agent takes no new words, notes or routines (AGENT_RETIRED). */
export const RETIRED_LINE = 'This agent is retired, so its chat is read only. Bring it back on Team to work with it again.';
/** What a retired agent's thread says above its read-only history. */
export const SHELF_THREAD_LINE = 'Retired. This chat is read only. Bring back makes it work again.';
/** The check screen's fixed promise: what retiring never loses. */
export const RETIRE_KEPT_LINE = 'Nothing is lost. Receipts, approvals waiting on Today and Undo all stay. Bring back restores it as it was.';
/** A changed check: the owner looks again. */
export const RETIRE_STALE = 'What this agent holds or has in flight changed since you looked. Look again before retiring it.';
export const NOT_RETIRED = 'That agent is not retired.';
export const RETIRE_CHOOSE = 'Choose another agent on this team to take over, or take it over yourself.';
/** How a run in flight reads on the check screen. */
export const RETIRE_RUN_WORDS: Readonly<Record<string, string>> = Object.freeze({ active: 'in progress', waiting: 'waiting on you' });

/** The last AI agent of a team cannot retire: its business would have no agent left. */
export function lastOneLine(name: string): string {
  return `${name} is the last AI agent on this team, so it cannot retire. Pause the business instead if you need a break.`;
}

/** The Retired shelf's line for one agent: who does its steps now. */
export function shelfLine(toName: string | null): string {
  return toName ? `Retired. ${toName} does its steps now.` : 'Retired. You took over its work.';
}

/** What retiring says once done. */
export function retiredLine(name: string, toName: string | null, routinesOff: number): string {
  const off = routinesOff ? ' Its routines are off.' : '';
  return toName ? `${name} is retired. ${toName} does its steps now.${off}` : `${name} is retired. You took over its work.${off}`;
}

/** What Bring back says once done. */
export function restoredLine(name: string, routinesOn: number): string {
  const on = routinesOn === 1 ? ' 1 routine is on again.' : routinesOn > 1 ? ` ${routinesOn} routines are on again.` : '';
  return `${name} is back, as it was.${on}`;
}

/** The check screen's lines for the things in flight. */
export const inFlightWords = {
  question: (question: string) => `Its question waits for you on Work and Today: ${question}`,
  proposal: (quote: string) => `Waiting for your answer in its chat: "${quote}"`,
  today: (title: string) => `On Today: ${title}`,
  routine: (name: string) => `On Today: ${name} is due`,
};
