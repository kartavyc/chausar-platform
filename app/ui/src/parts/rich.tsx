import { Fragment, type ReactNode } from 'react';
import type { T, TextValues } from '../text';

const MARK = '\u0000';

/**
 * A sentence from the text catalogue with some of its values drawn as elements: a name in bold, a version number in
 * DM Mono. The catalogue still owns the whole sentence and its word order (Hindi puts names elsewhere), so nothing
 * is glued from pieces here. Plain values (and `count`, which picks the plural form) go in as text; each element is
 * put back where its `{name}` stood. Everything stays text nodes and React elements, never markup.
 */
export function rich(t: T, key: string, text: TextValues, elements: Readonly<Record<string, ReactNode>>): ReactNode[] {
  const marked: Record<string, string | number> = { ...text };
  for (const name of Object.keys(elements)) marked[name] = `${MARK}${name}${MARK}`;
  return t(key, marked)
    .split(MARK)
    .map((part, index) => (index % 2 === 1 && part in elements ? <Fragment key={index}>{elements[part]}</Fragment> : part))
    .filter((part) => part !== '');
}
