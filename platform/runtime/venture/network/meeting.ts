// Chausar venture launcher, network (Ink v2 wave 4, package 4E3, catalogue C17): "after a call". When a call with
// someone in the network has ended, Today asks for notes (inbound-rows.ts). venture.meeting.digest { eventId?, notes }
// reads the owner's own notes (or a transcript they paste) with their AI, under the chat consent, for the people
// mentioned, intros promised by either side and next steps. Code checks all of it before anything is drafted: every
// item must quote the notes; a name not in the notes is dropped; a date the AI gives is kept only when the notes write
// that same date (English or Hindi, in words or figures), else the step has no date; a step with a figure or an amount
// the notes do not hold is left out. Every item becomes a drafted proposal for the owner (a next step on the card, or
// an intro or reminder note to draft): a step with no day written gets none, and the owner gives it when approving on
// Today; one for a person with no open card says so and cannot be raised until they have one. Nothing is raised, sent
// or moved here. Keys and id numbers are refused before anything is read and the notes pass the untrusted screen. The
// notes are kept in no record of their own; the exact request sent to the AI, the screened notes in it, is kept in
// its model call record as every call's is, and Forget erases that text when it names someone (network/forget.ts).
import { check, ChausarError, type Context, type State } from '../../contracts.ts';
import type { CalendarFeedRecord, IsoDate, Json, MeetingDigestView, ModelTask, ProposalRecord, VentureDeps, VentureRecord } from '../contracts.ts';
import { copiedTokens, exactPayload, formatVentureDate, identifier, modelNumbers, plainText, requireAppChannel, tidyWords, ventureAction } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { secretFindings } from '../core/secrets.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { readAs } from '../delivery/shared.ts';
import { statesMoney } from '../delivery/harness/patches.ts';
import { requireChatConsent } from '../agents/consent.ts';
import { chatCall, holdsIdNumber } from '../agents/answer.ts';
import { ID_REFUSED, KEY_REFUSED } from '../agents/threads.ts';
import { draftProposal } from '../chief/store.ts';
import { proposalView } from '../chief/gate.ts';
import { addDays } from './followups.ts';
import { cardsOf, CLOSED_STAGES, type Card } from './pipeline.ts';
import { listPeople } from './store.ts';
import { fold } from './text.ts';
import { calendarFeedOf, NO_COUNTRY } from './calendar-feed.ts';

export const HELD_NOTES = 'These notes have words aimed at an AI, so Chausar did not send them. Take those words out and try again.';
export const MEETING_WORDS = Object.freeze({
  noDate: 'No day was written in your notes, so you choose it when you approve.',
  noCard: (name: string) => `${name} has no open card in your pipeline. Add them first, then raise this.`,
  drafted: 'Drafted for you to approve. Nothing changes until you do.',
  template: 'Connect your AI in Connections to turn notes into next steps. Chausar found these people in your notes by name.',
  refused: 'Your AI\'s answer did not pass Chausar\'s checks, so nothing was drafted. These are the people Chausar found in your notes by name.',
});
const MAX_ITEMS = 10;

// ---------------------------------------------------------------------------
// Dates the notes write
// ---------------------------------------------------------------------------

const MONTH_WORDS: Readonly<Record<string, number>> = Object.freeze({
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
  'जनवरी': 1, 'फ़रवरी': 2, 'फरवरी': 2, 'मार्च': 3, 'अप्रैल': 4, 'मई': 5, 'जून': 6, 'जुलाई': 7, 'अगस्त': 8, 'सितंबर': 9, 'सितम्बर': 9,
  'अक्टूबर': 10, 'अक्तूबर': 10, 'नवंबर': 11, 'नवम्बर': 11, 'दिसंबर': 12, 'दिसम्बर': 12,
});
const MONTH_NAMES = Object.keys(MONTH_WORDS).sort((a, b) => b.length - a.length).join('|');

/** A real day, or null. */
function dayOf(year: number, month: number, date: number): IsoDate | null {
  if (!Number.isInteger(year) || month < 1 || month > 12 || date < 1 || date > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, date));
  return d.getUTCMonth() === month - 1 ? d.toISOString().slice(0, 10) : null;
}

/**
 * Every day the notes write in full: 2026-11-03, 3/11 or 3/11/2026 (in the business's date order), 3 Nov, Nov 3, the 3rd
 * of November, 3 नवंबर, with Devanagari digits too. A day with no year is this year's, or next year's when this year's
 * is more than 30 days gone. Weekday names and words like "tomorrow" are never a date.
 */
export function datesWritten(notes: string, today: IsoDate, order: VentureRecord['country']['dateOrder']): Set<IsoDate> {
  const text = notes.replace(/[०-९]/g, digit => String(digit.charCodeAt(0) - 0x0966)).normalize('NFC');
  const year = Number(today.slice(0, 4));
  const out = new Set<IsoDate>();
  const add = (y: number | null, month: number, date: number) => {
    let day = dayOf(y ?? year, month, date);
    if (day && y === null && day < addDays(today, -30)) day = dayOf(year + 1, month, date);
    if (day) out.add(day);
  };
  const fullYear = (value: string | undefined) => (value === undefined ? null : value.length === 2 ? 2000 + Number(value) : Number(value));
  for (const m of text.matchAll(/(?<!\d)(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/g)) add(Number(m[1]), Number(m[2]), Number(m[3]));
  for (const m of text.matchAll(/(?<![\d-])(\d{1,2})[/.](\d{1,2})(?:[/.](\d{4}|\d{2}))?(?![\d/.])/g)) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    if (order === 'month-day-year') add(fullYear(m[3]), a, b); else add(fullYear(m[3]), b, a);
  }
  const dayFirst = new RegExp(`(?<!\\d)(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MONTH_NAMES})(?![\\p{L}])(?:,?\\s+(\\d{4}))?`, 'giu');
  for (const m of text.matchAll(dayFirst)) add(m[3] ? Number(m[3]) : null, MONTH_WORDS[m[2].toLowerCase()], Number(m[1]));
  const monthFirst = new RegExp(`(?<![\\p{L}])(${MONTH_NAMES})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?!\\d)(?:,?\\s+(\\d{4}))?`, 'giu');
  for (const m of text.matchAll(monthFirst)) add(m[3] ? Number(m[3]) : null, MONTH_WORDS[m[1].toLowerCase()], Number(m[2]));
  return out;
}

// ---------------------------------------------------------------------------
// The AI's answer, in a closed shape, then checked by code
// ---------------------------------------------------------------------------

type Intro = { by: 'owner' | 'them'; person: string; introduce: string; quote: string };
type Step = { text: string; person: string; date: string; quote: string };
export type DigestOutput = { people: string[]; intros: Intro[]; steps: Step[] };

const DIGEST_INSTRUCTIONS = [
  'You read the owner\'s own notes from a call with people in their network. Pull out, from the notes only: the people mentioned by name; intros promised by either side ("I\'ll connect you with my CA friend"); and next steps.',
  'For each intro and step, quote the exact words of the notes it comes from. by is "owner" when the owner promised the intro, "them" when the other side did. person: who it is about, as the notes name them.',
  'date: a day as YYYY-MM-DD only when the notes write that day; otherwise leave it empty. Never work a date out from words like "Friday" or "next week".',
  'Write each step in a few plain words. Never add an amount, a price or a figure the notes do not write.',
].join(' ');

const STRING = { type: 'string' };
const DIGEST_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['people', 'intros', 'steps'],
  properties: {
    people: { type: 'array', items: STRING },
    intros: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['by', 'person', 'introduce', 'quote'], properties: { by: { type: 'string', enum: ['owner', 'them'] }, person: STRING, introduce: STRING, quote: STRING } } },
    steps: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['text', 'person', 'date', 'quote'], properties: { text: STRING, person: STRING, date: { type: 'string', description: 'YYYY-MM-DD only when the notes write this day; else empty.' }, quote: STRING } } },
  },
};

const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const rejected = (message: string): never => { throw new ChausarError('MODEL_OUTPUT_REJECTED', message); };
const shortText = (value: unknown): string => (typeof value === 'string' && value.length <= 300 && !HIDDEN.test(value) ? value : rejected('A part of the answer was not plain short text.'));

/** The answer's shape: three lists of at most ten, every field short plain text, a date empty or YYYY-MM-DD. */
export function validateDigest(raw: unknown): DigestOutput {
  const value = raw as Record<string, unknown>;
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join() !== 'intros,people,steps') return rejected('The answer had the wrong shape.');
  const list = (items: unknown) => (Array.isArray(items) && items.length <= MAX_ITEMS ? items : rejected('A list in the answer was too long.'));
  const object = (item: unknown, keys: string) => (item && typeof item === 'object' && Object.keys(item).sort().join() === keys ? item as Record<string, unknown> : rejected('An item of the answer had the wrong shape.'));
  return {
    people: list(value.people).map(shortText),
    intros: list(value.intros).map(item => {
      const intro = object(item, 'by,introduce,person,quote');
      if (intro.by !== 'owner' && intro.by !== 'them') return rejected('An intro said neither who promised it.');
      return { by: intro.by, person: shortText(intro.person), introduce: shortText(intro.introduce), quote: shortText(intro.quote) };
    }),
    steps: list(value.steps).map(item => {
      const step = object(item, 'date,person,quote,text');
      const date = shortText(step.date);
      if (date !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(date)) return rejected('A date in the answer was not YYYY-MM-DD.');
      return { text: shortText(step.text), person: shortText(step.person), date, quote: shortText(step.quote) };
    }),
  };
}

/** Who a name in the notes is: a person in the network with that full name, else the one person on the call with that first name. */
function personNamed(state: State, venture: VentureRecord, name: string, onCall: readonly string[]) {
  const people = listPeople(state, venture.id);
  const folded = fold(name);
  if (!folded) return null;
  const exact = people.filter(person => fold(person.name) === folded);
  if (exact.length === 1) return exact[0];
  const first = people.filter(person => onCall.includes(person.id) && fold(person.name).split(' ')[0] === folded.split(' ')[0]);
  return first.length === 1 ? first[0] : null;
}

/** The open, saved card of a person, newest first; proposals act on a saved card only. */
function cardFor(cards: readonly Card[], personId: string): Card | null {
  return cards.filter(card => card.personId === personId && !CLOSED_STAGES.has(card.stage) && card.stored).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0] ?? null;
}

type CheckedStep = { text: string; personId: string | null; name: string | null; due: IsoDate | null; kind: 'step' | 'intro'; intro?: Intro };

/**
 * Code's checks on the answer: each item quotes the notes (folded, so case and punctuation do not matter), each name is
 * in the notes, a date is one the notes write and not before today, and a step's words hold no figure or amount the
 * notes do not. Items that fail are left out and counted.
 */
export function checkDigest(state: State, venture: VentureRecord, output: DigestOutput, input: { notes: string; today: IsoDate; onCall: readonly string[] }): { people: { name: string; personId: string | null }[]; steps: CheckedStep[]; leftOut: number } {
  const notes = fold(input.notes);
  const inNotes = (text: string) => { const folded = fold(text); return folded.length >= 2 && notes.includes(folded); };
  const written = datesWritten(input.notes, input.today, venture.country.dateOrder);
  const allowed = copiedTokens(input.notes);
  let leftOut = 0;
  const people: { name: string; personId: string | null }[] = [];
  for (const name of output.people) {
    const person = personNamed(state, venture, name, input.onCall);
    // A name the notes write, or someone on the call the notes name by their first name.
    const named = inNotes(name) || (!!person && input.onCall.includes(person.id) && inNotes(firstOf(person.name)));
    if (!named) { leftOut += 1; continue; }
    if (!people.some(item => fold(item.name) === fold(person?.name ?? name))) people.push({ name: person?.name ?? tidyWords(name), personId: person?.id ?? null });
  }
  const defaultPerson = input.onCall.length === 1 ? listPeople(state, venture.id).find(person => person.id === input.onCall[0]) ?? null : null;
  const steps: CheckedStep[] = [];
  const who = (name: string) => (name.trim() ? (inNotes(name) ? personNamed(state, venture, name, input.onCall) : undefined) : defaultPerson);
  for (const intro of output.intros) {
    const person = who(intro.person);
    if (!inNotes(intro.quote) || person === undefined || !inNotes(intro.introduce)) { leftOut += 1; continue; }
    const name = person?.name ?? tidyWords(intro.person);
    const text = intro.by === 'owner' ? `Introduce ${name} to ${tidyWords(intro.introduce)}` : `${name} said they would introduce you to ${tidyWords(intro.introduce)}`;
    steps.push({ text: text.slice(0, 200), personId: person?.id ?? null, name, due: null, kind: 'intro', intro });
  }
  for (const step of output.steps) {
    const person = who(step.person);
    const text = tidyWords(step.text).slice(0, 200);
    if (!text || !inNotes(step.quote) || person === undefined || statesMoney(text, input.notes) || modelNumbers(text, allowed)) { leftOut += 1; continue; }
    const due = step.date && written.has(step.date) && step.date >= input.today ? step.date : null;
    steps.push({ text, personId: person?.id ?? null, name: person?.name ?? (step.person.trim() ? tidyWords(step.person) : null), due, kind: 'step' });
  }
  return { people, steps, leftOut };
}

/** The people code finds in the notes by their full name, for an answer with no AI. */
function namesInNotes(state: State, venture: VentureRecord, notes: string, onCall: readonly string[]): { name: string; personId: string | null }[] {
  const folded = ` ${fold(notes)} `;
  return listPeople(state, venture.id).filter(person => onCall.includes(person.id) || (fold(person.name).includes(' ') && folded.includes(` ${fold(person.name)} `)))
    .map(person => ({ name: person.name, personId: person.id }));
}

const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/**
 * venture.meeting.digest { eventId?, notes } (prepare, inside the app): the owner's notes from a call, read for people,
 * intros and next steps as above. eventId: a call Today asked about (its people are who the notes are about, and Today
 * stops asking). With only templates, or an answer that fails Chausar's checks, nothing is drafted and code lists the
 * people it finds by name. Answers the people, the drafted proposals, and every step with its proposal or why none.
 */
export async function meetingDigest(deps: VentureDeps, ctx: Context, payload: unknown): Promise<MeetingDigestView> {
  requireAppChannel(ctx, 'venture.meeting.digest');
  const body = exactPayload(payload, ['eventId', 'notes'], ['notes']);
  const notes = plainText(body.notes, 'Your notes', { min: 1, max: 20_000 });
  check(secretFindings(notes).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(notes), 'CHAT_KEY_REFUSED', ID_REFUSED);
  const eventId = body.eventId === undefined ? null : identifier(body.eventId, 'eventId');
  const { state, venture } = readAs(deps, ctx, 'prepare');
  check(venture.country, 'INVALID_VENTURE_REQUEST', NO_COUNTRY);
  const feed = calendarFeedOf(state, venture.id);
  const event = eventId ? feed?.events.find(item => item.id === eventId) : undefined;
  check(!eventId || event, 'INVALID_VENTURE_REQUEST', 'That call is not one Chausar has from your calendar.');
  const screened = screenUntrusted({ source: 'client-file', text: notes }, { mode: 'enforce', released: screenSettingOf(state, venture.id).released }).text;
  check(screened !== null, 'UNTRUSTED_HELD', HELD_NOTES);
  const route = requireChatConsent(deps, ctx, state, venture);
  const today = localDayAt(deps.clock(), venture.country);
  const onCall = event?.personIds ?? [];
  const people = listPeople(state, venture.id);
  const callNames = onCall.map(id => people.find(person => person.id === id)?.name).filter((name): name is string => !!name);
  const task: ModelTask<DigestOutput> = {
    purpose: 'meeting-digest', instructions: DIGEST_INSTRUCTIONS, input: { notes: screened, call: { people: callNames }, today } as unknown as Json,
    schemaName: 'venture-meeting-digest', schema: DIGEST_SCHEMA, validate: validateDigest, containsClientData: true, maxOutputTokens: 1500,
  };
  const answered = await chatCall(deps, ctx, route, task);
  return ventureAction(deps, ctx, 'prepare', 'meeting.digest', tx => {
    const v = tx.venture!;
    // Today stops asking about this call once the owner has given notes.
    const current = calendarFeedOf(tx.state, v.id);
    if (current && eventId) tx.replace<CalendarFeedRecord>({ ...current, events: current.events.map(item => (item.id === eventId ? { ...item, notesAt: tx.now } : item)) });
    if (!answered) {
      tx.emit('queue.changed', {});
      return { people: namesInNotes(tx.state, v, screened, onCall), proposals: [], steps: [], line: route ? MEETING_WORDS.refused : MEETING_WORDS.template };
    }
    const checked = checkDigest(tx.state, v, answered.value, { notes: screened, today, onCall });
    const cards = cardsOf(tx.state, v, today);
    const drafted: ProposalRecord[] = [];
    const steps: MeetingDigestView['steps'] = [];
    // Every step and intro is a drafted proposal. With no day written in the notes, the owner gives the day when they
    // approve it on Today. For someone with no open card the proposal says so, and it cannot go to Today until they have one.
    let noCard = 0;
    for (const step of checked.steps) {
      const card = step.personId ? cardFor(cards, step.personId) : null;
      const name = card?.name ?? step.name ?? 'This person';
      const missing = MEETING_WORDS.noCard(name);
      let proposal: ProposalRecord;
      if (step.kind === 'intro') {
        const kind = step.intro!.by === 'owner' ? 'double-opt-in' : 'follow-up';
        proposal = draftProposal(tx, {
          kind: 'outreach-draft', source: 'meeting', title: (kind === 'double-opt-in' ? `Draft the intro you promised: ${step.text.replace(/^Introduce /, '')}` : `Draft a note to ${firstOf(name)} about the intro they promised`).slice(0, 160),
          line: card ? `From your notes after the call: "${step.intro!.quote.slice(0, 160)}"` : missing, input: { opportunityId: card?.stored?.id ?? null, kind, channel: 'email' },
        });
      } else {
        const line = !card ? missing
          : step.due ? `Due ${formatVentureDate(step.due, v.country.dateOrder)}, as your notes say. Approve it on Today to put it on ${firstOf(name)}'s card.`
            : `No day in your notes: give the day when you approve it on Today, and it goes on ${firstOf(name)}'s card.`;
        proposal = draftProposal(tx, {
          kind: 'next-step', source: 'meeting', title: `Next step for ${name}: ${step.text}`.slice(0, 160), line,
          input: { id: card?.stored?.id ?? null, text: step.text, due: step.due },
        });
      }
      drafted.push(proposal);
      if (!card) noCard += 1;
      steps.push({
        text: step.text, person: card?.name ?? step.name, due: step.due, proposalId: proposal.id,
        line: !card ? missing : step.kind === 'step' && !step.due ? MEETING_WORDS.noDate : MEETING_WORDS.drafted,
      });
    }
    const people = checked.people.length ? checked.people : namesInNotes(tx.state, v, screened, onCall);
    for (const id of onCall) {
      const person = listPeople(tx.state, v.id).find(item => item.id === id);
      if (person && !people.some(item => item.personId === id)) people.unshift({ name: person.name, personId: id });
    }
    const left = checked.leftOut ? ` ${checked.leftOut === 1 ? '1 item was' : `${checked.leftOut} items were`} left out: not in your notes as written, or with a figure your notes do not have.` : '';
    const waiting = noCard ? `; ${noCard} ${noCard === 1 ? 'needs' : 'need'} a card in your pipeline first` : '';
    const line = drafted.length
      ? `Drafted ${drafted.length === 1 ? '1 proposal' : `${drafted.length} proposals`} from your notes. Raise each to Today to approve it${waiting}.${left}`
      : `Nothing to draft from your notes.${left}`;
    tx.emit('queue.changed', {});
    return { people, proposals: drafted.map(record => proposalView(tx.state, v, record)), steps, line };
  });
}
