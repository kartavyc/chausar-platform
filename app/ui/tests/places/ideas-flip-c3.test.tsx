import { afterEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

afterEach(() => { vi.unstubAllGlobals(); });

it('moving an idea to Triage starts at its measured former position', async () => {
  vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1));
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const x = this.closest('[data-stage]')?.getAttribute('data-stage') === 'triage' ? 100 : 0;
    return { x, y: 0, left: x, top: 0, right: x + 100, bottom: 40, width: 100, height: 40, toJSON: () => ({}) };
  });
  window.location.hash = '#/work/ideas';
  render(<App client={createFakeClient(new FakeEngine())} language="en" />);
  const move = (await screen.findAllByRole('button', { name: 'Move to Triage' }))[0]!;
  const card = move.closest('[data-idea]')!;
  const id = card.getAttribute('data-idea')!;
  await act(async () => { fireEvent.click(within(card as HTMLElement).getByRole('button', { name: 'Move to Triage' })); });
  await waitFor(() => {
    const moved = document.querySelector<HTMLElement>(`[data-stage="triage"] [data-idea="${id}"]`)!;
    expect(moved).not.toBeNull();
    expect(moved.closest<HTMLElement>('li')!.style.transform).toBe('translate(-100px, 0px)');
  });
});
