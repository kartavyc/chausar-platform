import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { Tabs } from '../../src/parts/Tabs';
import { FilterChips } from '../../src/parts/FilterChips';
import { cssOf, rule } from '../helpers/css';
import { TextProvider } from '../../src/text';

/**
 * One-shot C3 task 15: one pill under a row of tabs, sliding to the current one over the press time. Its first place is
 * set with no transition: the row's data-pill-ready comes after, so nothing moves at first paint.
 */
afterEach(() => { vi.restoreAllMocks(); });

const OPTIONS = [{ id: 'a', label: 'One' }, { id: 'b', label: 'Two' }];

function offsets() {
  // Each item stands at its own left; jsdom has no layout.
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function offset(this: HTMLElement) { return this.textContent?.startsWith('Two') ? 100 : 10; });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function width(this: HTMLElement) { return this.textContent?.startsWith('Two') ? 60 : 40; });
}

function Row() {
  const [value, setValue] = useState('a');
  return <TextProvider language="en"><Tabs mode="buttons" label="Views" items={OPTIONS} value={value} onChange={setValue} /></TextProvider>;
}

describe('the sliding pill', () => {
  it('one pill per row, under the current tab, and it follows the choice', async () => {
    offsets();
    render(<Row />);
    const pills = document.querySelectorAll<HTMLElement>('[data-pill]');
    expect(pills).toHaveLength(1);
    expect(pills[0]!.getAttribute('aria-hidden')).toBe('true');
    expect(pills[0]!.style.transform).toContain('translate(10px');
    await act(async () => { screen.getByRole('button', { name: 'Two' }).click(); });
    expect(pills[0]!.style.transform).toContain('translate(100px');
    expect(pills[0]!.style.width).toBe('60px');
  });

  it('the first render has no transition: the row is marked ready only after the first frame', async () => {
    offsets();
    render(<Row />);
    const row = screen.getByRole('group', { name: 'Views' });
    expect(row.hasAttribute('data-pill-ready')).toBe(false);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(row.hasAttribute('data-pill-ready')).toBe(true);
    expect(rule('Tabs.module.css', ".tabs[data-pill-ready] .pill")).toMatch(/transition:\s*transform var\(--t-press\)/);
  });

  it('FilterChips carries the same pill, and the bottom tabs’ mark slides over the sheet time', () => {
    render(<TextProvider language="en"><FilterChips label="Show" options={OPTIONS} value="a" onChange={() => {}} /></TextProvider>);
    expect(document.querySelectorAll('[data-pill]')).toHaveLength(1);
    expect(rule('FilterChips.module.css', ".chips[data-pill-ready] .pill")).toMatch(/var\(--t-press\)/);
    expect(cssOf('BottomTabs.module.css')).toMatch(/\.line\s*\{[^}]*var\(--t-sheet\)/);
  });
});
