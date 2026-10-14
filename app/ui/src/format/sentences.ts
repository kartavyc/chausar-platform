/**
 * Sentences for the activity list and the job time line (TD-04; builders part 7, Text).
 *
 * The engine sends typed events and no prose. Each event type has its own function here,
 * in both languages: it reads only the values it names and fills one complete template
 * from the text file. Values are data (names and ids as written, digits): they are never
 * translated, never used as keys and never become markup. A value the event did not carry
 * reads as its missing words, never as a blank or a zero. An event type this screen does
 * not know yet gets the fallback sentence, which names the type code as data.
 */

import type { Language } from '../app/presentation.ts';
import type { ActivityEvent } from '../bridge/todayx-contract.ts';
import { count } from './counts.ts';
import en from '../text/en.json' with { type: 'json' };
import hi from '../text/hi.json' with { type: 'json' };

type Values = Readonly<Record<string, string>>;

/** One complete template from the shared catalogue, with `{name}` values filled as text. */
export function catalogueText(language: Language, key: string, values: Values = {}): string {
  const catalogue: Readonly<Record<string, string>> = language === 'hi' ? hi : en;
  const template = catalogue[key];
  if (template === undefined) throw new TypeError(`TEXT_KEY_MISSING ${key}`);
  return template.replace(/\{([A-Za-z][A-Za-z0-9]*)\}/g, (token: string, name: string) => values[name] ?? token);
}

/** The event types the engine module emits. A type outside this list is shown by the fallback. */
export const ACTIVITY_SENTENCE_TYPES = [
  'source.read', 'source.refused', 'import.done', 'model.request', 'answer.receipt',
  'action.prepared', 'action.approved', 'action.done', 'action.read-back', 'action.unknown',
  'job.step', 'job.stopped', 'dictionary.published', 'lesson.decided', 'backup.done',
  'update.checked', 'member.joined', 'lock', 'unlock',
] as const;
export type ActivitySentenceType = (typeof ACTIVITY_SENTENCE_TYPES)[number];

/** What a sentence function reads: the event's plain values and its route. */
export interface SentenceInput {
  readonly values: Values;
  readonly route: string | null;
}

type SentenceFn = (input: SentenceInput, language: Language) => string;

const missing = (language: Language) => catalogueText(language, 'TD-04.missing');
/** A value as written, or its missing words. */
const asWritten = (input: SentenceInput, name: string, language: Language) => {
  const value = input.values[name];
  return value !== undefined && value.trim().length > 0 ? value : missing(language);
};
/** A whole count from exact digits, with Indian grouping, or its missing words. */
const digits = (input: SentenceInput, name: string, language: Language) => {
  const value = input.values[name];
  return value !== undefined && /^(0|[1-9][0-9]{0,30})$/.test(value) ? count(value) : missing(language);
};
const say = (language: Language, type: string, values: Values = {}) => catalogueText(language, `TD-04.event.${type}`, values);

function sourceRead(input: SentenceInput, language: Language) { return say(language, 'source.read', { source: asWritten(input, 'source', language) }); }
function sourceRefused(input: SentenceInput, language: Language) { return say(language, 'source.refused', { source: asWritten(input, 'source', language) }); }
function importDone(input: SentenceInput, language: Language) { return say(language, 'import.done', { rows: digits(input, 'rows', language), source: asWritten(input, 'source', language) }); }
function modelRequest(input: SentenceInput, language: Language) {
  const route = input.route !== null && input.route.trim().length > 0 ? input.route : asWritten(input, 'route', language);
  return say(language, 'model.request', { route });
}
function answerReceipt(_input: SentenceInput, language: Language) { return say(language, 'answer.receipt'); }
function actionPrepared(input: SentenceInput, language: Language) { return say(language, 'action.prepared', { action: asWritten(input, 'action', language) }); }
function actionApproved(input: SentenceInput, language: Language) { return say(language, 'action.approved', { action: asWritten(input, 'action', language) }); }
function actionDone(input: SentenceInput, language: Language) { return say(language, 'action.done', { action: asWritten(input, 'action', language) }); }
function actionReadBack(input: SentenceInput, language: Language) { return say(language, 'action.read-back', { action: asWritten(input, 'action', language), system: asWritten(input, 'system', language) }); }
function actionUnknown(input: SentenceInput, language: Language) { return say(language, 'action.unknown', { action: asWritten(input, 'action', language) }); }
function jobStep(input: SentenceInput, language: Language) { return say(language, 'job.step', { job: asWritten(input, 'job', language) }); }
/** When the rule that stopped the job is the budget, the reason says "the budget". */
function jobStopped(input: SentenceInput, language: Language) {
  return say(language, input.values['rule'] === 'budget' ? 'job.stopped.budget' : 'job.stopped', { job: asWritten(input, 'job', language) });
}
function dictionaryPublished(input: SentenceInput, language: Language) { return say(language, 'dictionary.published', { version: asWritten(input, 'version', language) }); }
function lessonDecided(input: SentenceInput, language: Language) { return say(language, 'lesson.decided', { lesson: asWritten(input, 'lesson', language) }); }
function backupDone(_input: SentenceInput, language: Language) { return say(language, 'backup.done'); }
function updateChecked(_input: SentenceInput, language: Language) { return say(language, 'update.checked'); }
function memberJoined(input: SentenceInput, language: Language) { return say(language, 'member.joined', { name: asWritten(input, 'name', language) }); }
function lock(_input: SentenceInput, language: Language) { return say(language, 'lock'); }
function unlock(_input: SentenceInput, language: Language) { return say(language, 'unlock'); }

export const ACTIVITY_SENTENCES: Readonly<Record<ActivitySentenceType, SentenceFn>> = {
  'source.read': sourceRead,
  'source.refused': sourceRefused,
  'import.done': importDone,
  'model.request': modelRequest,
  'answer.receipt': answerReceipt,
  'action.prepared': actionPrepared,
  'action.approved': actionApproved,
  'action.done': actionDone,
  'action.read-back': actionReadBack,
  'action.unknown': actionUnknown,
  'job.step': jobStep,
  'job.stopped': jobStopped,
  'dictionary.published': dictionaryPublished,
  'lesson.decided': lessonDecided,
  'backup.done': backupDone,
  'update.checked': updateChecked,
  'member.joined': memberJoined,
  lock,
  unlock,
};

export function isActivitySentenceType(type: string): type is ActivitySentenceType {
  return Object.prototype.hasOwnProperty.call(ACTIVITY_SENTENCES, type);
}

/** The fallback for a type this screen does not know: it names the type code as data. */
export function otherEventSentence(type: string, language: Language): string {
  return say(language, 'other', { type });
}

/** The one sentence for a typed event, in this language. */
export function activitySentence(event: Pick<ActivityEvent, 'type' | 'values' | 'route'>, language: Language): string {
  const input: SentenceInput = { values: event.values, route: event.route };
  return isActivitySentenceType(event.type) ? ACTIVITY_SENTENCES[event.type](input, language) : otherEventSentence(event.type, language);
}
