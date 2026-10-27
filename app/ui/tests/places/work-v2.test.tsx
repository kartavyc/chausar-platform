import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { ClockProvider } from '../../src/shell/clock';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { DeliveryLite, MethodName, QueueRow, RunDetail, RunSummary } from '../../src/engine/types';
import s from '../../src/places/work/Work.module.css';
import { assertInkRules, receiptMark } from '../helpers/ink-rules';

/*
 * Work in the direction D look (w3 package 3E1, docs/superpowers/designs/ink-v2-direction-d/D-Work.dc.html): filter
 * chips held in the address, Running now as tiles with rings, the failed run with what went wrong and Run again,
 * Finished, and orders grouped by client. Only what the engine sends is drawn: no Stop, no order stage steps and no
 * frames until W4 (4F, 4J).
 */

type Call = { method: string; params: unknown };
/** An intercept answers in the engine's place; `real` asks the engine itself, to change what it sends. */
type Intercept = (params: unknown, real: () => Promise<unknown>) => unknown;
interface StartOptions { language?: 'en' | 'hi'; intercept?: Partial<Record<MethodName, Intercept>> }

/** Friday 23 October 2026, 19:05 in India. */
const NOW = () => new Date('2026-10-23T19:05:00.000+05:30');

async function start(hash = '#/work', options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params, () => request(method, params as never)));
    return request(method, params as never);
  }) as typeof client.request;
  render(<ClockProvider now={NOW}><App client={client} language={options.language ?? 'en'} /></ClockProvider>);
  await screen.findByRole('heading', { level: 1 });
  return { engine, client, calls };
}

const go = async (hash: string) => { await act(async () => { window.location.hash = hash; window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const settle = async () => { for (let i = 0; i < 3; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const tileOf = async (text: string, scope: HTMLElement = document.body) => (await within(scope).findByText(text)).closest('li')!;
const click = async (element: Element) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); };
const pressed = (group: HTMLElement) => within(group).getAllByRole('button').filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent);
const decides = (calls: Call[]) => calls.filter((c) => c.method === 'venture.queue.decide').map((c) => c.params);

/** The engine's runs, with more of them after its own. */
const withRuns = (...more: RunSummary[]): Intercept => async (_params, real) => {
  const sent = (await real()) as { runs: RunSummary[] };
  return { ...sent, runs: [...sent.runs, ...more] };
};
/** Today's rows, with the thumbnail run's Run again action changed as given. */
const withAgain = (change: Partial<QueueRow['actions'][number]>): Intercept => async (_params, real) => {
  const sent = (await real()) as { rows: QueueRow[] };
  const rows = sent.rows.map((row) => (row.id !== 'q-run-again-thumbs' ? row : { ...row, actions: row.actions.map((a) => (a.id === 'run-again' ? { ...a, ...change } : a)) }));
  return { ...sent, rows };
};
const doneRun = (runId: string, purpose: string): RunSummary => ({
  runId, businessId: 'lumen', agent: 'Editor', purpose, state: 'done', startedAt: '2026-10-20T07:00:00.000Z', elapsed: '3m', result: 'Done.', receiptId: 'R-0412',
});

/**
 * The colour Work.module.css gives an element with these classes (their local names), by the plain cascade among
 * rules made only of classes: more classes win, then the later rule. At-rules (@container, @media) are left out.
 * jsdom draws no stylesheet, so this reads the cascade from the file the way a browser would for these selectors.
 */
function colourOf(classes: readonly string[]): string | undefined {
  const css = readFileSync(join(import.meta.dirname, '../../src/places/work/Work.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  let won: { weight: number; colour: string } | undefined;
  let at = 0;
  while (at < css.length) {
    const open = css.indexOf('{', at);
    if (open < 0) break;
    const selector = css.slice(at, open).trim();
    let depth = 1;
    let end = open + 1;
    for (; end < css.length && depth > 0; end++) {
      if (css[end] === '{') depth++;
      else if (css[end] === '}') depth--;
    }
    const body = css.slice(open + 1, end - 1);
    at = end;
    if (selector.startsWith('@')) continue;
    const colour = /(?:^|;)\s*color\s*:\s*([^;]+)/.exec(body)?.[1]?.trim();
    if (!colour) continue;
    for (const one of selector.split(',').map((x) => x.trim())) {
      if (!/^(\.[A-Za-z][\w-]*)+$/.test(one)) continue;
      const parts = one.slice(1).split('.');
      if (parts.every((part) => classes.includes(part)) && (!won || parts.length >= won.weight)) won = { weight: parts.length, colour };
    }
  }
  return won?.colour;
}

describe('Work v2: the filter chips', () => {
  it('say what is shown, keep it in the address, and the failed address presses Failed', async () => {
    await start('#/work?state=failed');
    const show = screen.getByRole('group', { name: 'Show' });
    // An engine-failed run is "Failed"; "Stopped" is kept for the owner's own Stop (W4 4F).
    // Ink v2 wave 5 (5A3): Ideas, the idea pipeline, after D's chips.
    expect(within(show).getAllByRole('button').map((b) => b.textContent)).toEqual(['All', 'Needs you', 'Running', 'Failed', 'Done', 'Ideas']);
    expect(pressed(show)).toEqual(['Failed']);
    await click(within(show).getByRole('button', { name: 'Running' }));
    expect(window.location.hash).toBe('#/work?state=active');
    expect(pressed(screen.getByRole('group', { name: 'Show' }))).toEqual(['Running']);
    await click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'Needs you' }));
    expect(window.location.hash).toBe('#/work?state=waiting');
    await click(within(screen.getByRole('group', { name: 'Show' })).getByRole('button', { name: 'All' }));
    expect(window.location.hash).toBe('#/work');
    expect(pressed(screen.getByRole('group', { name: 'Show' }))).toEqual(['All']);
  });

  it('offers a chip per business only when runs come from more than one, and a chosen business shows only its runs', async () => {
    await start();
    const businesses = await screen.findByRole('group', { name: 'Business' });
    expect(within(businesses).getAllByRole('button').map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'false']);
    expect(within(businesses).getByRole('button', { name: 'Lumen Studio' })).toBeTruthy();
    await click(within(businesses).getByRole('button', { name: 'Ledgerline' }));
    expect(window.location.hash).toBe('#/work?business=ledgerline');
    expect(await screen.findByText('Matched September bank lines to invoices')).toBeTruthy();
    expect(screen.queryByText('Cutting shorts from episode 13')).toBeNull();
    expect(screen.queryByText('Rendering the thumbnail set')).toBeNull();
    // Orders belong to the business that is open (Lumen Studio), so they are not Ledgerline's.
    expect(screen.queryByRole('region', { name: 'Orders' })).toBeNull();
    await click(within(screen.getByRole('group', { name: 'Business' })).getByRole('button', { name: 'Ledgerline' }));
    expect(window.location.hash).toBe('#/work');
  });

  it('draws no business chips when every run is from one business', async () => {
    const engine = new FakeEngine();
    const lumen = ((await engine.request('venture.runs.list', { state: 'all' })) as { runs: RunSummary[] }).runs.filter((r) => r.businessId === 'lumen');
    await start('#/work', { intercept: { 'venture.runs.list': () => ({ runs: lumen }) } });
    await screen.findByRole('region', { name: 'Running now' });
    expect(screen.queryByRole('group', { name: 'Business' })).toBeNull();
  });
});

describe('Work v2: running now', () => {
  it('draws one tile per active or waiting run: avatar, agent, business, ring, purpose, the current step and the run line', async () => {
    await start();
    const running = await screen.findByRole('region', { name: 'Running now' });
    const editor = await tileOf('Cutting shorts from episode 13', running);
    expect(within(editor).getByRole('heading', { level: 3, name: 'Cutting shorts from episode 13' })).toBeTruthy();
    expect(within(editor).getByRole('img', { name: '3 of 5 steps done' })).toBeTruthy();
    expect(editor.querySelector('[data-state="working"]')?.textContent).toBe('ED');
    expect(within(editor).getByText('Editor')).toBeTruthy();
    expect(within(editor).getByText('Lumen Studio')).toBeTruthy();
    expect(await within(editor).findByText('Rendering 3 of 6')).toBeTruthy();
    expect(within(editor).getByText('Run 31 · 4m').className).toMatch(/mono/);
    const researcher = await tileOf('Checking titles against the last 30 videos', running);
    expect(within(researcher).getByRole('img', { name: 'Working, no step count yet' })).toBeTruthy();
    expect(await within(researcher).findByText('Comparing the two new titles')).toBeTruthy();
    expect(within(running).getAllByRole('listitem')).toHaveLength(3);
    assertInkRules();
  });

  it('a run that waits says which step waits, shows its question, and Answer (the one primary) opens the run', async () => {
    await start();
    const running = await screen.findByRole('region', { name: 'Running now' });
    const producer = await tileOf('Pricing the sponsor slot', running);
    expect(within(producer).getByRole('img', { name: '2 of 3 steps done, waiting on you' })).toBeTruthy();
    expect(producer.querySelector('[data-state="waiting"]')?.textContent).toBe('PR');
    expect((await within(producer).findByText('2 of 3 done, waits on you')).className).toMatch(/wait/);
    expect(within(producer).getByText('The sponsor wants to see the video before it goes up. Share a private preview link with them?')).toBeTruthy();
    const answer = within(producer).getByRole('button', { name: 'Answer' });
    expect(answer.getAttribute('data-variant')).toBe('primary');
    await click(answer);
    expect(window.location.hash).toBe('#/work?sheet=run%3A29');
    expect(await screen.findByRole('complementary', { name: 'Pricing the sponsor slot' })).toBeTruthy();
  });

  it('a run that waits with no question offers a plain Open, not Answer', async () => {
    await start('#/work', {
      intercept: {
        'venture.runs.get': async (params, real) => {
          const run = (await real()) as RunDetail;
          if ((params as { runId: string }).runId !== '29') return run;
          const { question: _none, ...rest } = run;
          return rest;
        },
      },
    });
    const running = await screen.findByRole('region', { name: 'Running now' });
    const producer = await tileOf('Pricing the sponsor slot', running);
    expect(await within(producer).findByText('2 of 3 done, waits on you')).toBeTruthy();
    expect(within(producer).queryByRole('button', { name: 'Answer' })).toBeNull();
    const open = within(producer).getByRole('button', { name: 'Open' });
    expect(open.getAttribute('data-variant')).not.toBe('primary');
    await click(open);
    expect(window.location.hash).toBe('#/work?sheet=run%3A29');
  });

  it('the section head leaves the counts to the sub line, which already says them (W4 4F3 review)', async () => {
    await start();
    const running = await screen.findByRole('region', { name: 'Running now' });
    await settle();
    expect(within(running).queryByText('3 running · 1 failed')).toBeNull();
    expect(screen.getByText(/runs going and 1 failed\./)).toBeTruthy();
  });

  it('offers Stop on each running tile now that the engine has run controls (W4 4F3); Force stop and Resume wait until asked', async () => {
    await start();
    const running = await screen.findByRole('region', { name: 'Running now' });
    await settle();
    expect(within(running).getAllByRole('button', { name: /^Stop run \d+$/ }).length).toBe(3);
    // Force stop sits behind Stop, and Resume only on a stopped run: nothing is stopped at rest.
    for (const name of [/^Force stop/, /^Resume/]) expect(screen.queryByRole('button', { name })).toBeNull();
  });
});

describe('Work v2: the failed run', () => {
  it('says where it failed and what went wrong in the engine words, lists the steps, and runs it again through the engine', async () => {
    const { client, calls } = await start();
    const stopped = await tileOf('Rendering the thumbnail set');
    expect(screen.getByRole('region', { name: 'Failed' }).contains(stopped)).toBe(true);
    expect(within(stopped).getByRole('heading', { level: 3, name: 'Rendering the thumbnail set' })).toBeTruthy();
    expect(await within(stopped).findByText('Failed at step 2 of 3')).toBeTruthy();
    expect(within(stopped).getByText('Editor · Lumen Studio · run 28 · 40s')).toBeTruthy();
    expect(within(stopped).getByText('What went wrong')).toBeTruthy();
    expect(within(stopped).getByText('The renderer stopped: ffmpeg was not found on this computer.')).toBeTruthy();
    const steps = within(stopped).getByRole('list', { name: 'Steps' });
    expect(within(steps).getAllByRole('listitem').map((li) => li.getAttribute('data-state'))).toEqual(['done', 'failed', 'pending']);
    // W4 4F3: the engine's fix for a missing ffmpeg (fixOf), one step away.
    expect(within(stopped).getByRole('button', { name: 'How to fix it' }).getAttribute('data-variant')).not.toBe('primary');
    const again = within(stopped).getByRole('button', { name: 'Run again' });
    expect(again.getAttribute('data-variant')).toBe('primary');
    assertInkRules();
    // The digest of the row as Work read it: a row that changed since is the engine's to refuse.
    const { rows } = await client.request('venture.queue.list', { scope: 'all' });
    const digest = rows.find((row) => row.id === 'q-run-again-thumbs')!.digest;
    await act(async () => { fireEvent.click(again); });
    expect(decides(calls)).toEqual([expect.objectContaining({ id: 'q-run-again-thumbs', digest, action: 'run-again' })]);
    const running = screen.getByRole('region', { name: 'Running now' });
    await waitFor(() => expect(within(running).getByText('Rendering the thumbnail set')).toBeTruthy());
  });

  it("uses the action's own label, and asks once more first when the engine says so", async () => {
    const { calls } = await start('#/work', { intercept: { 'venture.queue.list': withAgain({ label: 'Try again', secondAsk: true }) } });
    const stopped = await tileOf('Rendering the thumbnail set');
    const again = await within(stopped).findByRole('button', { name: 'Try again' });
    expect(within(stopped).queryByRole('button', { name: 'Run again' })).toBeNull();
    await act(async () => { fireEvent.click(again); });
    expect(decides(calls)).toEqual([]);
    expect(within(stopped).getByText("This can't be undone. Try again?")).toBeTruthy();
    const notNow = within(stopped).getByRole('button', { name: 'Not now' });
    expect(document.activeElement).toBe(notNow);
    assertInkRules();
    await act(async () => { fireEvent.click(notNow); });
    expect(within(stopped).queryByText("This can't be undone. Try again?")).toBeNull();
    expect(decides(calls)).toEqual([]);
    await act(async () => { fireEvent.click(within(stopped).getByRole('button', { name: 'Try again' })); });
    const confirm = within(stopped).getByRole('button', { name: 'Try again' });
    expect(confirm.hasAttribute('data-confirm')).toBe(true);
    await act(async () => { fireEvent.click(confirm); });
    expect(decides(calls)).toEqual([expect.objectContaining({ id: 'q-run-again-thumbs', digest: expect.any(String), action: 'run-again' })]);
  });

  it('stays locked until the run is opened when the engine wants it looked at first, then says it was', async () => {
    const { calls } = await start('#/work', { intercept: { 'venture.queue.list': withAgain({ requiresView: true }) } });
    const stopped = await tileOf('Rendering the thumbnail set');
    const again = await within(stopped).findByRole('button', { name: /^Run again/ });
    expect(again.getAttribute('aria-disabled')).toBe('true');
    expect(within(stopped).getByText('Run again unlocks after you open it')).toBeTruthy();
    await act(async () => { fireEvent.click(again); });
    expect(decides(calls)).toEqual([]);
    await click(within(stopped).getByRole('button', { name: 'Rendering the thumbnail set' }));
    expect(await screen.findByRole('complementary', { name: 'Rendering the thumbnail set' })).toBeTruthy();
    const open = within(stopped).getByRole('button', { name: /^Run again/ });
    expect(open.hasAttribute('aria-disabled')).toBe(false);
    await act(async () => { fireEvent.click(open); });
    expect(decides(calls)).toEqual([expect.objectContaining({ id: 'q-run-again-thumbs', action: 'run-again', viewed: true })]);
  });

  it('a failed run a newer run of its order replaced is left out of All, and the Failed chip still shows it', async () => {
    const old: RunSummary = { runId: '25', businessId: 'lumen', agent: 'Writer', purpose: 'First go at the episode 12 script', state: 'failed', startedAt: '2026-10-02T10:00:00.000Z', elapsed: '1m', result: 'The model did not answer.' };
    const replaced: DeliveryLite = { id: '25', at: '2026-10-02T10:00:00.000Z', orderId: 'o-boat-12', status: 'failed', practice: false, deliverable: null, verdict: null };
    await start('#/work', {
      intercept: {
        'venture.runs.list': withRuns(old),
        'venture.delivery.list': async (_params, real) => [...((await real()) as DeliveryLite[]), replaced],
      },
    });
    const failed = await screen.findByRole('region', { name: 'Failed' });
    await tileOf('Rendering the thumbnail set', failed);
    await settle();
    expect(within(failed).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Rendering the thumbnail set']);
    expect(screen.queryByText('First go at the episode 12 script')).toBeNull();
    await go('#/work?state=failed');
    expect(await screen.findByText('First go at the episode 12 script')).toBeTruthy();
    expect(await screen.findByText('Rendering the thumbnail set')).toBeTruthy();
  });
});

describe('Work v2: finished', () => {
  it('lists done runs with their result and receipt, or "model estimate" and no receipt', async () => {
    await start();
    const finished = await screen.findByRole('region', { name: 'Finished' });
    const books = await tileOf('Matched September bank lines to invoices', finished);
    expect(books.textContent).toContain('Matched 212 of 214 lines. 2 need your data.');
    expect(within(books).getByRole('button', { name: receiptMark('R-0412') })).toBeTruthy();
    expect(within(books).getByText('Worked for 4m')).toBeTruthy();
    const reach = await tileOf('Estimated reach for episode 14', finished);
    // The model's words sit inside the estimate itself, so they read as labelled wherever they stand.
    const estimate = within(reach).getByText('About 18,000 views in 30 days').closest('[data-estimate]') as HTMLElement | null;
    expect(estimate).toBeTruthy();
    expect(within(estimate!).getByText('model estimate')).toBeTruthy();
    expect(within(reach).queryByRole('button', { name: /Receipt/ })).toBeNull();
    expect(within(finished).queryByText('Rendering the thumbnail set')).toBeNull();
    expect(within(finished).queryByRole('link', { name: 'All finished runs' })).toBeNull();
    assertInkRules();
  });

  it('All lists the newest five, and "All finished runs" leads to Done with every one', async () => {
    const more = ['Cut episode 9', 'Cut episode 10', 'Cut episode 11', 'Cut episode 12', 'Cut episode 13'].map((purpose, i) => doneRun(`f${i}`, purpose));
    await start('#/work', { intercept: { 'venture.runs.list': withRuns(...more) } });
    const finished = await screen.findByRole('region', { name: 'Finished' });
    await within(finished).findByText('Matched September bank lines to invoices');
    expect(within(finished).getAllByRole('listitem')).toHaveLength(5);
    expect(within(finished).queryByText('Cut episode 12')).toBeNull();
    const all = within(finished).getByRole('link', { name: 'All finished runs' });
    expect(all.getAttribute('href')).toBe('#/work?state=done');
    await go('#/work?state=done');
    const every = await screen.findByRole('region', { name: 'Finished' });
    expect(await within(every).findByText('Cut episode 13')).toBeTruthy();
    expect(within(every).getAllByRole('listitem')).toHaveLength(7);
    expect(within(every).queryByRole('link', { name: 'All finished runs' })).toBeNull();
  });
});

describe('Work v2: orders by client', () => {
  it('one tile per client: initials, the name opening the client sheet, since when, and what they owe with its receipt', async () => {
    await start();
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const boat = await within(orders).findByRole('article', { name: 'Boat Audio' });
    expect(boat.querySelector('[aria-hidden="true"][data-size]')?.textContent).toBe('BA');
    expect(within(boat).getByText(/^Client since 2 Sept? · 2 orders$/)).toBeTruthy();
    const owes = within(boat).getByText('Owes you').parentElement!;
    const owed = within(owes).getByText('₹26,200.00').closest('[data-figure]') as HTMLElement;
    expect(within(owed).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
    await click(within(boat).getByRole('button', { name: 'Boat Audio' }));
    expect(window.location.hash).toBe('#/work?sheet=client%3Ac-boat');
    expect(await screen.findByRole('complementary', { name: 'Boat Audio' })).toBeTruthy();
  });

  it('each order is a card: the request, its status chip, the price receipt, its invoice, one sentence, and Open on Today when it waits on you', async () => {
    await start();
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const ep14 = await tileOf('Two mentions in episode 14', orders);
    expect(ep14.hasAttribute('data-card')).toBe(true);
    await waitFor(() => expect(ep14.textContent).toContain('Draft ready. Read it before it goes to the client.'));
    expect(within(ep14).getByText('Ready for you to read')).toBeTruthy();
    expect(within(ep14).getByText(/^Ordered 20 Oct/)).toBeTruthy();
    expect(within(ep14).getByRole('button', { name: receiptMark('R-0415') })).toBeTruthy();
    expect(within(ep14).getByRole('link', { name: 'Open on Today' }).getAttribute('href')).toBe('#/today');
    const ep12 = await tileOf('Two mentions in episode 12', orders);
    await waitFor(() => expect(ep12.textContent).toContain('Invoiced as INV-0039. Waiting for payment.'));
    expect(within(ep12).getByText('Sent')).toBeTruthy();
    expect(within(ep12).getByText('INV-0039')).toBeTruthy();
    expect(within(ep12).getByText(/^due 28 Oct/)).toBeTruthy();
    // Its price and its invoice total, each with its receipt (the sample bills the order at its price, R-0416).
    const total = within(ep12).getByText('₹26,200.00').closest('[data-figure]') as HTMLElement;
    expect(within(total).getByRole('button', { name: receiptMark('R-0416') })).toBeTruthy();
    expect(within(ep12).getAllByRole('button', { name: receiptMark('R-0416') })).toHaveLength(2);
    expect(within(ep12).queryByRole('link', { name: 'Open on Today' })).toBeNull();
    // W4 4J19 flips wave 3's "no steps yet": each order draws the engine's stage steps (4J3).
    expect(within(ep12).getByRole('list', { name: 'Steps for this order' })).toBeTruthy();
    assertInkRules();
  });
});

describe('Work v2: the orders head and a failed verdict', () => {
  it('the orders head counts what is open and leads to Clients', async () => {
    await start();
    const orders = await screen.findByRole('region', { name: 'Orders' });
    await waitFor(() => expect(within(orders).getByText('2 open for 1 client')).toBeTruthy());
    expect(within(orders).getByRole('link', { name: 'Open Clients' }).getAttribute('href')).toBe('#/clients');
  });

  it("a failed judge verdict keeps the fail colour over the line's own", async () => {
    const FAILED = 'Failed: tone-fits. Only 0 of 1 vote said yes with checked evidence; this rule needs 1.';
    const failed: DeliveryLite = {
      id: 'd-ep14-script', at: '2026-10-21T08:30:00.000Z', orderId: 'o-boat-14', status: 'ready-for-review', practice: false, practiceNow: false,
      servedBy: 'model', deliverable: { title: 'Sponsor script for episode 14' }, verdict: null, awaitingYou: true,
      checks: [{ check: 'no-numeric-prose', passed: true, detail: 'No numbers in the prose.' }, { check: 'rules-judge', passed: false, detail: FAILED }],
      canAccept: false, acceptBlocked: `This draft failed a check: ${FAILED}`,
      judge: { status: 'done', preview: null, auto: false, estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', line: null, draftDigest: 'f'.repeat(64) },
    };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failed] } });
    const judge = await screen.findByRole('region', { name: 'The judge' });
    const verdict = await within(judge).findByText(`The judge found a problem: ${FAILED}`);
    expect(verdict.classList.contains(s.state!)).toBe(true);
    expect(verdict.classList.contains(s.failure!)).toBe(true);
    expect(colourOf(['state'])).toBe('var(--fg2)');
    expect(colourOf(['state', 'failure'])).toBe('var(--fail)');
  });
});

describe('Work v2: the header line and the other filters', () => {
  it('the line under the title counts what is going, failed and open, with the running count in bold', async () => {
    await start();
    const header = screen.getByRole('heading', { level: 1, name: 'Work' }).closest('header')!;
    await waitFor(() => expect(header.textContent).toContain('3 runs going and 1 failed. 2 orders open for 1 client.'));
    expect(header.querySelector('b')?.textContent).toBe('3');
  });

  it('Needs you shows the run that waits and the orders that wait on you, nothing else', async () => {
    await start('#/work?state=waiting');
    const running = await screen.findByRole('region', { name: 'Running now' });
    await tileOf('Pricing the sponsor slot', running);
    expect(within(running).getAllByRole('listitem')).toHaveLength(1);
    const orders = await screen.findByRole('region', { name: 'Orders' });
    expect(await within(orders).findByText('Two mentions in episode 14')).toBeTruthy();
    expect(within(orders).queryByText('Two mentions in episode 12')).toBeNull();
    expect(screen.queryByRole('region', { name: 'Finished' })).toBeNull();
    expect(screen.queryByText('Rendering the thumbnail set')).toBeNull();
    assertInkRules();
  });

  it('Running, Failed and Done each show only their runs, and keep the Ink rules', async () => {
    await start('#/work?state=active');
    const running = await screen.findByRole('region', { name: 'Running now' });
    await tileOf('Cutting shorts from episode 13', running);
    expect(screen.queryByRole('region', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Finished' })).toBeNull();
    assertInkRules();
    await go('#/work?state=failed');
    expect(await tileOf('Rendering the thumbnail set')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Running now' })).toBeNull();
    await settle();
    assertInkRules();
    await go('#/work?state=done');
    const finished = await screen.findByRole('region', { name: 'Finished' });
    expect(await within(finished).findByText('Estimated reach for episode 14')).toBeTruthy();
    expect(screen.queryByText('Rendering the thumbnail set')).toBeNull();
    assertInkRules();
  });

  it('one order from the address keeps the Ink rules too', async () => {
    await start('#/work?order=o-boat-14');
    const order = await screen.findByRole('region', { name: 'Order' });
    await within(order).findByText('Two mentions in episode 14');
    await settle();
    assertInkRules();
  });
});

describe('Work v2: Hindi', () => {
  it('renders every part of the place with no key showing as text', async () => {
    await start('#/work', { language: 'hi' });
    await screen.findByText('Rendering the thumbnail set');
    await screen.findByText('Two mentions in episode 14');
    await settle();
    const main = document.querySelector('main') ?? document.body;
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
    const keys: string[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      if (/^[a-z]+(\.[a-zA-Z0-9-]+)+$/.test(text)) keys.push(text);
    }
    expect(keys).toEqual([]);
    expect(screen.getByRole('group', { name: 'दिखाएँ' })).toBeTruthy();
  });
});
