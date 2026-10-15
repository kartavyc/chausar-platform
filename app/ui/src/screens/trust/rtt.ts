/**
 * The lane's own words (app/ui/src/text/lanes/reports-tools-trust.ts) for the Keys, Machines and sync, Hosted
 * backup and "This computer" screens, read the way the Trust screens read their catalogues: by language,
 * without a provider, with `{name}` slots filled from plain text.
 */
import type { Language } from '../../app/presentation.ts';
import { words as laneWords } from '../../text/lanes/reports-tools-trust.ts';
import { fill } from './words.ts';

export type Say = (key: string, values?: Readonly<Record<string, string>>) => string;

export function rtt(language: Language): Say {
  const catalogue = laneWords[language] ?? laneWords.en;
  return (key, values) => {
    const sentence = catalogue[key] ?? laneWords.en[key] ?? key;
    return values === undefined ? sentence : fill(sentence, values);
  };
}
