import type { ReactNode } from 'react';
import { useLanguage, useT } from '../../text';
import { useResource } from '../../engine/context';
import { useClock } from '../../shell/clock';
import { PageTitle } from '../../parts/PageTitle';

/**
 * The greeting for an hour of this computer's clock: morning from 5 to 11, afternoon from 12 to 16, evening from 17
 * until 4 at night. The owner's first name joins it once the engine keeps one (W4 4J21, venture.owner.get from 4J9).
 */
export function greetingKey(hour: number): string {
  if (hour >= 5 && hour < 12) return 'today.greeting.morning';
  if (hour >= 12 && hour < 17) return 'today.greeting.afternoon';
  return 'today.greeting.evening';
}

const never = () => false;

/** "Friday, 23 October" in the reader's language, from the clock. */
function dayOf(now: Date, language: string): string {
  return new Intl.DateTimeFormat(language === 'hi' ? 'hi-IN' : 'en-IN', { weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

/**
 * Today's header (D's `header.phead`): the date as the eyebrow, the greeting as the page title, and one line under it,
 * the engine's summary of what needs the owner and how many agents are working, the count in bold.
 */
export function Greeting({ line, count }: { line?: ReactNode; count?: string | undefined }) {
  const t = useT();
  const language = useLanguage();
  const now = useClock()();
  // W4 4J21: "Good evening, Kartavy" once the owner set a first name under Business, About you; without one, or until
  // the engine answers, the greeting alone.
  const owner = useResource('venture.owner.get', {}, { refreshOn: never });
  const name = owner.data?.firstName;
  const key = greetingKey(now.getHours());
  return <PageTitle eyebrow={dayOf(now, language)} title={name ? t(`${key}Named`, { name }) : t(key)} line={line} count={count} />;
}
