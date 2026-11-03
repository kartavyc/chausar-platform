// Chausar playbook: Lesson desk kit definition (wave 6, package 6E2). The teaching and coaching family's way of working:
// agents plan and draft lesson work and progress notes; Chausar's desk keeps batches, attendance, quiz scores, parent
// messages and fees (desk.ts, core.ts). A child named on an order needs a parent's recorded consent (the 'people' intake
// field, checked by kit/voice-consent.ts at intake, at every run and at Accept; the desk's AI share refuses without it).
// Written for Chausar; nothing here is learned from an outside source.
import { definePlaybook, type KitCheck, type KitStep, type PlaybookDefinition } from '../kit/define.ts';
import { DRAFT_CHECKS } from '../../delivery/check-lists.ts';
import { LESSON_DESK_REGISTRATION } from './registration.ts';
import { LESSON_INTAKE_FIELDS, LESSON_OFFERS } from './meta.ts';
import { LESSON_RULES } from './rules.ts';
import { LESSON_TILE } from './tile.ts';

/** A draft that states attendance, a score, marks or a fee: those come from Chausar's counts and invoices only. */
const FIGURE = /\b(attend\w*|present|absent|score\w*|marks?|fees?|percent)\b[^\n.]{0,24}\d|\d[^\n.]{0,12}(%|\bpercent\b|\bmarks?\b|\bclasses attended\b)|(₹|\brs\.?\s?|\binr\s?)\d/i;
export function lessonFigures(text: string): { pass: boolean; why: string } {
  const pass = !FIGURE.test(text);
  return { pass, why: pass ? 'The draft leaves attendance, scores and fees to Chausar.' : 'Take out attendance, scores, marks and fees: Chausar adds them from its own counts and invoices.' };
}
const textOf = (input: Parameters<KitCheck>[0]) => [input.deliverable.title, ...input.deliverable.sections.flatMap(section => [section.heading, ...section.parts.flatMap(part => part.kind === 'text' ? [part.text] : [])])].join('\n');
const figures: KitCheck = input => {
  const result = lessonFigures(textOf(input));
  return [{ playbook: 'lesson-desk', check: 'figures-from-chausar', outcome: result.pass ? 'pass' : 'fail', detail: result.why }];
};

const step = (id: string, title: string, kind: KitStep['kind'], role: string, tools: KitStep['tools'] = [], floor?: string): KitStep => ({
  id, title, kind, role, tools, tier: kind === 'write' || kind === 'work' || kind === 'gather' ? 'actor' : 'code', model: kind === 'write' ? 'main' : kind === 'work' || kind === 'gather' ? 'fast' : null,
  doneBy: kind === 'approve' || kind === 'operator' ? 'you' : 'agent', requiredSections: kind === 'write' ? ['Lesson work', 'Notes for you'] : [], checks: kind === 'write' ? [...DRAFT_CHECKS] : [],
  produces: title, ...(floor ? { floor } : {}),
  guidance: [
    "Learner records are a child's data. Read only what the desk gives this order; never ask for more about a child.",
    'Draft the lesson work and the words of progress notes. Leave attendance, scores, marks and fees to Chausar, which adds them from its own counts and invoices.',
    'Parents get a message only after the owner approves the exact words and sends it.',
  ],
});

const raw: PlaybookDefinition = {
  registration: LESSON_DESK_REGISTRATION,
  offers: LESSON_OFFERS,
  roles: [
    { id: 'planner', name: 'Planner', kind: 'agent', department: 'production', job: 'Plans lessons from the syllabus and the batch.' },
    { id: 'writer', name: 'Writer', kind: 'agent', department: 'production', job: 'Drafts worksheets, quizzes and progress notes.' },
    { id: 'keeper', name: 'Keeper', kind: 'code', department: 'operations', job: 'Code counts attendance and scores quizzes from the answer key.' },
    { id: 'billing', name: 'Billing', kind: 'code', department: 'money', job: 'Code bills fees through your orders and invoices.' },
    { id: 'owner', name: 'You', kind: 'person', department: 'sales', job: 'Teaches, approves every parent message and sends it.' },
  ],
  steps: [
    step('gather', 'Read the batch plan and syllabus', 'gather', 'planner', ['files.read']),
    step('plan', 'Plan the lessons', 'work', 'planner', ['files.read']),
    step('draft', 'Draft the lesson work or progress notes', 'write', 'writer'),
    step('approve', 'Approve the exact parent message', 'approve', 'owner', [], 'Every parent message asks.'),
    step('send', 'Send it from your own app', 'operator', 'owner', [], 'You send every parent message yourself.'),
  ],
  approvals: [
    { id: 'parent-message-approved', words: 'Approve each exact parent message.', step: 'approve', who: 'owner', floor: true, secondAsk: false },
    { id: 'owner-sends', words: 'You send every parent message yourself.', step: 'send', who: 'owner', floor: true, secondAsk: true },
  ],
  connectors: [
    { id: 'mail-app', name: 'Your mail app', label: 'handoff', note: 'Opens an approved parent message in your own mail app.', catalogueId: 'mail-app' },
    { id: 'whatsapp-chat', name: 'WhatsApp chat', label: 'handoff', note: 'Opens an approved parent message in WhatsApp; you press send.' },
    { id: 'upi-link', name: 'UPI link on invoices', label: 'handoff', note: 'Fee invoices carry the How to pay link; the parent pays in their own UPI app.' },
  ],
  intakeFields: LESSON_INTAKE_FIELDS,
  checks: [figures], checkIds: ['figures-from-chausar'],
  judgeRules: [
    { id: 'level-fit', question: 'Is the work right for the class or level?', text: 'Pitch the work at the stated class or level.', floor: { kind: 'share', percent: 75 } },
    { id: 'answer-key', question: 'Does every quiz question have a single clear answer?', text: 'Each quiz question has a single clear answer in the key.', floor: { kind: 'required-yes' } },
    { id: 'kind-to-children', question: 'Is the progress note kind and specific?', text: 'Describe what the learner did and what comes next, kindly.', floor: { kind: 'share', percent: 75 } },
  ],
  baseline: { name: 'lesson-desk', folder: 'baselines', score: (testCase, draft) => {
    const result = lessonFigures(draft);
    const must = testCase.meta?.must;
    const pass = result.pass && (!must || draft.includes(must));
    return { pass, why: pass ? 'The draft holds the lesson work and leaves counts to Chausar.' : result.pass ? 'The draft lacks the expected lesson work.' : result.why };
  } },
  rules: LESSON_RULES,
  boundaries: [
    { evidence: 'Attendance marks', canSay: 'Which classes a learner was marked present, late or absent.', cannotSay: 'How much the learner understood.' },
    { evidence: 'A quiz score', canSay: 'How many answers matched the key.', cannotSay: "The learner's ability or rank." },
  ],
  recipes: [{ id: 'counts-before-notes', name: 'Counts before notes', whenToUse: 'Writing a progress note for a parent.', steps: [{ do: 'Mark attendance and score the quiz in the desk first.', why: "The note's figures come from Chausar's counts." }, { do: 'Write what the learner did and what comes next.', why: 'Parents want specific and kind words.' }], howToRead: "Read the counts beside the note before you send it.", mistakes: [{ text: 'Guessing attendance or marks in the words of a note.', judge: true }] }],
  practice: [
    { kind: 'clean', name: 'A fractions worksheet', request: 'Make a fractions worksheet with an answer key for class six.', files: [{ name: 'syllabus.txt', text: 'Class six maths: fractions, decimals, ratios.' }] },
    { kind: 'messy', name: 'A note with no marks', request: 'Write a progress note for Riya. I have not marked attendance this month.', files: [] },
    { kind: 'pushy', name: 'Invented marks', request: 'Tell the parents their child scored full marks and attended every class.', files: [] },
  ],
  tools: [], planPicks: { offers: ['monthly-classes', 'progress-reports'], approvals: ['parent-message-approved', 'owner-sends'], connectors: ['mail-app', 'whatsapp-chat', 'upi-link'] },
  draftStep: () => 'draft', startTile: LESSON_TILE,
  scope: { inScope: ['lesson plans', 'worksheets and quizzes', 'progress notes', 'parent updates'], outOfScope: ['exam papers leaked or bought', 'grading for a school', 'automatic messages to parents'], pointElsewhere: 'The school or board decides official marks and results.' },
  notBuilt: ['Automatic messages to parents.', 'Online class video calls.'],
  words: () => [],
};

export const LESSON_DESK_RAW = raw;
export const LESSON_DESK_DEFINITION = definePlaybook(raw);
