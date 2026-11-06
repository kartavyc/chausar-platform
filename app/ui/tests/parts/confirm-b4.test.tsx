// B4 task 7: one confirm for every place that asks again: words, then Cancel, then the action, where the asking button was.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { Confirm } from '../../src/parts/Confirm';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { cssOf } from '../helpers/css';

describe('Confirm', () => {
  it('says the words, then Cancel as a secondary before the action as the one filled button', () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    const { container } = render(<Confirm action="Issue" onCancel={onCancel} onConfirm={onConfirm}>Issue this invoice?</Confirm>);
    const box = container.querySelector<HTMLElement>('[data-confirm-box]')!;
    expect(box.textContent).toContain('Issue this invoice?');
    const buttons = [...box.querySelectorAll('button')];
    expect(buttons.map((button) => button.textContent)).toEqual(['Cancel', 'Issue']);
    expect(buttons[0]!.dataset.variant).toBe('secondary');
    expect(buttons[1]!.dataset.variant).toBe('primary');
    expect(buttons[1]!.hasAttribute('data-confirm')).toBe(true);
    fireEvent.click(buttons[0]!);
    expect(onCancel).toHaveBeenCalledTimes(1);
    fireEvent.click(buttons[1]!);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('takes the focus to Cancel, so a second press never confirms by accident', () => {
    render(<Confirm action="Issue" onCancel={vi.fn()} onConfirm={vi.fn()}>Issue this invoice?</Confirm>);
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' }));
  });

  it('a stopping action is in the danger tone, never the fill; busy stops both buttons', () => {
    const { container } = render(<Confirm action="Stop all" tone="danger" busy onCancel={vi.fn()} onConfirm={vi.fn()}>Stop all?</Confirm>);
    const action = screen.getByRole('button', { name: 'Stop all' }) as HTMLButtonElement;
    expect(action.dataset.tone).toBe('danger');
    expect(action.dataset.variant).toBe('secondary');
    expect(action.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);
    expect(container.querySelector('[data-variant="primary"]')).toBeNull();
  });

  it('draws no colour block: no fill, border or amber in its CSS, and Money\'s amber ask is gone', () => {
    const css = cssOf('Confirm.module.css');
    expect(css).not.toMatch(/background/);
    expect(css).not.toMatch(/border/);
    expect(css).not.toMatch(/--wait/);
    expect(readFileSync(join(import.meta.dirname, '../../src/places/money/Money.module.css'), 'utf8')).not.toMatch(/\.ask\s*\{[^}]*--wait-soft/);
  });
});
