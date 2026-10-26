import { describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { createRef, useRef, type ComponentProps } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { StoriesRow, type Story } from '../../src/parts/StoriesRow';
import { PreviewFrame } from '../../src/parts/PreviewFrame';
import { SwipeCard, SWIPE_DISTANCE } from '../../src/parts/SwipeCard';
import { BottomTabs } from '../../src/parts/BottomTabs';
import { Gallery, GalleryTile, type GalleryWay } from '../../src/parts/Gallery';
import { Button } from '../../src/parts/Button';
import { ApprovalRow, type ApprovalHandle } from '../../src/parts/ApprovalRow';
import type { QueueRow } from '../../src/engine/types';
import { TextProvider } from '../../src/text';
import { assertFiguresProved, assertInkRules, assertNoInlineStyles, assertOnePrimary } from '../helpers/ink-rules';

/** A text key ("story.status.idle") shown as text means a missing string. */
const KEY_LIKE = /^[a-z]+(\.[a-zA-Z0-9-]+)+$/;

/** Every text node, and every aria-label, in `root` that is or holds a text key. */
function keysShown(root: Element): string[] {
  const found: string[] = [];
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = (node.textContent ?? '').trim();
    if (KEY_LIKE.test(text)) found.push(text);
  }
  for (const el of root.querySelectorAll('[aria-label]')) {
    const label = el.getAttribute('aria-label') ?? '';
    if (KEY_LIKE.test(label) || /\b[a-z]+\.[a-z]+\.[a-zA-Z]+/.test(label)) found.push(label);
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------------------
// StoriesRow
// ---------------------------------------------------------------------------------------------------------------

const STORIES: Story[] = [
  { id: 'producer', name: 'Producer', state: 'waiting', progress: { done: 2, total: 3 } },
  { id: 'editor', name: 'Editor', state: 'working', progress: { done: 3, total: 5 } },
  { id: 'researcher', name: 'Researcher', state: 'working', progress: 'indeterminate' },
  { id: 'thumbs', name: 'Thumbnailer', state: 'failed' },
  { id: 'bookkeeper', name: 'Bookkeeper', state: 'idle' },
];

describe('StoriesRow', () => {
  it('is a list of buttons, each named by the agent and its status words', () => {
    render(<StoriesRow stories={STORIES} onOpen={() => {}} />);
    const list = screen.getByRole('list', { name: 'Your agents' });
    const names = within(list).getAllByRole('button').map((b) => b.getAttribute('aria-label'));
    expect(names).toEqual([
      'Producer, needs you',
      'Editor, 3 of 5',
      'Researcher, working',
      'Thumbnailer, failed',
      'Bookkeeper, idle',
    ]);
  });

  it('colours the status words by tone, and a step count is DM Mono', () => {
    render(<StoriesRow stories={STORIES} onOpen={() => {}} />);
    const status = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) }).querySelector('[data-tone]') as HTMLElement;
    expect(status('Producer').textContent).toBe('Needs you');
    expect(status('Producer').dataset.tone).toBe('wait');
    expect(status('Editor').textContent).toBe('3 of 5');
    expect(status('Editor').dataset.tone).toBe('working');
    expect(status('Editor').classList.contains('mono')).toBe(true);
    expect(status('Researcher').textContent).toBe('Working');
    expect(status('Researcher').dataset.tone).toBe('working');
    expect(status('Thumbnailer').textContent).toBe('Failed');
    expect(status('Thumbnailer').dataset.tone).toBe('fail');
    expect(status('Bookkeeper').textContent).toBe('Idle');
    expect(status('Bookkeeper').dataset.tone).toBe('plain');
  });

  it('draws the 60 px story avatar with its ring, and the department badge only when a department is known', () => {
    render(<StoriesRow stories={[...STORIES, { id: 'billing', name: 'Billing', state: 'idle', dept: 'money' }]} onOpen={() => {}} />);
    const avatar = (name: string) => screen.getByRole('button', { name: new RegExp(`^${name},`) }).querySelector('[data-size]') as HTMLElement;
    expect(avatar('Producer').dataset.size).toBe('60');
    expect(avatar('Producer').getAttribute('aria-hidden')).toBe('true');
    expect(avatar('Producer').dataset.state).toBe('waiting');
    expect(avatar('Editor').dataset.state).toBe('working');
    expect(avatar('Thumbnailer').dataset.state).toBe('failed');
    expect(avatar('Bookkeeper').dataset.state).toBeUndefined();
    expect(avatar('Producer').dataset.dept).toBe('none');
    expect(avatar('Producer').querySelector('[data-badge]')).toBeNull();
    expect(avatar('Billing').dataset.dept).toBe('money');
    expect(avatar('Billing').querySelector('[data-badge]')).not.toBeNull();
  });

  it('calls onOpen with the agent id', () => {
    const onOpen = vi.fn();
    render(<StoriesRow stories={STORIES} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'Editor, 3 of 5' }));
    expect(onOpen).toHaveBeenCalledWith('editor');
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('shows the lead slot and the add item only when they are given', () => {
    const { rerender } = render(<StoriesRow stories={STORIES} onOpen={() => {}} />);
    const list = screen.getByRole('list', { name: 'Your agents' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(STORIES.length);
    expect(screen.queryByRole('button', { name: 'Add agent' })).toBeNull();

    const onAdd = vi.fn();
    rerender(<StoriesRow stories={STORIES} onOpen={() => {}} lead={<button type="button">Lead story</button>} onAdd={onAdd} />);
    const items = within(screen.getByRole('list', { name: 'Your agents' })).getAllByRole('listitem');
    expect(items).toHaveLength(STORIES.length + 2);
    expect(within(items[0]!).getByRole('button').textContent).toBe('Lead story');
    const add = within(items.at(-1)!).getByRole('button', { name: 'Add agent' });
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
  });

  it('puts the row in the phone\'s horizontal scroll when asked', () => {
    const { rerender } = render(<StoriesRow stories={STORIES} onOpen={() => {}} />);
    expect((screen.getByRole('list') as HTMLElement).dataset.scroll).toBeUndefined();
    rerender(<StoriesRow stories={STORIES} onOpen={() => {}} scroll />);
    expect((screen.getByRole('list') as HTMLElement).dataset.scroll).toBe('');
  });

  it('keeps the Ink rules and reads in Hindi with no key showing', () => {
    const { container } = render(<TextProvider language="hi"><StoriesRow stories={STORIES} onOpen={() => {}} onAdd={() => {}} /></TextProvider>);
    assertInkRules(document.body);
    expect(keysShown(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// PreviewFrame
// ---------------------------------------------------------------------------------------------------------------

describe('PreviewFrame', () => {
  it('video: the ground, the title, the "not watched" tag and a play button that opens it', () => {
    const onOpen = vi.fn();
    const { container } = render(<PreviewFrame variant="video" title="Cut of the launch video" unseen onOpen={onOpen} />);
    const frame = container.querySelector('[data-preview]') as HTMLElement;
    expect(frame.dataset.preview).toBe('video');
    expect(frame.textContent).toContain('Cut of the launch video');
    expect(frame.textContent).toContain('Not watched yet');
    // Drawing it at rest does not count as viewing it.
    expect(onOpen).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Watch Cut of the launch video' }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    assertInkRules(document.body);
  });

  it('video: no tag once watched, duration and chapters only when given, and never a video or image element', () => {
    const { container, rerender } = render(<PreviewFrame variant="video" title="Cut" onOpen={() => {}} />);
    expect(container.textContent).not.toContain('Not watched yet');
    expect(container.querySelector('[data-duration]')).toBeNull();
    expect(container.querySelector('[data-chapters]')).toBeNull();
    rerender(<PreviewFrame variant="video" title="Cut" duration="7:05" chapters={4} onOpen={() => {}} />);
    const duration = container.querySelector('[data-duration]') as HTMLElement;
    expect(duration.textContent).toContain('7:05');
    expect(duration.querySelector('.mono')!.textContent).toBe('7:05');
    expect(container.querySelector('[data-chapters]')!.textContent).toBe('4 chapters');
    rerender(<PreviewFrame variant="video" title="Cut" chapters={1} onOpen={() => {}} />);
    expect(container.querySelector('[data-chapters]')!.textContent).toBe('1 chapter');
    expect(container.querySelector('video, img, iframe')).toBeNull();
  });

  it('paper: the lines with their values in DM Mono inside a labelled image, and the total as a Figure with its receipt', () => {
    const onReceipt = vi.fn();
    const { container } = render(
      <PreviewFrame
        variant="paper"
        label="Invoice T-7, total ₹1,180.00"
        business="Test Books"
        docRef="T-7"
        title="Billed to Sample Client"
        lines={[{ label: 'Monthly books', value: '₹1,000.00' }, { label: 'GST at 18%', value: '₹180.00' }, { label: 'Paid by bank transfer' }]}
        total={{ value: '₹1,180.00', receiptId: 'R-77' }}
        onReceipt={onReceipt}
      />,
    );
    const sheet = screen.getByRole('img', { name: 'Invoice T-7, total ₹1,180.00' });
    expect(sheet.textContent).toContain('Monthly books');
    expect(sheet.textContent).toContain('Billed to Sample Client');
    const values = [...sheet.querySelectorAll('.mono')].map((el) => el.textContent);
    expect(values).toEqual(expect.arrayContaining(['T-7', '₹1,000.00', '₹180.00']));
    expect(sheet.textContent).toContain('Paid by bank transfer');
    // The receipt stays a reachable button: nothing interactive sits inside the image.
    expect(sheet.querySelector('button')).toBeNull();
    const receipt = screen.getByRole('button', { name: 'Receipt R-77' });
    expect(receipt.closest('[data-figure]')!.querySelector('[data-ui-number]')!.textContent).toBe('₹1,180.00');
    fireEvent.click(receipt);
    expect(onReceipt).toHaveBeenCalledWith('R-77');
    expect(assertFiguresProved(document.body)).toHaveLength(1);
    assertInkRules(document.body);
  });

  it('paper: a model-written total says "model estimate" and has no receipt', () => {
    const { container } = render(<PreviewFrame variant="paper" label="Quote" lines={[]} total={{ value: '₹900', estimate: true }} />);
    expect(container.querySelector('[data-estimate]')).not.toBeNull();
    expect(container.querySelector('[data-receipt]')).toBeNull();
    assertFiguresProved(document.body);
  });

  it('change: the change pill with its receipt, and the breakdown boxes only when given', () => {
    const { container, rerender } = render(
      <PreviewFrame variant="change" change={{ label: 'Slot', before: '₹100', after: '₹120', receiptId: 'R-9' }} />,
    );
    expect(container.querySelector('[data-preview]')!.getAttribute('data-preview')).toBe('change');
    expect(container.textContent).toContain('₹100');
    expect(container.textContent).toContain('₹120');
    expect(screen.getByRole('button', { name: 'Receipt R-9' })).toBeTruthy();
    expect(screen.queryByRole('group', { name: 'How it is worked out' })).toBeNull();
    rerender(
      <PreviewFrame
        variant="change"
        change={{ before: '₹100', after: '₹120', receiptId: 'R-9' }}
        breakdown={{ parts: [{ label: 'Each', value: '₹60.00' }, { label: 'Times', value: '2' }, { label: 'Before tax', value: '₹120.00' }], ops: ['×', '='] }}
      />,
    );
    const group = screen.getByRole('group', { name: 'How it is worked out' });
    expect(within(group).getByText('Each')).toBeTruthy();
    expect(within(group).getByText('₹60.00').classList.contains('mono')).toBe(true);
    const ops = [...group.querySelectorAll('[data-op]')];
    expect(ops.map((op) => op.textContent)).toEqual(['×', '=']);
    for (const op of ops) expect(op.getAttribute('aria-hidden')).toBe('true');
    // The change's receipt proves the old and new values and the breakdown, as one group.
    assertFiguresProved(document.body);
    assertInkRules(document.body);
  });

  it('text: the view\'s sections, headings and lines, as the engine wrote them', () => {
    const { container } = render(
      <PreviewFrame
        variant="text"
        view={{ title: 'Working for the month', line: 'Worked by the calculator', sections: [{ heading: 'On sales', lines: ['Taxable value ₹500.00', 'Tax ₹90.00'] }, { lines: ['Register matches the invoices'] }] }}
      />,
    );
    expect(screen.getByText('Working for the month')).toBeTruthy();
    expect(screen.getByText('Worked by the calculator')).toBeTruthy();
    expect(screen.getByText('On sales')).toBeTruthy();
    expect(screen.getByText('Taxable value ₹500.00')).toBeTruthy();
    expect(screen.getByText('Register matches the invoices')).toBeTruthy();
    assertNoInlineStyles(document.body);
  });

  it('text: amounts in the lines are proved by the receipt the caller gives, and flagged without one', () => {
    const view = { title: 'Working', sections: [{ lines: ['Tax ₹90.00'] }] };
    const onReceipt = vi.fn();
    const { unmount } = render(<PreviewFrame variant="text" view={view} proof={{ receiptId: 'R-5' }} onReceipt={onReceipt} />);
    expect(document.body.querySelector('[data-figure-group]')).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Receipt R-5' }));
    expect(onReceipt).toHaveBeenCalledWith('R-5');
    assertFiguresProved(document.body);
    unmount();

    render(<PreviewFrame variant="text" view={view} proof={{ estimate: true }} />);
    expect(document.body.querySelector('[data-estimate]')).not.toBeNull();
    assertFiguresProved(document.body);
    cleanup();

    render(<PreviewFrame variant="text" view={view} />);
    expect(() => assertFiguresProved(document.body)).toThrow(/₹90\.00/);
  });

  it('choice: a labelled radio group; picking one only reports the choice', () => {
    const onChange = vi.fn();
    const { container } = render(
      <PreviewFrame variant="choice" label="Title for the next episode" options={[{ id: 'a', label: 'First title' }, { id: 'b', label: 'Second title' }]} value="a" onChange={onChange} />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Title for the next episode' });
    const radios = within(group).getAllByRole('radio');
    expect(radios).toHaveLength(2);
    expect(screen.getByRole('radio', { name: /Option A.*First title/ })).toHaveProperty('checked', true);
    fireEvent.click(screen.getByRole('radio', { name: /Option B.*Second title/ }));
    expect(onChange).toHaveBeenCalledWith('b');
    assertInkRules(document.body);
  });

  it('choice: the focus ring follows keyboard focus only', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/PreviewFrame.module.css'), 'utf8');
    expect(css).toContain('.option:has(:focus-visible)');
    expect(css).not.toContain(':focus-within');
  });

  it('post: the account, the platform and the text', () => {
    const { container } = render(<PreviewFrame variant="post" account="Test Studio" platform="LinkedIn" text="A short post about the new episode." />);
    expect(screen.getByText('Test Studio')).toBeTruthy();
    expect(screen.getByText('Post on LinkedIn')).toBeTruthy();
    expect(screen.getByText('A short post about the new episode.')).toBeTruthy();
    assertInkRules(document.body);
  });

  it('reads in Hindi with no key showing', () => {
    const { container } = render(
      <TextProvider language="hi">
        <PreviewFrame variant="video" title="Cut" unseen duration="1:00" chapters={2} onOpen={() => {}} />
        <PreviewFrame variant="post" account="A" platform="LinkedIn" text="B" />
        <PreviewFrame variant="choice" label="L" options={[{ id: 'a', label: 'x' }]} />
      </TextProvider>,
    );
    expect(keysShown(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// SwipeCard
// ---------------------------------------------------------------------------------------------------------------

/** Drags from x 100 by `dx` (and `dy`) in a few moves, then lets go (on `releaseOn`, the target when left out). */
function drag(target: Element, dx: number, dy = 0, { release = true, id = 7, type = 'touch', releaseOn }: { release?: boolean; id?: number; type?: string; releaseOn?: Element } = {}) {
  const pointer = { pointerId: id, button: 0, pointerType: type };
  fireEvent.pointerDown(target, { ...pointer, clientX: 100, clientY: 100 });
  for (const part of [0.25, 0.5, 1]) fireEvent.pointerMove(target, { ...pointer, clientX: 100 + dx * part, clientY: 100 + dy * part });
  if (release) fireEvent.pointerUp(releaseOn ?? target, { ...pointer, clientX: 100 + dx, clientY: 100 + dy });
}

function swipeCard(props: Partial<Parameters<typeof SwipeCard>[0]> = {}) {
  const onRight = vi.fn();
  const onLeft = vi.fn();
  const onPrimary = vi.fn();
  const view = render(
    <SwipeCard rightLabel="Approve" leftLabel="Later" onRight={onRight} onLeft={onLeft} {...props}>
      <article data-card="">
        <h3>Price for the slot</h3>
        <Button variant="primary" onClick={onPrimary}>Approve</Button>
      </article>
    </SwipeCard>,
  );
  const card = view.container.querySelector('[data-swipe-card]') as HTMLElement;
  return { ...view, card, onRight, onLeft, onPrimary };
}

function stubReducedMotion(reduce: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }) as MediaQueryList);
}

describe('SwipeCard', () => {
  it('a drag right of the swipe distance or more calls onRight once', () => {
    expect(SWIPE_DISTANCE).toBe(96);
    const { card, onRight, onLeft } = swipeCard();
    drag(card, 96);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onLeft).not.toHaveBeenCalled();
  });

  it('a drag left of the swipe distance or more calls onLeft once', () => {
    const { card, onRight, onLeft } = swipeCard();
    drag(card, -120);
    expect(onLeft).toHaveBeenCalledTimes(1);
    expect(onRight).not.toHaveBeenCalled();
  });

  // w3 3H1 review: a card whose primary is no decision (open a business, go to Connections) does not swipe right.
  it('with no onRight a right drag shows no ground and does nothing; left still works', () => {
    const onLeft = vi.fn();
    const { container } = render(
      <SwipeCard rightLabel="Open" onLeft={onLeft}><article data-card=""><h3>Sitara Events is locked</h3></article></SwipeCard>,
    );
    const card = container.querySelector('[data-swipe-card]') as HTMLElement;
    drag(card, 120, 0, { release: false });
    expect(container.querySelector('[data-under]')).toBeNull();
    expect(card.hasAttribute('data-shift')).toBe(false);
    fireEvent.pointerUp(card, { pointerId: 7, clientX: 220, clientY: 100 });
    drag(card, -120);
    expect(onLeft).toHaveBeenCalledTimes(1);
  });

  it("reads the primary's words and 'asks once more' when the card moves, so a newer version's words show", () => {
    let label = 'Approve';
    let again = false;
    const { container, card } = swipeCard({ rightLabel: () => label, asksAgain: () => again });
    label = 'Issue';
    again = true;
    drag(card, 60, 0, { release: false });
    expect(container.querySelector('[data-under="right"]')!.textContent).toBe('Issueasks once more');
  });

  it('a shorter drag calls nothing and snaps back once, over the settle time', () => {
    const { card, onRight, onLeft } = swipeCard();
    drag(card, 90, 0, { release: false });
    expect(card.dataset.side).toBe('right');
    expect(Number(card.dataset.shift)).toBeGreaterThan(0);
    fireEvent.pointerUp(card, { pointerId: 7, clientX: 190, clientY: 100 });
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
    expect(card.dataset.shift).toBeUndefined();
    expect(card.dataset.snap).toBeDefined();
    fireEvent.animationEnd(card);
    expect(card.dataset.snap).toBeUndefined();
    expect(card.dataset.side).toBeUndefined();
  });

  it('under reduced motion the card returns at once, with no snap', () => {
    stubReducedMotion(true);
    const { card } = swipeCard();
    drag(card, 40);
    expect(card.dataset.snap).toBeUndefined();
    expect(card.dataset.shift).toBeUndefined();
  });

  it('follows the finger in token steps, armed at the swipe distance, with no inline style', () => {
    const { container, card } = swipeCard();
    drag(card, 50, 0, { release: false });
    const half = Number(card.dataset.shift);
    expect(card.dataset.armed).toBeUndefined();
    drag(card, 200, 0, { release: false });
    expect(Number(card.dataset.shift)).toBeGreaterThan(half);
    expect(card.dataset.armed).toBe('');
    assertInkRules(document.body);
  });

  it('a right swipe goes through the card\'s own path, and shows why when that path answers "locked"', () => {
    const onRight = vi.fn(() => 'locked' as const);
    const { card, container } = swipeCard({ onRight, rightLocked: true, lockedNote: 'Approve unlocks after you watch it' });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    drag(card, 150);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(status.textContent).toBe('Approve unlocks after you watch it');
    // The underlay says it is locked: the lock, not the tick.
    drag(card, 50, 0, { release: false });
    const under = container.querySelector('[data-under="right"]') as HTMLElement;
    expect(under.dataset.locked).toBe('');
  });

  it('any answer but "locked" (asking, busy, none, or opened something to view) shows no note and the card goes back', () => {
    for (const answer of ['pressed', 'asking', 'busy', 'none', undefined] as const) {
      const view = swipeCard({ onRight: () => answer, lockedNote: 'Open it first' });
      drag(view.card, 140);
      expect(screen.getByRole('status').textContent, String(answer)).toBe('');
      expect(view.card.dataset.shift, String(answer)).toBeUndefined();
      expect(view.card.dataset.snap, String(answer)).toBeDefined();
      view.unmount();
    }
  });

  it('never trusts a stale lock: it always asks the card, and reads the lock and the note when it needs them', () => {
    let locked = true;
    const onRight = vi.fn(() => (locked ? 'locked' as const : 'pressed' as const));
    const { card, container } = swipeCard({ onRight, rightLocked: () => locked, lockedNote: () => 'Open it first' });
    drag(card, 50, 0, { release: false });
    expect((container.querySelector('[data-under="right"]') as HTMLElement).dataset.locked).toBe('');
    fireEvent.pointerUp(card, { pointerId: 7, clientX: 150, clientY: 100 });
    drag(card, 150);
    expect(screen.getByRole('status').textContent).toBe('Open it first');
    locked = false;
    drag(card, 150);
    expect(onRight).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('status').textContent).toBe('');
    drag(card, 50, 0, { release: false });
    expect((container.querySelector('[data-under="right"]') as HTMLElement).dataset.locked).toBeUndefined();
  });

  it('the underlay says the primary\'s words, and "asks once more" when the primary asks again', () => {
    const plain = swipeCard();
    drag(plain.card, 40, 0, { release: false });
    const under = plain.container.querySelector('[data-under="right"]') as HTMLElement;
    expect(under.getAttribute('aria-hidden')).toBe('true');
    expect(under.textContent).toBe('Approve');
    plain.unmount();

    const again = swipeCard({ rightLabel: 'Issue', asksAgain: true });
    drag(again.card, 40, 0, { release: false });
    expect(again.container.querySelector('[data-under="right"]')!.textContent).toBe('Issueasks once more');
    again.unmount();

    const left = swipeCard();
    drag(left.card, -40, 0, { release: false });
    expect(left.container.querySelector('[data-under="left"]')!.textContent).toBe('Later');
  });

  it('a mostly vertical drag is a scroll, never a swipe', () => {
    const { card, onRight, onLeft } = swipeCard();
    drag(card, 30, 160);
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
    expect(card.dataset.shift).toBeUndefined();
  });

  it('never decides anything itself: a full swipe only calls the handler, never the card\'s own buttons', () => {
    const { card, onRight, onPrimary } = swipeCard();
    drag(card, 140);
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
    const source = readFileSync(join(import.meta.dirname, '../../src/parts/SwipeCard.tsx'), 'utf8');
    expect(source).not.toMatch(/from ['"][./]*engine/);
  });

  it('a plain tap on the card\'s buttons still works', () => {
    const { onPrimary } = swipeCard();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('with no onLeft a left drag does nothing and shows no underlay', () => {
    const onRight = vi.fn();
    const { container } = render(<SwipeCard rightLabel="Approve" onRight={onRight}><p>Card</p></SwipeCard>);
    const card = container.querySelector('[data-swipe-card]') as HTMLElement;
    drag(card, -150, 0, { release: false });
    expect(card.dataset.shift).toBeUndefined();
    expect(container.querySelector('[data-under="left"]')).toBeNull();
    act(() => { fireEvent.pointerUp(card, { pointerId: 7, clientX: -50, clientY: 100 }); });
    expect(onRight).not.toHaveBeenCalled();
  });

  it('a second finger drops the swipe without acting: a two-finger pan is never a swipe', () => {
    const { card, onRight, onLeft } = swipeCard();
    const one = { pointerId: 1, button: 0, pointerType: 'touch' };
    const two = { pointerId: 2, button: 0, pointerType: 'touch' };
    fireEvent.pointerDown(card, { ...one, clientX: 100, clientY: 100 });
    fireEvent.pointerDown(card, { ...two, clientX: 100, clientY: 130 });
    for (const x of [130, 170, 230]) {
      fireEvent.pointerMove(card, { ...one, clientX: x, clientY: 100 });
      fireEvent.pointerMove(card, { ...two, clientX: x, clientY: 130 });
    }
    expect(card.dataset.shift).toBeUndefined();
    fireEvent.pointerUp(card, { ...one, clientX: 230, clientY: 100 });
    fireEvent.pointerUp(card, { ...two, clientX: 230, clientY: 130 });
    expect(onRight).not.toHaveBeenCalled();
    expect(onLeft).not.toHaveBeenCalled();
    // Once every finger is up, one finger swipes again.
    drag(card, 130, 0, { id: 3 });
    expect(onRight).toHaveBeenCalledTimes(1);
  });

  it('a second finger mid-swipe drops it and the card goes back', () => {
    const { card, onRight } = swipeCard();
    drag(card, 80, 0, { release: false, id: 4 });
    expect(Number(card.dataset.shift)).toBeGreaterThan(0);
    fireEvent.pointerDown(card, { pointerId: 5, button: 0, pointerType: 'touch', clientX: 200, clientY: 140 });
    expect(card.dataset.shift).toBeUndefined();
    fireEvent.pointerMove(card, { pointerId: 4, button: 0, pointerType: 'touch', clientX: 260, clientY: 100 });
    fireEvent.pointerUp(card, { pointerId: 4, button: 0, pointerType: 'touch', clientX: 260, clientY: 100 });
    fireEvent.pointerUp(card, { pointerId: 5, button: 0, pointerType: 'touch', clientX: 200, clientY: 140 });
    expect(onRight).not.toHaveBeenCalled();
  });

  it('a cancelled pointer acts on nothing and the card goes back', () => {
    const { card, onRight } = swipeCard();
    drag(card, 130, 0, { release: false, id: 6 });
    fireEvent.pointerCancel(card, { pointerId: 6, button: 0, pointerType: 'touch', clientX: 230, clientY: 100 });
    expect(onRight).not.toHaveBeenCalled();
    expect(card.dataset.shift).toBeUndefined();
    expect(card.dataset.snap).toBeDefined();
  });

  it('a drag that turns into a scroll and ends outside the card leaves later swipes working', () => {
    const { card, onRight } = swipeCard();
    drag(card, 4, 220, { id: 8, releaseOn: document.body });
    drag(card, 130, 0, { id: 9 });
    expect(onRight).toHaveBeenCalledTimes(1);
  });

  it('a swipe that starts on a button inside the card swipes, and never presses that button', () => {
    const { onRight, onPrimary } = swipeCard();
    const button = screen.getByRole('button', { name: 'Approve' });
    drag(button, 130, 0, { id: 10 });
    fireEvent.click(button);
    expect(onRight).toHaveBeenCalledTimes(1);
    expect(onPrimary).not.toHaveBeenCalled();
  });

  it('only the click that follows a swipe is swallowed: a later tap or double-tap still presses', () => {
    let now = 1000;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    const { card, onPrimary } = swipeCard();
    drag(card, 130, 0, { id: 11 });
    now = 2500;
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('a mouse drag is not a swipe: mouse users have the buttons', () => {
    const { card, onRight, onPrimary } = swipeCard();
    drag(card, 160, 0, { id: 12, type: 'mouse' });
    expect(card.dataset.shift).toBeUndefined();
    expect(onRight).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    expect(onPrimary).toHaveBeenCalledTimes(1);
  });

  it('lets pinch-zoom through: the card takes only sideways drags', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/SwipeCard.module.css'), 'utf8');
    expect(css).toMatch(/touch-action:\s*pan-y pinch-zoom/);
  });
});

describe('SwipeCard with a real ApprovalRow behind it', () => {
  const price: QueueRow = {
    id: 'q-slot', businessId: 'b1', businessName: 'Test Studio', agent: 'Producer', kind: 'price', createdAt: '2026-10-21T08:52:00.000Z', digest: 'd2',
    title: 'Slot price', change: { before: '₹100', after: '₹120', receiptId: 'R-9' },
    actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }],
  };
  const draft: QueueRow = {
    id: 'q-cut', businessId: 'b1', businessName: 'Test Studio', agent: 'Editor', kind: 'draft', createdAt: '2026-10-21T08:40:00.000Z', digest: 'd1',
    title: 'The cut is ready', viewRef: { kind: 'draft', id: 'cut' },
    actions: [{ id: 'watch', label: 'Watch', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
  };

  /** The wiring 3H1 uses: the swipe presses the card's own buttons through its handle. */
  type Decide = ComponentProps<typeof ApprovalRow>['onDecide'];

  function Swiped({ row, onDecide }: { row: QueueRow; onDecide: Decide }) {
    const handle = useRef<ApprovalHandle>(null);
    return (
      <SwipeCard
        rightLabel="Approve"
        onRight={() => handle.current?.pressPrimary() ?? 'none'}
        onLeft={() => handle.current?.pressLater() ?? 'none'}
        rightLocked={() => handle.current?.primary().locked ?? false}
        lockedNote={() => handle.current?.primary().note}
      >
        <ApprovalRow layout="card" row={row} onDecide={onDecide} handle={handle} />
      </SwipeCard>
    );
  }

  it('two quick swipes right never confirm the second ask', () => {
    const onDecide = vi.fn<Decide>();
    const { container } = render(<Swiped row={price} onDecide={onDecide} />);
    const card = container.querySelector('[data-swipe-card]') as HTMLElement;
    drag(card, 130, 0, { id: 21 });
    drag(card, 130, 0, { id: 22 });
    expect(onDecide).not.toHaveBeenCalled();
    expect(container.textContent).toContain("This can't be undone. Approve?");
  });

  it('a swipe right on a row not opened yet decides nothing and says why', () => {
    const onDecide = vi.fn<Decide>();
    const handle = createRef<ApprovalHandle>();
    const { container } = render(<Swiped row={draft} onDecide={onDecide} />);
    const probe = render(<ApprovalRow layout="card" row={draft} onDecide={vi.fn()} handle={handle} />);
    const note = handle.current!.primary().note!;
    probe.unmount();
    expect(note).toBeTruthy();
    const card = container.querySelector('[data-swipe-card]') as HTMLElement;
    drag(card, 130, 0, { id: 23 });
    expect(onDecide).not.toHaveBeenCalled();
    const status = [...container.querySelectorAll('[role="status"]')].find((el) => el.closest('[data-swipe-card]') === null)!;
    expect(status.textContent).toBe(note);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// BottomTabs
// ---------------------------------------------------------------------------------------------------------------

const TABS = [
  { id: 'today', href: '#/today', label: 'Today', icon: 'sun', badge: 12 },
  { id: 'team', href: '#/team', label: 'Team', icon: 'users' },
  { id: 'work', href: '#/work', label: 'Work', icon: 'briefcase' },
  { id: 'clients', href: '#/clients', label: 'Clients', icon: 'contact' },
  { id: 'more', href: '#/more', label: 'More', icon: 'layout-grid' },
] as const;

describe('BottomTabs', () => {
  it('is a nav named "Places" with the links it is given', () => {
    render(<BottomTabs tabs={TABS} current="team" />);
    const nav = screen.getByRole('navigation', { name: 'Places' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['#/today', '#/team', '#/work', '#/clients', '#/more']);
    expect(within(nav).getByRole('link', { name: 'Team' })).toBeTruthy();
    for (const link of links) expect(link.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('marks the current tab with aria-current and the tab line', () => {
    const { container } = render(<BottomTabs tabs={TABS} current="work" />);
    const work = screen.getByRole('link', { name: 'Work' });
    expect(work.getAttribute('aria-current')).toBe('page');
    expect(work.dataset.current).toBe('');
    expect(work.querySelector('[data-tab-line]')).not.toBeNull();
    expect(container.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-tab-line]')).toHaveLength(1);
    expect(screen.getByRole('link', { name: /^Today/ }).dataset.current).toBeUndefined();
  });

  it('shows Today\'s count in DM Mono, hidden from screen readers, which hear it in words', () => {
    render(<BottomTabs tabs={TABS} current="today" />);
    const today = screen.getByRole('link', { name: 'Today, 12 need you' });
    const badge = today.querySelector('[data-badge]') as HTMLElement;
    expect(badge.getAttribute('aria-hidden')).toBe('true');
    expect(badge.textContent).toBe('12');
    expect(badge.querySelector('.mono')).not.toBeNull();
    expect(today.querySelector('.sr-only')!.textContent).toBe(', 12 need you');
  });

  it('keeps the Ink rules and reads in Hindi', () => {
    const { container } = render(<TextProvider language="hi"><BottomTabs tabs={TABS} current="today" /></TextProvider>);
    assertInkRules(document.body);
    expect(keysShown(container)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Gallery
// ---------------------------------------------------------------------------------------------------------------

const WAY: GalleryWay = {
  id: 'wedding-videos',
  name: 'Wedding videos',
  line: 'Invitation videos for families, made from their photos.',
  icon: 'play',
  category: 'Content',
  hours: '3 to 5 h a week',
  youDo: 'Meet families, approve each cut.',
  team: { names: ['Editor', 'Researcher', 'Producer'], line: 'Edits, music and quotes.' },
  pay: { range: '₹2,000 to ₹6,000', per: 'per video' },
};

describe('GalleryTile', () => {
  it('is an article labelled by its name, with its icon and category chip', () => {
    const { container } = render(<GalleryTile way={WAY} onStart={() => {}} />);
    const tile = screen.getByRole('article', { name: 'Wedding videos' });
    expect(tile.dataset.card).toBe('');
    expect(tile.querySelector('svg')!.getAttribute('aria-hidden')).toBe('true');
    expect(within(tile).getByText('Content')).toBeTruthy();
    expect(within(tile).getByText('Invitation videos for families, made from their photos.')).toBeTruthy();
    expect(within(tile).queryByText('You run this')).toBeNull();
    assertInkRules(document.body);
  });

  it('says "You run this" with the business initials when the owner already runs one, and offers another', () => {
    render(<GalleryTile way={{ ...WAY, running: 'Sample Films' }} onStart={() => {}} />);
    const tile = screen.getByRole('article', { name: 'Wedding videos' });
    const chip = within(tile).getByText('You run this').closest('[data-chip]') as HTMLElement;
    expect(chip.querySelector('[aria-hidden="true"]')!.textContent).toBe('SF');
    expect(within(tile).queryByText('Content')).toBeNull();
    expect(within(tile).getByRole('button', { name: 'Start another Wedding videos' })).toBeTruthy();
  });

  it('says what you do with the engine\'s hours, and what the AI team does with an avatar stack', () => {
    render(<GalleryTile way={WAY} onStart={() => {}} />);
    const tile = screen.getByRole('article', { name: 'Wedding videos' });
    expect(within(tile).getByText('What you do')).toBeTruthy();
    expect(within(tile).getByText('3 to 5 h a week').classList.contains('mono')).toBe(true);
    expect(within(tile).getByText('Meet families, approve each cut.')).toBeTruthy();
    expect(within(tile).getByText('What your AI team does')).toBeTruthy();
    const stack = within(tile).getByRole('img', { name: '3 agents: Editor, Researcher and Producer' });
    expect(stack.querySelectorAll('[data-size="24"]')).toHaveLength(3);
    expect(within(tile).getByText('Edits, music and quotes.')).toBeTruthy();
  });

  it('shows what clients usually pay as a model estimate, the label on the line above the range, never with a receipt', () => {
    const { container } = render(<GalleryTile way={WAY} onStart={() => {}} />);
    const label = screen.getByText('Clients usually pay, per video');
    const group = label.closest('[data-figure-group]') as HTMLElement;
    expect(group).not.toBeNull();
    // The chip sits on the label's line, as on the board.
    expect(label.parentElement!.querySelector('[data-estimate]')!.textContent).toBe('model estimate');
    expect(within(group).getByText('₹2,000 to ₹6,000').classList.contains('mono')).toBe(true);
    expect(group.querySelectorAll('[data-estimate]')).toHaveLength(1);
    expect(container.querySelector('[data-receipt]')).toBeNull();
    assertInkRules(document.body);
  });

  it('shows at most five avatars and counts the rest', () => {
    const team = { names: ['A One', 'B Two', 'C Three', 'D Four', 'E Five', 'F Six', 'G Seven'], line: 'Many hands.' };
    render(<GalleryTile way={{ ...WAY, team }} onStart={() => {}} />);
    const stack = screen.getByRole('img', { name: /^7 agents: / });
    expect(stack.querySelectorAll('[data-size="24"]')).toHaveLength(5);
    expect(stack.querySelector('[data-count]')!.textContent).toBe('+2');
  });

  it('takes a button size, so a phone gets the 44 px touch target', () => {
    render(<GalleryTile way={WAY} onStart={() => {}} buttonSize="lg" />);
    expect(screen.getByRole('button', { name: 'Start Wedding videos' }).dataset.size).toBe('lg');
  });

  it('has one Start button, a secondary named for the way, that reports which way', () => {
    const onStart = vi.fn();
    render(<GalleryTile way={WAY} onStart={onStart} />);
    const tile = screen.getByRole('article', { name: 'Wedding videos' });
    const buttons = within(tile).getAllByRole('button');
    expect(buttons).toHaveLength(1);
    const start = within(tile).getByRole('button', { name: 'Start Wedding videos' });
    expect(start.dataset.variant).toBe('secondary');
    fireEvent.click(start);
    expect(onStart).toHaveBeenCalledWith('wedding-videos');
  });

  it('the featured tile carries the one filled Start, and says "Good fit for you" is a model estimate', () => {
    render(<GalleryTile way={WAY} featured onStart={() => {}} />);
    const tile = screen.getByRole('article', { name: 'Wedding videos' });
    expect(within(tile).getByRole('button', { name: 'Start Wedding videos' }).dataset.variant).toBe('primary');
    const fit = within(tile).getByText('Good fit for you');
    expect(fit.closest('[data-fit]')!.querySelector('[data-estimate]')!.textContent).toBe('model estimate');
    assertInkRules(document.body);
  });
});

describe('Gallery', () => {
  const ways: GalleryWay[] = [
    WAY,
    { ...WAY, id: 'menu-cards', name: 'Menu cards', category: 'Shops and firms' },
    { ...WAY, id: 'tuition', name: 'Online tuition', category: undefined, pay: { range: '₹500 to ₹1,500' } },
  ];

  it('lists the ways as tiles, and only the featured one fills its button', () => {
    const { container } = render(<Gallery ways={ways} featured="menu-cards" onStart={() => {}} label="Ways to earn" />);
    const list = screen.getByRole('list', { name: 'Ways to earn' });
    expect(within(list).getAllByRole('article')).toHaveLength(3);
    for (const name of ['Wedding videos', 'Menu cards', 'Online tuition']) expect(within(list).getByRole('article', { name })).toBeTruthy();
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Start Menu cards' }).dataset.variant).toBe('primary');
    expect(screen.getByText('Clients usually pay')).toBeTruthy();
    assertOnePrimary(document.body);
    assertFiguresProved(document.body);
    assertInkRules(document.body);
  });

  it('passes its button size to every tile', () => {
    render(<Gallery ways={ways} featured="menu-cards" onStart={() => {}} buttonSize="lg" />);
    for (const button of screen.getAllByRole('button', { name: /^Start / })) expect(button.dataset.size).toBe('lg');
  });

  it('reads in Hindi with no key showing', () => {
    const { container } = render(<TextProvider language="hi"><Gallery ways={[...ways, { ...WAY, id: 'mine', running: 'Sample Films' }]} featured="tuition" onStart={() => {}} /></TextProvider>);
    expect(screen.getByRole('button', { name: 'एक और शुरू करें: Wedding videos' })).toBeTruthy();
    expect(keysShown(container)).toEqual([]);
  });
});
