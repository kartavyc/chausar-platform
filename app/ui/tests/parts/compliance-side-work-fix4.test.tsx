/**
 * Fix round 4 (the real-app tour of 16 Nov 2026, problem 14): on "Day job and rules", answering that the contract does
 * NOT allow side work changed nothing on the page. The owner is now told plainly, right there, what that means and
 * what to do, in the engine's own words (core/compliance-data.ts), and so is an owner who is not sure. Neither answer
 * is blocked: Continue stays open, and the answer is handed on (or recorded) as the owner's.
 */
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { ComplianceCheck, type ComplianceAnswer } from '../../src/parts/ComplianceCheck';
import type { EngineClient, MethodName } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

const NOT_ALLOWED = 'Your contract does not allow side work, so taking paid work could put your job at risk. Check with your employer first. You can still continue, and Chausar records this as your answer.';
const NOT_SURE = 'Read your contract or ask your employer before you take paid work. You can still continue, and Chausar records this as your answer.';
const warning = () => document.querySelector('[data-side-work-warning]');

function mount(record: boolean, onDone: (answer: ComplianceAnswer) => void = () => {}) {
  const fake = createFakeClient(new FakeEngine());
  const calls: [string, unknown][] = [];
  const client: EngineClient = { ...fake, request: (async (method: MethodName, params?: unknown) => { calls.push([method, params]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<TextProvider language="en"><EngineProvider client={client}><ComplianceCheck profession="copywriter" record={record} onDone={onDone} /></EngineProvider></TextProvider>);
  return calls;
}
const pick = async (name: string) => { await act(async () => { fireEvent.click(await screen.findByRole('radio', { name })); }); };

describe('ComplianceCheck: a contract that does not allow side work', () => {
  it('says what it means and what to do, right there, and does not block the owner', async () => {
    const answers: ComplianceAnswer[] = [];
    mount(false, (answer) => answers.push(answer));
    await screen.findByRole('radio', { name: 'No, it does not' });
    expect(warning()).toBeNull();
    await pick('Yes, it allows side work');
    expect(warning()).toBeNull();
    await pick('No, it does not');
    expect(warning()?.textContent).toBe(NOT_ALLOWED);
    expect(warning()?.getAttribute('role')).toBe('status');
    // The line that it is the owner's own responsibility stays beside it.
    expect(screen.getByText('Chausar does not read your contract. You decide, and you are responsible for it.')).toBeTruthy();
    assertInkRules();
    const go = screen.getByRole('button', { name: 'Continue' }) as HTMLButtonElement;
    expect(go.disabled).toBe(false);
    expect(go.getAttribute('aria-disabled')).toBeNull();
    await act(async () => { fireEvent.click(go); });
    expect(answers).toEqual([expect.objectContaining({ profession: 'copywriter', sideWork: 'not-allowed', recorded: false })]);
  });

  it('an owner who is not sure is told to check, and one with no day job or an allowing contract sees no warning', async () => {
    const calls = mount(true);
    await pick('I am not sure');
    expect(warning()?.textContent).toBe(NOT_SURE);
    await pick("I don't have a day job");
    expect(warning()).toBeNull();
    await pick('No, it does not');
    expect(warning()?.textContent).toBe(NOT_ALLOWED);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    // Recorded as the owner's answer, as any other.
    expect(calls.find(([method]) => method === 'venture.compliance.set')?.[1]).toEqual(expect.objectContaining({ profession: 'copywriter', sideWork: 'not-allowed' }));
  });
});
