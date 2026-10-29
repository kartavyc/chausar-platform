import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { NARROW } from '../../src/shell/useNarrow';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { MethodName } from '../../src/engine/types';

/*
 * 4Z2: what a cold review of the wave 4 screenshots found, fixed on screen. Each test names the finding it holds.
 */

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; now?: string; intercept?: Partial<Record<MethodName, (params: unknown, base: (p?: unknown) => Promise<unknown>) => unknown>> }

function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = new FakeEngine(options.now ? { now: () => options.now! } : undefined);
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params, (p?: unknown) => request(method, (p ?? params) as never)));
    return request(method, params as never);
  }) as typeof client.request;
  const view = render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, client, calls, ...view };
}
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

describe('1. the agent sheet note card says what the engine did', () => {
  it('a kept note is headed as a note for the agent, not "Save this note?", and says where it was saved', async () => {
    start('#/team?sheet=agent:editor&tab=chat');
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    const card = await within(panel).findByRole('article', { name: 'Note for Editor' });
    expect(card.getAttribute('data-status')).toBe('accepted');
    expect(card.textContent).toContain("Saved in Editor's notes.");
    expect(within(panel).queryByRole('article', { name: 'Save this note?' })).toBeNull();
  });

  it('a note waiting for the owner asks, with the engine\'s own verbs: Accept and Reject', async () => {
    start('#/team?sheet=agent:researcher&tab=chat');
    const panel = await screen.findByRole('complementary', { name: 'Researcher' });
    await within(panel).findByRole('log');
    const box = within(panel).getByRole('textbox', { name: /^Message / });
    await act(async () => { fireEvent.change(box, { target: { value: 'Remember that the channel posts on Fridays' } }); });
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: 'Send' })); });
    await settle();
    const card = await within(panel).findByRole('article', { name: 'Save this note?' });
    expect(within(card).getByRole('button', { name: 'Accept' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Reject' })).toBeTruthy();
    await act(async () => { fireEvent.click(within(card).getByRole('button', { name: 'Accept' })); });
    await settle();
    expect(within(panel).getByRole('article', { name: 'Note for Researcher' }).textContent).toContain("Saved in Researcher's notes.");
  });

  it('in Hindi the note card is worded by the UI', async () => {
    start('#/team?sheet=agent:editor&tab=chat', { language: 'hi' });
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    expect(await within(panel).findByRole('article', { name: 'Editor के लिए नोट' })).toBeTruthy();
  });
});

describe('2. Work: an order\'s button follows the engine\'s next step', () => {
  it('episode 12, delivered and invoiced, waits for payment and offers no Mark delivered', async () => {
    start('#/work');
    const orders = await screen.findByRole('region', { name: 'Orders' });
    const ep12 = (await within(orders).findByText('Two mentions in episode 12')).closest('li')!;
    await waitFor(() => expect(ep12.textContent).toContain('Invoiced as INV-0039. Waiting for payment.'));
    expect(within(ep12).queryByRole('button', { name: 'Mark delivered' })).toBeNull();
  });
});

describe('3. Money: cash ahead names no lowest week above the bank balance', () => {
  it('with cash only rising, the tile shows the bank and the line, and no Lowest week', async () => {
    start('#/money', { now: '2026-10-26T10:00:00.000Z' });
    const title = await screen.findByText('Cash, next 13 weeks');
    const cash = title.closest('section')!;
    await within(cash).findByText('In the bank');
    expect(within(cash).queryByText('Lowest week')).toBeNull();
  });
});

describe('4. Start: the country, the hours and Start', () => {
  it('starts from the open business\'s country, so an Indian owner on an en-US browser reads "Based in India"', async () => {
    expect(navigator.language).toBe('en-US');
    start('#/onboarding');
    expect(await screen.findByText('Based in India')).toBeTruthy();
  });

  it('in Hindi the country is a Hindi word, from the engine\'s code', async () => {
    start('#/onboarding', { language: 'hi' });
    expect(await screen.findByText('देश: भारत')).toBeTruthy();
  });

  it('hours read as body text, not code; every way\'s button reads Start (the running one says "another" to a screen reader)', async () => {
    start('#/onboarding');
    const region = await screen.findByRole('region', { name: 'All ways to earn' });
    const yours = await within(region).findByRole('article', { name: 'YouTube channel' });
    const hours = within(yours).getByText(/h a week$/);
    expect(hours.classList.contains('mono')).toBe(false);
    expect(within(yours).getByRole('button', { name: 'Start another YouTube channel' }).textContent).toBe('Start');
    for (const button of within(region).getAllByRole('button', { name: /^Start / })) expect(button.textContent).toBe('Start');
  });
});

describe('5. Team and Work agree on a waiting run', () => {
  it('the Producer card says Waiting on you once, with no "paused" beside it', async () => {
    start('#/team');
    const producer = (await screen.findByText('Pricing the sponsor slot')).closest('[data-row-id]') as HTMLElement;
    expect(producer.textContent).toContain('2 of 3');
    expect(producer.textContent).not.toMatch(/paused/i);
  });

  it('Work counts the waiting run as its ring does: 2 of 3 done, then it waits on you', async () => {
    start('#/work');
    const working = await screen.findByRole('region', { name: 'Running now' });
    const producer = (await within(working).findByText('Pricing the sponsor slot')).closest('li')!;
    expect(await within(producer).findByText('2 of 3 done, waits on you')).toBeTruthy();
    expect(within(producer).getByRole('img', { name: /2 of 3/ })).toBeTruthy();
  });

  it('a department counts its jobs as done this week, so it never reads against a job to look at', async () => {
    start('#/team');
    const operations = (await screen.findByRole('heading', { name: 'Operations' })).closest('article')!;
    expect(operations.textContent).toContain('done this week');
    expect(operations.textContent).not.toContain('jobs this week');
  });
});

describe('6. Network: the sources add up to more than the people, because one person is counted once', () => {
  it('the line says each person counts once across files; each source says its count once, in the engine\'s line', async () => {
    start('#/clients/network');
    expect((await screen.findByText(/people from your own files, each counted once\. Only you can search them\./)).textContent).toBe('9 people from your own files, each counted once. Only you can search them.');
    const tile = (await screen.findByRole('heading', { level: 2, name: 'Where your network comes from' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(tile).getByText('6 people, imported 21 Oct 2026.')).toBeTruthy());
    expect(tile.textContent).not.toMatch(/people kept/);
    expect(within(tile).getAllByText(/left out/).length).toBeGreaterThan(0);
  });
});

describe('7. Chats on a phone: no empty block above the first message', () => {
  it('the phone pane takes its height from its messages, not from the window', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/places/chats/Chats.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const phone = css.match(/\.layout\[data-phone\] \.pane \{([^}]*)\}/)![1]!;
    expect(phone).toMatch(/min-height:\s*0/);
    expect(phone).not.toMatch(/dvh/);
  });
});

describe('8. Today: the folds, the stack and the card words', () => {
  it('the waiting fold is not empty: it lists its line, and its summary shows it opens', async () => {
    start('#/today');
    const fold = await waitFor(() => { const found = document.querySelector<HTMLDetailsElement>('[data-today-fold="waiting"]'); expect(found).not.toBeNull(); return found!; });
    expect(fold.querySelectorAll('li').length).toBeGreaterThan(0);
    expect(fold.querySelector('summary [data-fold-mark]')).not.toBeNull();
  });

  it('"8 more need you" is one plain tile: no sheets peeking under it and no faces', async () => {
    start('#/today');
    const more = await waitFor(() => { const found = document.querySelector<HTMLElement>('[data-more]'); expect(found).not.toBeNull(); return found!; });
    expect(more.querySelectorAll(':scope > span[aria-hidden="true"]')).toHaveLength(0);
    expect(within(more).queryByText('ED')).toBeNull();
  });

  it('a plan\'s preview shows its first section only, so no heading is cut off at the fade', async () => {
    start('#/today');
    const plan = (await screen.findByRole('button', { name: 'Your plan is ready. Read it.' })).closest('article')!;
    await waitFor(() => expect(plan.querySelector('[data-sheet="text"]')).not.toBeNull());
    expect(plan.querySelector('[data-sheet="text"]')!.textContent).toContain('Offers');
    expect(plan.querySelector('[data-sheet="text"]')!.textContent).not.toContain('Stays with your CA');
  });

  it('a primary that asks twice says so plainly, and a count shows only near its limit', async () => {
    start('#/today');
    // Today shows the five most urgent cards (4Z3); the post waits behind the fold.
    fireEvent.click(await screen.findByRole('button', { name: /^Show [0-9]+ more$/ }));
    const post = (await screen.findByRole('button', { name: 'Post to X' })).closest('article')!;
    expect(post.querySelector('[data-count-of]')).toBeNull();
    expect(document.body.textContent).not.toContain('Asks once more');
    expect(document.body.textContent).toContain('Asks you to confirm');
  });
});

describe('9. a known failure in plain words, the technical line one step away', () => {
  it('Work: the video tool is not installed; the engine\'s error sits behind Details', async () => {
    start('#/work');
    const tile = (await screen.findByRole('button', { name: 'Rendering the thumbnail set' })).closest('li')!;
    await waitFor(() => expect(tile.textContent).toContain("The video tool isn't installed on this computer yet."));
    const details = within(tile).getByText('Details').closest('details')!;
    expect(details.open).toBe(false);
    expect(details.textContent).toContain('The renderer stopped: ffmpeg was not found on this computer.');
    // Outside the fold, the tool's own words are not at rest.
    const rest = [...tile.querySelectorAll('p')].filter((p) => !p.closest('details')).map((p) => p.textContent).join(' ');
    expect(rest).not.toContain('ffmpeg');
  });

  it('Today: Working now says the same plain words', async () => {
    start('#/today');
    const working = await screen.findByRole('region', { name: /^Working now/ });
    await waitFor(() => expect(working.textContent).toContain("The video tool isn't installed on this computer yet."));
    expect(working.textContent).not.toContain('ffmpeg');
  });

  it('in Hindi too', async () => {
    start('#/work', { language: 'hi' });
    const tile = (await screen.findByRole('button', { name: 'Rendering the thumbnail set' })).closest('li')!;
    await waitFor(() => expect(tile.textContent).toContain('वीडियो का टूल इस कंप्यूटर पर अभी इंस्टॉल नहीं है।'));
  });
});

describe('10. Today in Hindi: action labels and the summary in Hindi words', () => {
  it('the cards\' buttons and the line under the greeting are Hindi', async () => {
    start('#/today', { language: 'hi' });
    const plan = (await screen.findByRole('button', { name: 'Your plan is ready. Read it.' })).closest('article')!;
    expect(within(plan).getByRole('button', { name: 'पढ़ें' })).toBeTruthy();
    for (const english of ['Read', 'Accept', 'Deny', 'Approve', 'Later']) expect(screen.queryAllByRole('button', { name: english }).map((b) => b.closest('article')?.textContent?.slice(0, 80) ?? b.outerHTML.slice(0, 200)), english).toEqual([]);
    const head = document.querySelector('main h1')!.parentElement!.parentElement!;
    expect(head.textContent).not.toMatch(/need you|across|is locked/);
    expect(head.textContent).toMatch(/आपका इंतज़ार कर रहे हैं, \d+ बिज़नेस में/);
  });

  it('in English the engine\'s words stay as they are', async () => {
    start('#/today');
    const plan = (await screen.findByRole('button', { name: 'Your plan is ready. Read it.' })).closest('article')!;
    expect(within(plan).getByRole('button', { name: 'Read' })).toBeTruthy();
  });
});

describe('11. phone layout at 390', () => {
  const charts = () => readFileSync(join(import.meta.dirname, '../../src/parts/charts/Charts.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  it('a narrow chart hides only amounts over its bars: counts stay written', () => {
    expect(charts()).toMatch(/\.chart\[data-figure-group\] \.cap:not\(\[data-current\]\):not\(\[data-count\]\)/);
  });

  it('the order steps fall into rows of three on a narrow page, so labels never run together', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/places/work/OrderSteps.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    expect(css).toMatch(/@container \(max-width: \d+px\) \{\s*\.steps \{[^}]*grid-template-columns:\s*repeat\(3/);
  });

  it('Team\'s department chips wrap on a phone instead of scrolling a cut-off first chip out of view', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === NARROW, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    start('#/team?dept=prod');
    const chips = await screen.findByRole('group', { name: 'Show departments' });
    expect(chips.hasAttribute('data-scroll')).toBe(false);
    vi.restoreAllMocks();
  });
});
