// B4 task 4: an error sits in the slot of the card or button that failed, carries its fix, and is red only for a real
// failure. A known state is muted words with a small amber icon. Long words wrap and are never cut.
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { InlineError } from '../../src/parts/InlineError';
import { Composer } from '../../src/parts/Composer';
import { TextProvider } from '../../src/text';
import { cssOf, rule } from '../helpers/css';
import { act, type ReactNode } from 'react';

const draw = (node: ReactNode) => render(<TextProvider language="en">{node}</TextProvider>);

describe('InlineError', () => {
  it('a real failure is an alert in the failure tone', () => {
    draw(<InlineError>It did not work.</InlineError>);
    const line = screen.getByRole('alert');
    expect(line.textContent).toBe('It did not work.');
    expect(line.getAttribute('data-tone')).toBe('failure');
    expect(rule('InlineError.module.css', '.line')).toContain('var(--fail)');
  });

  it('the fix button calls its handler and is not part of the line', () => {
    const fix = vi.fn();
    draw(<InlineError fix={{ label: 'Check now', onSelect: fix }}>Check your AI first.</InlineError>);
    expect(screen.getByRole('alert').textContent).toBe('Check your AI first.');
    fireEvent.click(screen.getByRole('button', { name: 'Check now' }));
    expect(fix).toHaveBeenCalledOnce();
  });

  it('a fix on its way waits and says so', () => {
    draw(<InlineError fix={{ label: 'Check now', onSelect: () => {}, busy: true }}>Check your AI first.</InlineError>);
    const button = screen.getByRole('button', { name: 'Check now' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.getAttribute('aria-busy')).toBe('true');
  });

  it('the expected tone is a status, in muted words with an amber icon, with no red at all', () => {
    draw(<InlineError tone="expected">Connect your AI first.</InlineError>);
    expect(screen.queryByRole('alert')).toBeNull();
    const line = screen.getByRole('status');
    expect(line.getAttribute('data-tone')).toBe('expected');
    const expected = rule('InlineError.module.css', ".line[data-tone='expected']");
    expect(expected).toContain('var(--mute)');
    expect(expected).not.toContain('--fail');
    expect(rule('InlineError.module.css', ".line[data-tone='expected'] > svg")).toContain('var(--wait)');
  });

  it('a 300-character line is whole in the DOM, wraps, and nothing cuts it', () => {
    const long = `${'word '.repeat(60)}`.trim();
    expect(long.length).toBeGreaterThan(290);
    draw(<InlineError>{long}</InlineError>);
    expect(screen.getByRole('alert').textContent).toBe(long);
    const css = cssOf('InlineError.module.css');
    expect(css).toContain('overflow-wrap: anywhere');
    expect(css).not.toMatch(/text-overflow|line-clamp|white-space:\s*nowrap|overflow:\s*hidden|max-height/);
  });

  it('a short line in red, the long words after it in the normal colour', () => {
    const { container } = draw(<InlineError detail="The long reason, in full.">Not sent.</InlineError>);
    expect(screen.getByRole('alert').textContent).toBe('Not sent. The long reason, in full.');
    expect(container.querySelector('[data-detail]')!.textContent).toBe('The long reason, in full.');
    expect(rule('InlineError.module.css', '.detail')).toContain('var(--fg2)');
  });
});

describe('Composer', () => {
  const failing = (message: string) => () => Promise.reject(new Error(message));
  const sendIt = async () => {
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Hello there' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Send' })); });
  };

  it('a failure says one short red line, then the long reason in the normal colour, whole', async () => {
    const long = `Chats send your message. ${'And more words about it. '.repeat(10)}Never sent.`;
    const { container } = draw(<Composer label="Ask" onSend={failing(long)} />);
    await sendIt();
    const line = screen.getByRole('alert');
    expect(line.textContent).toBe(`Couldn't send, so your message is still here. ${long}`);
    expect(container.querySelector('[data-detail]')!.textContent).toBe(long);
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hello there');
  });

  it('a place can say a failure its own way, with its fix', async () => {
    const fix = vi.fn();
    draw(<Composer label="Ask" onSend={failing('Connect your AI first.')}
      describeFailure={(failure) => ({ words: (failure as Error).message, tone: 'expected', fix: { label: 'Connect your AI', onSelect: fix } })} />);
    await sendIt();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status').textContent).toBe('Connect your AI first.');
    fireEvent.click(screen.getByRole('button', { name: 'Connect your AI' }));
    expect(fix).toHaveBeenCalledOnce();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('Hello there');
  });
});
