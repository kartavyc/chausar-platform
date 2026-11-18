import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { PLAN_TEAM_LINES } from '../../../../platform/runtime/venture/views/plan-sections';
import business from '../../src/text/en/business.json';
import { assertInkRules } from '../helpers/ink-rules';

/*
 * Business, Plan reads the plan the owner kept (found by running the real app, 15 Nov 2026). The plan sheet on Today
 * already led with the way to earn the owner kept and the team they hired; this page still showed the template's
 * "People and small businesses who need this service done well" and, for every service type, the hands-on step's
 * sentence about bookkeeping. Both readers now follow the engine's views/plan-sections.ts.
 */
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes in Pune.';
const WAY = {
  customer: 'Cafe owners in Pune who buy tableware in bulk.',
  reach: 'A list of cafes near Koregaon Park, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make up to about 200 pieces a month, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.'],
};
const MIRA = { name: 'Mira', job: 'Keeps cafe leads in order.', duties: ['Lists cafe prospects', 'Tracks follow ups'], reads: ['clients', 'trackers'] };
const settle = async () => { for (let i = 0; i < 6; i++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); }); };

async function potter() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  await client.request('workspace.create', { name: 'Koregaon Clay', pack: 'services', folder: null } as never);
  await client.request('venture.create', { idea: POTTER, countryCode: 'IN' } as never);
  let view = await client.request('venture.interview.next', { useTemplate: true });
  for (const question of view.interview.questions) view = await client.request('venture.interview.answer', { questionId: question.id, answer: question.required ? (question.kind === 'yesno' ? { yes: false } : { choiceId: question.choices[0]!.id }) : { skipped: true } } as never);
  const shown = { name: 'Koregaon Clay', by: 'template' as const, offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes.' }] };
  await client.request('venture.blueprint.draft', { useTemplate: true, shown });
  return client;
}
async function show(client: ReturnType<typeof createFakeClient>) {
  window.location.hash = '#/business/plan';
  render(<App client={client} language="en" />);
  await settle();
  return screen.getByRole('main');
}
const region = (main: HTMLElement, title: string) => within(main).getByText(title, { selector: 'h2' }).closest('section') as HTMLElement;

describe('Business, Plan: the plan the owner kept', () => {
  it('the fake answers venture.blueprint.get with the kept plan beside the record, only once something is kept', async () => {
    const client = await potter();
    const before = await client.request('venture.blueprint.get', {});
    expect('kept' in before!).toBe(false);
    await client.request('venture.owner.set', { way: WAY });
    expect((await client.request('venture.blueprint.get', {}))!.kept).toEqual({ way: WAY, team: [] });
    await client.request('venture.agents.hire.team', { agents: [{ ...MIRA, digest: teamCardDigest(MIRA as never) }] });
    const kept = await client.request('venture.blueprint.get', {});
    expect(kept!.kept).toEqual({ way: WAY, team: [{ name: 'Mira', job: MIRA.job, duties: MIRA.duties }] });
    expect(kept!.blueprint).toEqual(before!.blueprint);
  });

  it('says who pays, how the owner earns and who is on the team, in place of the template line', async () => {
    const client = await potter();
    const template = (await client.request('venture.blueprint.get', {}))!.blueprint.customer.value;
    await client.request('venture.owner.set', { way: WAY });
    await client.request('venture.agents.hire.team', { agents: [{ ...MIRA, digest: teamCardDigest(MIRA as never) }] });
    const main = await show(client);
    await waitFor(() => expect(within(main).getByText(`Who pays: ${WAY.customer}`)).toBeTruthy());
    expect(main.textContent).not.toContain(`For: ${template}`);
    const earn = region(main, 'How you earn');
    expect(within(earn).getAllByRole('listitem').map((item) => item.textContent)).toEqual([`How you reach them: ${WAY.reach}`, `Your team does: ${WAY.teamDoes}`, `You do: ${WAY.youDo}`]);
    const team = region(main, 'Your team');
    expect(within(team).getByText('Mira')).toBeTruthy();
    expect(team.textContent).toContain('Keeps cafe leads in order. Lists cafe prospects. Tracks follow ups.');
    for (const line of PLAN_TEAM_LINES) expect(within(team).getByText(line)).toBeTruthy();
    expect(within(team).getByRole('link', { name: 'Open Team' }).getAttribute('href')).toBe('#/team');
    assertInkRules(main);
  });

  it('with nothing kept the page reads as it did', async () => {
    const client = await potter();
    const template = (await client.request('venture.blueprint.get', {}))!.blueprint.customer.value;
    const main = await show(client);
    await waitFor(() => expect(within(main).getByText(`For: ${template}`)).toBeTruthy());
    expect(within(main).queryByText('How you earn')).toBeNull();
    expect(within(main).queryByText('Your team')).toBeNull();
  });

  it('the standing team lines are the engine\'s own', () => {
    expect([business['business.kept.teamNever'], business['business.kept.teamAsks']]).toEqual([...PLAN_TEAM_LINES]);
  });

  it('no business outside bookkeeping reads the hands-on step\'s sentence about bookkeeping', async () => {
    // Lumen is a content business whose stored step note is the engine's own, bookkeeping sentence and all.
    const lumen = createFakeClient(new FakeEngine());
    const stored = (await lumen.request('venture.blueprint.get', {}))!.blueprint.deliverySteps[1]!.note;
    expect(stored).toContain('For bookkeeping');
    const main = await show(lumen);
    const steps = region(main, 'Steps');
    await act(async () => { fireEvent.click(within(steps).getByText('How each step works')); });
    expect(within(steps).getByText('Cut the episode and the shorts: You do the hands-on work.')).toBeTruthy();
    expect(steps.textContent).not.toContain('bookkeeping');
  });

  it('a bookkeeping business still reads the whole note', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const main = await show(createFakeClient(engine));
    const steps = region(main, 'Steps');
    await act(async () => { fireEvent.click(within(steps).getByText('How each step works')); });
    expect(steps.textContent).toContain('For bookkeeping, an agent reconciles a month');
  });
});
