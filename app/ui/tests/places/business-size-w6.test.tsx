// W6 founder decisions of 3 November 2026: the business's size is asked in the onboarding rules step only when one of
// the profession's rules counts it (today the home chef's FSSAI rule), as ranges in the engine's words with "I'd rather
// not say", and each sized rule then says what applies at that size, in the engine's words. The owner can change it
// later in Business > About you.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { ComplianceCheck, type ComplianceAnswer } from '../../src/parts/ComplianceCheck';
import type { ComplianceLite, EngineClient, MethodName } from '../../src/engine/types';

const CHEF = 'home-chef-tiffin';
const QUESTION = "What's your yearly turnover?";
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

function recording(engine = new FakeEngine()) {
  const fake = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const client: EngineClient = { ...fake, request: (async (method: MethodName, params?: unknown) => { calls.push([method, params]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  return { client, calls, engine };
}

function check(client: EngineClient, profession: string, record: boolean, onDone: (answer: ComplianceAnswer) => void = () => {}) {
  render(<TextProvider language="en"><EngineProvider client={client}><ComplianceCheck profession={profession} record={record} onDone={onDone} /></EngineProvider></TextProvider>);
}

describe('ComplianceCheck: the business size', () => {
  it('asks the size only when a rule counts it, shows the engine\'s verdict for the picked range, and hands the answer back', async () => {
    const { client, calls } = recording();
    const answers: ComplianceAnswer[] = [];
    check(client, CHEF, false, (answer) => answers.push(answer));
    const group = await screen.findByRole('radiogroup', { name: QUESTION });
    expect(within(group).getAllByRole('radio').map((radio) => radio.closest('label')?.textContent?.trim())).toEqual(['Up to ₹1.5 crore a year', 'More than ₹1.5 crore a year', "I'd rather not say"]);
    expect(screen.getByText('Some rules change with your size. Chausar uses this only to show which ones apply.')).toBeTruthy();
    const rule = document.querySelector('[data-profession-rule="fssai"]') as HTMLElement;
    expect(within(rule).getByText('Add your yearly turnover to see which applies.')).toBeTruthy();

    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'Up to ₹1.5 crore a year' })); });
    expect(await within(rule).findByText('At your size: an FSSAI registration.')).toBeTruthy();
    expect(calls.filter(([method]) => method === 'venture.compliance.get').at(-1)?.[1]).toEqual({ profession: CHEF, size: { turnover: 'up-to-1500000000' } });
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'More than ₹1.5 crore a year' })); });
    expect(await within(rule).findByText('Above ₹1.5 crore a year: an FSSAI state licence.')).toBeTruthy();

    // The size is optional; the side-work answer still opens Continue.
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Yes, it allows side work' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    expect(calls.some(([method]) => method === 'venture.compliance.set')).toBe(false);
    expect(answers).toEqual([expect.objectContaining({ profession: CHEF, sideWork: 'allowed', size: { turnover: 'above-1500000000' }, recorded: false })]);
  });

  it('asks nothing about size for a profession whose rules do not count it', async () => {
    const { client, calls } = recording();
    check(client, 'advocate', true);
    await screen.findByText('Does your employment contract allow side work? This is your responsibility.');
    expect(screen.queryByRole('radiogroup', { name: QUESTION })).toBeNull();
    expect(screen.queryByText(/Some rules change with your size/)).toBeNull();
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    expect(calls.find(([method]) => method === 'venture.compliance.set')?.[1]).toEqual({ profession: 'advocate', sideWork: 'not-sure', digest: expect.any(String) });
  });

  it('records the picked range with the side-work answer when the business is open, and "I\'d rather not say" stays calm', async () => {
    const { client, calls } = recording();
    check(client, CHEF, true);
    const group = await screen.findByRole('radiogroup', { name: QUESTION });
    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: "I'd rather not say" })); });
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'Yes, it allows side work' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    expect(calls.find(([method]) => method === 'venture.compliance.set')?.[1]).toEqual({ profession: CHEF, sideWork: 'allowed', digest: expect.any(String), size: { turnover: 'not-say' } });
    expect(screen.getByText('Add your yearly turnover to see which applies.')).toBeTruthy();
  });
});

describe('Business > About you: the business size', () => {
  it('shows the saved range and what applies, and Save size changes only the size', async () => {
    const engine = new FakeEngine();
    const view = await engine.request('venture.compliance.get', { profession: CHEF }) as ComplianceLite;
    await engine.request('venture.compliance.set', { profession: CHEF, sideWork: 'allowed', digest: view.digest, size: { turnover: 'up-to-1500000000' } });
    const { client, calls } = recording(engine);
    window.location.hash = '#/business/owner';
    render(<App client={client} language="en" />);
    await settle();
    const section = await screen.findByRole('region', { name: 'Your business size' });
    const group = within(section).getByRole('radiogroup', { name: QUESTION });
    expect((within(group).getByRole('radio', { name: 'Up to ₹1.5 crore a year' }) as HTMLInputElement).checked).toBe(true);
    expect(within(section).getByText('At your size: an FSSAI registration.')).toBeTruthy();
    expect(within(section).getByText('FSSAI licence or registration')).toBeTruthy();

    await act(async () => { fireEvent.click(within(group).getByRole('radio', { name: 'More than ₹1.5 crore a year' })); });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Save size' })); });
    expect(calls.find(([method]) => method === 'venture.compliance.set')?.[1]).toEqual({ size: { turnover: 'above-1500000000' } });
    expect(await within(section).findByRole('status')).toHaveProperty('textContent', 'Your size is saved.');
    await waitFor(() => expect(within(section).getByText('Above ₹1.5 crore a year: an FSSAI state licence.')).toBeTruthy());
    const after = await engine.request('venture.compliance.get', {}) as ComplianceLite;
    expect([after.recorded?.sideWork, after.size?.questions[0]!.answer]).toEqual(['allowed', 'above-1500000000']);
  });

  it('shows no size setting when no rule of the business counts size', async () => {
    const engine = new FakeEngine();
    const view = await engine.request('venture.compliance.get', { profession: 'advocate' }) as ComplianceLite;
    await engine.request('venture.compliance.set', { profession: 'advocate', sideWork: 'allowed', digest: view.digest });
    const { client } = recording(engine);
    window.location.hash = '#/business/owner';
    render(<App client={client} language="en" />);
    await settle();
    expect(await screen.findByRole('heading', { level: 1, name: 'About you' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Your business size' })).toBeNull();
  });
});
