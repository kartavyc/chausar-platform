/** Only the declared producer event union supplies these sentences. */
import type { TodayDayEvent } from '../bridge/today-engine.ts';
import type { DayEvent, Language } from '../app/presentation.ts';
import { time } from './dates.ts';
import en from '../text/en.json' with { type: 'json' };
import hi from '../text/hi.json' with { type: 'json' };

export function todayWords(language: Language, key: string, values: Readonly<Record<string, string>> = {}): string {
  const catalogue: Readonly<Record<string, string>> = language === 'hi' ? hi : en;
  const sentence = catalogue[`TODAY_ENGINE.${key}`] ?? catalogue['TODAY_ENGINE.unavailable'] ?? '';
  return sentence.replace(/\{([^}]+)\}/g, (token: string, name: string) => values[name] ?? token);
}
export function todayEvent(event: TodayDayEvent, timeZone: string, language: Language): DayEvent {
  let words: string, note: string;
  const actor = event.actor.kind === 'member' ? todayWords(language, 'actor', { id: event.actor.memberId }) : todayWords(language, 'actorMissing');
  switch (event.kind) {
    case 'source.imported':
      words = todayWords(language, 'event.source.imported'); note = `${todayWords(language, 'experimental')} · ${actor}`; break;
    case 'source.import-refused':
      words = todayWords(language, 'event.source.import-refused'); note = `${todayWords(language, 'experimental')} · ${actor}`; break;
    case 'calculation.completed':
      words = todayWords(language, 'event.calculation.completed'); note = [event.args.operation, ...(event.args.stale ? [todayWords(language, 'stale')] : []), actor].join(' · '); break;
    case 'action.prepared': case 'action.revised': case 'action.approved': case 'action.attempt': case 'action.settled': case 'action.reconciled': case 'action.cancelled': case 'action.interrupted':
      words = todayWords(language, `event.${event.kind}`); note = `${event.args.operation} · ${actor}`; break;
    case 'decision.created': case 'decision.revised': case 'decision.reviewed':
      words = todayWords(language, `event.${event.kind}`); note = actor; break;
    case 'job.delivered':
      words = todayWords(language, 'event.job.delivered'); note = `${todayWords(language, 'spentMinor', { value: event.args.spentMinor })} · ${actor}`; break;
    default: { const exhaustive: never = event; return exhaustive; }
  }
  return Object.freeze({ id: event.id, mark: event.kind === 'source.import-refused' || event.kind === 'action.interrupted' ? 'unsure' : 'cha', time: time(event.at, timeZone), words, note });
}
