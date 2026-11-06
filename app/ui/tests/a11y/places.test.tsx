import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PLACES, SHEETS, OPENED, PHONE, settle, violations, timeoutOf, NARROW } from './cases';


describe('the axe check itself', () => {
  it('finds a real fault, so a clean result means something', async () => {
    const { container } = render(<div><button type="button" /><img src="x.png" /><input type="text" /></div>);
    const found = (await violations(container)).map((line) => line.split(' ')[0]);
    expect(found).toEqual(expect.arrayContaining(['button-name', 'image-alt', 'label']));
  });
});

describe('axe on every place', () => {
  for (const place of PLACES) {
    it(place.name, async () => {
      expect(await violations(await settle(place))).toEqual([]);
    }, timeoutOf(place));
  }
});

describe('axe on the command bar (C2)', () => {
  it('the list open, with records, pages, actions and the Ask row', async () => {
    const root = await settle({ name: 'the bar', hash: '#/money' });
    const box = await screen.findByRole('combobox', { name: 'Find or ask' });
    box.focus();
    await act(async () => { fireEvent.change(box, { target: { value: 'invoice' } }); });
    await waitFor(() => expect(screen.getByRole('listbox', { name: 'Find or ask' }).querySelectorAll('[role="group"]').length).toBeGreaterThan(2));
    expect(await violations(root)).toEqual([]);
  }, 30_000);
});
