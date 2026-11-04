import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * W4 4J19: Business > Decisions (catalogue O17): who decided each thing, when, on what rule and why, newest first, from
 * venture.decisions.list; a step a saved rule still lets run on its own offers "Stop always allowing", which sets that
 * step to wait for the owner (venture.team.gate { gate: 'hold' }). A decision made on Today shows here too.
 */

function start(hash: string) {
  window.location.hash = hash;
  const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
  const spy = vi.spyOn(client, 'request');
  render(<App client={client} language="en" />);
  return { client, spy };
}
const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });

afterEach(() => { window.location.hash = ''; });

describe('Business > Decisions', () => {
  it('is a page of the business menu that lists who decided each item, with Stop always allowing on a saved rule', async () => {
    const { spy } = start('#/business/decisions');
    expect(await screen.findByRole('heading', { level: 1, name: 'Decisions' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Decisions' }).getAttribute('href')).toBe('#/business/decisions');
    const list = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-decisions]');
      expect(found).not.toBeNull();
      return found!;
    });
    const row = within(list).getAllByRole('listitem')[0]!;
    expect(row.querySelector('[data-who]')!.textContent).toContain('A saved rule');
    expect(row.textContent).toContain("Allowed by your Auto setting on 'Cut the episode', without asking");
    expect(row.textContent).toContain("Rule: Your Auto setting on 'Cut the episode'");
    await waitFor(() => expect(within(row).getByRole('button', { name: 'Stop always allowing' })).toBeTruthy());
    assertInkRules(document.body);
    assertOnePrimary(document.body);

    await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Stop always allowing' })); });
    await settle();
    expect(spy.mock.calls.filter(([method]) => method === 'venture.team.gate').map(([, p]) => p)).toEqual([{ agentId: 'editor', stepId: 'cut', gate: 'hold' }]);
    expect(within(row).getByRole('status').textContent).toBe("'Cut the episode' waits for you again.");
    await waitFor(() => expect(within(row).queryByRole('button', { name: 'Stop always allowing' })).toBeNull());
  });

  it('a send back made on Today shows as the owner\'s, newest first', async () => {
    const { client } = start('#/business/decisions');
    const rows = (await client.request('venture.queue.list', { scope: 'all' })).rows;
    const draft = rows.find((row) => row.id === 'run:d-ep14:review-1')!;
    await client.request('venture.queue.sendBack', { rowId: draft.id, digest: draft.digest, text: 'Revise this to cut the intro' });
    await act(async () => { client.engine.emit({ type: 'queue.changed', businessId: 'lumen', at: '2026-10-23T10:00:00.000Z' }); });
    await settle();
    const first = await waitFor(() => {
      const found = document.querySelector<HTMLElement>('[data-decisions] li');
      expect(found?.querySelector('[data-who="owner"]')).not.toBeNull();
      return found!;
    });
    expect(first.querySelector('[data-who]')!.textContent).toContain('You');
    expect(first.textContent).toContain('Sent back with your words: Revise this to cut the intro');
  });

  // A4 review round 2: the eyebrow names who decided as the reader reads it: You for the reader's own, else the role,
  // and Chausar for its own note.
  it('names the reader as You, another member by their role, and Chausar for its own note', async () => {
    window.location.hash = '#/business/decisions';
    const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
    const real = client.request.bind(client);
    const one = (id: string, who: string, mine: boolean, line: string) => ({
      id, at: '2026-10-23T09:00:00.000Z', subject: `price:${id}`, action: 'accept', who, rule: null, ruleId: null, reason: line, line, by: mine || who !== 'chausar' ? id : null, agentId: null, mine,
    });
    const listed = { decisions: [
      one('d1', 'owner', true, 'You decided: Keep the price.'),
      one('d2', 'owner', false, 'The owner decided: Keep the price.'),
      one('d3', 'accountant', false, 'Your accountant decided: Keep the price.'),
      one('d4', 'chausar', false, 'This business uses the same AI as Pune Frames.'),
    ] };
    vi.spyOn(client, 'request').mockImplementation(((method: string, payload: unknown) => (method === 'venture.decisions.list' ? Promise.resolve(listed) : real(method as never, payload as never))) as never);
    render(<App client={client} language="en" />);
    const rows = await waitFor(() => {
      const found = [...document.querySelectorAll<HTMLElement>('[data-decisions] li')];
      expect(found.length).toBe(4);
      return found;
    });
    expect(rows.map((row) => row.querySelector('[data-who]')!.firstChild!.textContent)).toEqual(['You', 'The owner', 'Your accountant', 'Chausar']);
  });
});
