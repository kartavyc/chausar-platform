import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';

// Fix round 4 (the tours of 16 Nov 2026): the fake places an idea exactly as the engine does, through the engine's own
// pure pick and classifier (platform/runtime/venture/core/service-keywords.ts; platform/tests/venture-placement-fix4.test.ts
// holds the engine to the same answers). Found on the sample data: "I run a recruitment agency for small businesses in
// Pune." landed on the job seekers' desk, because the fake's classifier skipped the playbook the words pick, read them
// as another service type and so put the People and careers lead sentence, a job seekers' one, before them.
const RECRUITER = 'I run a recruitment agency for small businesses in Pune.';
const BAKER = 'I bake custom cakes and cupcakes from my home kitchen in Indore and want regular orders from offices and event planners.';

async function business(idea: string) {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  await client.request('workspace.create', { name: 'A new business', pack: 'services', folder: null } as never);
  await client.request('venture.create', { idea, countryCode: 'IN' } as never);
  let view = await client.request('venture.interview.next', { useTemplate: true });
  for (const question of view.interview.questions) view = await client.request('venture.interview.answer', { questionId: question.id, answer: question.required ? (question.kind === 'yesno' ? { yes: false } : { choiceId: question.choices[0]!.id }) : { skipped: true } } as never);
  return { client, plan: await client.request('venture.blueprint.draft', { useTemplate: true }) };
}

describe('fake engine: an idea is placed as the engine places it', () => {
  it("a recruiter's own words stay the idea and pick the recruiting desk", async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    const read = await client.request('venture.about.read', { text: RECRUITER });
    expect(read.family?.id).toBe('people');
    expect(read.idea).toBe(RECRUITER);
    expect((await client.request('venture.preview', { idea: RECRUITER, countryCode: 'IN' })).serviceType.value).toBe('consulting');
    const { plan } = await business(read.idea!);
    expect(plan.playbook?.id).toBe('recruiting-desk');
  });

  it('a trade named as the customer picks no desk: a baker who sells to event planners is no booking desk', async () => {
    const client = createFakeClient(new FakeEngine({ fresh: true }));
    expect((await client.request('venture.preview', { idea: BAKER, countryCode: 'IN' })).serviceType.value).toBe('other');
    const { plan } = await business(BAKER);
    expect(plan.playbook ?? null).toBeNull();
    // The owner's own trade still picks.
    expect((await business('I am a wedding planner in Pune')).plan.playbook?.id).toBe('booking-desk');
  });
});
