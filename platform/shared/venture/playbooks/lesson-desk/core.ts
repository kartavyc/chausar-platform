// Chausar playbook: Lesson desk core (wave 6, package 6E2). Pure transitions over one batch, shared by the engine's desk
// (desk.ts) and the fake engine, so both answer with the same codes, words, ids and digests. Every count (attendance,
// quiz scores) is made here by code; a progress report's figures come from these counts, never from a model. A child's
// lesson records reach the AI only while their parent's person consent (kit/voice-consent.ts) is current: the D21
// child-data hard stop, refused in lessonAiLearners. Parent messages are drafted here and handed to the owner, who sends
// them; fees are the existing orders and invoices (the caller drafts the invoice). Portable: no Node built-ins.
// Written for Chausar; nothing here is learned from an outside source.
import { check, ChausarError, digest } from '../../../portable.ts';
import { validDate } from '../../../date-core.ts';
import { HARD_STOPS, HARD_STOP_WORDS } from '../../policy/hard-stops.ts';
import { messageDigest, ownerPhone, OWNER_CHANNELS } from '../kit/owner-message.ts';
import type { OwnerChannel } from '../kit/owner-message.ts';
import type { LessonBatchBody, LessonDay, LessonItem, LessonLearner, LessonMark, LessonMessage, LessonWork } from '../../../../contract/venture/playbooks/lesson-desk/records.ts';

export const LESSON_PLAYBOOK = 'lesson-desk' as const;
const INVALID = 'INVALID_VENTURE_REQUEST';
const DAYS: readonly LessonDay[] = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const MARKS: readonly LessonMark[] = ['present', 'late', 'absent'];
const MAX_LEARNERS = 80, MAX_SESSIONS = 400, MAX_WORKS = 200, MAX_ITEMS = 60, MAX_MESSAGES = 400;

/** Where a learner's parent consent stands. 'not-needed': an adult learner; 'needed': none linked yet. */
export type LessonConsentState = 'not-needed' | 'needed' | 'current' | 'revoked' | 'replaced' | 'expired';
export type LessonFee = { invoiceId: string; number: string | null; status: string; total: string; balance: string; receiptId: string };

/** What the desk reads beyond the batch: the business's clients, orders, person consents and invoices. */
export type LessonWorld = {
  client(id: string): { id: string; name: string; email: string | null } | null;
  order(id: string): { id: string; clientId: string; status: string } | null;
  consent(id: string): { id: string; speaker: string; state: 'current' | 'revoked' | 'replaced' | 'expired' } | null;
  fees(orderId: string): LessonFee[];
};

export const LESSON_LINE = 'Counts are made by Chausar. Parent messages go out only when you send them yourself.';
const CONSENT_LINES: Readonly<Record<LessonConsentState, string>> = Object.freeze({
  'not-needed': 'An adult learner. The client AI permission applies.',
  needed: "Record a parent's consent before this child's records reach your AI.",
  current: "A parent's consent is recorded.",
  revoked: "The parent withdrew consent. This child's records never reach your AI.",
  replaced: 'A newer consent replaced this one. Link the newer one.',
  expired: 'This consent has ended. Record it again.',
});

// ---------------------------------------------------------------------------
// Field checks (the engine and the fake read payloads through these, so their refusals match word for word)
// ---------------------------------------------------------------------------

export function exact(value: unknown, allowed: readonly string[], required: readonly string[] = allowed): Record<string, unknown> {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), INVALID, 'Send the fields as an object.');
  const body = value as Record<string, unknown>;
  for (const key of Object.keys(body)) check(allowed.includes(key), INVALID, `The request has no field called ${key}.`);
  for (const key of required) check(body[key] !== undefined, INVALID, `The request needs ${key}.`);
  return body;
}

export function line(value: unknown, label: string, max = 120): string {
  check(typeof value === 'string', INVALID, `${label} must be text.`);
  const text = value.replace(/\s+/g, ' ').trim();
  check(text.length >= 1 && text.length <= max && !/[\u0000-\u001F\u007F]/.test(text), INVALID, `${label} is one line of up to ${max} characters.`);
  return text;
}

export function words(value: unknown, label: string, max = 2000, min = 1): string {
  check(typeof value === 'string', INVALID, `${label} must be text.`);
  const text = value.replace(/\r\n?/g, '\n').replace(/[ \t]+\n/g, '\n').trim();
  check(text.length >= min && text.length <= max && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(text), INVALID, `${label} is up to ${max} characters.`);
  return text;
}

export function idOf(value: unknown, label: string): string {
  check(typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(value), INVALID, `${label} must be a known identifier.`);
  return value;
}

function channelOf(value: unknown): OwnerChannel {
  check(typeof value === 'string' && (OWNER_CHANNELS as readonly string[]).includes(value), INVALID, 'Choose email or WhatsApp.');
  return value as OwnerChannel;
}

/** The desk request as venture.desk.list, .get and .act send it. */
export function lessonRequest(raw: unknown, op: 'list' | 'get' | 'act'): Record<string, unknown> {
  const allowed = op === 'list' ? ['playbook', 'kind', 'filter'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload', 'digest'];
  const required = op === 'list' ? ['playbook', 'kind'] : op === 'get' ? ['playbook', 'kind', 'id'] : ['playbook', 'kind', 'id', 'action', 'payload'];
  const p = exact(raw, allowed, required);
  check(p.playbook === LESSON_PLAYBOOK && p.kind === 'batch', INVALID, 'Choose a lesson batch.');
  if (op === 'list') check(p.filter === undefined, INVALID, 'The batch list takes no filter.');
  return p;
}

/** The digest the owner sees and sends back: the whole batch as it is now. */
export const batchDigest = (batch: LessonBatchBody): string => digest(batch);

// ---------------------------------------------------------------------------
// The batch
// ---------------------------------------------------------------------------

export function batchFields(payload: unknown): Pick<LessonBatchBody, 'name' | 'subject' | 'days' | 'time' | 'minutes'> {
  const b = exact(payload, ['name', 'subject', 'days', 'time', 'minutes']);
  check(Array.isArray(b.days) && b.days.length >= 1 && b.days.length <= 7 && b.days.every(day => (DAYS as readonly unknown[]).includes(day)) && new Set(b.days).size === b.days.length,
    INVALID, 'Choose the days of the week the batch meets.');
  check(typeof b.time === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(b.time), INVALID, 'Give the start time like 17:00.');
  check(Number.isInteger(b.minutes) && (b.minutes as number) >= 15 && (b.minutes as number) <= 480, INVALID, 'A class lasts 15 to 480 minutes.');
  return { name: line(b.name, 'Batch name', 80), subject: line(b.subject, 'Subject', 80), days: DAYS.filter(day => (b.days as string[]).includes(day)), time: b.time, minutes: b.minutes as number };
}

export function newBatch(payload: unknown): LessonBatchBody {
  return { ...batchFields(payload), learners: [], sessions: [], works: [], messages: [], seq: 0 };
}

function nextId(batch: LessonBatchBody, prefix: string): [string, LessonBatchBody] {
  const seq = batch.seq + 1;
  return [`${prefix}${seq}`, { ...batch, seq }];
}

function learnerOf(batch: LessonBatchBody, id: unknown): LessonLearner {
  const learner = batch.learners.find(item => item.id === id);
  check(learner, 'LESSON_LEARNER_NOT_FOUND', 'Choose a learner in this batch.');
  return learner;
}

const speakerKey = (name: string) => name.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

/** The order and consent a learner may be linked to: the guardian's own open order, the child's own current consent. */
function checkLinks(world: LessonWorld, input: { name: string; minor: boolean; guardianClientId: string; orderId: string | null; consentId: string | null }): void {
  if (input.orderId !== null) {
    const order = world.order(input.orderId);
    check(order && order.status !== 'cancelled' && order.clientId === input.guardianClientId, 'LESSON_ORDER_MISMATCH', "Choose an open order of this learner's parent or guardian.");
  }
  if (input.consentId !== null) {
    check(input.minor, INVALID, "An adult learner needs no parent's consent.");
    const consent = world.consent(input.consentId);
    check(consent && speakerKey(consent.speaker) === speakerKey(input.name) && consent.state === 'current', 'CONSENT_REQUIRED', `Choose ${input.name}'s own current consent, recorded from their parent.`);
  }
}

/** Where a learner's parent consent stands today, with its line. */
export function consentOf(learner: LessonLearner, world: LessonWorld): { state: LessonConsentState; consentId: string | null; line: string } {
  let state: LessonConsentState;
  if (!learner.minor) state = 'not-needed';
  else {
    const consent = learner.consentId === null ? null : world.consent(learner.consentId);
    state = !consent || speakerKey(consent.speaker) !== speakerKey(learner.name) ? 'needed' : consent.state;
  }
  return { state, consentId: learner.minor ? learner.consentId : null, line: CONSENT_LINES[state] };
}

// ---------------------------------------------------------------------------
// Counts, by code
// ---------------------------------------------------------------------------

export function attendanceOf(batch: LessonBatchBody, learnerId: string): { present: number; late: number; absent: number; of: number; line: string } {
  const marks = batch.sessions.map(session => session.marks[learnerId]).filter((mark): mark is LessonMark => mark !== undefined);
  const present = marks.filter(mark => mark === 'present').length, late = marks.filter(mark => mark === 'late').length;
  const of = marks.length, attended = present + late;
  return { present, late, absent: of - attended, of, line: of ? `Attended ${attended} of ${of} classes.` : 'No classes marked yet.' };
}

export function scoresOf(batch: LessonBatchBody, learnerId: string): { workId: string; title: string; right: number; of: number; line: string }[] {
  return batch.works.filter(work => work.kind === 'quiz' && work.scores[learnerId]).map(work => {
    const { right, of } = work.scores[learnerId]!;
    return { workId: work.id, title: work.title, right, of, line: `${right} of ${of} right.` };
  });
}

const answerKey = (value: string) => value.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

// ---------------------------------------------------------------------------
// Messages to parents
// ---------------------------------------------------------------------------

function recipient(world: LessonWorld, learner: LessonLearner, channel: OwnerChannel, phone: unknown): string | null {
  if (channel === 'email') return world.client(learner.guardianClientId)?.email ?? null;
  return ownerPhone(phone) ?? learner.phone;
}

function addMessage(batch: LessonBatchBody, input: Omit<LessonMessage, 'id' | 'digest' | 'handedOffAt' | 'journalId'>): LessonBatchBody {
  check(batch.messages.length < MAX_MESSAGES, INVALID, 'This batch holds as many messages as it can. Remove a learner who left first.');
  const [id, next] = nextId(batch, 'm');
  const message: LessonMessage = { ...input, id, digest: messageDigest(input), handedOffAt: null, journalId: null };
  return { ...next, messages: [...next.messages, message] };
}

/** The progress report's words: every figure from the counts above, then the owner's own note. */
export function progressText(batch: LessonBatchBody, learner: LessonLearner, guardianName: string, note: string): string {
  const attended = new Set(batch.sessions.filter(session => session.marks[learner.id] === 'present' || session.marks[learner.id] === 'late').map(session => session.topic));
  const topics = [...attended];
  return [
    `Hello ${guardianName},`,
    '',
    `Progress for ${learner.name} in ${batch.subject} (${batch.name}).`,
    attendanceOf(batch, learner.id).line,
    ...scoresOf(batch, learner.id).map(score => `${score.title}: ${score.line}`),
    ...(topics.length ? [`Topics covered: ${topics.join(', ')}.`] : []),
    ...(note ? ['', note] : []),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// One act on a batch (everything but create, handoff and fee, which need the engine's journal and invoices)
// ---------------------------------------------------------------------------

export type LessonActOutcome = { batch: LessonBatchBody; result: unknown; line: string };

export function lessonAct(batch: LessonBatchBody, action: string, payload: unknown, world: LessonWorld): LessonActOutcome {
  if (action === 'edit') {
    const next = { ...batch, ...batchFields(payload) };
    return { batch: next, result: { name: next.name }, line: 'Batch saved.' };
  }
  if (action === 'add-learner') {
    const b = exact(payload, ['name', 'minor', 'guardianClientId', 'orderId', 'consentId', 'phone'], ['name', 'minor', 'guardianClientId']);
    check(typeof b.minor === 'boolean', INVALID, 'Say whether the learner is under 18 with true or false.');
    check(batch.learners.length < MAX_LEARNERS, INVALID, `A batch holds up to ${MAX_LEARNERS} learners.`);
    const name = line(b.name, 'Learner name', 80);
    const guardianClientId = idOf(b.guardianClientId, 'Parent or guardian');
    check(world.client(guardianClientId), 'CLIENT_NOT_FOUND', 'Add the parent or guardian as a client first.');
    const orderId = b.orderId === undefined || b.orderId === null ? null : idOf(b.orderId, 'Fee order');
    const consentId = b.consentId === undefined || b.consentId === null ? null : idOf(b.consentId, 'Consent');
    checkLinks(world, { name, minor: b.minor, guardianClientId, orderId, consentId });
    const [id, next] = nextId(batch, 'l');
    const learner: LessonLearner = { id, name, minor: b.minor, guardianClientId, orderId, consentId, phone: ownerPhone(b.phone) };
    return { batch: { ...next, learners: [...next.learners, learner] }, result: { learnerId: id }, line: b.minor ? `${name} added. Record a parent's consent before their records reach your AI.` : `${name} added.` };
  }
  if (action === 'link-learner') {
    const b = exact(payload, ['learnerId', 'orderId', 'consentId', 'phone'], ['learnerId', 'orderId', 'consentId']);
    const learner = learnerOf(batch, b.learnerId);
    const orderId = b.orderId === null ? null : idOf(b.orderId, 'Fee order');
    const consentId = b.consentId === null ? null : idOf(b.consentId, 'Consent');
    checkLinks(world, { ...learner, orderId, consentId });
    const phone = b.phone === undefined ? learner.phone : ownerPhone(b.phone);
    const updated: LessonLearner = { ...learner, orderId, consentId, phone };
    return { batch: { ...batch, learners: batch.learners.map(item => item.id === learner.id ? updated : item) }, result: { learnerId: learner.id }, line: 'Learner saved.' };
  }
  if (action === 'remove-learner') {
    const b = exact(payload, ['learnerId']);
    const learner = learnerOf(batch, b.learnerId);
    return { batch: withoutLearners(batch, new Set([learner.id])), result: { learnerId: learner.id }, line: `${learner.name} and their marks, scores and messages are removed.` };
  }
  if (action === 'session') {
    const b = exact(payload, ['on', 'topic']);
    check(validDate(b.on), INVALID, 'Give the class date like 2026-11-02.');
    check(batch.sessions.length < MAX_SESSIONS, INVALID, `A batch keeps up to ${MAX_SESSIONS} classes.`);
    const [id, next] = nextId(batch, 's');
    return { batch: { ...next, sessions: [...next.sessions, { id, on: b.on, topic: line(b.topic, 'Topic', 120), marks: {} }] }, result: { sessionId: id }, line: 'Class added.' };
  }
  if (action === 'attendance') {
    const b = exact(payload, ['sessionId', 'marks']);
    const session = batch.sessions.find(item => item.id === b.sessionId);
    check(session, 'LESSON_SESSION_NOT_FOUND', 'Choose a class in this batch.');
    check(b.marks !== null && typeof b.marks === 'object' && !Array.isArray(b.marks), INVALID, 'Send each learner with present, late or absent.');
    const marks: Record<string, LessonMark> = { ...session.marks };
    for (const [learnerId, mark] of Object.entries(b.marks as Record<string, unknown>)) {
      learnerOf(batch, learnerId);
      check(typeof mark === 'string' && (MARKS as readonly string[]).includes(mark), INVALID, 'Mark each learner present, late or absent.');
      marks[learnerId] = mark as LessonMark;
    }
    return { batch: { ...batch, sessions: batch.sessions.map(item => item.id === session.id ? { ...session, marks } : item) }, result: { sessionId: session.id }, line: 'Attendance saved.' };
  }
  if (action === 'work') {
    const b = exact(payload, ['kind', 'title', 'topic', 'items']);
    check(b.kind === 'worksheet' || b.kind === 'quiz', INVALID, 'Choose a worksheet or a quiz.');
    check(Array.isArray(b.items) && b.items.length >= 1 && b.items.length <= MAX_ITEMS, INVALID, `Add 1 to ${MAX_ITEMS} questions.`);
    check(batch.works.length < MAX_WORKS, INVALID, `A batch keeps up to ${MAX_WORKS} worksheets and quizzes.`);
    const items: LessonItem[] = (b.items as unknown[]).map(item => {
      const row = exact(item, ['prompt', 'answer']);
      const answer = row.answer === '' ? '' : line(row.answer, 'Answer', 200);
      check(b.kind !== 'quiz' || answer.length > 0, INVALID, 'Every quiz question needs its answer in the key.');
      return { prompt: words(row.prompt, 'Question', 600), answer };
    });
    const [id, next] = nextId(batch, 'w');
    const work: LessonWork = { id, kind: b.kind, title: line(b.title, 'Title', 120), topic: line(b.topic, 'Topic', 120), items, scores: {} };
    return { batch: { ...next, works: [...next.works, work] }, result: { workId: id }, line: b.kind === 'quiz' ? 'Quiz saved with its answer key.' : 'Worksheet saved.' };
  }
  if (action === 'scores') {
    const b = exact(payload, ['workId', 'answers']);
    const work = batch.works.find(item => item.id === b.workId);
    check(work, 'LESSON_WORK_NOT_FOUND', 'Choose a worksheet or quiz in this batch.');
    check(work.kind === 'quiz', 'LESSON_NOT_A_QUIZ', 'Only a quiz with an answer key is scored.');
    check(b.answers !== null && typeof b.answers === 'object' && !Array.isArray(b.answers), INVALID, "Send each learner's answers in order.");
    const scores = { ...work.scores };
    for (const [learnerId, given] of Object.entries(b.answers as Record<string, unknown>)) {
      learnerOf(batch, learnerId);
      check(Array.isArray(given) && given.length === work.items.length && given.every(item => typeof item === 'string' && item.length <= 200), INVALID, 'Send one answer for each question, in order.');
      const right = work.items.filter((item, index) => answerKey(item.answer) === answerKey(given[index] as string)).length;
      scores[learnerId] = { right, of: work.items.length };
    }
    return { batch: { ...batch, works: batch.works.map(item => item.id === work.id ? { ...work, scores } : item) }, result: { workId: work.id }, line: 'Scores counted from the answer key.' };
  }
  if (action === 'progress' || action === 'update') {
    const b = exact(payload, action === 'progress' ? ['learnerId', 'note', 'channel', 'phone'] : ['learnerId', 'text', 'channel', 'phone'], action === 'progress' ? ['learnerId', 'channel'] : ['learnerId', 'text', 'channel']);
    const learner = learnerOf(batch, b.learnerId);
    const channel = channelOf(b.channel);
    const guardian = world.client(learner.guardianClientId);
    check(guardian, 'CLIENT_NOT_FOUND', "This learner's parent or guardian is no longer a client.");
    const to = recipient(world, learner, channel, b.phone);
    const text = action === 'progress'
      ? progressText(batch, learner, guardian.name, b.note === undefined ? '' : words(b.note, 'Your note', 1000, 0))
      : words(b.text, 'Message', 2000);
    const subject = channel === 'email' ? (action === 'progress' ? `Progress for ${learner.name}` : `About ${learner.name}`) : null;
    const next = addMessage(batch, { learnerId: learner.id, kind: action, channel, to, subject, text });
    return { batch: next, result: { messageId: next.messages.at(-1)!.id }, line: 'Saved for you to check. Nothing was sent.' };
  }
  throw new ChausarError(INVALID, 'Choose a lesson desk action.');
}

/** Removes learners with every mark, score and message about them (Remove, and Forget). */
export function withoutLearners(batch: LessonBatchBody, ids: ReadonlySet<string>): LessonBatchBody {
  const drop = <T>(record: Record<string, T>) => Object.fromEntries(Object.entries(record).filter(([key]) => !ids.has(key)));
  return {
    ...batch,
    learners: batch.learners.filter(item => !ids.has(item.id)),
    sessions: batch.sessions.map(session => ({ ...session, marks: drop(session.marks) })),
    works: batch.works.map(work => ({ ...work, scores: drop(work.scores) })),
    messages: batch.messages.filter(message => !ids.has(message.learnerId)),
  };
}

/** The message the owner approved, unchanged and not yet handed over, or the refusal. */
export function messageOf(batch: LessonBatchBody, payload: unknown): LessonMessage {
  const b = exact(payload, ['messageId']);
  const message = batch.messages.find(item => item.id === b.messageId);
  check(message, 'LESSON_MESSAGE_NOT_FOUND', 'Choose a message in this batch.');
  check(message.digest === messageDigest(message), 'APPROVAL_CHANGED', 'This message changed. Read it again before you send it.');
  return message;
}

export function markHandedOff(batch: LessonBatchBody, messageId: string, at: string, journalId: string): LessonBatchBody {
  return { ...batch, messages: batch.messages.map(item => item.id === messageId ? { ...item, handedOffAt: at, journalId } : item) };
}

// ---------------------------------------------------------------------------
// Views and the AI's share
// ---------------------------------------------------------------------------

export function batchRow(id: string, batch: LessonBatchBody) {
  return { id, name: batch.name, subject: batch.subject, learners: batch.learners.length, sessions: batch.sessions.length };
}

export function batchView(id: string, batch: LessonBatchBody, world: LessonWorld) {
  return {
    id, name: batch.name, subject: batch.subject, days: batch.days, time: batch.time, minutes: batch.minutes,
    learners: batch.learners.map(learner => ({
      id: learner.id, name: learner.name, minor: learner.minor, guardianClientId: learner.guardianClientId,
      guardianName: world.client(learner.guardianClientId)?.name ?? null, orderId: learner.orderId, phone: learner.phone,
      consent: consentOf(learner, world), attendance: attendanceOf(batch, learner.id), scores: scoresOf(batch, learner.id),
      fees: learner.orderId ? world.fees(learner.orderId) : [],
    })),
    sessions: batch.sessions, works: batch.works, messages: batch.messages, line: LESSON_LINE,
  };
}

/**
 * The learners an AI job on this order may read, with only their names, the topics they attended and the work they
 * did: no counts, no contact. A child without their parent's current consent stops the job here (the D21 hard stop).
 */
export function lessonAiLearners(batch: LessonBatchBody, orderId: string, world: LessonWorld): { name: string; minor: boolean; batch: string; subject: string; topics: string[]; work: string[] }[] {
  return batch.learners.filter(learner => learner.orderId === orderId).map(learner => {
    if (consentOf(learner, world).state !== 'not-needed' && consentOf(learner, world).state !== 'current') {
      const stop = HARD_STOPS.find(item => item.id === 'child-data')!;
      throw new ChausarError('HARD_STOP', `${stop.line} Record a parent's consent for ${learner.name} before their lesson records reach your AI. ${HARD_STOP_WORDS}`);
    }
    return {
      name: learner.name, minor: learner.minor, batch: batch.name, subject: batch.subject,
      topics: batch.sessions.filter(session => session.marks[learner.id] === 'present' || session.marks[learner.id] === 'late').map(session => session.topic),
      work: batch.works.filter(work => work.kind === 'worksheet' || work.scores[learner.id]).map(work => work.title),
    };
  });
}
