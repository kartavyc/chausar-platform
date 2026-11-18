// Chausar venture launcher, journal: the words the decision record writes (journal/decisions.ts), kept apart so the
// app's fake engine says a decision in exactly these words. Round 6: a Today click reaches Earlier as the engine says it.
//
// Pure: no store, no network and no Node imports.
/** Each Today action in a few words, for the record's line. */
export const ACTION_WORDS: Readonly<Record<string, string>> = Object.freeze({
  approve: 'Approve', deny: 'No', later: 'Later', watch: 'Watch', read: 'Read', answer: 'Answer', 'send-to-ca': 'Send to CA', open: 'Open',
  connect: 'Connect', 'set-prices': 'Set prices', keep: 'Keep', issue: 'Issue', 'run-again': 'Run again', sent: 'I sent it',
  continue: 'Continue', stop: 'Stop', resume: 'Resume', 'show-file': 'Show in folder',
});

export const DECISION_WORDS = Object.freeze({
  today: (action: string, reason: string, who = 'You') => `${who} chose ${action} on Today: ${reason}`,
  /** One-shot A4 (rows 33, 46): the plan's row is decided on Today, in Prices or on the plan page, so it names no place. */
  plan: (action: string, reason: string, who = 'You') => `${who} chose ${action}: ${reason}`,
  owner: (reason: string) => `You decided: ${reason}`,
  cofounder: (reason: string) => `Your cofounder decided: ${reason}`,
  decided: (who: string, reason: string) => `${who} decided: ${reason}`,
  timeout: (reason: string) => `No answer in time: ${reason}`,
  approved: (what: string, who = 'You') => `${who} approved it: ${what}`,
  refused: (what: string, who = 'You') => `${who} said no: ${what}`,
  // A4 review round 2: "wait for you" only to the one who set it; anyone else reads that it waits for an approval.
  gate: (step: string, gate: 'auto' | 'hold', who = 'You') => (gate === 'auto' ? `${who} set '${step}' to run on its own.` : `${who} set '${step}' to wait for ${who === 'You' ? 'you' : 'an approval'}.`),
  autoRule: (step: string) => `Your Auto setting on '${step}'`,
  sessionRule: (step: string) => `Your allow for this session on '${step}'`,
  someRule: 'A saved rule',
  autoLine: (step: string) => `Allowed by your Auto setting on '${step}', without asking`,
  sessionLine: (step: string) => `Allowed for this session on '${step}', without asking`,
  calls: (count: number) => `${count} calls`,
  ran: (tool: string) => `The agent ran ${tool} without asking.`,
  ranMany: (count: number, tools: string) => `The agent made ${count} calls without asking: ${tools}.`,
  journalAction: 'Ran without asking',
});
