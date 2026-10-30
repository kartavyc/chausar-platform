// Lead desk UI through its real fake client: bounded research, owner-only handoffs, exact paid-search preview and Hindi.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { LeadGenerationDesk } from '../../src/places/work/desks/LeadGenerationDesk';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { assertInkRules } from '../helpers/ink-rules';
const start = (language: 'en' | 'hi' = 'en') => { const client = createFakeClient(new FakeEngine({ now: () => '2026-10-27T12:00:00.000Z' })); const spy = vi.spyOn(client, 'request'); render(<EngineProvider client={client}><TextProvider language={language}><LeadGenerationDesk /></TextProvider></EngineProvider>); return { client, spy }; };
describe('Work lead research desk', () => {
  it('researches only the stated count and offer, shows sources and drafts, and never sends', async () => {
    const { spy } = start();
    expect(await screen.findByRole('heading', { name: 'Your prospects' })).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Mumbai' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Your offer' }), { target: { value: 'shop websites' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Business postal address' }), { target: { value: '12 Lake Road, Mumbai' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Research prospects' })); });
    expect(await screen.findByText('Sample local business 1')).toBeTruthy();
    expect(screen.getAllByRole('link', { name: 'Source' }).length).toBeGreaterThan(0);
    expect(spy.mock.calls.filter(([method]) => /recordSend|outreach.sent/.test(method))).toHaveLength(0);
    assertInkRules();
  });
  it('shows exact Happenstance credit preview before asking to approve the paid search', async () => {
    const { spy } = start();
    await screen.findByRole('heading', { name: 'Your prospects' });
    fireEvent.click(screen.getByText('Search your Happenstance network'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Who to find' }), { target: { value: 'Bakery founders' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Show search cost' })); });
    expect(await screen.findByText(/2 credits/)).toBeTruthy();
    expect(spy.mock.calls.filter(([method, p]) => method === 'venture.desk.act' && (p as { action?: string }).action === 'search')).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Approve this paid search' }).getAttribute('aria-disabled')).toBe('true');
    assertInkRules();
  });
  it('words the desk and form in Hindi', async () => {
    start('hi');
    expect(await screen.findByRole('heading', { name: 'आपके संभावित क्लाइंट' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'संभावित क्लाइंट खोजें' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'शहर' })).toBeTruthy();
  });
});


it('confirms pasted community evidence through plain fields, shows quoted scores and coverage, and forgets it', async () => {
  const { spy } = start();
  await screen.findByRole('heading', { name: 'Your prospects' });
  fireEvent.click(screen.getByText('Review community posts'));
  const form = screen.getByRole('form', { name: 'Review community posts' });
  const values = { 'Product in two or three sentences': 'We help bakeries answer customer questions. Owners review every answer.', 'Problem to look for': 'missed questions', 'Categories, separated by commas': 'bakery', 'Pain words, separated by commas': 'missing questions', 'Community name': 'bakers', 'Post link': 'https://community.example/p1', 'Community rules link': 'https://community.example/rules', 'Rules checked on': '2026-10-27', 'Post date': '2026-10-26', 'Pasted post': 'I keep missing questions and need help answering shop questions.', 'Pain quote': 'missing questions', 'Fit quote': 'shop questions', 'Intent quote': 'need help' };
  for (const [name, value] of Object.entries(values)) fireEvent.change(within(form).getByLabelText(name), { target: { value } });
  fireEvent.change(within(form).getByLabelText('Pain score'), { target: { value: '4' } });
  fireEvent.change(within(form).getByLabelText('Fit score'), { target: { value: '5' } });
  fireEvent.click(within(form).getByLabelText('I confirm this product and that the community rules permit reading this post.'));
  await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Create community report' })); });
  expect(await screen.findByText('Covered 1 of 7 days.')).toBeTruthy();
  expect(screen.getByText('missing questions', { selector: 'blockquote' })).toBeTruthy();
  expect(spy.mock.calls.filter(([method, body]) => method === 'venture.desk.act' && (body as { action?: string }).action === 'community')).toHaveLength(1);
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Forget pasted evidence' })); });
  expect(screen.queryByText('Covered 1 of 7 days.')).toBeNull();
  assertInkRules();
});
