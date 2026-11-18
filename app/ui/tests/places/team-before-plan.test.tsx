import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { TEAM_WAITS_FOR_PLAN, teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { HIRED_PAGE_WORDS, HIRED_READ_WORDS, hiredCapabilityPage } from '../../../../platform/runtime/venture/agents/hired-capabilities';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * The team is built at setup (founder, 14 Nov 2026): the agents hired when the owner kept their plan show on Team and
 * on Today's "Team at work" strip, and open with their chat, before the plan is accepted. The agents the plan brings
 * still wait for it; Team says so in the engine's one line, with the way to the plan.
 */
const card = (name: string, job: string, duties: string[], reads: string[]) => ({ name, job, duties, reads, digest: teamCardDigest({ name, job, duties, reads } as never) });
const ASHA = card('Asha', 'Lists likely customers for me.', ['Lists likely customers from public sources'], ['plan', 'trackers']);
const KABIR = card('Kabir', 'Drafts quotes for my approval.', ['Drafts a quote for each enquiry'], ['plan', 'clients']);

const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function start(hash: string, hire = true) {
  const engine = new FakeEngine({ fresh: true });
  const client = createFakeClient(engine);
  await client.request('workspace.create', { name: 'Clay Corner', pack: 'services' });
  await client.request('venture.create', { idea: 'Handmade pottery sold in bulk to cafes and small hotels', countryCode: 'IN' });
  if (hire) await client.request('venture.agents.hire.team', { agents: [ASHA, KABIR] });
  window.location.hash = hash;
  render(<App client={client} language="en" />);
  await settle();
  return { client };
}

describe('Team before the plan is accepted', () => {
  it('shows the hired agents, counts them, and says in one line that the plan brings the rest', async () => {
    await start('#/team');
    const main = screen.getByRole('main');
    expect(await within(main).findByRole('button', { name: 'Asha' })).toBeTruthy();
    expect(within(main).getByRole('button', { name: 'Kabir' })).toBeTruthy();
    expect(within(main).queryByText('No team yet.')).toBeNull();
    expect(main.textContent).toContain('2 agents in 1 department.');
    const line = within(main).getByText(TEAM_WAITS_FOR_PLAN).closest('p') as HTMLElement;
    expect(within(line).getByRole('link', { name: 'Read your plan' }).getAttribute('href')).toBe('#/today?focus=plan&read=1');
    // Keeper joins with the plan.
    expect(within(main).queryByRole('button', { name: 'Keeper' })).toBeNull();
    assertInkRules(main);
  });

  it('a hired agent opens with its chat before the plan is accepted', async () => {
    await start('#/team');
    await act(async () => { fireEvent.click(await within(screen.getByRole('main')).findByRole('button', { name: 'Asha' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const sheet = await screen.findByRole('complementary', { name: 'Asha' });
    expect(within(sheet).getAllByText('Lists likely customers from public sources').length).toBeGreaterThan(0);
    await act(async () => { fireEvent.click(within(sheet).getByRole('tab', { name: /Chat/ })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
    const panel = within(sheet).getByRole('tabpanel');
    await waitFor(() => expect(panel.getAttribute('data-tab')).toBe('chat'));
    // Its own chat box, ready for the first message (which still asks for the chat consent when an AI is connected).
    await waitFor(() => expect(within(panel).getAllByRole('textbox').length).toBeGreaterThan(0));
  });

  it('its sheet says which AI answers for it, never that it uses no AI', async () => {
    await start('#/team?sheet=agent:hire-1&tab=instructions');
    const sheet = await screen.findByRole('complementary', { name: 'Asha' });
    const ai = (await within(sheet).findByRole('heading', { name: 'Its AI' })).closest('section') as HTMLElement;
    await waitFor(() => expect(ai.querySelector('[data-tier="main"]')).not.toBeNull());
    expect(ai.textContent).not.toContain('This agent uses no AI.');
  });

  it('its Can do tab is its own honest page, never "That agent was not found"', async () => {
    const { client } = await start('#/team?sheet=agent:hire-1&tab=cando');
    const sheet = await screen.findByRole('complementary', { name: 'Asha' });
    const panel = within(sheet).getByRole('tabpanel');
    expect(await within(panel).findByText(HIRED_PAGE_WORDS.line)).toBeTruthy();
    expect(panel.textContent).not.toContain('That agent was not found');
    // What it reads is its hire card's reads; what it does is its duties; what is off is what a hired agent never does.
    const see = within(panel).getByRole('list', { name: 'What it can see' });
    expect(within(see).getAllByRole('listitem').map((item) => item.lastElementChild!.textContent)).toEqual([HIRED_PAGE_WORDS.chat, HIRED_READ_WORDS.plan, HIRED_READ_WORDS.trackers]);
    const does = within(panel).getByRole('list', { name: 'What it can do' });
    // A duty that sounds like a search says what the agent really does with it (the engine's hired-capabilities.ts).
    expect(within(does).getByText(`Lists likely customers from public sources. ${HIRED_PAGE_WORDS.listsOnly}`)).toBeTruthy();
    expect(within(does).getByText(HIRED_PAGE_WORDS.asks)).toBeTruthy();
    const off = within(panel).getByRole('list', { name: "If it is off here, it can't do it" });
    expect(within(off).getByText(HIRED_PAGE_WORDS.write)).toBeTruthy();
    expect(within(off).getByText(HIRED_PAGE_WORDS.reach)).toBeTruthy();
    // The fake answers exactly as the engine's own page builder does.
    const page = await client.request('venture.agents.capabilities', { agent: 'hire-1' });
    expect(page).toEqual(hiredCapabilityPage({ id: 'hire-1', duties: ASHA.duties, reads: ASHA.reads.map((read) => ({ read })) }));
    assertInkRules(panel);
  });

  it('with nobody hired the empty Team still says to accept the plan', async () => {
    await start('#/team', false);
    const main = screen.getByRole('main');
    expect(await within(main).findByText('No team yet.')).toBeTruthy();
    expect(within(main).queryByText(TEAM_WAITS_FOR_PLAN)).toBeNull();
  });

  it('Today shows them on the Team at work strip', async () => {
    await start('#/today');
    const strip = (await screen.findByRole('heading', { name: 'Team at work' })).closest('section') as HTMLElement;
    await waitFor(() => expect(within(strip).getByText('Asha')).toBeTruthy());
    expect(within(strip).getByText('Kabir')).toBeTruthy();
    expect(strip.textContent).toContain('2 idle');
  });
});
