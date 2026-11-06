import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { Tabs } from '../../src/parts/Tabs';
import { fitTabs } from '../../src/parts/tabs-fit';
import { assertNoInlineStyles } from '../helpers/ink-rules';
import { cssOf, rule } from '../helpers/css';

/** C1 task 1: one tab part for every row of tabs, with the ones that do not fit under More. */

describe('fitTabs', () => {
  const five = [100, 100, 100, 100, 100];

  it('keeps what fits beside More, in order', () => {
    expect(fitTabs({ widths: five, room: 320, moreWidth: 60, current: 0 })).toEqual({ row: [0, 1], more: [2, 3, 4] });
  });

  it('keeps everything when it all fits, with no More', () => {
    expect(fitTabs({ widths: five, room: 500, moreWidth: 60, current: 0 })).toEqual({ row: [0, 1, 2, 3, 4], more: [] });
  });

  it('the current item takes the last place in the row, and the one it displaces goes under More', () => {
    expect(fitTabs({ widths: five, room: 320, moreWidth: 60, current: 3 })).toEqual({ row: [0, 3], more: [1, 2, 4] });
  });

  it('primary items alone sit in the row, the rest under More even with room', () => {
    expect(fitTabs({ widths: five, room: 2000, moreWidth: 60, current: 0, primary: [0, 1, 2] })).toEqual({ row: [0, 1, 2], more: [3, 4] });
    expect(fitTabs({ widths: five, room: 2000, moreWidth: 60, current: 4, primary: [0, 1, 2] })).toEqual({ row: [0, 1, 2, 4], more: [3] });
  });

  it('not measured (zero widths, as in jsdom) keeps everything in the row but the non-primary items', () => {
    expect(fitTabs({ widths: [0, 0, 0, 0, 0], room: 0, moreWidth: 0, current: 2 })).toEqual({ row: [0, 1, 2, 3, 4], more: [] });
    expect(fitTabs({ widths: [0, 0, 0, 0, 0], room: 0, moreWidth: 0, current: 4, primary: [0, 1] })).toEqual({ row: [0, 1, 4], more: [2, 3] });
  });

  it('counts the gap between items', () => {
    expect(fitTabs({ widths: five, room: 320, moreWidth: 60, current: 0, gap: 10 })).toEqual({ row: [0, 1], more: [2, 3, 4] });
    expect(fitTabs({ widths: [100, 100, 100], room: 310, moreWidth: 60, current: 0, gap: 10 })).toEqual({ row: [0, 1], more: [2] });
  });
});

const links = [
  { id: 'a', label: 'Alpha', href: '#/a', count: 3 },
  { id: 'b', label: 'Beta', href: '#/b', count: 0 },
  { id: 'c', label: 'Gamma', href: '#/c' },
  { id: 'd', label: 'Delta', href: '#/d' },
];

describe('Tabs, links mode', () => {
  it('a named nav of links, the page marked current, the row and current item marked for motion, zero counts not drawn', () => {
    const { container } = render(<Tabs mode="links" label="Views" value="b" items={links} />);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(nav.hasAttribute('data-tabs')).toBe(true);
    const all = within(nav).getAllByRole('link');
    expect(all.map((link) => link.getAttribute('href'))).toEqual(['#/a', '#/b', '#/c', '#/d']);
    expect(all[1]!.getAttribute('aria-current')).toBe('page');
    expect(all[1]!.hasAttribute('data-current')).toBe(true);
    expect(all[0]!.hasAttribute('aria-current')).toBe(false);
    expect([...container.querySelectorAll('[data-count]')].map((c) => c.textContent)).toEqual(['3']);
    expect(screen.getByRole('link', { name: 'Alpha 3' })).toBe(all[0]);
    expect(within(nav).queryByRole('button', { name: 'More' })).toBeNull();
    expect(container.querySelector('svg')).toBeNull();
    assertNoInlineStyles(container);
  });

  it('primary: only those sit in the row; More holds the rest as links; Escape closes it and focus returns', async () => {
    render(<Tabs mode="links" label="Views" value="a" items={links} primary={['a', 'b']} />);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Alpha 3', 'Beta']);
    const more = within(nav).getByRole('button', { name: 'More' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(more.getAttribute('aria-controls')!)!;
    expect(within(list).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([['Gamma', '#/c'], ['Delta', '#/d']]);
    fireEvent.keyDown(within(list).getAllByRole('link')[0]!, { key: 'Escape' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(more);
    fireEvent.click(more);
    fireEvent.click(within(document.getElementById(more.getAttribute('aria-controls')!)!).getByRole('link', { name: 'Delta' }));
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });

  it('the current item is always in the row, even when it is not primary', () => {
    render(<Tabs mode="links" label="Views" value="d" items={links} primary={['a', 'b']} />);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Alpha 3', 'Beta', 'Delta']);
    expect(within(nav).getByRole('link', { name: 'Delta' }).getAttribute('aria-current')).toBe('page');
  });

  it('measured, the items that do not fit go under More, and a narrower row (a sheet opening) moves more of them', () => {
    let room = 1000;
    let resized: (() => void) | undefined;
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class { constructor(callback: () => void) { resized = callback; } observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
    const stubs = [
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return this.hasAttribute('data-tab-item') || this.hasAttribute('data-tabs-more') ? 100 : 0; }),
      vi.spyOn(Element.prototype, 'clientWidth', 'get').mockImplementation(function (this: Element) { return this.hasAttribute('data-tabs') ? room : 0; }),
    ];
    render(<Tabs mode="links" label="Views" value="a" items={links} />);
    const nav = screen.getByRole('navigation', { name: 'Views' });
    expect(within(nav).getAllByRole('link')).toHaveLength(4);
    room = 320;
    act(() => resized!());
    expect(within(nav).getAllByRole('link').map((link) => link.textContent)).toEqual(['Alpha 3', 'Beta']);
    expect(within(nav).getByRole('button', { name: 'More' })).toBeTruthy();
    for (const stub of stubs) stub.mockRestore();
    globalThis.ResizeObserver = original;
  });
});

describe('Tabs, buttons mode', () => {
  it('a named group of toggle buttons with counts and department dots', () => {
    const onChange = vi.fn();
    const { container } = render(
      <Tabs
        mode="buttons"
        label="Show departments"
        value="all"
        onChange={onChange}
        items={[{ id: 'all', label: 'All departments', count: 4 }, { id: 'prod', label: 'Production', dept: 'prod', count: 0 }]}
      />,
    );
    const group = screen.getByRole('group', { name: 'Show departments' });
    const [all, prod] = within(group).getAllByRole('button');
    expect(all!.getAttribute('aria-pressed')).toBe('true');
    expect(all!.hasAttribute('data-current')).toBe(true);
    expect(prod!.getAttribute('aria-pressed')).toBe('false');
    expect(prod!.querySelector('[data-dept]')!.getAttribute('data-dept')).toBe('prod');
    expect(prod!.textContent).toBe('Production');
    fireEvent.click(prod!);
    expect(onChange).toHaveBeenCalledWith('prod');
    assertNoInlineStyles(container);
  });

  it('More holds the other choices as buttons; choosing one closes it', () => {
    const onChange = vi.fn();
    render(<Tabs mode="buttons" label="Show" value="a" onChange={onChange} primary={['a']} items={[{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }]} />);
    const more = screen.getByRole('button', { name: 'More' });
    fireEvent.click(more);
    const list = document.getElementById(more.getAttribute('aria-controls')!)!;
    fireEvent.click(within(list).getByRole('button', { name: 'B' }));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(more.getAttribute('aria-expanded')).toBe('false');
  });
});

function Switch({ start = 'one' }: { start?: string }) {
  const [value, setValue] = useState(start);
  return (
    <>
      <Tabs mode="tabs" label="Agent" value={value} onChange={setValue} idOf={(id) => `t-${id}`} items={[{ id: 'one', label: 'One' }, { id: 'two', label: 'Two', count: 2 }, { id: 'three', label: 'Three' }]} />
      <div role="tabpanel" id={`t-${value}-panel`} aria-labelledby={`t-${value}`}>{value}</div>
    </>
  );
}

describe('Tabs, tabs mode', () => {
  it('a tablist of tabs: selected, roving tab stop, the selected tab names its panel', () => {
    render(<Switch />);
    const list = screen.getByRole('tablist', { name: 'Agent' });
    const tabs = within(list).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['One', 'Two 2', 'Three']);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['true', 'false', 'false']);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([0, -1, -1]);
    expect(tabs[0]!.id).toBe('t-one');
    expect(tabs[0]!.getAttribute('aria-controls')).toBe('t-one-panel');
    expect(tabs.filter((tab) => tab.hasAttribute('aria-controls'))).toHaveLength(1);
    expect(screen.getByRole('tabpanel', { name: 'One' })).toBeTruthy();
  });

  it('arrow keys, Home and End move between the tabs and take the focus', async () => {
    render(<Switch />);
    const tab = (name: RegExp) => screen.getByRole('tab', { name });
    await act(async () => { tab(/^One/).focus(); fireEvent.keyDown(tab(/^One/), { key: 'ArrowRight' }); });
    expect(tab(/^Two/).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(tab(/^Two/));
    await act(async () => { fireEvent.keyDown(tab(/^Two/), { key: 'End' }); });
    expect(document.activeElement).toBe(tab(/^Three/));
    await act(async () => { fireEvent.keyDown(tab(/^Three/), { key: 'ArrowRight' }); });
    expect(document.activeElement).toBe(tab(/^One/));
    await act(async () => { fireEvent.keyDown(tab(/^One/), { key: 'ArrowLeft' }); });
    expect(document.activeElement).toBe(tab(/^Three/));
    await act(async () => { fireEvent.keyDown(tab(/^Three/), { key: 'Home' }); });
    expect(tab(/^One/).getAttribute('aria-selected')).toBe('true');
  });
});

describe('Tabs, the look', () => {
  it('no sideways scroll, no fade, no frame or shadow on the row; the selected item is a quiet grey fill with dark words', () => {
    const css = cssOf('Tabs.module.css');
    expect(css).not.toMatch(/overflow-x/);
    expect(css).not.toMatch(/mask-image/);
    expect(rule('Tabs.module.css', '.tabs')).not.toMatch(/border|box-shadow|overflow/);
    expect(rule('Tabs.module.css', ".item[aria-current='page']")).toMatch(/background:\s*var\(--nav-on\)[\s\S]*color:\s*var\(--nav-on-fg\)/);
    expect(rule('Tabs.module.css', ".item[aria-pressed='true']")).toMatch(/background:\s*var\(--nav-on\)/);
    expect(rule('Tabs.module.css', ".item[aria-selected='true']")).toMatch(/background:\s*var\(--line\)/);
    expect(rule('Tabs.module.css', '.count')).toMatch(/color:\s*var\(--mute\)/);
  });
});
