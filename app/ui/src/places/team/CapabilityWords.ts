import words from '../../text/en/capability-words.json';

const copy: Readonly<Record<string, string>> = words;
/** Exact known engine copy only. Custom steps and changed live evidence stay verbatim. */
export function capabilityWords(t: (key: string) => string, key: string, current: string): string {
  const textKey = `capability-words.${key}`;
  return copy[textKey] === current ? t(textKey) : current;
}

export function capabilityPageWords(t: (key: string) => string, current: string): string {
  return capabilityWords(t, 'page.none', capabilityWords(t, 'page.team', current));
}
