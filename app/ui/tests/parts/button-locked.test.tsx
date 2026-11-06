import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Button } from '../../src/parts/Button';
import { Receipt } from '../../src/parts/Receipt';
import { runKey } from '../../src/shell/keys';
import { TextProvider } from '../../src/text';
import { receiptMark } from '../helpers/ink-rules';

const css = (file: string) => readFileSync(join(import.meta.dirname, '../../src/parts', file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('a locked button', () => {
  it('can be reached with Tab, and Enter, Space or a click do nothing', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<><Button>Watch</Button><Button variant="primary" locked lockedReason="Unlocks after you watch it" onClick={onClick}>Approve</Button></>);
    const approve = screen.getByRole('button', { name: 'Approve' });
    await user.tab();
    await user.tab();
    expect(document.activeElement).toBe(approve);
    await user.keyboard('{Enter}');
    await user.keyboard(' ');
    await user.click(approve);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('says "Locked" and the reason in its description when there is no note line', () => {
    render(<><Button locked lockedReason="Unlocks after you open it">Accept</Button><Button variant="primary" locked>Send</Button></>);
    expect(screen.getByRole('button', { name: 'Accept', description: 'Locked. Unlocks after you open it' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Send', description: 'Locked. Not available yet' })).toBeTruthy();
  });

  it('keeps a description it is given, after the locked words', () => {
    render(<><Button variant="primary" locked aria-describedby="hint" lockedNoteId="note">Issue</Button><p id="hint">Sends to the client.</p><p id="note">Issue unlocks after you read it.</p></>);
    expect(screen.getByRole('button', { name: 'Issue', description: 'Sends to the client. Locked. Issue unlocks after you read it.' })).toBeTruthy();
  });

  it('says it in Hindi too', () => {
    render(<TextProvider language="hi"><Button variant="primary" locked>भेजें</Button></TextProvider>);
    const button = screen.getByRole('button', { name: 'भेजें' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.getAttribute('title')).toBe('अभी उपलब्ध नहीं');
  });

  it('never submits the form it sits in', async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn((event: SubmitEvent) => event.preventDefault());
    render(<form onSubmit={(event) => onSubmit(event.nativeEvent as SubmitEvent)}><Button type="submit" variant="primary" locked>Send</Button></form>);
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('a natively disabled button (busy) stays natively disabled, with no locked words', () => {
    render(<Button variant="primary" disabled>Approve</Button>);
    const approve = screen.getByRole('button', { name: 'Approve' });
    expect(approve).toHaveProperty('disabled', true);
    expect(approve.hasAttribute('aria-disabled')).toBe(false);
    expect(approve.hasAttribute('aria-describedby')).toBe(false);
  });

  it('the A shortcut does not run a locked primary', () => {
    const onClick = vi.fn();
    render(
      <main>
        <ul><li data-row="" tabIndex={-1}><Button data-key="secondary">Watch</Button><Button data-key="primary" variant="primary" locked onClick={onClick}>Approve</Button></li></ul>
      </main>,
    );
    const row = document.querySelector<HTMLElement>('[data-row]')!;
    row.focus();
    expect(runKey('primary', document.querySelector('main'), () => {})).toBe(false);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('a locked secondary looks locked too, and nothing locked changes on hover', () => {
    const button = css('Button.module.css');
    expect(button).toMatch(/\.button\[data-locked\]:not\(\.primary\):not\(\.quiet\)\s*\{[^}]*background:\s*var\(--wash\)[^}]*color:\s*var\(--mute\)/);
    for (const [, selector] of button.matchAll(/([^{}]+)\{[^}]*\}/g)) {
      for (const part of selector!.split(',')) if (part.includes(':hover')) expect(part.trim()).toMatch(/:not\(\[data-locked\]\)/);
    }
  });
});

describe('the chat button', () => {
  it('may be named by aria-labelledby as well as aria-label', () => {
    render(<><span id="who">Chat with Editor</span><Button variant="chat" aria-labelledby="who" /></>);
    expect(screen.getByRole('button', { name: 'Chat with Editor' }).dataset.variant).toBe('chat');
  });

  it('is D\'s 32 px tall quiet button, as tall as the 32 px avatar it sits beside', () => {
    expect(css('Button.module.css')).toMatch(/\.chat\[data-size='sm'\]\s*\{[^}]*min-height:\s*var\(--av-32\)/);
  });
});

describe('the dark receipt', () => {
  it('lightens on hover with the goal card\'s own hover colour', () => {
    expect(css('Receipt.module.css')).toMatch(/\[data-tone='dark'\]:hover\s*\{[^}]*color:\s*var\(--goal-link-hover\)/);
    render(<Receipt id="R-0421" tone="dark" onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: receiptMark('R-0421') }).dataset.tone).toBe('dark');
  });
});
