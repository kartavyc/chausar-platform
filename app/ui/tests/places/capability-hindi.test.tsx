import { expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

it('Hindi capability explanations preserve the exact state while translating fixed boundaries', async () => {
  window.location.hash = '#/team?sheet=agent:editor&tab=cando';
  render(<App client={createFakeClient(new FakeEngine())} language="hi" />);
  const panel = await screen.findByRole('complementary', { name: 'Editor' });
  await waitFor(() => expect(panel.textContent).toContain('ऑर्डर की एआई टीम'));
  const item = within(panel).getByText('क्लाइंट, संपर्क या जनता को कुछ नहीं भेज सकता।').closest('li')!;
  expect(item.querySelector('[data-state]')?.getAttribute('data-state')).toBe('off');
  expect(panel.textContent).toContain('हर कदम और उसमें पढ़ा जाने वाला डेटा');
});

it('Hindi Connections translates static planned/manual limits and AI setup evidence', async () => {
  window.location.hash = '#/connections';
  render(<App client={createFakeClient(new FakeEngine())} language="hi" />);
  const card = (await screen.findByText('Phone receptionist provider', { selector: 'button' })).closest('li')!;
  expect(card.textContent).toContain('लाइव कॉल अभी योजना में है');
  expect(card.querySelector('[data-connector-label] [data-label]')?.getAttribute('data-label')).toBe('planned');
  expect((await screen.findByText('Help-channel manual handoff', { selector: 'button' })).closest('li')!.textContent).toContain('कोई संदेश नहीं भेजा जाता');
  await waitFor(() => expect(document.body.textContent).toContain('अभी कोई एआई नहीं जुड़ा है'));
  expect(document.body.textContent).toContain('अभी Anthropic की चाबी इस्तेमाल करें।');
});

it('Hindi never replaces changed live capability evidence or custom step content', async () => {
  window.location.hash = '#/team?sheet=agent:editor&tab=cando';
  const client = createFakeClient(new FakeEngine());
  const request = client.request.bind(client);
  client.request = vi.fn(async (method, params) => {
    const real = await request(method, params);
    if (method !== 'venture.agents.capabilities') return real;
    const page = real as { line: string; items: { key: string; line: string }[] };
    return { ...page, line: 'Current team access revoked', items: page.items.map(item => ({ ...item, line: item.key === 'effect:send' ? 'Current send permission changed' : item.key.startsWith('step:') ? 'Client custom task stays verbatim' : item.line })) };
  }) as typeof client.request;
  render(<App client={client} language="hi" />);
  expect(await screen.findByText('Current team access revoked')).toBeTruthy();
  expect(screen.getByText('Current send permission changed')).toBeTruthy();
  expect(screen.getAllByText('Client custom task stays verbatim').length).toBeGreaterThan(0);
});
