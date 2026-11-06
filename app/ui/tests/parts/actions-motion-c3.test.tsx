import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Confirm, ConfirmSlot } from '../../src/parts/Confirm';
import { Button } from '../../src/parts/Button';
import { ApprovalRow } from '../../src/parts/ApprovalRow';
import { NextStep } from '../../src/places/today/NextStep';
import { assertOnePrimary } from '../helpers/ink-rules';
import type { QueueRow } from '../../src/engine/types';

const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    if (!element.hasAttribute('data-swap-old') && !element.hasAttribute('data-lock-leaving')) return style;
    return new Proxy(style, { get(target, key) { if (key === 'animationDuration') return '120ms'; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });
const row: QueueRow = { id: 'motion-price', businessId: 'lumen', businessName: 'Lumen', kind: 'price', createdAt: '2026-10-21T08:00:00Z', digest: 'price-one', title: 'Service price', actions: [{ id: 'deny', label: 'Deny', primary: false }, { id: 'approve', label: 'Approve', primary: true, secondAsk: true }] };

describe('approval state motion', () => {
  it.each(['row', 'card', 'compact'] as const)('%s second ask fades old buttons inertly and keeps Cancel focused', layout => {
    const decide = vi.fn();
    const { container } = render(<ApprovalRow row={row} layout={layout} onDecide={decide} />);
    expect(container.querySelector('[data-swap-old]')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }));
    const old = container.querySelector<HTMLElement>('[data-swap-old]')!;
    expect(old).not.toBeNull();
    expect(old.getAttribute('aria-hidden')).toBe('true');
    expect(old.hasAttribute('inert')).toBe(true);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(old.querySelector('button')!);
    expect(decide).not.toHaveBeenCalled();
    expect(screen.getAllByRole('button', { name: 'Approve' })).toHaveLength(1);
    expect(() => assertOnePrimary(container)).not.toThrow();
    fireEvent.animationEnd(old);
    expect(old.isConnected).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Approve' }));
  });

  it('fades an unlocking icon over the same button without a first-render entrance', () => {
    const { container, rerender } = render(<Button locked variant="primary">Send</Button>);
    const button = screen.getByRole('button', { name: 'Send' });
    expect(container.querySelector('[data-lock-leaving]')).toBeNull();
    rerender(<Button variant="primary">Send</Button>);
    const lock = button.querySelector('[data-lock-leaving]')!;
    expect(lock).not.toBeNull();
    expect(screen.getByRole('button', { name: 'Send' })).toBe(button);
    expect(button.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.animationEnd(lock);
    expect(button.querySelector('[data-lock-leaving]')).toBeNull();
  });

  it('changes the next step content in place while its current action stays the only live one', () => {
    const first = vi.fn(), second = vi.fn();
    const primary = { label: 'Open', locked: false, note: undefined, asksAgain: false };
    const { container, rerender } = render(<NextStep data={{ rowId: 'one', title: 'Review first draft' }} primary={primary} onPrimary={first} />);
    expect(container.querySelector('[data-swap-old]')).toBeNull();
    rerender(<NextStep data={{ rowId: 'two', title: 'Review second draft' }} primary={primary} onPrimary={second} />);
    const old = container.querySelector('[data-swap-old]')!;
    expect(old).not.toBeNull();
    expect(old.textContent).toContain('Review first draft');
    expect(screen.getByRole('heading', { name: 'Review second draft' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('keeps only the current state when motion is off', () => {
    document.documentElement.dataset.motion = 'off';
    const { container, rerender } = render(<Button locked>Send</Button>);
    rerender(<Button>Send</Button>);
    expect(container.querySelector('[data-lock-leaving]')).toBeNull();
  });
});

it('a persistent confirmation slot fades the asking button and cannot focus or press the retired ask', () => {
  const action = vi.fn(), cancel = vi.fn();
  const { container, rerender } = render(<ConfirmSlot asking={false}><Button onClick={action}>Issue</Button></ConfirmSlot>);
  expect(container.querySelector('[data-swap-old]')).toBeNull();
  rerender(<ConfirmSlot asking><Confirm action="Issue" onCancel={cancel} onConfirm={action}>Issue this invoice?</Confirm></ConfirmSlot>);
  const old = container.querySelector<HTMLElement>('[data-swap-old]')!;
  expect(old.hasAttribute('inert')).toBe(true);
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  fireEvent.click(old.querySelector('button')!);
  expect(action).not.toHaveBeenCalled();
  fireEvent.animationEnd(old);
  rerender(<ConfirmSlot asking={false}><Button onClick={action}>Issue</Button></ConfirmSlot>);
  const retired = container.querySelector<HTMLElement>('[data-swap-old]')!;
  expect(document.activeElement?.closest('[inert]')).toBeNull();
  fireEvent.click(retired.querySelector('[data-confirm]')!);
  expect(action).not.toHaveBeenCalled();
});

it('excludes only the decorative retired copy from the primary rule', () => {
  const { container, rerender } = render(<div data-card=""><Button variant="primary">Current</Button><div data-swap-old="" inert aria-hidden="true"><Button variant="primary">Retired</Button></div></div>);
  expect(() => assertOnePrimary(container)).not.toThrow();
  for (const missing of ['inert', 'aria-hidden', 'data-swap-old']) {
    rerender(<div data-card=""><Button variant="primary">Current</Button><div data-swap-old={missing === 'data-swap-old' ? undefined : ''} inert={missing !== 'inert'} aria-hidden={missing === 'aria-hidden' ? undefined : true}><Button variant="primary">Duplicate</Button></div></div>);
    expect(() => assertOnePrimary(container)).toThrow(/primar/);
  }
});
