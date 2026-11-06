import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import axe from 'axe-core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PathLine } from '../../src/parts/PathLine';
import { StrengthDots } from '../../src/parts/StrengthDots';
import { Board, BoardCard } from '../../src/parts/Board';
import { NotificationBell } from '../../src/parts/NotificationBell';
import { Composer } from '../../src/parts/Composer';
import { ChatThread, type ThreadEntry } from '../../src/parts/ChatThread';
import { DiffCard } from '../../src/parts/DiffCard';
import { TextProvider } from '../../src/text';
import { assertInkRules, assertNoInlineStyles, assertOnePrimary } from '../helpers/ink-rules';

/* Package 3B4 (docs/superpowers/plans/2026-10-23-chausar-ink-v2-w3.md): the parts W4 wires to data for warm paths,
   strength, the pipeline board, the bell, agent chat and instruction changes. Every name and figure here is a prop
   written in this file; none of it is in src. */

/** The declarations of `.name { ... }` in a part's CSS module (its first, base rule). jsdom lays nothing out, so
 *  wrapping and no-wrap are checked in the stylesheet itself. */
function ruleOf(part: string, name: string): string {
  const css = readFileSync(join(import.meta.dirname, '../../src/parts', `${part}.module.css`), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = new RegExp(`(?:^|\\n)\\.${name}\\s*\\{([^}]*)\\}`).exec(css)?.[1];
  if (rule === undefined) throw new Error(`no rule .${name} in ${part}.module.css`);
  return rule;
}

function deferred<T = void>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

describe('PathLine', () => {
  it('reads a confirmed path aloud and draws each step as a solid line', () => {
    const { container } = render(<PathLine strength="strong" people={[{ name: 'Meera Joshi', confirmed: true, strength: 'strong' }, { name: 'Kavya Reddy', confirmed: true, strength: 'strong' }]} />);
    const path = screen.getByRole('img', { name: 'Path: you, then Meera Joshi, then Kavya Reddy. Both steps confirmed.' });
    const links = path.querySelectorAll('[data-confirmed]');
    expect(links).toHaveLength(2);
    expect([...links].every((link) => link.getAttribute('data-confirmed') === 'true')).toBe(true);
    expect(container.textContent).toContain('via Meera Joshi, strong');
    expect(container.textContent).not.toContain('not confirmed');
    assertNoInlineStyles(document.body);
  });

  it("says the path's strength only when code gives it for the whole path, never borrowed from one step", () => {
    const { container } = render(<PathLine people={[{ name: 'Arjun Mehta', confirmed: true, strength: 'strong' }, { name: 'Asha Rao', confirmed: true, strength: 'fair' }]} />);
    expect(container.querySelector('p')!.textContent).toBe('via Arjun Mehta');
  });

  it('a confirmed step with no strength from code is drawn neutral, not as strong', () => {
    render(<PathLine people={[{ name: 'Meera Joshi', confirmed: true }, { name: 'Kavya Reddy', confirmed: true, strength: 'fair' }]} />);
    const links = [...screen.getByRole('img').querySelectorAll('[data-confirmed]')];
    expect(links[0]!.hasAttribute('data-strength')).toBe(false);
    expect(links[1]!.getAttribute('data-strength')).toBe('fair');
  });

  it('says "possible path, not confirmed" in words and dashes the step it cannot confirm (spec 8)', () => {
    const { container } = render(<PathLine people={[{ name: 'Rahul Mehta', confirmed: true, strength: 'fair' }, { name: 'Sameer Joshi', confirmed: false }]} />);
    const path = screen.getByRole('img', { name: 'Possible path: you, then Rahul Mehta, then Sameer Joshi. The second step is not confirmed.' });
    const links = [...path.querySelectorAll('[data-confirmed]')];
    expect(links.map((link) => link.getAttribute('data-confirmed'))).toEqual(['true', 'false']);
    expect(links[0]!.getAttribute('data-strength')).toBe('fair');
    expect(screen.getByText('possible path, not confirmed')).toBeTruthy();
    expect(container.textContent).not.toContain(', fair');
  });

  it('names every step it cannot confirm', () => {
    render(<PathLine people={[{ name: 'Rahul Mehta', confirmed: false }, { name: 'Sameer Joshi', confirmed: false }]} />);
    expect(screen.getByRole('img', { name: 'Possible path: you, then Rahul Mehta, then Sameer Joshi. The first and second steps are not confirmed.' })).toBeTruthy();
  });

  it('a person you know yourself is one step', () => {
    const { container } = render(<PathLine people={[{ name: 'Vikram Desai', confirmed: true }]} />);
    expect(screen.getByRole('img', { name: 'Path: you know Vikram Desai directly.' })).toBeTruthy();
    expect(container.textContent).toContain('You know Vikram Desai directly');
  });

  it('draws the owner as the first avatar and every avatar hidden from screen readers', () => {
    const { container } = render(<PathLine owner="Kartik Rao" people={[{ name: 'Meera Joshi', confirmed: true }, { name: 'Kavya Reddy', confirmed: true }]} layout="named" />);
    const avatars = [...container.querySelectorAll('[data-path-node] > span[aria-hidden="true"]')];
    expect(avatars.map((a) => a.textContent)).toEqual(['KR', 'MJ', 'KR']);
    // The named layout writes each name under its avatar, and "You" under the owner's.
    expect(container.querySelector('[data-layout="named"]')).not.toBeNull();
    expect(screen.getByText('You')).toBeTruthy();
  });

  it('speaks Hindi', () => {
    render(<TextProvider language="hi"><PathLine people={[{ name: 'राहुल मेहता', confirmed: true }, { name: 'समीर जोशी', confirmed: false }]} /></TextProvider>);
    expect(screen.getByRole('img').getAttribute('aria-label')).toContain('राहुल मेहता');
  });
});

describe('StrengthDots', () => {
  it('is a button that says the strength in words and opens how you know them', () => {
    const onOpen = vi.fn();
    render(<StrengthDots level={1} onOpen={onOpen} />);
    const button = screen.getByRole('button', { name: 'Strength: cold, 1 of 5. Open how you know them' });
    const dots = button.querySelectorAll('[data-dot]');
    expect(dots).toHaveLength(5);
    expect(button.querySelectorAll('[data-dot][data-filled]')).toHaveLength(1);
    expect(button.textContent).toBe('Cold');
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
    assertNoInlineStyles(document.body);
  });

  it('fills as many dots as the level the engine computed', () => {
    render(<StrengthDots level={4} onOpen={() => {}} />);
    const button = screen.getByRole('button', { name: 'Strength: know well, 4 of 5. Open how you know them' });
    expect(button.querySelectorAll('[data-dot][data-filled]')).toHaveLength(4);
  });

  it('without a way to open the receipt it is an image, not a button', () => {
    render(<StrengthDots level={5} />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('img', { name: 'Strength: close, 5 of 5.' })).toBeTruthy();
  });

  it('keeps the dots together but lets the words wrap (Hindi "no signals yet" is long)', () => {
    expect(ruleOf('StrengthDots', 'strength')).not.toMatch(/white-space:\s*nowrap/);
    expect(ruleOf('StrengthDots', 'dots')).toMatch(/white-space:\s*nowrap/);
  });
});

describe('Board', () => {
  const card = (id: string, name: string) => ({ id, node: <BoardCard name={name} sub="A company" /> });
  const columns = [
    { id: 'new', title: 'New', hint: 'Not written to yet', cards: [card('a', 'Asha Rao'), card('b', 'Neha Gupta')] },
    { id: 'contacted', title: 'Contacted', cards: [card('c', 'Farhan Ali')] },
    { id: 'won', title: 'Won', cards: [] },
    { id: 'lost', title: 'Lost', folded: true, cards: [card('d', 'Tarun Sethi'), card('e', 'Rhea Menon')] },
  ];

  it('is a labelled group of columns, each a section with a heading, a count and its cards in a list', () => {
    render(<Board label="Pipeline board" columns={columns} />);
    const board = screen.getByRole('group', { name: 'Pipeline board' });
    const sections = board.querySelectorAll('section');
    expect(sections).toHaveLength(3);
    const first = sections[0]!;
    expect(within(first).getByRole('heading', { level: 2, name: 'New' })).toBeTruthy();
    expect(first.querySelector('[data-count]')!.textContent).toBe('2');
    expect(first.querySelector('[data-ui-number]')).toBeNull();
    expect(within(first).getByText('Not written to yet')).toBeTruthy();
    expect(within(within(first).getByRole('list')).getAllByRole('listitem')).toHaveLength(2);
    assertInkRules(document.body);
  });

  it('says so in one sentence when a column is empty', () => {
    render(<Board label="Pipeline board" columns={columns} />);
    const won = screen.getByRole('heading', { name: 'Won' }).closest('section')!;
    expect(won.querySelector('[data-count]')!.textContent).toBe('0');
    expect(within(won).getByText('Nothing here yet.')).toBeTruthy();
  });

  it('a folded column is a button that says what it holds, and expands on click', () => {
    render(<Board label="Pipeline board" columns={columns} />);
    const show = screen.getByRole('button', { name: 'Show Lost, 2 people' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByRole('heading', { name: 'Lost' })).toBeNull();
    fireEvent.click(show);
    const lost = screen.getByRole('heading', { level: 2, name: 'Lost' }).closest('section')!;
    expect(within(lost).getAllByRole('listitem')).toHaveLength(2);
    const hide = within(lost).getByRole('button', { name: 'Hide Lost' });
    expect(hide.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(hide);
    expect(screen.getByRole('button', { name: 'Show Lost, 2 people' })).toBeTruthy();
  });

  it('keeps focus where the owner is when a column opens and folds again', () => {
    render(<Board label="Pipeline board" columns={columns} />);
    const show = screen.getByRole('button', { name: 'Show Lost, 2 people' });
    show.focus();
    fireEvent.click(show);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Hide Lost' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hide Lost' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show Lost, 2 people' }));
  });

  it('the board scrolls sideways on a phone, so it can take focus and be scrolled by keys', () => {
    render(<Board label="Pipeline board" columns={columns} />);
    expect(screen.getByRole('group', { name: 'Pipeline board' }).tabIndex).toBe(0);
  });

  it('a folded column with one person says "1 person"', () => {
    render(<Board label="Pipeline board" columns={[{ id: 'blocked', title: 'Blocked', folded: true, cards: [card('x', 'Dev Malhotra')] }]} />);
    expect(screen.getByRole('button', { name: 'Show Blocked, 1 person' })).toBeTruthy();
  });

  it('shows the first cards of a long column and the rest on request', () => {
    render(<Board label="Pipeline board" limit={1} columns={[columns[0]!]} />);
    expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('article'))).toHaveLength(1);
    const more = screen.getByRole('button', { name: 'Show 1 more' });
    more.focus();
    fireEvent.click(more);
    expect(screen.getAllByRole('listitem').filter((li) => li.querySelector('article'))).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /more/ })).toBeNull();
    // The button is gone, so focus moves to the first card it revealed.
    expect(document.activeElement?.tagName).toBe('LI');
    expect(document.activeElement?.textContent).toContain('Neha Gupta');
  });

  it('a board card is an article named by the person, opened from the name', () => {
    const onOpen = vi.fn();
    render(<BoardCard name="Kavya Reddy" sub="Kesar Botanicals" onOpen={onOpen}><p>Draft ready</p></BoardCard>);
    const article = screen.getByRole('article', { name: 'Kavya Reddy' });
    expect(article.hasAttribute('data-card')).toBe(true);
    expect(within(article).getByText('Kesar Botanicals')).toBeTruthy();
    expect(within(article).getByText('Draft ready')).toBeTruthy();
    expect(article.querySelector('[aria-hidden="true"]')!.textContent).toBe('KR');
    fireEvent.click(within(article).getByRole('button', { name: 'Kavya Reddy' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    assertInkRules(document.body);
  });
  it('long engine words wrap instead of running out of a column or card', () => {
    for (const name of ['title', 'hint', 'cardName', 'cardSub', 'cardBody']) expect(ruleOf('Board', name), name).toMatch(/overflow-wrap:\s*anywhere/);
    for (const name of ['caption', 'nodeName']) expect(ruleOf('PathLine', name), name).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('NotificationBell', () => {
  it('says how many are new in its name and shows only a dot, never a number', () => {
    const onOpen = vi.fn();
    render(<NotificationBell unread={2} onOpen={onOpen} />);
    const bell = screen.getByRole('button', { name: 'Notifications, 2 new' });
    expect(bell.querySelector('[data-dot]')).not.toBeNull();
    expect(bell.textContent).not.toMatch(/\d/);
    expect(bell.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(bell);
    expect(onOpen).toHaveBeenCalledTimes(1);
    assertNoInlineStyles(document.body);
  });

  it('with nothing new it is just "Notifications", with no dot', () => {
    render(<NotificationBell unread={0} />);
    const bell = screen.getByRole('button', { name: 'Notifications' });
    expect(bell.querySelector('[data-dot]')).toBeNull();
  });

  it('one new reads "1 new", and the bare look is for the phone top bar', () => {
    render(<NotificationBell unread={1} look="bare" expanded={false} />);
    const bell = screen.getByRole('button', { name: 'Notifications, 1 new' });
    expect(bell.getAttribute('data-look')).toBe('bare');
    expect(bell.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('Composer', () => {
  it('has a labelled textarea, and Send stays off while there is nothing to send', () => {
    const { container } = render(<Composer label="Message Editor" onSend={vi.fn()} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' });
    expect(box.tagName).toBe('TEXTAREA');
    const label = container.querySelector(`label[for="${box.id}"]`)!;
    expect(label.classList.contains('sr-only')).toBe(true);
    const send = screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: '   ' } });
    expect(send.disabled).toBe(true);
    fireEvent.change(box, { target: { value: 'Cut shorts from episode 13' } });
    expect(send.disabled).toBe(false);
    assertNoInlineStyles(document.body);
  });

  it('Enter sends, Shift+Enter keeps writing on a new line', async () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<Composer label="Message Editor" onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' });
    fireEvent.change(box, { target: { value: 'Keep it under 12 minutes' } });
    expect(fireEvent.keyDown(box, { key: 'Enter', shiftKey: true })).toBe(true);
    expect(onSend).not.toHaveBeenCalled();
    await act(async () => { expect(fireEvent.keyDown(box, { key: 'Enter' })).toBe(false); });
    expect(onSend).toHaveBeenCalledWith('Keep it under 12 minutes');
  });

  it('nothing sends while an input method is still composing', async () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<Composer label="Message Editor" onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' });
    fireEvent.change(box, { target: { value: 'नमस्ते' } });
    fireEvent.compositionStart(box);
    fireEvent.keyDown(box, { key: 'Enter' });
    fireEvent.keyDown(box, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box, { key: 'Process', keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.compositionEnd(box);
    await act(async () => { fireEvent.keyDown(box, { key: 'Enter' }); });
    expect(onSend).toHaveBeenCalledWith('नमस्ते');
  });

  it('clears the text only once the engine says it was stored (catalogue O22)', async () => {
    const sent = deferred();
    const onSend = vi.fn(() => sent.promise);
    render(<Composer label="Message Editor" onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Run thumbnails again' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(box.value).toBe('Run thumbnails again');
    expect(box.readOnly).toBe(true);
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    await act(async () => { sent.resolve(); await sent.promise; });
    expect(box.value).toBe('');
    expect(box.readOnly).toBe(false);
  });

  it('keeps the text and says why when sending fails', async () => {
    const sent = deferred();
    render(<Composer label="Message Editor" onSend={() => sent.promise} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Pause this run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => { sent.reject(new Error('The engine is not answering.')); await sent.promise.catch(() => {}); });
    expect(box.value).toBe('Pause this run');
    expect(screen.getByRole('alert').textContent).toContain('The engine is not answering.');
    // Writing again clears the old error line.
    fireEvent.change(box, { target: { value: 'Pause this run now' } });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a suggestion tapped while a message is sending changes nothing, so a failed send loses no words', async () => {
    const sent = deferred();
    render(<Composer label="Message Editor" onSend={() => sent.promise} suggestions={['Show short 3']} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' }) as HTMLTextAreaElement;
    fireEvent.change(box, { target: { value: 'Pause this run' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    const chip = screen.getByRole('button', { name: 'Show short 3' }) as HTMLButtonElement;
    expect(chip.disabled).toBe(true);
    fireEvent.click(chip);
    expect(box.value).toBe('Pause this run');
    await act(async () => { sent.reject(new Error('The engine is not answering.')); await sent.promise.catch(() => {}); });
    expect(box.value).toBe('Pause this run');
    expect(chip.disabled).toBe(false);
  });

  it('Enter pressed twice while a message is sending sends it once', async () => {
    const sent = deferred();
    const onSend = vi.fn(() => sent.promise);
    render(<Composer label="Message Editor" onSend={onSend} />);
    const box = screen.getByRole('textbox', { name: 'Message Editor' });
    fireEvent.change(box, { target: { value: 'Run thumbnails again' } });
    // Both Enters and a submit land before React draws the sending state, as a fast double press can.
    act(() => {
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.keyDown(box, { key: 'Enter' });
      fireEvent.submit(box.closest('form')!);
    });
    expect(onSend).toHaveBeenCalledTimes(1);
    await act(async () => { sent.resolve(); await sent.promise; });
  });

  it('long engine words wrap instead of running out of the box', () => {
    for (const name of ['error', 'hint', 'suggestion']) expect(ruleOf('Composer', name), name).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('suggestions fill the box and never send', () => {
    const onSend = vi.fn(() => Promise.resolve());
    render(<Composer label="Message Editor" onSend={onSend} suggestions={['Show short 3', 'Run thumbnails again']} hint="Editor asks you before anything that publishes or spends." />);
    const group = screen.getByRole('group', { name: 'Suggestions' });
    fireEvent.click(within(group).getByRole('button', { name: 'Show short 3' }));
    const box = screen.getByRole('textbox', { name: 'Message Editor' }) as HTMLTextAreaElement;
    expect(box.value).toBe('Show short 3');
    expect(document.activeElement).toBe(box);
    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByText('Editor asks you before anything that publishes or spends.')).toBeTruthy();
  });
});

describe('ChatThread', () => {
  const now = new Date('2026-10-23T13:30:00.000Z');
  const entries: ThreadEntry[] = [
    { kind: 'owner', id: 'm1', at: '2026-10-22T02:32:00.000Z', text: 'Cut episode 14 from the recording.' },
    { kind: 'run', id: 'r1', at: '2026-10-22T02:40:00.000Z', title: 'Cut episode 14', state: 'done', done: 3, duration: '4m', steps: <ul><li>Read the transcript</li></ul> },
    { kind: 'agent', id: 'm2', at: '2026-10-22T03:10:00.000Z', text: 'Episode 14 is cut. It is on Today for you to watch.' },
    { kind: 'owner', id: 'm3', at: '2026-10-23T13:07:00.000Z', text: 'Now cut shorts from episode 13.' },
    { kind: 'run', id: 'r2', at: '2026-10-23T13:08:00.000Z', title: 'Shorts from episode 13', state: 'active', done: 3, total: 5 },
    { kind: 'card', id: 'c1', at: '2026-10-23T13:10:00.000Z', node: <p>A card the caller draws</p> },
  ];

  it('is a polite live log named for the agent', () => {
    render(<ChatThread agent={{ name: 'Editor', dept: 'prod' }} entries={entries} now={now} timeZone="Asia/Kolkata" />);
    const log = screen.getByRole('log', { name: 'Conversation with Editor' });
    expect(log.getAttribute('aria-live')).toBe('polite');
    assertInkRules(document.body);
  });

  it('separates days', () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={entries} now={now} timeZone="Asia/Kolkata" />);
    const days = [...screen.getByRole('log').querySelectorAll('[data-day]')].map((d) => d.textContent);
    expect(days).toEqual(['Yesterday', 'Today']);
  });

  it("shows the owner's and the agent's messages with their time in DM Mono", () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={entries} now={now} timeZone="Asia/Kolkata" />);
    const mine = screen.getByText('Cut episode 14 from the recording.').closest('[data-from]')!;
    expect(mine.getAttribute('data-from')).toBe('owner');
    const time = within(mine as HTMLElement).getByText('08:02');
    expect(time.tagName).toBe('TIME');
    expect(time.classList.contains('mono')).toBe(true);
    const theirs = screen.getByText('Episode 14 is cut. It is on Today for you to watch.').closest('[data-from]')!;
    expect(theirs.getAttribute('data-from')).toBe('agent');
    expect(within(theirs as HTMLElement).getByText('08:40').classList.contains('mono')).toBe(true);
    // A screen reader hears who said each message; the eye has the side and the avatar.
    expect(mine.textContent).toContain('You:');
    expect(theirs.textContent).toContain('Editor:');
  });

  it('folds a finished run to one row that opens its steps', () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={entries} now={now} timeZone="Asia/Kolkata" />);
    const fold = screen.getByRole('button', { name: /^Cut episode 14 · 3 steps done/ });
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByText('Read the transcript')).toBeNull();
    fireEvent.click(fold);
    expect(fold.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByText('Read the transcript')).toBeTruthy();
    expect(within(fold).getByText('4m').classList.contains('mono')).toBe(true);
  });

  it('a run still going says how far it is, and a run with no steps to show is not a button', () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={entries} now={now} timeZone="Asia/Kolkata" />);
    expect(screen.getByText(/Shorts from episode 13/).closest('[data-run]')!.textContent).toContain('3 of 5 steps');
    expect(screen.queryByRole('button', { name: /Shorts from episode 13/ })).toBeNull();
    expect(screen.getByText('A card the caller draws')).toBeTruthy();
  });

  it('a failed run says so in words', () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={[{ kind: 'run', id: 'r3', at: '2026-10-23T09:00:00.000Z', title: 'Render the thumbnail set', state: 'failed', done: 1 }]} now={now} timeZone="Asia/Kolkata" />);
    expect(screen.getByText(/Render the thumbnail set/).closest('[data-run]')!.textContent).toContain('failed');
  });

  it('Chausar as chief of staff has its own mark and name', () => {
    const { container } = render(<ChatThread agent={{ name: 'Chausar', chausar: true }} entries={entries.slice(2, 3)} now={now} timeZone="Asia/Kolkata" />);
    expect(screen.getByRole('log', { name: 'Conversation with Chausar' })).toBeTruthy();
    expect(container.querySelector('[data-chausar]')).not.toBeNull();
  });

  it('a model-written figure in a reply carries the "model estimate" label', () => {
    render(<ChatThread agent={{ name: 'Chausar', chausar: true }} entries={[{ kind: 'agent', id: 'm9', at: '2026-10-23T13:00:00.000Z', text: 'About 18,000 views.', estimate: true }]} now={now} timeZone="Asia/Kolkata" />);
    expect(screen.getByText('About 18,000 views.').closest('[data-from]')!.querySelector('[data-estimate]')).not.toBeNull();
  });

  it('an empty thread says so in one sentence', () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={[]} now={now} />);
    expect(screen.getByRole('log').textContent).toBe('No messages yet.');
  });

  it('lets each message set its own direction, so a right-to-left reply reads right', () => {
    render(<ChatThread agent={{ name: 'Editor' }} entries={entries} now={now} timeZone="Asia/Kolkata" />);
    expect(screen.getByText('Cut episode 14 from the recording.').getAttribute('dir')).toBe('auto');
    expect(screen.getByText('Episode 14 is cut. It is on Today for you to watch.').getAttribute('dir')).toBe('auto');
  });

  it('follows new messages only while the owner is at the bottom, never pulling them away from older ones', () => {
    const view = { top: 0, height: 1000, client: 300 };
    const { rerender } = render(<ChatThread agent={{ name: 'Editor' }} entries={entries.slice(0, 3)} now={now} timeZone="Asia/Kolkata" />);
    const log = screen.getByRole('log');
    Object.defineProperty(log, 'scrollHeight', { configurable: true, get: () => view.height });
    Object.defineProperty(log, 'clientHeight', { configurable: true, get: () => view.client });
    Object.defineProperty(log, 'scrollTop', { configurable: true, get: () => view.top, set: (value: number) => { view.top = value; } });
    // The owner scrolls up to read older messages; a new one arrives and they stay where they are.
    view.top = 100;
    fireEvent.scroll(log);
    view.height = 1200;
    rerender(<ChatThread agent={{ name: 'Editor' }} entries={entries.slice(0, 4)} now={now} timeZone="Asia/Kolkata" />);
    expect(view.top).toBe(100);
    // Back at the bottom, the next message brings the thread along.
    view.top = 900;
    fireEvent.scroll(log);
    view.height = 1400;
    rerender(<ChatThread agent={{ name: 'Editor' }} entries={entries.slice(0, 5)} now={now} timeZone="Asia/Kolkata" />);
    expect(view.top).toBe(1400);
  });

  it('long engine words wrap instead of running out of the bubble or the run row', () => {
    for (const name of ['mineText', 'bubble', 'foldText']) expect(ruleOf('ChatThread', name), name).toMatch(/overflow-wrap:\s*anywhere/);
  });
});

describe('DiffCard', () => {
  const lines = [
    { kind: 'same' as const, text: 'Cut shorts under 60 s with a clear hook' },
    { kind: 'removed' as const, text: 'Captions only when the client asks' },
    { kind: 'added' as const, text: 'Always add burned-in captions to shorts' },
  ];
  const done = () => vi.fn(() => Promise.resolve());
  const base = { agent: 'Editor', appliesTo: 'Applies to every short from now on', lines, fromVersion: 4, toVersion: 5 };

  it('shows the before and after in words, the version step, and Accept as the one primary', async () => {
    const onAccept = done();
    const onReject = done();
    render(<DiffCard {...base} dept="prod" onAccept={onAccept} onReject={onReject} onUndo={done()} />);
    const card = screen.getByRole('article', { name: "Proposed change to Editor's instructions" });
    expect(within(card).getByRole('heading', { name: "Proposed change to Editor's instructions" })).toBeTruthy();
    expect(within(card).getByText('Applies to every short from now on')).toBeTruthy();
    const change = within(card).getByRole('group', { name: 'The change, with the lines around it' });
    const added = within(change).getByText('Always add burned-in captions to shorts').closest('[data-line]')!;
    const removed = within(change).getByText('Captions only when the client asks').closest('[data-line]')!;
    expect(added.getAttribute('data-line')).toBe('added');
    expect(added.textContent).toContain('Added:');
    expect(added.querySelector('ins')).not.toBeNull();
    expect(removed.getAttribute('data-line')).toBe('removed');
    expect(removed.textContent).toContain('Removed:');
    expect(removed.querySelector('del')).not.toBeNull();
    const same = within(change).getByText('Cut shorts under 60 s with a clear hook').closest('[data-line]')!;
    expect(same.textContent).not.toMatch(/Added|Removed/);
    expect(within(card).getByText((_, el) => el?.getAttribute('data-version') !== null && el?.textContent === 'Version 4 to 5, you can undo')).toBeTruthy();
    const reject = within(card).getByRole('button', { name: 'Reject' });
    const accept = within(card).getByRole('button', { name: 'Accept' });
    expect(reject.getAttribute('data-variant')).toBe('secondary');
    expect(accept.getAttribute('data-variant')).toBe('primary');
    expect(reject.compareDocumentPosition(accept) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    assertInkRules(document.body);
    assertOnePrimary(document.body);
    await act(async () => { fireEvent.click(accept); });
    await act(async () => { fireEvent.click(reject); });
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).toHaveBeenCalledTimes(1);
  });

  it('a second Accept while the first is on its way does nothing', async () => {
    const sent = deferred();
    const onAccept = vi.fn(() => sent.promise);
    const onReject = done();
    render(<DiffCard {...base} onAccept={onAccept} onReject={onReject} onUndo={done()} />);
    const accept = screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement;
    const reject = screen.getByRole('button', { name: 'Reject' });
    // All three presses land before React draws the waiting buttons, as a fast double press can.
    act(() => {
      fireEvent.click(accept);
      fireEvent.click(accept);
      fireEvent.click(reject);
    });
    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onReject).not.toHaveBeenCalled();
    expect(accept.disabled).toBe(true);
    await act(async () => { sent.resolve(); await sent.promise; });
  });

  it('a decision that fails says why, and both buttons work again with focus back on the one pressed', async () => {
    const sent = deferred();
    render(<DiffCard {...base} onAccept={() => sent.promise} onReject={done()} onUndo={done()} />);
    const accept = screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement;
    accept.focus();
    fireEvent.click(accept);
    await act(async () => { sent.reject(new Error('The instructions changed.')); await sent.promise.catch(() => {}); });
    expect(screen.getByRole('alert').textContent).toContain('The instructions changed.');
    expect(accept.disabled).toBe(false);
    expect(document.activeElement).toBe(accept);
  });

  it('after the owner decides, focus moves to the outcome line, which is a status', async () => {
    const onUndo = done();
    const { rerender } = render(<DiffCard {...base} onAccept={done()} onReject={done()} onUndo={onUndo} />);
    const accept = screen.getByRole('button', { name: 'Accept' });
    accept.focus();
    await act(async () => { fireEvent.click(accept); });
    rerender(<DiffCard {...base} decided="accepted" onAccept={done()} onReject={done()} onUndo={onUndo} />);
    const outcome = screen.getByRole('status');
    expect(outcome.textContent).toBe('Accepted. Editor works to version 5 from the next run.');
    expect(document.activeElement).toBe(outcome);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Undo' })); });
    expect(onUndo).toHaveBeenCalledTimes(1);
    rerender(<DiffCard {...base} decided="undone" onAccept={done()} onReject={done()} onUndo={onUndo} />);
    expect(screen.getByRole('status').textContent).toBe('Undone. Editor is back on version 4.');
    expect(document.activeElement).toBe(screen.getByRole('status'));
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a decision that arrives from elsewhere does not pull focus', () => {
    const { rerender } = render(<><button type="button">Elsewhere</button><DiffCard {...base} onAccept={done()} onReject={done()} onUndo={done()} /></>);
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    rerender(<><button type="button">Elsewhere</button><DiffCard {...base} decided="rejected" onAccept={done()} onReject={done()} onUndo={done()} /></>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Elsewhere' }));
  });

  it('a stale proposal hides both buttons and says why (spec 8)', () => {
    render(<DiffCard {...base} stale onAccept={done()} onReject={done()} onUndo={done()} />);
    expect(screen.queryByRole('button', { name: 'Accept' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Reject' })).toBeNull();
    expect(screen.getByText('This was drafted against an older version.')).toBeTruthy();
  });

  it('while the decision is being sent every button waits, Undo too', () => {
    const { rerender } = render(<DiffCard {...base} busy onAccept={done()} onReject={done()} onUndo={done()} />);
    expect((screen.getByRole('button', { name: 'Accept' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Reject' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<DiffCard {...base} busy decided="accepted" onAccept={done()} onReject={done()} onUndo={done()} />);
    expect((screen.getByRole('button', { name: 'Undo' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('undo is a promise the card always keeps, so it cannot be left out', () => {
    // @ts-expect-error onUndo is required: the card says "you can undo".
    render(<DiffCard {...base} decided="accepted" onAccept={done()} onReject={done()} />);
    expect(screen.getByRole('button', { name: 'Undo' })).toBeTruthy();
  });

  it('once rejected it says nothing changed', () => {
    render(<DiffCard {...base} decided="rejected" onAccept={done()} onReject={done()} onUndo={done()} />);
    expect(screen.getByRole('status').textContent).toBe('Rejected. The instructions did not change.');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('long engine words wrap instead of running out of the card', () => {
    for (const name of ['title', 'applies', 'text', 'note']) expect(ruleOf('DiffCard', name), name).toMatch(/overflow-wrap:\s*anywhere/);
  });

  it('speaks Hindi', () => {
    render(<TextProvider language="hi"><DiffCard {...base} appliesTo="x" onAccept={done()} onReject={done()} onUndo={done()} /></TextProvider>);
    expect(screen.getByRole('heading').textContent).toContain('Editor');
    expect(screen.getByRole('heading').textContent).not.toBe("Proposed change to Editor's instructions");
  });
});

describe('the talk parts together pass axe', () => {
  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <PathLine people={[{ name: 'Rahul Mehta', confirmed: true }, { name: 'Sameer Joshi', confirmed: false }]} layout="named" />
        <StrengthDots level={2} onOpen={() => {}} />
        <Board label="Pipeline board" columns={[{ id: 'new', title: 'New', cards: [{ id: 'a', node: <BoardCard name="Asha Rao" sub="Pocket Audio" onOpen={() => {}} /> }] }, { id: 'lost', title: 'Lost', folded: true, cards: [] }]} />
        <NotificationBell unread={3} />
        <ChatThread agent={{ name: 'Editor' }} entries={[{ kind: 'owner', id: 'm1', at: '2026-10-23T08:00:00.000Z', text: 'Hello' }, { kind: 'run', id: 'r1', at: '2026-10-23T08:01:00.000Z', title: 'Cut', state: 'done', done: 2, steps: <p>Steps</p> }]} />
        <DiffCard agent="Editor" appliesTo="Applies from now on" lines={[{ kind: 'added', text: 'Always add captions' }]} fromVersion={1} toVersion={2} onAccept={() => Promise.resolve()} onReject={() => Promise.resolve()} onUndo={() => Promise.resolve()} />
        <Composer label="Message Editor" onSend={() => Promise.resolve()} suggestions={['Show short 3']} />
      </main>,
    );
    const result = await axe.run(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(result.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`)).toEqual([]);
  });
});

