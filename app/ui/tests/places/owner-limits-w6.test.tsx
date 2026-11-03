import { expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

it('the owner raises outreach limits in a compact form with the platform warning', async () => {
  window.location.hash = '#/clients/pipeline';
  const engine = createFakeClient(new FakeEngine());
  render(<App client={engine} language="en" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Sending limits' }));
  const form = await screen.findByRole('form', { name: 'Sending limits' });
  expect(form.textContent).toMatch(/WhatsApp, Gmail and X can ban accounts that send too fast/);
  const email = await within(form).findByLabelText('Email daily sends');
  await waitFor(() => expect((email as HTMLInputElement).value).toBe('30'));
  fireEvent.change(email, { target: { value: '60' } });
  await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save limits' })); });
  await waitFor(() => expect(form.textContent).toContain('Saved. New sends use these limits.'));
  await waitFor(async () => expect((await engine.request('venture.pipeline.settings', {})).caps.channels?.email).toBe(60));
});

it('the owner raises daily agent write limits and confirms the exact settings', async () => {
  window.location.hash = '#/money/spend';
  const engine = createFakeClient(new FakeEngine());
  render(<App client={engine} language="en" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Daily work limits' }));
  const form = await screen.findByRole('form', { name: 'Daily work limits' });
  const messages = await within(form).findByLabelText('Messages a day');
  await waitFor(() => expect((messages as HTMLInputElement).value).toBe('40'));
  fireEvent.change(messages, { target: { value: '80' } });
  await act(async () => { fireEvent.click(within(form).getByRole('button', { name: 'Save limits' })); });
  await waitFor(() => expect(form.textContent).toContain('Saved. New work uses these limits.'));
  await waitFor(async () => expect((await engine.request('venture.spend.policy.get', {})).writeCaps?.find(row => row.kind === 'messages')?.cap).toBe(80));
});

it('fake settings keep exact fields and reject invalid cap numbers', async () => {
  const engine = createFakeClient(new FakeEngine());
  for (const value of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await expect(engine.request('venture.pipeline.settings', { caps: { channels: { email: value } } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.spend.policy.set', { writeCaps: { messages: value } })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  }
  const raised = { capPer24h: 10001, minGapMinutes: 0, warmUpDays: 0, duplicatePercent: 99, linkStreak: 8 };
  expect((await engine.request('venture.posting.limits.set', { connectorId: 'x', limits: raised })).channels.find(row => row.connectorId === 'x')?.inUse).toEqual(raised);
  await expect(engine.request('venture.pipeline.settings', { caps: { sneaky: 1 } } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
});

it('the fake uses raised send limits and still stops at the chosen cap', async () => {
  const now = '2026-10-23T10:00:00.000Z';
  const engine = createFakeClient(new FakeEngine({ now: () => now }));
  await engine.request('venture.pipeline.add', { personId: 'person_arjun', trigger: { kind: 'owner' } });
  const board = await engine.request('venture.pipeline.list', {});
  const arjun = board.columns.flatMap(column => column.cards).find(card => card.personId === 'person_arjun')!;
  await engine.request('venture.pipeline.settings', { caps: { channels: { email: 31 }, warmupPercent: [100, 100, 100, 100, 100] } });
  for (let i = 0; i < 30; i++) {
    const { draft } = await engine.request('venture.outreach.draft', { opportunityId: arjun.id, kind: 'reply', channel: 'email', basis: 'they-wrote-first' });
    await engine.request('venture.outreach.sent', { draftId: draft.id, at: now, channel: 'own-mailbox' });
  }
  const { draft } = await engine.request('venture.outreach.draft', { opportunityId: arjun.id, kind: 'reply', channel: 'email', basis: 'they-wrote-first' });
  expect((await engine.request('venture.outreach.open', { draftId: draft.id })).action).toBe('mailto');
  await engine.request('venture.pipeline.settings', { caps: { channels: { email: 30 } } });
  await expect(engine.request('venture.outreach.open', { draftId: draft.id })).rejects.toMatchObject({ code: 'OUTREACH_DAILY_CAP' });
});

it('new fake follow-ups keep the sending days and time chosen at the first send', async () => {
  let now = '2026-10-23T10:00:00.000Z';
  const engine = createFakeClient(new FakeEngine({ now: () => now }));
  await engine.request('venture.pipeline.add', { personId: 'person_arjun', trigger: { kind: 'owner' } });
  const board = await engine.request('venture.pipeline.list', {});
  const card = board.columns.flatMap(column => column.cards).find(card => card.personId === 'person_arjun')!;
  await engine.request('venture.pipeline.settings', { weekdays: [7], sendTime: '17:00' });
  const { draft } = await engine.request('venture.outreach.draft', { opportunityId: card.id, kind: 'reply', channel: 'email', basis: 'they-wrote-first' });
  await engine.request('venture.outreach.sent', { draftId: draft.id, at: now, channel: 'own-mailbox' });
  await engine.request('venture.pipeline.settings', { weekdays: [1], sendTime: '09:30' });
  let followups = await engine.request('venture.pipeline.followups', {});
  expect(followups.later.find(row => row.cardId === card.id)?.due).toBe('2026-11-01');
  now = '2026-11-01T10:00:00.000Z';
  followups = await engine.request('venture.pipeline.followups', {});
  expect(followups.later.find(row => row.cardId === card.id)?.line).toContain('from 17:00');
  now = '2026-11-01T12:00:00.000Z';
  followups = await engine.request('venture.pipeline.followups', {});
  expect(followups.due.some(row => row.cardId === card.id)).toBe(true);
});

it('direct lead sends keep their first sending calendar when settings change', async () => {
  const now = '2026-10-23T10:00:00.000Z';
  const engine = createFakeClient(new FakeEngine({ now: () => now }));
  await engine.request('venture.pipeline.settings', { weekdays: [7], sendTime: '17:00' });
  const { draft } = await engine.request('venture.leads.draft', { leadId: 'lead-pocket', subject: 'Hello there', body: 'A short note about our mic tests.' });
  await engine.request('venture.leads.recordSend', { leadId: 'lead-pocket', draftId: draft.id, sentAt: now });
  await engine.request('venture.pipeline.settings', { weekdays: [1], sendTime: '09:30' });
  const followups = await engine.request('venture.pipeline.followups', {});
  expect(followups.later.find(row => row.cardId === 'lead-pocket')?.due).toBe('2026-11-01');
});
