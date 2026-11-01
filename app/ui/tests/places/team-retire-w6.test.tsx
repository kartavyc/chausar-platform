import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * Retiring an agent (wave 6 package 6G2, D43). From the agent panel's Instructions tab, a quiet "Retire this agent"
 * opens the check: what it holds, what is in flight, the routines that switch off, who takes over and what is kept.
 * Retiring sends the digest the owner read. The agent then sits on a Retired shelf under the departments with a
 * read-only chat, and Bring back restores it. Team at rest reads as before (the shelf shows only when used).
 */

async function start(hash = '#/team', before?: (base: ReturnType<typeof createFakeClient>) => Promise<void>) {
  window.location.hash = hash;
  const base = createFakeClient(new FakeEngine());
  if (before) await before(base);
  const spy = vi.fn();
  const client: EngineClient = {
    ...base,
    request: ((method: string, params?: Record<string, unknown>) => {
      spy(method, params);
      return base.request(method as never, params as never);
    }) as EngineClient['request'],
  };
  const view = render(<App client={client} language="en" />);
  return { base, spy, ...view };
}

const hashChanged = () => window.dispatchEvent(new HashChangeEvent('hashchange'));
const click = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); hashChanged(); }); };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };
const calls = (spy: ReturnType<typeof vi.fn>, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);

describe('Team: retire an agent and bring it back (6G2)', () => {
  it('Team at rest has no Retired shelf', async () => {
    await start();
    await screen.findByRole('button', { name: 'Chat with Editor' });
    await settle();
    expect(document.querySelector('[data-retired-shelf]')).toBeNull();
  });

  it('the check lists what it holds, what is in flight and who takes over; Retire sends the digest it read', async () => {
    const { spy, base } = await start('#/team?sheet=agent:editor&tab=instructions');
    const panel = await screen.findByRole('complementary', { name: 'Editor' });
    await click(await within(panel).findByRole('button', { name: 'Retire this agent' }));
    const check = await within(panel).findByRole('region', { name: 'Before Editor retires' });
    expect(within(check).getByText('What it holds')).toBeTruthy();
    expect(within(check).getByText('In flight')).toBeTruthy();
    expect(within(check).getByText('Routines that switch off')).toBeTruthy();
    expect(within(check).getByText(/^Nothing is lost\./)).toBeTruthy();
    const choices = within(check).getByRole('group', { name: 'Who takes over' });
    expect(within(choices).getByRole('radio', { name: 'You' })).toBeTruthy();
    await click(within(choices).getByRole('radio', { name: 'Producer' }));
    assertInkRules(check);
    const seen = await base.request('venture.agents.retire.check', { agent: 'editor' });
    await click(within(check).getByRole('button', { name: 'Retire Editor' }));
    await settle();
    expect(calls(spy, 'venture.agents.retire')).toEqual([{ agent: 'editor', to: 'producer', digest: seen.digest }]);
    // The panel now shows the retired agent read only, with Bring back and no box to write in.
    await waitFor(() => expect(document.querySelector('[data-retired-panel]')).toBeTruthy());
    const shelfPanel = await screen.findByRole('complementary', { name: 'Editor' });
    expect(within(shelfPanel).getByText('Retired. Producer does its steps now.')).toBeTruthy();
    expect(within(shelfPanel).getByText('Editor is retired. Producer does its steps now.')).toBeTruthy();
    expect(within(shelfPanel).queryByRole('textbox', { name: /^Message / })).toBeNull();
    expect(await within(shelfPanel).findByText('Retired. This chat is read only. Bring back makes it work again.')).toBeTruthy();
    expect(within(shelfPanel).queryByRole('button', { name: 'Add a note' })).toBeNull();
    expect(within(shelfPanel).getByRole('button', { name: 'Bring back' })).toBeTruthy();
  });

  it('the Retired shelf lists the agent under the departments, and Bring back restores it', async () => {
    const { spy } = await start('#/team', async (base) => {
      const seen = await base.request('venture.agents.retire.check', { agent: 'editor' });
      await base.request('venture.agents.retire', { agent: 'editor', to: 'owner', digest: seen.digest });
    });
    const shelf = await waitFor(() => { const found = document.querySelector('[data-retired-shelf]'); expect(found).toBeTruthy(); return found as HTMLElement; });
    expect(within(shelf).getByText('Editor')).toBeTruthy();
    expect(within(shelf).getByText(/Retired\. You took over its work\./)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Chat with Editor' })).toBeNull();
    assertInkRules(shelf);
    await click(within(shelf).getByRole('button', { name: 'Bring back Editor' }));
    await settle();
    expect(calls(spy, 'venture.agents.restore')).toEqual([{ agent: 'editor' }]);
    await screen.findByRole('button', { name: 'Chat with Editor' });
    await waitFor(() => expect(document.querySelector('[data-retired-shelf]')).toBeNull());
  });
});
