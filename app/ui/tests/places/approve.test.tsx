// One approval in three places (Ink v2 wave 4, package 4G4; catalogue O11): Today, the run sheet and a standalone
// approval page. `#/approve/next` is where a phone alert's tap lands (public/sw.js): the oldest waiting approval as one
// card, the same ApprovalRow card as on Today with its second ask and view-before-approve, and "Next" once it is
// decided. `#/approve/<rowId>` shows that row, or says it was already decided. A run sheet over a run with several
// waiting items says "3 things need you (1 of 3)" and jumps between them.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { parseHash } from '../../src/shell/routes';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { QUEUE } from '../../src/engine/fixtures';
import type { QueueRow } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

type Seed = Omit<QueueRow, 'digest'>;

function start(hash: string, engine = new FakeEngine(), language: 'en' | 'hi' = 'en') {
  window.location.hash = hash;
  render(<App client={createFakeClient(engine)} language={language} />);
  return engine;
}
const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const cards = () => [...screen.getByRole('main').querySelectorAll<HTMLElement>('article[data-row-id]')];
const locked = (button: HTMLElement) => button.getAttribute('aria-disabled') === 'true';

describe('the approval page\'s address', () => {
  it('reads next, or a row id as the engine spells it; anything else has no row', () => {
    expect(parseHash('#/approve/next')).toEqual({ place: 'approve', sub: 'next', query: {} });
    expect(parseHash('#/approve/run:R_1:q2')).toEqual({ place: 'approve', sub: 'run:R_1:q2', query: {} });
    expect(parseHash('#/approve/run%3AR_1%3Aq2')).toEqual({ place: 'approve', sub: 'run:R_1:q2', query: {} });
    expect(parseHash('#/approve/<b>')).toEqual({ place: 'approve', query: {} });
  });
});

describe('#/approve/next', () => {
  it('shows the oldest waiting approval as one card, locked until the owner reads it', async () => {
    start('#/approve/next');
    expect(await screen.findByRole('heading', { level: 1, name: 'Needs you' })).toBeTruthy();
    await waitFor(() => expect(cards()).toHaveLength(1));
    const card = cards()[0]!;
    expect(card.getAttribute('data-row-id')).toBe('q-plan');
    expect(within(card).getByRole('heading', { name: 'Your plan is ready. Read it.' })).toBeTruthy();
    expect(locked(within(card).getByRole('button', { name: 'Accept' }))).toBe(true);
    expect(screen.getByRole('main').textContent).toContain('1 of 11');
    assertInkRules(document.body);
  });

  it('after a decision, "Next" brings the next oldest; the last one says nothing else needs you', async () => {
    const rows = QUEUE.filter((row) => row.id === 'q-price-sponsor' || row.id === 'q-quote-iyer') as Seed[];
    start('#/approve/next', new FakeEngine({ queue: rows }));
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-price-sponsor'));
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: 'Approve' }));
    expect(cards()[0]!.textContent).toContain("This can't be undone. Approve?");
    await act(async () => { fireEvent.click(within(cards()[0]!).getAllByRole('button', { name: 'Approve' }).at(-1)!); });
    await waitFor(() => expect(cards()[0]!.hasAttribute('data-decided')).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-quote-iyer'));
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: 'Deny' }));
    await waitFor(() => expect(cards()[0]!.hasAttribute('data-decided')).toBe(true));
    expect(await screen.findByText('That was the last one. Nothing else needs you now.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('#/today');
  });

  it('with nothing waiting, it says so and points to Today', async () => {
    start('#/approve/next', new FakeEngine({ queue: QUEUE.filter((row) => row.kind === 'locked') as Seed[] }));
    expect(await screen.findByText('Nothing needs you right now.')).toBeTruthy();
    expect(cards()).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'Go to Today' }).getAttribute('href')).toBe('#/today');
  });
});

describe('#/approve/<rowId>', () => {
  it('shows that row, decided the same way as on Today', async () => {
    start('#/approve/post:linkedin-ep13:v1');
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('post:linkedin-ep13:v1'));
    expect(locked(within(cards()[0]!).getByRole('button', { name: 'Approve and post' }))).toBe(true);
  });

  it('a row no longer waiting: "This one was already decided." and the way to the next one', async () => {
    start('#/approve/q-gone');
    expect(await screen.findByText('This one was already decided.')).toBeTruthy();
    expect(cards()).toHaveLength(0);
    expect(screen.getByRole('link', { name: 'See the next one' }).getAttribute('href')).toBe('#/approve/next');
    await go('#/approve/next');
    await waitFor(() => expect(cards()).toHaveLength(1));
  });

  it('in Hindi', async () => {
    start('#/approve/q-gone', new FakeEngine(), 'hi');
    expect(await screen.findByText('इस पर फ़ैसला पहले ही हो चुका है।')).toBeTruthy();
  });
});

describe('the approval page: every answer the engine can give', () => {
  /** A client whose queue.decide answers as given (the rest is the fake's), and which hears no events. */
  function quiet(engine: FakeEngine, answer?: (params: { id: string }) => unknown) {
    const client = createFakeClient(engine);
    const request = client.request.bind(client);
    client.request = (async (method: string, params?: unknown) => (method === 'venture.queue.decide' && answer
      ? answer(params as { id: string })
      : request(method as never, params as never))) as typeof client.request;
    client.subscribe = () => () => {};
    return client;
  }
  const show = (hash: string, client: ReturnType<typeof createFakeClient>) => { window.location.hash = hash; render(<App client={client} language="en" />); };
  const confirmApprove = async () => {
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: 'Approve' }));
    await act(async () => { fireEvent.click(within(cards()[0]!).getAllByRole('button', { name: 'Approve' }).at(-1)!); });
  };

  it('a setup step asked for by id shows with its own place action, never "already decided"', async () => {
    start('#/approve/q-setup-ai');
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-setup-ai'));
    expect(screen.queryByText('This one was already decided.')).toBeNull();
    fireEvent.click(within(cards()[0]!).getByRole('button', { name: 'Connect' }));
    await waitFor(() => expect(window.location.hash).toBe('#/connections'));
  });

  it('stale: the page keeps showing the newer version the engine handed back, undecided', async () => {
    const engine = new FakeEngine({ queue: QUEUE.filter((row) => row.id === 'q-price-sponsor' || row.id === 'q-quote-iyer') as Seed[] });
    show('#/approve/next', quiet(engine));
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-price-sponsor'));
    engine.touch('q-price-sponsor');
    await confirmApprove();
    await waitFor(() => expect(cards()[0]!.textContent).toContain('Updated after the client replied.'));
    expect(cards()[0]!.hasAttribute('data-decided')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('VIEW_FIRST: the refusal shows on the card, which stays to decide', async () => {
    const engine = new FakeEngine({ queue: QUEUE.filter((row) => row.id === 'q-price-sponsor' || row.id === 'q-quote-iyer') as Seed[] });
    show('#/approve/next', quiet(engine, () => ({ outcome: 'refused', reason: 'VIEW_FIRST', line: 'Open it and read it first.' })));
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-price-sponsor'));
    await confirmApprove();
    await waitFor(() => expect(cards()[0]!.textContent).toContain('Open it and read it first.'));
    expect(cards()[0]!.hasAttribute('data-decided')).toBe(false);
    expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
  });

  it('ALREADY_DECIDED: the card says it was decided elsewhere, and Next moves on', async () => {
    const engine = new FakeEngine({ queue: QUEUE.filter((row) => row.id === 'q-price-sponsor' || row.id === 'q-quote-iyer') as Seed[] });
    show('#/approve/next', quiet(engine, () => ({ outcome: 'refused', reason: 'ALREADY_DECIDED', line: 'You decided this already.' })));
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-price-sponsor'));
    await confirmApprove();
    await waitFor(() => expect(cards()[0]!.hasAttribute('data-decided')).toBe(true));
    fireEvent.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(cards()[0]?.getAttribute('data-row-id')).toBe('q-quote-iyer'));
  });
});

describe('the run sheet with several waiting items', () => {
  const question = QUEUE.find((row) => row.id === 'q-question-preview')! as Seed;
  const several: Seed[] = [
    { ...question, id: 'q-run29-a', title: 'Which sponsor read?', createdAt: '2026-10-21T09:50:00.000Z' },
    { ...question, id: 'q-run29-b', title: 'Share the preview?', createdAt: '2026-10-21T09:58:00.000Z' },
    { ...question, id: 'q-run29-c', title: 'Which thumbnail?', createdAt: '2026-10-21T10:01:00.000Z' },
  ];

  it('says "3 things need you (1 of 3)" and jumps between them, each one decided on the approval page', async () => {
    start('#/work?sheet=run:29', new FakeEngine({ queue: several }));
    const banner = await screen.findByRole('region', { name: '3 things need you (1 of 3)' });
    // The title in view is said again when Previous or Next changes it.
    expect(within(banner).getByText('Which sponsor read?').getAttribute('aria-live')).toBe('polite');
    expect(within(banner).getByRole('link', { name: 'Decide this one' }).getAttribute('href')).toBe('#/approve/q-run29-a');
    expect((within(banner).getByRole('button', { name: 'Previous' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(within(banner).getByRole('button', { name: 'Next' }));
    const second = await screen.findByRole('region', { name: '3 things need you (2 of 3)' });
    expect(within(second).getByText('Share the preview?')).toBeTruthy();
    expect(within(second).getByRole('link', { name: 'Decide this one' }).getAttribute('href')).toBe('#/approve/q-run29-b');
    fireEvent.click(within(second).getByRole('button', { name: 'Next' }));
    const third = await screen.findByRole('region', { name: '3 things need you (3 of 3)' });
    expect((within(third).getByRole('button', { name: 'Next' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('one waiting item needs no banner', async () => {
    start('#/work?sheet=run:29');
    await screen.findByRole('heading', { name: /./, level: 2 });
    await waitFor(() => expect(screen.queryByText(/things need you \(/)).toBeNull());
  });
});
