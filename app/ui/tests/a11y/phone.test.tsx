import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PLACES, SHEETS, OPENED, PHONE, settle, violations, timeoutOf, NARROW } from './cases';


describe('axe on a phone', () => {
  for (const each of PHONE) {
    it(each.name, async () => {
      vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
        matches: query === NARROW, media: query, onchange: null,
        addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
      }) as unknown as MediaQueryList);
      const root = await settle(each);
      expect(root.querySelector('[data-phone]')).not.toBeNull();
      expect(await violations(root)).toEqual([]);
    }, timeoutOf(each));
  }
});

describe('axe on the command bar on a phone (C2)', () => {
  it('the dialog open with a list', async () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
      matches: query === NARROW, media: query, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }) as unknown as MediaQueryList);
    const root = await settle({ name: 'the bar on a phone', hash: '#/today' });
    const [button] = await screen.findAllByRole('button', { name: 'Find or ask' });
    await act(async () => { fireEvent.click(button!); });
    const box = screen.getByRole('combobox', { name: 'Find or ask' });
    await act(async () => { fireEvent.change(box, { target: { value: 'invoice' } }); });
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Find or ask' }).querySelectorAll('[role="group"]').length).toBeGreaterThan(2));
    expect(await violations(root)).toEqual([]);
  }, 30_000);
});
