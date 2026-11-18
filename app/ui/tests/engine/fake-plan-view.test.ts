import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { teamCardDigest } from '../../../../platform/runtime/venture/agents/team-proposal';
import { KEEPER_JOINS } from '../../../../platform/runtime/venture/agents/order-agents-core';

// The plan the owner reads before accepting, as the engine's views/queue-view.ts planView answers it: the kept plan, laid
// out by the engine's own views/plan-sections.ts. With a way to earn kept and a team hired the sheet leads with them;
// a business that does not charge the tax reads "plain invoices"; no potter reads a line about bookkeeping.
const POTTER = 'I make pottery by hand, mostly mugs and bowls, and I want bulk orders from cafes in Pune.';
const WAY = {
  customer: 'Cafe owners in Pune who buy tableware in bulk.',
  reach: 'A list of cafes near Koregaon Park, then a first message you send to each one.',
  teamDoes: 'Drafts each message and quote, and keeps track of who replied.',
  youDo: 'Make up to about 200 pieces a month, set the prices and send each message.',
  firstWeek: ['Decide the designs and your price for each offer.', 'Approve the first list of cafes.'],
};
const MIRA = { name: 'Mira', job: 'Keeps cafe leads in order.', duties: ['Lists cafe prospects', 'Tracks follow ups'], reads: ['clients', 'trackers'] };

async function kept() {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  await client.request('workspace.create', { name: 'Koregaon Clay', pack: 'services', folder: null } as never);
  await client.request('venture.create', { idea: POTTER, countryCode: 'IN' } as never);
  let view = await client.request('venture.interview.next', { useTemplate: true });
  for (const question of view.interview.questions) view = await client.request('venture.interview.answer', { questionId: question.id, answer: question.required ? (question.kind === 'yesno' ? { yes: false } : { choiceId: question.choices[0]!.id }) : { skipped: true } } as never);
  const shown = { name: 'Koregaon Clay', by: 'template' as const, offers: [{ name: 'Cafe mug sets', line: 'Handmade mugs in bulk for cafes.' }] };
  const blueprint = (await client.request('venture.blueprint.draft', { useTemplate: true, shown })).blueprint;
  return { client, blueprint };
}
const headings = (view: { sections: { heading?: string }[] }) => view.sections.map((section) => section.heading);
const lines = (view: { sections: { heading?: string; lines: string[] }[] }, heading: string) => view.sections.find((section) => section.heading === heading)?.lines;

describe('fake venture.queue.view: the plan the owner kept', () => {
  it('reads the kept plan as the engine lays it out, with no bookkeeping line and no tax contradiction', async () => {
    const { client, blueprint } = await kept();
    const view = await client.request('venture.queue.view', { kind: 'plan', id: blueprint.id });
    expect(view.kind).toBe('plan');
    expect(view.title).toBe('Koregaon Clay');
    expect(view.line).toBe(blueprint.oneLiner.value);
    // The agent that will do each order is listed as the team, said to join when the plan is accepted (agents/order-agents.ts).
    expect(headings(view)).toEqual(['Who it is for', 'What you sell', 'Your team', 'How the work is done', 'What you approve', 'Back office']);
    expect(lines(view, 'Your team')?.[0]).toBe('Delivery agent: Drafts the reply to each order for you to check. Joins when you accept this plan.');
    expect(lines(view, 'What you sell')).toEqual(['Cafe mug sets: no price yet. Handmade mugs in bulk for cafes.']);
    expect(JSON.stringify(view.sections)).not.toContain('bookkeeping');
    expect(lines(view, 'Back office')).toEqual(['You do not charge GST.', 'Invoices are plain invoices.']);
  });

  it('leads with the way to earn the owner kept and lists the team they hired', async () => {
    const { client, blueprint } = await kept();
    await client.request('venture.owner.set', { way: WAY });
    await client.request('venture.agents.hire.team', { agents: [{ ...MIRA, digest: teamCardDigest(MIRA as never) }] });
    const view = await client.request('venture.queue.view', { kind: 'plan', id: blueprint.id });
    expect(headings(view)).toEqual(['Who pays', 'What you sell', 'How you earn', 'First week', 'Your team', 'How each order is done', 'What you approve', 'Back office']);
    expect(lines(view, 'Who pays')).toEqual([WAY.customer]);
    expect(lines(view, 'How you earn')).toEqual([`How you reach them: ${WAY.reach}`, `Your team does: ${WAY.teamDoes}`, `You do: ${WAY.youDo}`]);
    expect(lines(view, 'First week')).toEqual(['1. Decide the designs and your price for each offer.', '2. Approve the first list of cafes.']);
    expect(lines(view, 'Your team')).toEqual([
      'Mira: Keeps cafe leads in order. Lists cafe prospects. Tracks follow ups.',
      'Delivery agent: Drafts the reply to each order for you to check. Joins when you accept this plan.',
      // Keeper joins with the plan too, so the plan lists it (the engine's views/plan-sections.ts).
      `Keeper: ${KEEPER_JOINS.does} Joins when you accept this plan.`,
      'None of them sends, pays, posts, deletes or changes a price by itself.', 'They ask you before anything leaves.',
    ]);
  });

  it('a plan that is not this business\'s is not found, as before', async () => {
    const { client } = await kept();
    await expect(client.request('venture.queue.view', { kind: 'plan', id: 'plan-nobody-1' })).rejects.toMatchObject({ code: 'VIEW_NOT_FOUND' });
  });
});
