// The capability page (Ink v2 wave 4, package 4J18, catalogue A16): what one agent can see, what it can do and what
// is off, worked out by code from what a run really obeys. A run has one act loop whose grant is the union of its act
// steps' tools (playbookGrant, then the host and the owner's CLI), so every AI role that owns an act step shows that one
// team list, and the page says so. What every turn carries (the client's request, file names, the dictionary, answers,
// notes and sources) is on "can see"; each turn going to the owner's own AI provider is on "can do". Steps say what they
// really do: the fixed hands-on work step is the owner's work (planned for an agent outside bookkeeping), a step whose
// floor spends on something not built is planned, a check step says when an AI judge reads the draft. An empty list
// never means everything. Read only; no model is asked.
import test from 'node:test';
import assert from 'node:assert/strict';
import { STEP_PLAN, TOOL_NAMES, type CapabilityPageView, type PlaybookStep } from '../runtime/venture/contracts.ts';
import { EFFECT_KINDS } from '../runtime/venture/policy/effects.ts';
import { hostRefusal } from '../runtime/venture/delivery/harness/tools.ts';
import { playbookGrant } from '../runtime/venture/delivery/harness/loop.ts';
import { playbookSteps } from '../runtime/venture/delivery/playbook.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { listRecords, ventureAction } from '../runtime/venture/records.ts';
import {
  capabilityPage, capabilityTeam, EFFECT_OFF_WORDS, INPUT_WORDS, NO_CLI, NO_TOOLS_LINE, TEAM_LINE, TOOL_WORDS, type CapabilityTeam,
} from '../runtime/venture/agents/capabilities.ts';
import { business, code, owner, phone, PLAIN_IDEA } from './venture-judge-helpers.ts';
import { agentBusiness } from './venture-agent-helpers.ts';
import { handlers as agentHandlers } from '../runtime/venture/agents/index.ts';

const APPROVAL = 'Anything that sends, spends, posts or changes a price still waits for your approval.';
const page = (env: { deps: any }, agent: string, ctx = owner): Promise<CapabilityPageView> =>
  (agentHandlers as Record<string, (deps: unknown, ctx: unknown, payload: unknown) => Promise<any>>)['venture.agents.capabilities'](env.deps, ctx, { agent });
const keys = (view: CapabilityPageView, list: 'see' | 'do' | 'off') => view.items.filter(item => item.list === list).map(item => item.key);
const item = (view: CapabilityPageView, key: string) => view.items.find(entry => entry.key === key)!;
/** The tool names the page names anywhere: on its lists, or off with the host's or the CLI's reason. */
const toolsOn = (view: CapabilityPageView) => [...new Set(view.items.flatMap(entry => {
  if (entry.key.startsWith('outbox:')) return ['outbox.propose'];
  const match = /^(?:tool|host|cli):(.+)$/.exec(entry.key);
  return match ? [match[1]] : [];
}))].sort();
const step = (patch: Partial<PlaybookStep>): PlaybookStep => ({
  id: 'one', kind: 'gather', title: 'Read the order', tier: 'actor', model: 'fast', doneBy: 'agent', requiredSections: [], checks: [], tools: [], guidance: [], ...patch,
});
const teamOf = (steps: PlaybookStep[], patch: Partial<CapabilityTeam> = {}): CapabilityTeam => ({ steps, floor: {}, spends: new Set(), serviceType: null, flagship: true, ...patch });
const desktop = { host: 'desktop' as const, delegate: true, judge: true };
const ACT = new Set(['gather', 'question', 'work']);

test('every tool, every input a turn carries and every effect kind have owner words: the page cannot drift', () => {
  assert.deepEqual(Object.keys(TOOL_WORDS).sort(), [...TOOL_NAMES].sort());
  assert.deepEqual(Object.keys(EFFECT_OFF_WORDS).sort(), [...EFFECT_KINDS].sort());
  assert.deepEqual(Object.keys(INPUT_WORDS).sort(), ['answers', 'compute', 'dictionary', 'files', 'knowledge', 'notes', 'proven', 'request', 'verify']);
  for (const words of [...Object.values(TOOL_WORDS), ...Object.values(EFFECT_OFF_WORDS), ...Object.values(INPUT_WORDS)]) {
    assert.ok(words.length > 10 && !words.includes(String.fromCharCode(0x2014)), words);
  }
});

test('the AI team shares one tool list: every role that owns an act step shows the run\'s real grant, for each shipped playbook', () => {
  for (const id of ['youtube', 'ca-firm', 'social-agency']) {
    const delivery = flagshipDelivery(id)!;
    const grant = [...playbookGrant({ steps: [...delivery.steps] })].sort();
    const team = teamOf([...delivery.steps], { floor: delivery.floor });
    for (const role of delivery.roles) {
      const own = delivery.steps.filter(entry => delivery.roleOf[entry.id] === role.id);
      const view = capabilityPage({ id: role.id, name: role.name, kind: role.kind, steps: own }, team, desktop);
      if (own.some(entry => ACT.has(entry.kind))) {
        assert.deepEqual(toolsOn(view), grant, `${id} ${role.id}`);
        assert.equal(view.line, TEAM_LINE);
      } else {
        assert.deepEqual(toolsOn(view), [], `${id} ${role.id} holds no tools`);
      }
    }
  }
});

test('the fixed steps: the delivery agent shows the run\'s grant; the hands-on work step is yours, planned for an agent outside bookkeeping', async () => {
  const env = await business(PLAIN_IDEA);
  const view = await page(env, 'delivery');
  const plan = listRecords(env.store.read(), 'venture-blueprint').find(entry => entry.status === 'accepted')!;
  const steps = playbookSteps(plan, null);
  assert.deepEqual(toolsOn(view), [...playbookGrant({ steps })].sort());
  const work = item(view, 'step:work');
  assert.equal(work.state, 'planned', 'the owner\'s own hands-on work never shows as working');
  assert.equal(work.line, `${steps.find(entry => entry.id === 'work')!.title}. ${STEP_PLAN[1].note}`);
  const books = capabilityPage({ id: 'delivery', name: 'Bookkeeper', kind: 'agent', steps }, teamOf(steps, { serviceType: 'bookkeeping', flagship: false }), desktop);
  assert.equal(item(books, 'step:work').state, 'works', 'bookkeeping\'s reconciling is the agent\'s real work');
});

test('the Story editor: the team\'s tools, everything a turn carries, its step, its questions and the owner\'s own AI', async () => {
  const env = await agentBusiness();
  const view = await page(env, 'story-editor');
  assert.equal(view.agent, 'story-editor');
  assert.deepEqual(keys(view, 'see'), [
    'tool:files.list', 'tool:files.read', 'tool:youtube.hooks', 'tool:youtube.editList', 'tool:youtube.chapters', 'tool:youtube.retention',
    'input:request', 'input:files', 'input:dictionary', 'input:answers', 'input:notes', 'input:knowledge',
  ]);
  assert.ok(view.items.filter(entry => entry.list === 'see').every(entry => entry.state === 'reads'));
  assert.match(INPUT_WORDS.knowledge, /other clients/);
  assert.deepEqual(keys(view, 'do'), ['step:find', 'tool:handoff.client', 'tool:handoff.owner', 'tool:evidence.record', 'model:provider']);
  assert.equal(item(view, 'tool:handoff.client').state, 'hands-off');
  assert.equal(item(view, 'model:provider').line, 'Send each step, with what it reads, to your own AI provider: your key or the CLI you set up.');
  assert.deepEqual(keys(view, 'off'), ['effect:send', 'effect:money'], 'it reads beyond the order (sources), notes evidence and sends to your AI, so only send and money are off');
  assert.ok(!view.off.some(line => /beyond this order|off this computer/.test(line)));
  assert.equal(view.line, TEAM_LINE);
  assert.deepEqual(view.canSee, view.items.filter(entry => entry.list === 'see').map(entry => entry.line));
});

test('the Packager writes with no tools: it sees what the team found and the sources, and cannot open the files', async () => {
  const env = await agentBusiness();
  const view = await page(env, 'packager');
  assert.deepEqual(keys(view, 'see'), ['input:request', 'input:proven', 'input:answers', 'input:knowledge']);
  assert.deepEqual(view.canDo, ['Draft the title, thumbnail text, description, chapters and pinned comment. You check the draft before anything leaves Chausar.', item(view, 'model:provider').line]);
  assert.deepEqual(keys(view, 'off'), ['effect:read', 'effect:write', 'effect:send', 'effect:money']);
  assert.equal(view.line, NO_TOOLS_LINE);
});

test('a code role reads the files by code (never "can\'t open" them); a floor that spends on something not built is planned, and money is not off', async () => {
  const env = await agentBusiness();
  const view = await page(env, 'chausar');
  assert.deepEqual(keys(view, 'see'), ['input:compute', 'input:verify']);
  assert.ok(!keys(view, 'off').includes('effect:read'));
  assert.equal(item(view, 'step:score').line, 'Score the hooks and keep the best two. Code does this, with no AI.');
  const assemble = item(view, 'step:assemble');
  assert.equal(assemble.state, 'planned');
  assert.equal(assemble.line, "Build the edit list from the chosen segments, with any paid voice quoted first. Code does this, with no AI. Paid generation spends money, so it asks you first at every posture. Paying for it is planned: Chausar can't buy it yet, so nothing is spent.");
  assert.ok(!keys(view, 'off').includes('effect:money'), 'a step that spends counts money as reached');
  assert.equal(item(view, 'step:verify').line, 'Check the package and the finished cut. Code runs the checks, then an AI judge reads the draft on your own AI.');
  assert.equal(view.line, `Chausar is code, not AI: it does the same steps the same way every time. ${APPROVAL}`);
});

test('the social checker: code checks, then the AI judge, or only code when the judge is off; creative briefs are planned spend', () => {
  const delivery = flagshipDelivery('social-agency')!;
  const own = (role: string) => delivery.steps.filter(entry => delivery.roleOf[entry.id] === role);
  const team = teamOf([...delivery.steps], { floor: delivery.floor, spends: new Set(['creative-briefs']) });
  const on = capabilityPage({ id: 'checker', name: 'Checker', kind: 'agent', steps: own('checker') }, team, desktop);
  assert.equal(item(on, 'step:check').line, 'Run the code checks, then the yes or no judge. Code runs the checks, then an AI judge reads the draft on your own AI.');
  const off = capabilityPage({ id: 'checker', name: 'Checker', kind: 'agent', steps: own('checker') }, team, { ...desktop, judge: false });
  assert.equal(item(off, 'step:check').line, 'Run the code checks, then the yes or no judge. Code runs the checks. The AI judge is off for this business.');
  assert.ok(!on.items.some(entry => /with no AI/.test(entry.line)));
  const creative = capabilityPage({ id: 'creative', name: 'Creative', kind: 'agent', steps: own('creative') }, team, desktop);
  assert.equal(item(creative, 'step:creative-briefs').state, 'planned');
  assert.ok(!keys(creative, 'off').includes('effect:money'));
});

test('the business\'s own team says which steps spend, from the playbook\'s own data', async () => {
  const env = await agentBusiness();
  const state = env.store.read();
  const team = capabilityTeam(state, listRecords(state, 'venture-record')[0])!;
  assert.deepEqual([...team.spends], ['assemble']);
});

test('Keeper has no page of tools, an unknown agent is refused, and the page reads on the phone too (read only)', async () => {
  const env = await agentBusiness();
  await assert.rejects(page(env, 'keeper'), code('AGENT_IS_CODE'));
  await assert.rejects(page(env, 'nobody'), code('AGENT_NOT_FOUND'));
  await assert.rejects(page(env, '../x'), code('INVALID_VENTURE_REQUEST'));
  assert.equal((await page(env, 'story-editor', phone)).agent, 'story-editor');
});

test('an empty list never means everything: a role with no steps, and an absent grant (older records), say "Nothing" or hold no tool', () => {
  const none = capabilityPage({ id: 'x', name: 'Helper', kind: 'agent', steps: [] }, teamOf([]), desktop);
  assert.deepEqual(none.canSee, ['Nothing: none of its steps gives it anything to read.']);
  assert.deepEqual(none.canDo, ['Nothing: none of its steps lets it work, ask or propose anything.']);
  assert.equal(none.items.find(entry => entry.list === 'see')!.state, 'off');
  const absent = step({ tools: undefined });
  const older = capabilityPage({ id: 'x', name: 'Helper', kind: 'agent', steps: [absent] }, teamOf([absent]), desktop);
  assert.deepEqual(toolsOn(older), [], 'a step with no grant gets no tools');
});

test('outside actions it may propose are only recorded: the mail app records the proposal, a payment link is planned', () => {
  const outbox = step({ kind: 'work', tools: ['outbox.propose'] });
  const view = capabilityPage({ id: 'x', name: 'Helper', kind: 'agent', steps: [outbox] }, teamOf([outbox]), desktop);
  assert.equal(item(view, 'outbox:mail-app').state, 'records');
  assert.equal(item(view, 'outbox:mail-app').line, 'Propose an email for your approval. Nothing is sent: Chausar records it, and you send it yourself from your own mail app.');
  assert.equal(item(view, 'outbox:payment-link').state, 'planned');
  assert.equal(item(view, 'outbox:payment-link').line, 'Propose a payment link for your approval. Planned: no payment link connector is built, so the proposal is only recorded.');
});

test('a step that needs a connector mode that is only planned is planned too, never shown as working', () => {
  // 4J7: Zoho Mail's inbox is read now (4E3's IMAP), so a still-planned mode stands in: reading Zoho Books.
  const inbox = step({ kind: 'work', title: 'Read the books', needs: [{ connector: 'zoho-books', mode: 'read' }] });
  const view = capabilityPage({ id: 'x', name: 'Helper', kind: 'agent', steps: [inbox] }, teamOf([inbox]), desktop);
  assert.equal(item(view, 'step:one').state, 'planned');
  assert.equal(item(view, 'step:one').line, 'Read the books. Planned: it needs Zoho Books to read, which this build does not do yet.');
});

test('Claude Code or Codex: works only when one is set up here; on the hosted app the server\'s own reason', async () => {
  const env = await business(PLAIN_IDEA);
  const local = await page(env, 'delivery');
  assert.equal(item(local, 'cli:agent.delegate').state, 'off', 'no CLI is set up in tests');
  assert.equal(item(local, 'cli:agent.delegate').line, `${TOOL_WORDS['agent.delegate']} Off here: ${NO_CLI}`);
  const work = step({ kind: 'work', tools: ['agent.delegate'] });
  assert.equal(item(capabilityPage({ id: 'x', name: 'Helper', kind: 'agent', steps: [work] }, teamOf([work]), desktop), 'tool:agent.delegate').state, 'works');
  env.deps.host = 'hosted-web';
  const hosted = await page(env, 'delivery');
  assert.equal(item(hosted, 'host:agent.delegate').line, `${TOOL_WORDS['agent.delegate']} Off here: ${hostRefusal('hosted-web', 'agent.delegate')}`);
  assert.ok(hosted.items.some(entry => entry.key === 'host:sandbox.python'));
  assert.ok(!keys(hosted, 'see').includes('tool:sandbox.python'));
});

test('the judge setting of the business is read: turned off, the check step says only code checks', async () => {
  const env = await agentBusiness();
  await ventureAction(env.deps, owner, 'admin', 'seed.judge', tx => tx.put({ ...tx.base('venture-judge-setting'), auto: false, consent: null } as any));
  const view = await page(env, 'chausar');
  assert.equal(item(view, 'step:verify').line, 'Check the package and the finished cut. Code runs the checks. The AI judge is off for this business.');
});

test('the CA firm\'s check step never says the AI judge reads its papers: only a draft for a client goes to the judge', () => {
  const delivery = flagshipDelivery('ca-firm')!;
  const own = delivery.steps.filter(entry => delivery.roleOf[entry.id] === 'checker');
  const view = capabilityPage({ id: 'checker', name: 'Checks', kind: 'code', steps: own }, teamOf([...delivery.steps], { floor: delivery.floor, flagshipId: 'ca-firm' }), desktop);
  assert.equal(item(view, 'step:verify').line, 'Check the papers against the receipts and the rules. Code runs the checks. Papers for your CA of record never go to the AI judge; only a draft that goes to a client does, on your own AI.');
});
