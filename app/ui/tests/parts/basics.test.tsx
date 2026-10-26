import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Button } from '../../src/parts/Button';
import { Change } from '../../src/parts/Change';
import { Receipt } from '../../src/parts/Receipt';
import { ModelEstimate } from '../../src/parts/ModelEstimate';
import { EmptyState } from '../../src/parts/EmptyState';
import { Field } from '../../src/parts/Field';
import { CodeGroups, NewPassphrase } from '../../src/parts/Secret';
import { TextProvider } from '../../src/text';
import { assertFiguresProved, receiptMark } from '../helpers/ink-rules';

describe('Button', () => {
  it('is a real button that never submits a form, in one of three looks', () => {
    const onClick = vi.fn();
    render(<><Button variant="primary" onClick={onClick}>Approve</Button><Button>Deny</Button><Button variant="quiet">Close</Button></>);
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve.getAttribute('type')).toBe('button');
    expect(approve.dataset.variant).toBe('primary');
    expect(screen.getByRole('button', { name: 'Deny' }).dataset.variant).toBe('secondary');
    fireEvent.click(approve);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('comes in the four D sizes, medium by default', () => {
    render(<><Button>Plain</Button><Button size="sm">Small</Button><Button size="lg">Large</Button><Button size="xl">Extra</Button></>);
    expect(screen.getByRole('button', { name: 'Plain' }).dataset.size).toBe('md');
    expect(screen.getByRole('button', { name: 'Small' }).dataset.size).toBe('sm');
    expect(screen.getByRole('button', { name: 'Large' }).dataset.size).toBe('lg');
    expect(screen.getByRole('button', { name: 'Extra' }).dataset.size).toBe('xl');
  });

  it('has the ink and chat looks too', () => {
    render(<><Button variant="ink">Open</Button><Button variant="chat" aria-label="Chat with Editor" /></>);
    expect(screen.getByRole('button', { name: 'Open' }).dataset.variant).toBe('ink');
    const chat = screen.getByRole('button', { name: 'Chat with Editor' });
    expect(chat.dataset.variant).toBe('chat');
    expect(chat.textContent).toBe('Chat');
    expect(chat.querySelector('svg.lucide-message-square')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('a chat button must say whose chat it opens', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Button variant="chat">Chat</Button>)).toThrow(/aria-label/);
  });

  it('a locked primary stays the primary, is aria-disabled (so it stays in the Tab order), shows the lock and says why', () => {
    const onClick = vi.fn();
    render(
      <>
        <Button variant="primary" size="lg" locked lockedReason="Unlocks after you watch it" lockedNoteId="note-1" onClick={onClick}>Approve</Button>
        <p id="note-1">Approve unlocks after you watch it</p>
      </>,
    );
    const approve = screen.getByRole('button', { name: 'Approve', description: 'Locked. Approve unlocks after you watch it' });
    expect(approve.getAttribute('aria-disabled')).toBe('true');
    expect(approve).toHaveProperty('disabled', false);
    expect(approve.dataset.variant).toBe('primary');
    expect(approve.hasAttribute('data-locked')).toBe(true);
    expect(approve.getAttribute('title')).toBe('Unlocks after you watch it');
    expect(approve.querySelector('svg.lucide-lock')!.getAttribute('aria-hidden')).toBe('true');
    fireEvent.click(approve);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('an unlocked button has no lock, no title and no data-locked', () => {
    render(<Button variant="primary">Approve</Button>);
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve.querySelector('svg')).toBeNull();
    expect(approve.hasAttribute('data-locked')).toBe(false);
    expect(approve.hasAttribute('title')).toBe(false);
  });

  it('fills only the primary with the accent, and the locked primary with the soft accent', () => {
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/Button.module.css'), 'utf8');
    expect(css).toMatch(/\.primary\s*\{[^}]*background:\s*var\(--accent\)[^}]*color:\s*var\(--accent-ink\)/);
    expect(css).toMatch(/\.primary\[data-locked\]\s*\{[^}]*background:\s*var\(--accent-soft\)[^}]*color:\s*var\(--mute\)/);
    for (const [, selector, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^}]*)\}/g)) {
      if (/var\(--accent\)/.test(body!)) expect(selector!.trim()).toMatch(/^\.primary\b/);
    }
  });
});

describe('Change', () => {
  it('strikes the old value, shows the new one in mono and links its receipt', () => {
    const onReceipt = vi.fn();
    const { container } = render(<Change before="₹25,000" after="₹30,000" receiptId="R-0415" onReceipt={onReceipt} />);
    const old = container.querySelector('del')!;
    expect(old.textContent).toBe('₹25,000');
    expect(old.className).toContain('mono');
    expect(screen.getByText('₹30,000').className).toContain('mono');
    expect(container.textContent).toContain('was');
    fireEvent.click(screen.getByRole('button', { name: 'Receipt for ₹30,000' }));
    expect(onReceipt).toHaveBeenCalledWith('R-0415');
  });

  it('a model estimate never carries a receipt, even when one is sent', () => {
    render(<Change after="18,000" receiptId="R-9999" estimate />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('model estimate')).toBeTruthy();
  });
});

describe('Receipt', () => {
  it('is a small receipt mark (4Z3) that opens the receipt sheet; it never prints its code, which the sheet shows', () => {
    render(<Receipt id="R-0419" amount="₹1,12,400" />);
    const button = screen.getByRole('button', { name: 'Receipt for ₹1,12,400' });
    expect(button.textContent).toBe('');
    expect(button).toBe(screen.getByRole('button', { name: receiptMark('R-0419') }));
    fireEvent.click(button);
    expect(window.location.hash).toBe('#/today?sheet=receipt%3AR-0419');
  });

  it('says what it proves in Hindi too, and is plainly "Receipt" when it stands for no one amount', () => {
    render(<TextProvider language="hi"><Receipt id="R-0419" amount="₹1,12,400" /></TextProvider>);
    expect(screen.getByRole('button', { name: '₹1,12,400 की रसीद' }).dataset.receipt).toBe('R-0419');
    render(<Receipt id="R-0420" />);
    expect(screen.getByRole('button', { name: 'Receipt' }).dataset.receipt).toBe('R-0420');
  });

  it("with source ca it opens the CA firm's calculator receipt (venture.ca.receipt) in the receipt sheet", () => {
    render(<Receipt id="w-portal-sep" source="ca" />);
    const button = screen.getByRole('button', { name: receiptMark('w-portal-sep') });
    expect(button.dataset.receipt).toBe('w-portal-sep');
    fireEvent.click(button);
    expect(window.location.hash).toBe('#/today?sheet=ca-receipt%3Aw-portal-sep');
  });

  it('carries data-receipt and the receipt icon, hidden from screen readers (the name says it)', () => {
    render(<Receipt id="R-0419" onOpen={() => {}} />);
    const button = screen.getByRole('button', { name: receiptMark('R-0419') });
    expect(button.dataset.receipt).toBe('R-0419');
    expect(button.querySelector('svg.lucide-receipt-text')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('on the dark goal card it is the same mark in the goal card\'s light link colour, with no code', () => {
    render(<Receipt id="R-0421" tone="dark" amount="₹18,880" onOpen={() => {}} />);
    const button = screen.getByRole('button', { name: 'Receipt for ₹18,880' });
    expect(button.dataset.tone).toBe('dark');
    expect(button.textContent).toBe('');
    expect(button.querySelector('svg.lucide-receipt-text')).not.toBeNull();
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/Receipt.module.css'), 'utf8');
    expect(css).toMatch(/\[data-tone='dark'\]\s*\{[^}]*color:\s*var\(--goal-link\)/);
  });

  it('a mark that prints its code, or has no name, breaks the Ink rules', () => {
    const { container } = render(<span data-figure-group=""><span>₹10</span><button type="button" data-receipt="R-1" aria-label="Receipt">R-1</button></span>);
    expect(() => assertFiguresProved(container)).toThrow(/prints its code/);
    const { container: unnamed } = render(<span data-figure-group=""><span>₹10</span><button type="button" data-receipt="R-2"><svg /></button></span>);
    expect(() => assertFiguresProved(unnamed)).toThrow(/has no name/);
  });
});

describe('ModelEstimate', () => {
  it('puts the words "model estimate" beside a model-written number and offers no receipt', () => {
    const { container } = render(<ModelEstimate value="About 18,000 views" />);
    expect(container.textContent).toBe('About 18,000 views model estimate');
    expect(container.querySelector('button')).toBeNull();
  });
  it('is the dashed estimate chip and carries data-estimate', () => {
    const { container } = render(<ModelEstimate />);
    const chip = container.querySelector('[data-estimate]')!;
    expect(chip.textContent).toBe('model estimate');
    const name = /^_(\w+)_[0-9a-f]{6}$/.exec([...chip.classList].find((c) => c.startsWith('_'))!)![1]!;
    const css = readFileSync(join(import.meta.dirname, '../../src/parts/ModelEstimate.module.css'), 'utf8');
    expect(new RegExp(`\\.${name}\\s*\\{[^}]*dashed var\\(--dash\\)[^}]*color:\\s*var\\(--mute\\)`).test(css)).toBe(true);
  });
  it('in Hindi too', () => {
    const { container } = render(<TextProvider language="hi"><ModelEstimate /></TextProvider>);
    expect(container.textContent).toBe('मॉडल का अनुमान');
  });
});

describe('EmptyState', () => {
  it('says it plainly', () => {
    render(<EmptyState title="Nothing needs you." />);
    expect(screen.getByText('Nothing needs you.')).toBeTruthy();
  });
});

describe('Field', () => {
  it('labels its input and describes it with the hint and the error', () => {
    render(<Field label="Your answer" hint="One line is enough." error="Write an answer first." value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Your answer');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    const described = (input.getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toEqual(['One line is enough.', 'Write an answer first.']);
  });
  it('can be several lines', () => {
    render(<Field label="Note" multiline value="a" onChange={() => {}} />);
    expect(screen.getByLabelText('Note').tagName).toBe('TEXTAREA');
  });
});

/* Ink v2 (w3 plan, package 3B5b): empty states, fields and secrets in the D look. */

const v2Css = (file: string) => readFileSync(join(import.meta.dirname, '../../src/parts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const v2Class = (el: Element) => /^_(\w+)_[0-9a-f]{6}$/.exec([...el.classList].find((c) => /^_\w+_[0-9a-f]{6}$/.test(c)) ?? '')?.[1];

describe('EmptyState (Ink v2): one sentence, then actions, never a control that acts on nothing (catalogue U12)', () => {
  it('renders no button and no link when no action is given, or an empty list', () => {
    const { container, rerender } = render(<EmptyState title="Nothing is running." />);
    expect(container.querySelector('button, a, ul')).toBeNull();
    rerender(<EmptyState title="Nothing is running." actions={[]} />);
    expect(container.querySelector('button, a, ul')).toBeNull();
    expect(container.querySelectorAll('p')).toHaveLength(1);
  });

  it('lists its actions as rows: a link for an address, a button for a handler, each with a chevron', () => {
    const onSelect = vi.fn();
    render(<EmptyState title="No agents work here yet." actions={[{ label: 'See ways to earn', href: '#/onboarding' }, { label: 'Add a lead', onSelect }]} />);
    const list = screen.getByRole('list');
    expect(list.querySelectorAll('li')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'See ways to earn' }).getAttribute('href')).toBe('#/onboarding');
    const add = screen.getByRole('button', { name: 'Add a lead' });
    expect(add.getAttribute('type')).toBe('button');
    fireEvent.click(add);
    expect(onSelect).toHaveBeenCalledOnce();
    for (const item of list.querySelectorAll('li')) expect(item.querySelector('svg.lucide-chevron-right')!.getAttribute('aria-hidden')).toBe('true');
  });

  it('drops an action that has neither an address nor a handler', () => {
    const { container } = render(<EmptyState title="Nothing here yet." actions={[{ label: 'Do nothing' } as never]} />);
    expect(container.querySelector('button, a, ul')).toBeNull();
  });
});

describe('Field (Ink v2): the D input box', () => {
  it('has the button-line border and the button radius, the ink border on focus, and the fail border when invalid', () => {
    render(<Field label="Your answer" value="" onChange={() => {}} />);
    const name = v2Class(screen.getByLabelText('Your answer'))!;
    const css = v2Css('Field.module.css');
    expect(css).toMatch(new RegExp(`\\.${name}\\s*\\{[^}]*border:\\s*var\\(--hair\\) solid var\\(--btn-line\\)[^}]*border-radius:\\s*var\\(--r-button\\)`));
    expect(css).toMatch(new RegExp(`\\.${name}:focus-visible\\s*\\{[^}]*border-color:\\s*var\\(--fg\\)`));
    expect(css).toMatch(new RegExp(`\\.${name}\\[aria-invalid='true'\\]\\s*\\{[^}]*border-color:\\s*var\\(--fail\\)`));
  });

  it('an error carries a hidden warning icon and is still read as its words alone', () => {
    render(<Field label="Your answer" error="Write an answer first." value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Your answer');
    const error = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(error.textContent).toBe('Write an answer first.');
    expect(error.querySelector('svg.lucide-triangle-alert')!.getAttribute('aria-hidden')).toBe('true');
  });
});

describe('Secret (Ink v2): never shows a stored value', () => {
  it('a new passphrase goes into password fields that never offer a saved one and are never spell-checked', () => {
    render(<NewPassphrase reason="This computer can't keep the key." first="" again="" onFirst={() => {}} onAgain={() => {}} />);
    const fields = [...document.querySelectorAll('input')];
    expect(fields).toHaveLength(2);
    for (const field of fields) {
      expect(field.getAttribute('type')).toBe('password');
      expect(field.getAttribute('autocomplete')).toBe('new-password');
      expect(field.getAttribute('spellcheck')).toBe('false');
      expect(field.value).toBe('');
    }
  });

  it('a code the engine sends once reads as its exact groups, on the inner grey card', () => {
    render(<CodeGroups code="ABCD1234EFGH" label="Recovery code" />);
    const group = screen.getByRole('group', { name: 'Recovery code' });
    expect(group.textContent).toBe('ABCD1234EFGH');
    expect([...group.children].map((c) => c.textContent)).toEqual(['ABCD', '1234', 'EFGH']);
    expect(v2Css('Secret.module.css')).toMatch(new RegExp(`\\.${v2Class(group)}\\s*\\{[^}]*background:\\s*var\\(--inner\\)[^}]*border-radius:\\s*var\\(--r-card\\)`));
  });
});
