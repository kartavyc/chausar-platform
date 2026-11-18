// Chausar venture launcher: the words Chausar itself writes on a draft's card, its run and its preview (views/queue-view.ts,
// views/runs.ts, delivery/playbook.ts, delivery/judge-run.ts, models/written-by.ts). Round 6 (re-check 036): with Hindi
// on, Today kept these in English: the practice-draft notice, "For ... You send it yourself.", the checks lines, the
// model-estimate line, "Written by ... through Codex", the run step "You review the draft" and "Practice draft for ...".
// The app says each in the owner's language from its own pack (app/ui/src/places/today/plan-words.ts):
// - CARD_FIXED_WORDS are the same every time;
// - CARD_TEMPLATE_WORDS hold a name, a count or a model in {braces}; the engine fills them with fillWords, and the app
//   finds the template a line was filled from and says it with the same values in the owner's language. A value (a
//   client's name, a model id, a tool's name) stays as written; so does every word an AI or the owner wrote.
// A test holds the English pack to exactly these words.
//
// Pure: no store, no network and no Node imports, so the app's fake engine says exactly these words by using this file.

export const CARD_FIXED_WORDS = Object.freeze({
  checks: 'Checks',
  files: 'Files the agent works from',
  fileGone: 'A file that is no longer here',
  estimates: 'Numbers the agent wrote in its own words are model estimates; figures from receipts are not.',
  noDraftYet: 'There is no draft text yet.',
  // "A job", the one name for an agent's task (tests/naming-b1.test.ts).
  jobStopped: 'This job stopped before it finished. Nothing was sent to the client.',
  templateWrote: "Written by Chausar's template, not your AI",
  judgeNotChecked: 'Not checked by the quality check.',
  judgeReading: 'The quality check is reading this draft.',
  judgeNotRead: 'The quality check has not read this draft.',
  judgeNeverRead: 'The quality check never read this draft before you accepted it.',
  // The delivery steps every plan's own playbook has (delivery/playbook.ts); the work and drafting steps are the plan's.
  stepGather: "Read the client's message and files and pull out what is needed",
  stepClarify: 'Decide what is still unclear',
  stepWork: 'Do the hands-on work with tools',
  stepPrice: 'Take prices from the calculator',
  stepVerify: 'Check the draft',
  stepApprove: 'You review the draft',
  stepSend: 'Send it to the client (you copy it for now)',
});

export const CARD_TEMPLATE_WORDS = Object.freeze({
  forClient: 'For {client}. You send it yourself.',
  checksPassed: '{passed} of {count} checks passed.',
  checksUnsettled: '{passed} of {count} checks passed. The quality check settled no rule, so its check is not counted.',
  draftReply: 'Draft reply for {client}',
  draftOf: 'The draft for {client}',
  practiceDraft: 'Practice draft for {client}',
  replyDraft: 'Draft a reply for {client}',
  writtenThrough: 'Written by {model} through {tool}',
  writtenBy: 'Written by {model}',
  writtenUnrecorded: 'Written by {model}. The model was not recorded.',
  writtenUnreported: 'Written by {model}. It did not report the model.',
});

/** A template with its {names} filled in. A name the values do not hold stays as it is. */
export function fillWords(template: string, values: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{([a-zA-Z]+)\}/g, (whole, name: string) => (Object.hasOwn(values, name) ? String(values[name]) : whole));
}
