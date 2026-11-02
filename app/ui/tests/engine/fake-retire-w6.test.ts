import { describe, expect, it } from 'vitest';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { RETIRE_KEPT_LINE } from '../../../../platform/runtime/venture/agents/retired-words';

// Wave 6 package 6G2 (D43): the fake engine retires an agent and brings it back as the engine's agents/retire.ts does
// (the engine's own tests are platform/tests/venture-agent-retire-w6.test.ts): the same check, shelf, handover, words
// and refusals. The sample is Lumen Studio: Editor, Researcher, Producer and Publisher, with Keeper last.

const PROMPT = 'Tell me which videos are waiting on me and what each one needs from me.';
const HOURLY = { kind: 'interval' as const, everyMinutes: 60, from: '2026-10-23T10:00:00.000Z' };

function fake() {
  return createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z' }));
}

// Each fake request reads the whole sample business (about 0.1 s here, 0.7 s for the retire check), so the longer
// cases pass 5 s on the slower Windows CI runner.
describe('fake retire an agent (6G2)', { timeout: 20_000 }, () => {
  it('the check lists what the agent holds, what is in flight, the routines that switch off and who can take over', async () => {
    const client = fake();
    const routine = (await client.request('venture.routines.set', { routine: { name: 'Check in', agent: 'editor', prompt: PROMPT, schedule: HOURLY, on: true } })).routine;
    const editor = (await client.request('venture.team.list', {})).agents.find((agent) => agent.id === 'editor')!;
    const seen = await client.request('venture.agents.retire.check', { agent: 'editor' });
    expect(seen.agent).toEqual({ id: 'editor', name: 'Editor', role: editor.role });
    expect(seen.holds.steps).toEqual(editor.steps.map((step) => step.purpose));
    expect(seen.holds.notes).toBe(1);
    expect(seen.routines).toEqual([{ id: routine.id, name: 'Check in', when: routine.when }]);
    expect(seen.inFlight.some((item) => item.kind === 'proposal')).toBe(true);
    expect(seen.to.map((item) => item.id)).toEqual(['researcher', 'producer', 'publisher'].filter((id) => seen.to.some((item) => item.id === id)));
    expect(seen.to.some((item) => item.id === 'editor' || item.id === 'keeper')).toBe(false);
    expect(seen.kept).toBe(RETIRE_KEPT_LINE);
    expect(seen.blocked).toBeNull();
    expect(seen.digest).toMatch(/^[0-9a-f]{64}$/);
    await expect(client.request('venture.agents.retire.check', { agent: 'keeper' })).rejects.toMatchObject({ code: 'AGENT_IS_CODE' });
    await expect(client.request('venture.agents.retire.check', { agent: 'nobody' })).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('retire puts it on the shelf, hands its steps over, switches its routines off and keeps its chat read only', async () => {
    const client = fake();
    const routine = (await client.request('venture.routines.set', { routine: { name: 'Check in', agent: 'editor', prompt: PROMPT, schedule: HOURLY, on: true } })).routine;
    const before = await client.request('venture.team.list', {});
    const editor = before.agents.find((agent) => agent.id === 'editor')!;
    const receiver = before.agents.find((agent) => agent.id === 'producer')!;
    const seen = await client.request('venture.agents.retire.check', { agent: 'editor' });
    await expect(client.request('venture.agents.retire', { agent: 'editor', to: 'producer', digest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await expect(client.request('venture.agents.retire', { agent: 'editor', to: 'editor', digest: seen.digest })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const done = await client.request('venture.agents.retire', { agent: 'editor', to: 'producer', digest: seen.digest });
    expect(done.retired).toMatchObject({ id: 'editor', name: 'Editor', to: { id: 'producer', name: 'Producer' }, line: 'Retired. Producer does its steps now.' });
    expect(done.line).toBe('Editor is retired. Producer does its steps now. Its routines are off.');
    const after = await client.request('venture.team.list', {});
    expect(after.agents.some((agent) => agent.id === 'editor')).toBe(false);
    expect(after.retired?.map((item) => item.id)).toEqual(['editor']);
    expect(after.agents.find((agent) => agent.id === 'producer')!.steps.map((step) => step.id)).toEqual([...receiver.steps, ...editor.steps].map((step) => step.id));
    expect((await client.request('venture.routines.list', {})).routines.find((item) => item.id === routine.id)!.on).toBe(false);
    const thread = await client.request('venture.agents.thread.list', { agent: 'editor' });
    expect(thread.retired?.line).toBe('Retired. This chat is read only. Bring back makes it work again.');
    await expect(client.request('venture.agents.thread.send', { agent: 'editor', text: 'Hello there' })).rejects.toMatchObject({ code: 'AGENT_RETIRED' });
    await expect(client.request('venture.agents.notes.edit', { agent: 'editor', text: 'Meera wants files by the 5th.' })).rejects.toMatchObject({ code: 'AGENT_RETIRED' });
    await expect(client.request('venture.routines.set', { routine: { name: 'New', agent: 'editor', prompt: PROMPT, schedule: HOURLY, on: false } })).rejects.toMatchObject({ code: 'AGENT_RETIRED' });
    expect((await client.request('venture.agents.notes.list', { agent: 'editor' })).notes).toHaveLength(1);
  });

  it('Bring back restores it as it was, routines included; the last agent cannot retire', async () => {
    const client = fake();
    const routine = (await client.request('venture.routines.set', { routine: { name: 'Check in', agent: 'editor', prompt: PROMPT, schedule: HOURLY, on: true } })).routine;
    const shape = async () => (await client.request('venture.team.list', {})).agents.map((agent) => [agent.id, agent.steps.map((step) => step.id)]);
    const before = await shape();
    const seen = await client.request('venture.agents.retire.check', { agent: 'editor' });
    await client.request('venture.agents.retire', { agent: 'editor', to: 'owner', digest: seen.digest });
    expect((await client.request('venture.team.list', {})).retired?.[0]?.to).toBeNull();
    await expect(client.request('venture.agents.restore', { agent: 'producer' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'That agent is not retired.' });
    const back = await client.request('venture.agents.restore', { agent: 'editor' });
    expect(back).toMatchObject({ routines: 1, line: 'Editor is back, as it was. 1 routine is on again.' });
    expect(back.agent.id).toBe('editor');
    expect(await shape()).toEqual(before);
    expect((await client.request('venture.team.list', {})).retired).toBeUndefined();
    expect((await client.request('venture.routines.list', {})).routines.find((item) => item.id === routine.id)!.on).toBe(true);
  });

  it('a Today card naming a retired agent says (retired); the card stays decidable', async () => {
    const client = fake();
    const rows = (await client.request('venture.queue.list', { scope: 'current' })).rows;
    const named = rows.find((row) => row.agent && ['Editor', 'Researcher', 'Producer', 'Publisher'].includes(row.agent));
    if (!named) return;
    const id = (await client.request('venture.team.list', {})).agents.find((agent) => agent.name === named.agent)!.id;
    const others = (await client.request('venture.agents.retire.check', { agent: id }));
    await client.request('venture.agents.retire', { agent: id, to: 'owner', digest: others.digest });
    const after = (await client.request('venture.queue.list', { scope: 'current' })).rows.find((row) => row.id === named.id)!;
    expect(after.agent).toBe(`${named.agent} (retired)`);
    expect(after.digest).toBe(named.digest);
  });

  it('retire and Bring back are app only', async () => {
    const client = createFakeClient(new FakeEngine({ now: () => '2026-10-23T10:00:00.000Z', hosted: true }));
    await expect(client.request('venture.agents.retire', { agent: 'editor', to: 'owner', digest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'APP_APPROVAL_REQUIRED' });
    await expect(client.request('venture.agents.restore', { agent: 'editor' })).rejects.toMatchObject({ code: 'APP_APPROVAL_REQUIRED' });
  });
});
