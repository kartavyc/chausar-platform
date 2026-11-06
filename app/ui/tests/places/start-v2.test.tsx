import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient, type FakeOptions } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider, type Language } from '../../src/text';
import type { EngineClient } from '../../src/engine/types';
import { StartPage } from '../../src/places/onboarding';
import { Examples } from '../../src/places/onboarding/Examples';
import type { WayData, WaysSlot } from '../../src/places/onboarding/ways';
import { rule } from '../helpers/css';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * Start in the direction D look (w3 plan, 3G2; D-Start.dc.html). The flow, the passphrase and the recovery code keep
 * every behaviour and test of onboarding.test.tsx; this file holds what the look adds: the header, "How starting
 * works" in icons and words, the one-sentence tile with its hint and examples, the gallery slot that only W4 fills,
 * and "Resume setup".
 */

const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
/** A text key ("onboarding.how.title") shown as text means a missing string. */
const KEY_LIKE = /^[a-z]+(\.[a-zA-Z0-9-]+)+$/;

/** The engine listing no way to earn (W3's case; W4 4J21's start-gallery.test.tsx covers the engine's ways). */
const NO_WAYS = { ways: [], categories: [], upTo: { maxHours: 5, label: 'Up to 5 h a week', hi: 'हफ़्ते में 5 घंटे तक', count: 0 } };

/** The App on the fake engine, with every request written down. The engine lists no ways to earn here. */
function start(options: FakeOptions = {}, { hash = '#/onboarding', language = 'en', venture }: { hash?: string; language?: Language; venture?: { done: number; total: number } } = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(new FakeEngine(options));
  const calls: string[] = [];
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: Record<string, unknown>) => {
      calls.push(method);
      if (method === 'venture.playbooks.list') return structuredClone(NO_WAYS);
      const answer = await fake.request(method as never, params as never);
      return method === 'venture.get' && venture && answer ? { ...(answer as object), ...venture } : answer;
    }) as EngineClient['request'],
  };
  render(<App client={client} language={language} />);
  return { calls };
}

/** StartPage alone, with the gallery slot W4 fills. */
function page(gallery: WaysSlot | undefined, language: Language = 'en') {
  window.location.hash = '#/onboarding';
  const client = createFakeClient(new FakeEngine());
  return render(<TextProvider language={language}><EngineProvider client={client}><StartPage gallery={gallery} onStarted={() => {}} /></EngineProvider></TextProvider>);
}

/** The text a screen reader hears in `root`: every text node outside aria-hidden. */
function heard(root: Element): string {
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (!node.parentElement?.closest('[aria-hidden="true"]')) text += node.textContent;
  return text;
}

function keysShown(root: Element): string[] {
  const found: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) if (KEY_LIKE.test((node.textContent ?? '').trim())) found.push(node.textContent!.trim());
  for (const el of root.querySelectorAll('[aria-label]')) if (KEY_LIKE.test(el.getAttribute('aria-label') ?? '')) found.push(el.getAttribute('aria-label')!);
  return found;
}

const follows = (a: Node, b: Node) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe('Start: the header', () => {
  it('says "Start a new business", "Describe your business" while the engine lists no ways, and that nothing goes out until you approve', async () => {
    start();
    const title = await screen.findByRole('heading', { level: 1, name: 'Describe your business' });
    const header = title.closest('header')!;
    const eyebrow = within(header).getByText('Start a new business');
    expect(eyebrow.tagName).toBe('P');
    expect(follows(eyebrow, title)).toBe(true);
    expect(header.textContent).toContain('Nothing goes out until you approve it.');
    // No gallery until W4 sends ways to earn.
    expect(screen.queryByRole('heading', { name: 'All ways to earn' })).toBeNull();
    expect(screen.queryByRole('list', { name: 'Ways to earn' })).toBeNull();
  });
});

describe('Start: how starting works', () => {
  it('three numbered steps in icons and words, with no figure, count or digit to hear', async () => {
    start();
    const how = await screen.findByRole('region', { name: 'How starting works' });
    const steps = within(how).getByRole('list');
    expect(steps.tagName).toBe('OL');
    const items = within(steps).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(within(how).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Describe it', 'Read your plan', 'Approve real work']);
    for (const item of items) {
      expect(item.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(item.querySelector('p')?.textContent).toBeTruthy();
    }
    expect(how.querySelector('[data-ui-number], [data-figure], [data-count], [data-estimate]')).toBeNull();
    expect(heard(how)).not.toMatch(/\d/);
    // No miniature cards: no button, no chip that looks like one.
    expect(within(how).queryAllByRole('button')).toEqual([]);
  });
});

describe('Start: the one-sentence tile', () => {
  it('the labelled box, the hint, "Make my plan" as the one primary, and three examples', async () => {
    start();
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    const tile = box.closest('section')!;
    expect(within(tile).getByRole('heading', { level: 2, name: 'What do you want to start?' })).toBeTruthy();
    expect(tile.textContent).toContain('Write in English or हिन्दी');
    expect(within(tile).getByText('हिन्दी').getAttribute('lang')).toBe('hi');
    const primaries = [...tile.querySelectorAll('[data-variant="primary"]')];
    expect(primaries.map((b) => b.textContent)).toEqual(['Make my plan']);
    const examples = within(tile).getByRole('group', { name: 'Examples' });
    expect(within(examples).getAllByRole('button').map((b) => b.textContent)).toEqual(['Wedding invitation videos', 'GST filing for kirana shops', 'बच्चों को ऑनलाइन गणित']);
    expect(within(examples).getByRole('button', { name: 'बच्चों को ऑनलाइन गणित' }).getAttribute('lang')).toBe('hi');
    expect(within(examples).getByRole('button', { name: 'Wedding invitation videos' }).hasAttribute('lang')).toBe(false);
    assertInkRules();
  });

  it('an example fills the box with its sentence and asks the engine nothing', async () => {
    const { calls } = start();
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' }) as HTMLTextAreaElement;
    await screen.findByText(/^Based in /);
    await screen.findByRole('link', { name: 'Resume setup' });
    fireEvent.change(box, { target: { value: 'Something I typed first' } });
    const before = calls.length;
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Wedding invitation videos' })); });
    expect(box.value).toBe('I make wedding invitation videos for families.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'बच्चों को ऑनलाइन गणित' })); });
    expect(box.value).toBe('बच्चों के लिए ऑनलाइन गणित की कक्षाएँ।');
    expect(calls.slice(before)).toEqual([]);
  });

  it('an example clears the line that asked for more words', async () => {
    start();
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    fireEvent.change(box, { target: { value: 'Dogs' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make my plan' })); });
    expect(screen.getByRole('alert').textContent).toBe('Say a little more: at least 10 characters.');
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'GST filing for kirana shops' })); });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(box.getAttribute('aria-invalid')).toBeNull();
  });

  it('the examples never change by themselves: no timer, the same three after a minute', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const onPick = vi.fn();
      render(<Examples onPick={onPick} />);
      const names = () => screen.getAllByRole('button').map((b) => b.textContent);
      const first = names();
      expect(first).toHaveLength(3);
      expect(vi.getTimerCount()).toBe(0);
      act(() => { vi.advanceTimersByTime(60_000); });
      expect(names()).toEqual(first);
      expect(onPick).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('once the vault exists, the examples stand still too: the sentence is kept for Try again', async () => {
    window.location.hash = '#/onboarding';
    const fake = createFakeClient(new FakeEngine());
    let refused = false;
    const client: EngineClient = {
      ...fake,
      request: ((method: string, params?: Record<string, unknown>) => {
        if (method === 'venture.blueprint.draft' && !refused) { refused = true; return Promise.reject(new Error('A workspace operation is in progress. Wait for it to finish.')); }
        return fake.request(method as never, params as never);
      }) as EngineClient['request'],
    };
    render(<App client={client} language="en" />);
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: IDEA } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make my plan' })); });
    await screen.findByRole('button', { name: 'Try again' });
    const wedding = screen.getByRole('button', { name: 'Wedding invitation videos' }) as HTMLButtonElement;
    expect(wedding.disabled).toBe(true);
    fireEvent.click(wedding);
    expect(box.value).toBe(IDEA);
  });
});

describe('Start: the passphrase and the recovery code keep their order', () => {
  it('Lock and start comes after the passphrase fields, and only Continue is offered while the code shows', async () => {
    start({ fresh: true, deviceKeys: false }, { hash: '#/today' });
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    fireEvent.change(box, { target: { value: IDEA } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })); });
    const again = await screen.findByLabelText('Type it again');
    const lock = screen.getByRole('button', { name: 'Lock and start' });
    expect(follows(again, lock)).toBe(true);
    expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'correct horse battery' } });
    fireEvent.change(again, { target: { value: 'correct horse battery' } });
    await act(async () => { fireEvent.click(lock); });
    await screen.findByRole('group', { name: 'Recovery code' });
    const main = screen.getByRole('main');
    expect(within(main).queryByRole('button', { name: /^(Start|Lock and start|Try again)$/ })).toBeNull();
    expect(within(main).getAllByRole('button', { name: 'Continue' })).toHaveLength(1);
    // The box is kept and read-only now: no "write in English or Hindi" hint for a box nobody can write in.
    expect(main.textContent).not.toContain('Write in English or');
    assertInkRules();
  });

  it('Continue stays locked, reachable and saying why, until the owner ticks that the code is saved', async () => {
    const { calls } = start({ fresh: true, deviceKeys: false }, { hash: '#/today' });
    fireEvent.change(await screen.findByRole('textbox', { name: 'What do you want to start?' }), { target: { value: IDEA } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })); });
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'correct horse battery' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lock and start' })); });
    await screen.findByRole('group', { name: 'Recovery code' });
    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    expect(go.getAttribute('aria-disabled')).toBe('true');
    expect(go.title).toBe('Tick that you saved it, then Continue unlocks.');
    const before = calls.length;
    await act(async () => { fireEvent.click(go); });
    expect(calls.slice(before).filter((m) => m === 'venture.create')).toEqual([]);
    fireEvent.click(screen.getByRole('checkbox', { name: 'I saved it somewhere safe' }));
    expect(go.hasAttribute('aria-disabled')).toBe(false);
  });
});

describe('Start: once it begins, nothing else on the page leads away', () => {
  it('inside the app: no "Resume setup" for the business just locked, while the passphrase or the recovery code shows', async () => {
    start({ deviceKeys: false });
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    await screen.findByRole('link', { name: 'Resume setup' });
    fireEvent.change(box, { target: { value: IDEA } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make my plan' })); });
    await screen.findByLabelText('Type it again');
    expect(screen.queryByRole('link', { name: 'Resume setup' })).toBeNull();
    fireEvent.change(screen.getByLabelText('Passphrase'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Type it again'), { target: { value: 'correct horse battery' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Lock and start' })); });
    expect(await screen.findByRole('group', { name: 'Recovery code' })).toBeTruthy();
    await act(async () => {});
    expect(screen.queryByRole('link', { name: 'Resume setup' })).toBeNull();
  });

  it('a sentence the box refuses is not a beginning: "Resume setup" stays', async () => {
    start();
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    await screen.findByRole('link', { name: 'Resume setup' });
    fireEvent.change(box, { target: { value: 'Dogs' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Make my plan' })); });
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Resume setup' })).toBeTruthy();
  });

  it('the first run: "Open a business you already have" goes once Start begins', async () => {
    start({ fresh: true, deviceKeys: false }, { hash: '#/today' });
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    expect(screen.getByRole('button', { name: 'Open a business you already have' })).toBeTruthy();
    fireEvent.change(box, { target: { value: IDEA } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })); });
    await screen.findByLabelText('Type it again');
    expect(screen.queryByRole('button', { name: 'Open a business you already have' })).toBeNull();
  });

  it('from Welcome back: "Back to your businesses" goes once Start begins', async () => {
    start({ closed: true, deviceKeys: false }, { hash: '#/today' });
    const another = await screen.findByRole('button', { name: 'Start another business' });
    await act(async () => { fireEvent.click(another); });
    const box = await screen.findByRole('textbox', { name: 'What do you want to start?' });
    expect(screen.getByRole('button', { name: 'Back to your businesses' })).toBeTruthy();
    fireEvent.change(box, { target: { value: IDEA } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Start' })); });
    await screen.findByLabelText('Type it again');
    expect(screen.queryByRole('button', { name: 'Back to your businesses' })).toBeNull();
  });
});

describe('Start: Welcome back carries the logo too', () => {
  it('the two-square mark, and "Chausar" said once', async () => {
    start({ closed: true }, { hash: '#/today' });
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
    const main = screen.getByRole('main');
    expect(main.querySelectorAll('svg[aria-hidden="true"] rect')).toHaveLength(2);
    expect(within(main).getByText('Chausar')).toBeTruthy();
  });
});

describe('Start: the first run stays simple', () => {
  it('the brand, the question, the box with its hint and Start; no steps, no examples, no gallery', async () => {
    start({ fresh: true }, { hash: '#/today' });
    await screen.findByRole('textbox', { name: 'What do you want to start?' });
    const main = screen.getByRole('main');
    // The two-square mark is decorative; the name is said once.
    expect(main.querySelectorAll('svg[aria-hidden="true"] rect')).toHaveLength(2);
    expect(within(main).getByText('Chausar')).toBeTruthy();
    expect(main.textContent).toContain('Write in English or हिन्दी');
    expect(within(main).queryByRole('group', { name: 'Examples' })).toBeNull();
    expect(within(main).queryByRole('region', { name: 'How starting works' })).toBeNull();
    expect(within(main).queryByRole('link', { name: 'Resume setup' })).toBeNull();
    expect([...main.querySelectorAll('[data-variant="primary"]')].map((b) => b.textContent)).toEqual(['Start']);
    assertInkRules();
  });
});

describe('Start: resume setup (catalogue U18)', () => {
  it('the open business that is not set up yet shows how far it is, and a way back to its setup', async () => {
    start();
    const link = await screen.findByRole('link', { name: 'Resume setup' });
    expect(link.getAttribute('href')).toBe('#/today?show=setup');
    const tile = link.closest('section')!;
    expect(within(tile).getByRole('heading', { level: 2 }).textContent).toBe('Lumen Studio is not set up yet');
    expect(within(tile).getByRole('img', { name: '6 of 12 steps done' })).toBeTruthy();
    // Below the one-sentence tile: starting is this page's one clear step.
    expect(follows(screen.getByRole('textbox', { name: 'What do you want to start?' }), link)).toBe(true);
    assertInkRules();
  });

  it('a business whose setup is done shows nothing', async () => {
    start({}, { venture: { done: 12, total: 12 } });
    await screen.findByRole('textbox', { name: 'What do you want to start?' });
    await waitFor(() => expect(screen.getByRole('button', { name: /Lumen Studio/ })).toBeTruthy());
    await act(async () => {});
    expect(screen.queryByRole('link', { name: 'Resume setup' })).toBeNull();
  });
});

/** Ways to earn written for these tests (W4 4J21 maps the engine's list onto this shape). */
const ways: WayData[] = [
  {
    id: 'menu-cards', name: 'Menu cards for cafes', line: 'Printed and online menus for small cafes.', icon: 'file-text', dept: 'mkt', category: 'Shops and firms',
    hours: '2 to 4 h a week', youDo: 'Approve each menu.', team: { names: ['Designer', 'Writer'], line: 'Drafts the menus and the prices list.' }, pay: { range: '₹1,000 to ₹3,000', per: 'per menu' },
  },
  {
    id: 'tuition', name: 'Online tuition', line: 'Maths classes for school children.', icon: 'users', dept: 'prod', category: 'Content',
    hours: '6 to 8 h a week', youDo: 'Teach the live classes.', team: { names: ['Planner'], line: 'Plans lessons and sends worksheets.' }, pay: { range: '₹500 to ₹1,500' },
  },
];

describe('Start: the gallery slot (filled by W4 4J21)', () => {
  it('with ways: "Pick a way to earn", the tiles in the gallery with the featured one the only primary, and "Or describe it in one sentence"', async () => {
    const onStart = vi.fn();
    page({ ways, featured: 'tuition', onStart });
    expect(screen.getByRole('heading', { level: 1, name: 'Pick a way to earn' })).toBeTruthy();
    const line = screen.getByRole('heading', { level: 1 }).closest('header')!.querySelector('b');
    expect(line?.textContent).toBe('2');
    const section = screen.getByRole('region', { name: 'All ways to earn' });
    const list = within(section).getByRole('list', { name: 'Ways to earn' });
    const tiles = within(list).getAllByRole('article');
    expect(tiles).toHaveLength(2);
    const primaries = [...section.querySelectorAll('[data-variant="primary"]')];
    expect(primaries).toHaveLength(1);
    expect(primaries[0]!.getAttribute('aria-label')).toBe('Start Online tuition');
    fireEvent.click(within(section).getByRole('button', { name: 'Start Menu cards for cafes' }));
    expect(onStart).toHaveBeenCalledWith('menu-cards');
    expect(within(screen.getByRole('region', { name: 'How starting works' })).getAllByRole('heading', { level: 3 })[0]!.textContent).toBe('Describe or pick');
    expect(await screen.findByRole('textbox', { name: 'Or describe it in one sentence' })).toBeTruthy();
    // The gallery comes before the one-sentence tile, as on the board.
    expect(follows(section, screen.getByRole('textbox', { name: 'Or describe it in one sentence' }))).toBe(true);
    // Three columns on a desktop (the Gallery part's grid).
    expect(rule('Gallery.module.css', '.gallery')).toContain('grid-template-columns: repeat(3, minmax(0, 1fr))');
    assertInkRules();
  });

  it('an empty list is no gallery', async () => {
    page({ ways: [], onStart: () => {} });
    expect(screen.getByRole('heading', { level: 1, name: 'Describe your business' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'All ways to earn' })).toBeNull();
    expect(await screen.findByRole('textbox', { name: 'What do you want to start?' })).toBeTruthy();
  });
});

describe('Start: Hindi', () => {
  it('renders the place with no key showing as text', async () => {
    start({}, { language: 'hi' });
    await screen.findByRole('textbox', { name: 'आप क्या शुरू करना चाहते हैं?' });
    await screen.findByRole('link', { name: 'सेटअप फिर से शुरू करें' });
    expect(keysShown(document.body)).toEqual([]);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('अपने बिज़नेस के बारे में बताइए');
  });

  it('the gallery page in Hindi has no key showing either', () => {
    page({ ways, featured: 'tuition', onStart: () => {} }, 'hi');
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('कमाई का एक तरीका चुनें');
    const section = screen.getByRole('region', { name: 'कमाई के सभी तरीके' });
    expect(within(section).getAllByRole('article')).toHaveLength(2);
    expect(screen.getByRole('textbox', { name: 'या एक वाक्य में बताइए' })).toBeTruthy();
    expect(keysShown(document.body)).toEqual([]);
  });
});
