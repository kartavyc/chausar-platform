import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type EngineClient } from '../../src/engine/types';
import type { Language } from '../../src/text';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * The owner's name and the setup checklist (W4 4J21, from 4J9 and 4J8): Business > About you keeps the owner's first
 * name (only for Today's greeting) and the services the business does not sell (drafts never offer them), through
 * venture.owner.set; unsent edits are kept in the vault with venture.settings.draft ("Saved"), and a draft left
 * behind is offered back (W3's O22), never kept in browser storage. Business > Plan lists the setup steps by name, each
 * linking where it is done. Today's greeting says the name once one is set.
 */

const NOW = '2026-10-26T13:05:00.000Z';
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function start(hash: string, { engine = new FakeEngine({ now: () => NOW }), language = 'en' }: { engine?: FakeEngine; language?: Language } = {}) {
  const fake = createFakeClient(engine);
  const calls: [string, unknown][] = [];
  const client: EngineClient = {
    ...fake,
    request: (async (method: string, params?: unknown) => {
      calls.push([method, params]);
      return fake.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  window.location.hash = hash;
  render(<App client={client} language={language} />);
  await settle();
  return { calls, engine };
}

const timeOf = (iso: string) => new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

describe('Business > About you', () => {
  it('is a page in the business nav, with the first name and the services the business does not sell', async () => {
    await start('#/business/owner');
    expect(await screen.findByRole('heading', { level: 1, name: 'About you' })).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Business pages' })).getByRole('link', { name: 'About you' }).getAttribute('aria-current')).toBe('page');
    const name = screen.getByRole('textbox', { name: 'Your first name' }) as HTMLInputElement;
    expect(name.value).toBe('');
    expect(screen.getByText('Chausar uses it only to greet you on Today.')).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Services you do not sell' })).toBeTruthy();
    assertInkRules();
  });

  it('Save sends both fields to venture.owner.set, as typed, and the greeting on Today says the name', async () => {
    const { calls } = await start('#/business/owner');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your first name' }), { target: { value: 'Kartavy' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Services you do not sell' }), { target: { value: 'Logo design\n\nPrinting\n' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect(calls.find(([method]) => method === 'venture.owner.set')?.[1]).toEqual({ firstName: 'Kartavy', excludedServices: ['Logo design', 'Printing'] });
    expect(await screen.findByText('Your details are saved.')).toBeTruthy();
    await act(async () => { window.location.hash = '#/today'; window.dispatchEvent(new HashChangeEvent('hashchange')); });
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).textContent).toMatch(/^Good (morning|afternoon|evening), Kartavy$/));
  });

  it('a name the engine refuses shows its rule, and nothing is saved', async () => {
    const { calls } = await start('#/business/owner');
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your first name' }), { target: { value: 'K4rtavy!' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save' })); });
    expect((await screen.findByRole('alert')).textContent).toBe('Your first name can have 1 to 40 letters, with spaces, dots, hyphens or apostrophes between letters, and nothing else.');
    expect(calls.filter(([method]) => method === 'venture.owner.set')).toHaveLength(1);
  });

  it('"Take my name back" removes it and says backups still hold it, as Forget does', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.owner.set', { firstName: 'Kartavy' });
    const { calls } = await start('#/business/owner', { engine });
    await waitFor(() => expect((screen.getByRole('textbox', { name: 'Your first name' }) as HTMLInputElement).value).toBe('Kartavy'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Take my name back' })); });
    expect(calls.find(([method]) => method === 'venture.owner.set')?.[1]).toEqual({ firstName: null });
    expect(await screen.findByText('Backups made before now still hold this person until those backups are deleted.')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Your first name' }) as HTMLInputElement).value).toBe('');
  });

  it('unsent edits are kept in the vault as they are typed ("Saved"), and offered back after a restart', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const first = await start('#/business/owner', { engine });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your first name' }), { target: { value: 'Kart' } });
    await waitFor(() => expect(first.calls.find(([method]) => method === 'venture.settings.draft')?.[1]).toEqual({ form: 'owner', values: { firstName: 'Kart', excludedServices: [] } }), { timeout: 3000 });
    expect(await screen.findByText('Saved')).toBeTruthy();
    // The window closes before Save; the same engine answers the next time the app opens.
    document.body.innerHTML = '';
    await start('#/business/owner', { engine });
    const offer = await screen.findByRole('group', { name: `Recover unsaved changes from ${timeOf(NOW)}?` });
    expect((screen.getByRole('textbox', { name: 'Your first name' }) as HTMLInputElement).value).toBe('');
    fireEvent.click(within(offer).getByRole('button', { name: 'Recover' }));
    expect((screen.getByRole('textbox', { name: 'Your first name' }) as HTMLInputElement).value).toBe('Kart');
    expect(screen.queryByRole('group', { name: /Recover unsaved changes/ })).toBeNull();
  });
});

describe('Business > Plan: the setup steps by name', () => {
  it('the steps left, each linking where it is done, and every step one fold away', async () => {
    await start('#/business/plan');
    const heading = await screen.findByText('Setup', { selector: 'h2' });
    const setup = heading.closest('section')!;
    const left = await within(setup).findByRole('list', { name: 'Next steps' });
    const links = within(left).getAllByRole('link');
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Open it in Lovable or Replit', '#/business/build'],
      ['Follow the build on GitHub', '#/business/build'],
      ['Rehearse with practice clients', '#/business/practice'],
    ]);
    const fold = setup.querySelector('details') as HTMLDetailsElement;
    expect(fold.querySelector('summary')?.textContent).toBe('All 12 steps');
    const all = within(fold).getAllByRole('listitem');
    expect(all).toHaveLength(12);
    expect(all[0]!.textContent).toContain('Connect your AI');
    expect(all[0]!.querySelector('[data-done]')).not.toBeNull();
    expect(all[11]!.querySelector('[data-done]')).toBeNull();
  });
});

describe('Settings drafts on every settings form (W4 4J21, W3 O22)', () => {
  const drafted = (calls: [string, unknown][]) => calls.filter(([method]) => method === 'venture.settings.draft').map(([, params]) => params);

  it('Goals keeps the typed goal as its draft, exactly what venture.goals.set takes, and offers it back', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const first = await start('#/business/goals', { engine });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Goal amount' }), { target: { value: '180000' } });
    await waitFor(() => expect(drafted(first.calls)).toEqual([{ form: 'goals', values: { month: '2026-10', amount: '180000' } }]), { timeout: 3000 });
    document.body.innerHTML = '';
    await start('#/business/goals', { engine });
    const offer = await screen.findByRole('group', { name: `Recover unsaved changes from ${timeOf(NOW)}?` });
    fireEvent.click(within(offer).getByRole('button', { name: 'Recover' }));
    expect((screen.getByRole('textbox', { name: 'Goal amount' }) as HTMLInputElement).value).toBe('180000');
  });

  it('Notifications keeps quiet hours and the digest as typed, as venture.notify.settings takes them, and offers them back', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const first = await start('#/business/notifications', { engine });
    const quiet = await screen.findByRole('checkbox', { name: 'Quiet hours' }) as HTMLInputElement;
    const was = quiet.checked;
    fireEvent.click(quiet);
    await waitFor(() => expect(drafted(first.calls)).toHaveLength(1), { timeout: 3000 });
    const values = (drafted(first.calls)[0] as { form: string; values: { quietHours: unknown; digest: unknown } });
    expect(values.form).toBe('notifications');
    expect(Object.keys(values.values).sort()).toEqual(['digest', 'quietHours']);
    document.body.innerHTML = '';
    await start('#/business/notifications', { engine });
    const offer = await screen.findByRole('group', { name: /Recover unsaved changes/ });
    fireEvent.click(within(offer).getByRole('button', { name: 'Recover' }));
    expect((screen.getByRole('checkbox', { name: 'Quiet hours' }) as HTMLInputElement).checked).toBe(!was);
  });

  it('Spend limits keep the edited limit as a draft of exactly what venture.spend.policy.set takes, and offer it back', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const first = await start('#/money/spend', { engine });
    fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Monthly limit' }), { target: { value: '25' } });
    await waitFor(() => expect(drafted(first.calls)).toHaveLength(1), { timeout: 3000 });
    const kept = drafted(first.calls)[0] as { form: string; values: Record<string, unknown> };
    expect(kept.form).toBe('spend-policy');
    expect(Object.keys(kept.values).sort()).toEqual(['askFirstUsd', 'capUsd', 'currencyLead', 'inrPerUsd', 'rates']);
    expect(kept.values.capUsd).toBe('25');
    document.body.innerHTML = '';
    await start('#/money/spend', { engine });
    const offer = await screen.findByRole('group', { name: /Recover unsaved changes/ });
    fireEvent.click(within(offer).getByRole('button', { name: 'Recover' }));
    expect((screen.getByRole('textbox', { name: 'Monthly limit' }) as HTMLInputElement).value).toBe('25');
  });

  it('"Not now" declines a draft on purpose: it is replaced by an empty one, and not offered again', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.settings.draft', { form: 'owner', values: { firstName: 'Kart', excludedServices: [] } });
    const second = await start('#/business/owner', { engine });
    fireEvent.click(within(await screen.findByRole('group', { name: /Recover unsaved changes/ })).getByRole('button', { name: 'Not now' }));
    await waitFor(() => expect(drafted(second.calls)).toEqual([{ form: 'owner', values: {} }]));
    document.body.innerHTML = '';
    await start('#/business/owner', { engine });
    await screen.findByRole('textbox', { name: 'Your first name' });
    await settle();
    expect(screen.queryByRole('group', { name: /Recover unsaved changes/ })).toBeNull();
  });

  it("a draft the engine refuses says the engine's own line, never Saved", async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const fake = createFakeClient(engine);
    const client: EngineClient = {
      ...fake,
      request: (async (method: string, params?: unknown) => {
        if (method === 'venture.settings.draft') throw new EngineError('INVALID_VENTURE_REQUEST', 'This draft is too large to keep.');
        return fake.request(method as never, params as never);
      }) as EngineClient['request'],
    };
    window.location.hash = '#/business/owner';
    render(<App client={client} language="en" />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Your first name' }), { target: { value: 'Kart' } });
    await waitFor(() => expect(document.querySelector('[data-draft-refused]')?.textContent).toBe('This draft is too large to keep.'), { timeout: 3000 });
    expect(screen.queryByText('Saved')).toBeNull();
  });
});
