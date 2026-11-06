import { describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { TextProvider } from '../../src/text';
import { PassphraseField } from '../../src/parts/PassphraseField';

/** One-shot C4 task 35: the Show toggle named for readers, the 12 characters hint on a new one, and Caps Lock while typing. */
function Host({ isNew }: { isNew?: boolean }) {
  const [value, setValue] = useState('');
  return <TextProvider language="en"><PassphraseField label="Passphrase" isNew={isNew} value={value} onChange={setValue} autoComplete="new-password" /></TextProvider>;
}

describe('PassphraseField', () => {
  it('Show switches the type and is named for readers', () => {
    render(<Host />);
    const field = screen.getByLabelText('Passphrase') as HTMLInputElement;
    expect(field.type).toBe('password');
    const show = screen.getByRole('button', { name: 'Show Passphrase' });
    expect(show.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(show);
    expect(field.type).toBe('text');
    const hide = screen.getByRole('button', { name: 'Hide Passphrase' });
    expect(hide.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(hide);
    expect(field.type).toBe('password');
  });

  it('says Caps Lock is on while typing with it on, and stops when it goes off', () => {
    render(<Host />);
    const field = screen.getByLabelText('Passphrase');
    expect(screen.queryByText('Caps Lock is on')).toBeNull();
    fireEvent.keyDown(field, { key: 'A', modifierCapsLock: true });
    expect(screen.getByText('Caps Lock is on')).toBeTruthy();
    fireEvent.keyUp(field, { key: 'a', modifierCapsLock: false });
    expect(screen.queryByText('Caps Lock is on')).toBeNull();
  });

  it('a new passphrase says at least 12 characters; one being asked for does not', () => {
    const { unmount } = render(<Host isNew />);
    expect(screen.getByText('At least 12 characters')).toBeTruthy();
    unmount();
    render(<Host />);
    expect(screen.queryByText('At least 12 characters')).toBeNull();
  });
});
