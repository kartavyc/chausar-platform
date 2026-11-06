/**
 * Reading a Tabs row (C1): the items in the row, and the ones under More. More is opened, read and closed again with
 * Escape, so the page is left as it was.
 */

import { act, fireEvent, within } from '@testing-library/react';

export type Pair = [string | null, string | null];

/** The row's own links, as [words, address]. */
export function rowLinks(nav: HTMLElement): Pair[] {
  return within(nav).getAllByRole('link').map((a): Pair => [a.textContent, a.getAttribute('href')]);
}

/** The links under More, as [words, address]; none when the row has no More. */
export async function moreLinks(nav: HTMLElement): Promise<Pair[]> {
  const more = within(nav).queryByRole('button', { name: 'More' });
  if (!more) return [];
  await act(async () => { fireEvent.click(more); });
  const list = document.getElementById(more.getAttribute('aria-controls')!)!;
  const links = within(list).getAllByRole('link');
  const read = links.map((a): Pair => [a.textContent, a.getAttribute('href')]);
  await act(async () => { fireEvent.keyDown(links[0]!, { key: 'Escape' }); });
  return read;
}
