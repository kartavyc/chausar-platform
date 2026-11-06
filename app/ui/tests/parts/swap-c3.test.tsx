import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { Swap, SwapWords } from '../../src/parts/Swap';
import { Button } from '../../src/parts/Button';
import { Chip } from '../../src/parts/Chip';
import { TextProvider } from '../../src/text';
import { cssOf, rule } from '../helpers/css';

/**
 * One-shot C3 task 8: a word or state that changes in place. The old copy fades where it stands, hidden from screen
 * readers, and goes when its fade ends; nothing on first render; with animations off only the new one.
 */
const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element: Element, pseudo?: string | null) => {
    const style = real(element, pseudo);
    if (!(element instanceof HTMLElement) || !element.hasAttribute('data-swap-old')) return style;
    return new Proxy(style, { get: (target, key) => { if (key === 'animationDuration') return '140ms'; const value = Reflect.get(target, key) as unknown; return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });

const old = () => document.querySelector<HTMLElement>('[data-swap-old]');

describe('Swap', () => {
  it('first render: one copy, no fade', () => {
    render(<Swap value="a">Saved</Swap>);
    expect(old()).toBeNull();
    expect(document.querySelector('[data-swap-new]')).toBeNull();
    expect(screen.getByText('Saved')).toBeTruthy();
  });

  it('a key change: the old copy is hidden from readers and goes on animationend; a reader finds only the new words', () => {
    const { rerender } = render(<Swap value="a">Saved</Swap>);
    rerender(<Swap value="b">Shared</Swap>);
    expect(old()?.textContent).toBe('Saved');
    expect(old()?.getAttribute('aria-hidden')).toBe('true');
    expect(document.querySelector('[data-swap-new]')?.textContent).toBe('Shared');
    fireEvent.animationEnd(old()!);
    expect(old()).toBeNull();
    expect(screen.getByText('Shared')).toBeTruthy();
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('with animations off, only the new one', () => {
    document.documentElement.dataset.motion = 'off';
    const { rerender } = render(<Swap value="a">Saved</Swap>);
    rerender(<Swap value="b">Shared</Swap>);
    expect(old()).toBeNull();
    expect(screen.getByText('Shared')).toBeTruthy();
  });

  it('the fade runs once on the time tokens', () => {
    expect(cssOf('Swap.module.css')).toMatch(/\.old\s*\{[^}]*var\(--t-exit\) var\(--ease-exit\) 1 both/);
    expect(rule('Swap.module.css', '.now[data-swap-new]')).toMatch(/var\(--t-press\)/);
  });
});

describe('SwapWords and the parts that hold plain words', () => {
  it('adds no element at rest', () => {
    const { container } = render(<div><SwapWords>Save</SwapWords></div>);
    expect(container.firstElementChild!.children).toHaveLength(0);
    expect(container.firstElementChild!.textContent).toBe('Save');
  });

  it('a button whose label changes keeps the same element and fades the old label', () => {
    const { rerender } = render(<TextProvider language="en"><Button>Back up now</Button></TextProvider>);
    const button = screen.getByRole('button', { name: 'Back up now' });
    expect(button.children).toHaveLength(0);
    rerender(<TextProvider language="en"><Button>Backing up</Button></TextProvider>);
    expect(screen.getByRole('button')).toBe(button);
    expect(old()?.textContent).toBe('Back up now');
    act(() => { fireEvent.animationEnd(old()!); });
    expect(button.children).toHaveLength(0);
    expect(button.textContent).toBe('Backing up');
  });

  it('a chip whose word changes fades too', () => {
    const { rerender } = render(<Chip tone="working">Idle</Chip>);
    rerender(<Chip tone="working">Working</Chip>);
    expect(old()?.textContent).toBe('Idle');
  });
});

describe('a locked button that becomes ready', () => {
  it('changes its fill over the press time, on the same element', () => {
    expect(rule('Button.module.css', '.button')).toMatch(/background-color var\(--t-press\)/);
    const { rerender } = render(<TextProvider language="en"><Button variant="primary" locked>Send</Button></TextProvider>);
    const button = screen.getByRole('button');
    rerender(<TextProvider language="en"><Button variant="primary">Send</Button></TextProvider>);
    expect(screen.getByRole('button')).toBe(button);
    expect(button.hasAttribute('data-locked')).toBe(false);
  });
});
