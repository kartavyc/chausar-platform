// W6 6C5 (D20, D21): Business > Your rules (#/business/rules). One screen per locked rule in plain words, with a tick
// "I am responsible for this in my business" that records the date and can be withdrawn; then the hard stops, one line
// each, with no tick. W6 6C6: the side-work and compliance check onboarding mounts (ComplianceCheck).
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { ComplianceCheck } from '../../src/parts/ComplianceCheck';
import type { MethodName, RuleLocksLite } from '../../src/engine/types';

type Call = { method: string; params: unknown };
const LOCKS: RuleLocksLite = {
  playbook: { id: 'support-desk', label: 'Support desk' }, words: 'I am responsible for this in my business.', line: '2 rules wait for your tick.',
  rules: [
    { id: 'consumer-grievance', playbook: 'support-desk', topic: 'Consumer grievance deadlines', rule: 'Keep grievance acknowledgement and resolution separate from shop response targets.', limitations: 'Shop targets are not legal deadlines.', needs: 'lawyer', sources: [{ title: 'Department of Consumer Affairs', url: 'https://consumeraffairs.nic.in/' }], digest: 'rule-a', attestable: true, attestedOn: null, line: 'Client work that rests on this waits until you tick it.' },
    { id: 'support-privacy', playbook: 'support-desk', topic: 'Customer privacy', rule: 'Keep only the customer data needed for the support request and honour erasure.', limitations: 'Notice wording is yours.', needs: 'lawyer', sources: [], digest: 'rule-b', attestable: true, attestedOn: null, line: 'Client work that rests on this waits until you tick it.' },
  ],
  hardStops: [{ id: 'fake-reviews', line: 'No fake reviews.' }, { id: 'captcha', line: 'No getting past a CAPTCHA. Chausar stops there.' }],
};

function start(intercept: Partial<Record<MethodName, (params: unknown) => unknown>>) {
  window.location.hash = '#/business/rules';
  const engine = new FakeEngine();
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = intercept[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language="en" />);
  return { calls };
}

describe('Business: your rules (6C5)', () => {
  it('shows each locked rule in plain words with its own tick, records the tick, and lists hard stops with no tick', async () => {
    let view = structuredClone(LOCKS);
    const { calls } = start({
      'venture.rules.locks': () => view,
      'venture.rules.attest': (params) => {
        const p = params as { ruleId: string; attest: boolean };
        view = { ...view, rules: view.rules.map((rule) => rule.id === p.ruleId ? { ...rule, attestedOn: p.attest ? '2026-10-27' : null, line: p.attest ? 'You said you are responsible for this on 2026-10-27.' : 'Client work that rests on this waits until you tick it.' } : rule) };
        return view;
      },
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Your rules' })).toBeTruthy();
    const rule = await screen.findByRole('region', { name: 'Consumer grievance deadlines' });
    expect(within(rule).getByText('Keep grievance acknowledgement and resolution separate from shop response targets.')).toBeTruthy();
    expect(within(rule).getByText('Shop targets are not legal deadlines.')).toBeTruthy();
    const tick = within(rule).getByRole('checkbox', { name: 'I am responsible for this in my business.' }) as HTMLInputElement;
    expect(tick.checked).toBe(false);
    await act(async () => { fireEvent.click(tick); });
    expect(calls.filter((call) => call.method === 'venture.rules.attest').map((call) => call.params)).toEqual([{ ruleId: 'consumer-grievance', attest: true, digest: 'rule-a' }]);
    expect(await within(rule).findByText('You said you are responsible for this on 2026-10-27.')).toBeTruthy();
    await act(async () => { fireEvent.click(within(rule).getByRole('checkbox', { name: 'I am responsible for this in my business.' })); });
    expect(calls.filter((call) => call.method === 'venture.rules.attest').at(-1)?.params).toEqual({ ruleId: 'consumer-grievance', attest: false });
    const stops = screen.getByRole('region', { name: 'Never allowed' });
    expect(within(stops).getByText('No fake reviews.')).toBeTruthy();
    expect(within(stops).queryByRole('checkbox')).toBeNull();
  });
});

describe('ComplianceCheck (6C6)', () => {
  it('asks the side-work question, shows the advocate rules and switch-offs, and records the answer', async () => {
    const engine = new FakeEngine();
    const client = createFakeClient(engine);
    const calls: Call[] = [];
    const request = client.request.bind(client);
    client.request = ((method: MethodName, params?: unknown) => { calls.push({ method, params }); return request(method, params as never); }) as typeof client.request;
    const answers: unknown[] = [];
    render(<TextProvider language="en"><EngineProvider client={client}><ComplianceCheck profession="advocate" onDone={(answer) => answers.push(answer)} /></EngineProvider></TextProvider>);
    expect(await screen.findByText('Does your employment contract allow side work? This is your responsibility.')).toBeTruthy();
    expect(screen.getByText('Advocates may not advertise or ask people for work, directly or through others.')).toBeTruthy();
    expect(screen.getByText('Outreach is off: Bar Council rules bar advocates from asking people for work.')).toBeTruthy();
    expect(screen.getAllByText('Not checked against the official page yet').length).toBeGreaterThan(0);
    const go = screen.getByRole('button', { name: 'Continue' });
    expect(go.getAttribute('aria-disabled')).toBe('true');
    await act(async () => { fireEvent.click(screen.getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Continue' })); });
    const set = calls.find((call) => call.method === 'venture.compliance.set');
    expect(set?.params).toMatchObject({ profession: 'advocate', sideWork: 'not-sure' });
    expect(answers).toEqual([expect.objectContaining({ profession: 'advocate', sideWork: 'not-sure', recorded: true })]);
  });
  it('W6 6E6: a statute checked against its official page links that page with the date, and carries no unchecked tag', async () => {
    const client = createFakeClient(new FakeEngine());
    render(<TextProvider language="en"><EngineProvider client={client}><ComplianceCheck profession="school-teacher" record={false} onDone={() => {}} /></EngineProvider></TextProvider>);
    expect(await screen.findByText('School teachers covered by the Right to Education Act may not take private tuition or do private teaching.')).toBeTruthy();
    const link = screen.getByRole('link', { name: 'Official text, checked 1 Nov 2026' });
    expect(link.getAttribute('href')).toMatch(/^https:\/\/megscpcr\.gov\.in\//);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(screen.queryByText('Not checked against the official page yet')).toBeNull();
  });
});
