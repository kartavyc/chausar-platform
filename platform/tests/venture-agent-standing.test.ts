// "From now on" in an agent's thread (Ink v2 wave 4, package 4B1, catalogue A3, spec 5.2): code, not a model, spots a
// standing request in English or Hindi; the agent then drafts a typed playbook patch on a step its role owns, and code
// checks it under the owner rules of applyPatch before it is stored as a proposal the owner accepts or rejects. Only
// guidance changes from chat (PATCH_OWNER_OP), only on the agent's own steps (PATCH_NOT_YOUR_STEP), and numbers only
// when the owner said them. With templates only, the owner's own sentence, tidied, is the change.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { PlaybookPatch, PlaybookStep } from '../runtime/venture/contracts.ts';
import { listRecords } from '../runtime/venture/records.ts';
import { applyPatch, ownerControlReason, type PlaybookBody } from '../runtime/venture/delivery/harness/patches.ts';
import { DEFAULT_LIMITS } from '../runtime/venture/delivery/harness/loop.ts';
import { flagshipDelivery } from '../runtime/venture/playbooks/steps.ts';
import { detectStanding, standingValue } from '../runtime/venture/agents/standing.ts';
import { code } from './venture-judge-helpers.ts';
import { agentBusiness, agentEvents, consent, playbookIdOf, scriptChat } from './venture-agent-helpers.ts';

// ---------------------------------------------------------------------------
// The detector: a fixed list of patterns, each Hindi one with its English twin
// ---------------------------------------------------------------------------

test('detector: standing requests, notes and neither, in English and Hindi, by code', () => {
  const table: [string, 'standing' | 'note' | null][] = [
    ['From now on, always add burned-in captions to shorts.', 'standing'],
    ['Never put music under the intro', 'standing'],
    ['I prefer square thumbnails', 'standing'],
    ['Going forward, keep the intro short.', 'standing'],
    ['Always add a chapter for the sponsor read.', 'standing'],
    ['अब से हर शॉर्ट में कैप्शन जोड़ना', 'standing'], // from now on, add captions to every short
    ['आगे से इंट्रो छोटा रखना', 'standing'], // going forward, keep the intro short
    ['थंबनेल में हमेशा चेहरा दिखाना', 'standing'], // always show a face in the thumbnail
    ['इंट्रो में संगीत कभी नहीं डालना', 'standing'], // never put music in the intro
    ['Remember that Meera wants files by the 5th', 'note'],
    ['Keep in mind that Asha edits on weekends.', 'note'],
    ['My GST number has changed.', 'note'],
    ['मेरा GST नंबर बदल गया है', 'note'], // my GST number has changed
    ['मीरा को फ़ाइलें पाँच तारीख तक चाहिए, याद रखना', 'note'], // Meera wants the files by the fifth, remember
    ['Why did the thumbnail render stop?', null],
    ['Why do you always cut the intro?', null],
    ['Cut a trailer from episode 14.', null],
    ['क्या थंबनेल बन गया?', null], // is the thumbnail made?
  ];
  for (const [sentence, expected] of table) assert.equal(detectStanding(sentence), expected, sentence);
});

test('detector: the owner sentence, tidied, is a standing order of its own words', () => {
  assert.equal(standingValue('From now on, always add burned-in captions to shorts.'), 'Always add burned-in captions to shorts.');
  assert.equal(standingValue('  never   put music under the intro'), 'Never put music under the intro.');
  assert.equal(standingValue('Going forward, keep shorts under 60 seconds'), 'Keep shorts under 60 seconds.');
  assert.equal(standingValue('अब से हर शॉर्ट में कैप्शन जोड़ना'), 'हर शॉर्ट में कैप्शन जोड़ना');
});

// ---------------------------------------------------------------------------
// The owner rules in applyPatch
// ---------------------------------------------------------------------------

function youtubeBody(): PlaybookBody {
  return { steps: structuredClone([...flagshipDelivery('youtube')!.steps]) as PlaybookStep[], limits: { ...DEFAULT_LIMITS }, aliases: {} };
}
const ownerPatch = (op: PlaybookPatch['op'], stepId: string, value: string, quote: string): PlaybookPatch => ({
  id: 'patch_owner', level: 'harness', op, stepId, value, proposedBy: 'owner', parentHash: 'x'.repeat(64),
  note: { hypothesis: 'You asked for this in chat.', expectedFixes: [], likelyRegressions: [] }, source: { messageId: 'agentmsg_1', quote },
});
const context = { serviceType: 'content' as const, entryIds: [], flagship: 'youtube', owner: { steps: ['find'], added: [] as string[] } };
const refused = (expected: string, pattern?: RegExp) => (error: any) => {
  assert.equal(error?.code, expected, error?.message);
  if (pattern) assert.match(error.message, pattern);
  return true;
};

test('owner rules: chat changes guidance only, on the agent\'s own steps', () => {
  const body = youtubeBody();
  const added = applyPatch(body, ownerPatch('guidance.add', 'find', 'Always add burned-in captions to shorts.', 'From now on, always add burned-in captions to shorts.'), context);
  assert.deepEqual(added.steps.find(step => step.id === 'find')!.guidance, ['Always add burned-in captions to shorts.']);
  for (const [op, stepId, value] of [['tools.grant', 'find', 'files.list'], ['tools.revoke', 'find', 'files.read'], ['checks.add', 'package', 'house-style'], ['limits.turns', 'find', '3'], ['alias.add', 'find', 'concept.x=word']] as const) {
    assert.throws(() => applyPatch(body, ownerPatch(op, stepId, value, 'From now on do this'), context), refused('PATCH_OWNER_OP', /Tools, checks and limits are not changed from chat/), op);
  }
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'package', 'Always add a pinned comment.', 'Always add a pinned comment.'), context), refused('PATCH_NOT_YOUR_STEP'));
  // A line built into the playbook is not the owner's to remove from chat; a line the owner added is.
  const builtIn = body.steps.find(step => step.id === 'package')!.guidance![0];
  assert.throws(() => applyPatch(body, ownerPatch('guidance.remove', 'package', builtIn, 'Stop doing that'), { ...context, owner: { steps: ['package'], added: [] } }), refused('PATCH_OWNER_OP'));
  const removed = applyPatch(added, ownerPatch('guidance.remove', 'find', 'Always add burned-in captions to shorts.', 'Stop adding captions'), { ...context, owner: { steps: ['find'], added: ['Always add burned-in captions to shorts.'] } });
  assert.deepEqual(removed.steps.find(step => step.id === 'find')!.guidance, []);
  // An owner patch keeps the words it came from.
  const { source: _source, ...unsourced } = ownerPatch('guidance.add', 'find', 'Always add captions.', 'Always add captions.');
  assert.throws(() => applyPatch(body, unsourced as PlaybookPatch, context), refused('INVALID_VENTURE_REQUEST'));
});

test('owner rules: numbers only when the owner said them; no sums, no money, house style', () => {
  const body = youtubeBody();
  const quote = 'From now on, keep shorts under 60 seconds.';
  const kept = applyPatch(body, ownerPatch('guidance.add', 'find', 'Keep shorts under 60 seconds.', quote), context);
  assert.deepEqual(kept.steps.find(step => step.id === 'find')!.guidance, ['Keep shorts under 60 seconds.']);
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', 'Keep shorts under 45 seconds.', quote), context), refused('INVALID_VENTURE_REQUEST', /number you did not say/));
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', 'Keep shorts under forty five seconds.', quote), context), refused('INVALID_VENTURE_REQUEST', /number you did not say/));
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', 'Always total the views of each short.', 'Always total the views of each short.'), context), refused('INVALID_VENTURE_REQUEST', /sums/));
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', 'Always mention ₹500 for a short.', 'Always mention ₹500 for a short.'), context), refused('INVALID_VENTURE_REQUEST', /money/));
  // Charging is a price: refused before the words are read (B2), whatever amount the owner said.
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', 'Always charge ₹500 for a short.', 'Always charge ₹500 for a short.'), context), refused('PATCH_OWNER_OP', /Spend, prices/));
  assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', 'Always leverage the strongest hook.', 'Always leverage the strongest hook.'), context), refused('INVALID_VENTURE_REQUEST', /house style/));
  // The improvement loop's patches keep today's rules: a number is refused whatever anyone said.
  const model: PlaybookPatch = { ...ownerPatch('guidance.add', 'find', 'Keep shorts under 60 seconds.', quote), proposedBy: 'model' };
  delete model.source;
  assert.throws(() => applyPatch(body, model, { serviceType: 'content', entryIds: [], flagship: 'youtube' }), /contained a number/);
  assert.deepEqual(applyPatch(body, { ...model, op: 'tools.revoke', value: 'youtube.hooks' }, { serviceType: 'content', entryIds: [], flagship: 'youtube' }).steps.find(step => step.id === 'find')!.tools!.includes('youtube.hooks'), false);
});

// ---------------------------------------------------------------------------
// A standing request in the thread
// ---------------------------------------------------------------------------

const CAPTIONS = 'From now on, always add burned-in captions to shorts.';

test('standing request: the agent drafts a typed patch on its own step, code checks it, and it waits for the owner', async () => {
  const env = await agentBusiness();
  await consent(env);
  const playbook = await env.call('venture.delivery.playbook');
  scriptChat(env, { patch: () => ({ stepId: 'find', op: 'guidance.add', value: 'Always add burned-in captions to shorts.' }) });
  const sent = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: CAPTIONS });

  const task = env.models.previewed.filter(item => item.purpose === 'agent-chat').at(-1)!;
  assert.equal(task.schemaName, 'venture-agent-patch');
  assert.equal(task.containsClientData, true);
  assert.deepEqual((task.schema as any).properties.op.enum, ['guidance.add', 'guidance.remove']);
  assert.deepEqual((task.schema as any).properties.stepId.enum, ['find'], 'only the steps the story editor owns');
  assert.equal(env.models.generated.filter(item => item.purpose === 'agent-chat').length, 0, 'a chat call never goes on standing consent');

  const proposals = listRecords(env.store.read(), 'venture-agent-proposal');
  assert.equal(proposals.length, 1);
  const stored = proposals[0];
  assert.equal(stored.proposalKind, 'instruction');
  assert.equal(stored.agent, 'story-editor');
  assert.equal(stored.quote, CAPTIONS);
  assert.equal(stored.status, 'drafted');
  assert.equal(stored.patch!.proposedBy, 'owner');
  assert.equal(stored.patch!.op, 'guidance.add');
  assert.equal(stored.patch!.stepId, 'find');
  assert.equal(stored.patch!.value, 'Always add burned-in captions to shorts.');
  assert.deepEqual(stored.patch!.source, { messageId: stored.messageId, quote: CAPTIONS });
  assert.equal(stored.patch!.parentHash, playbook.hash);
  assert.equal(stored.parentHash, playbook.hash);
  assert.equal(stored.fromVersion, playbook.version);
  assert.equal(stored.toVersion, playbook.version + 1);
  assert.deepEqual(stored.diff, [{ op: 'add', text: 'Always add burned-in captions to shorts.' }]);
  assert.match(stored.appliesTo!, /Write the hooks, or pick the moments by transcript segment/);
  assert.equal(stored.label, null);
  assert.match(stored.digest, /^[a-f0-9]{64}$/);

  assert.deepEqual(sent.added.map((item: any) => item.type), ['message', 'proposal', 'message']);
  assert.equal(sent.added[0].message.from, 'owner');
  assert.equal(sent.added[1].proposal.id, stored.id);
  assert.equal(sent.added[1].proposal.status, 'drafted');
  assert.equal(sent.added[1].proposal.title, "Proposed change to Story editor's instructions");
  assert.deepEqual(sent.added[2].message.parts, [{ kind: 'text', text: "You said 'from now on', so here is the change to my instructions." }]);
  assert.equal(sent.added[2].message.from, 'agent');
  assert.equal(playbookIdOf(env), playbook.id, 'nothing changes until the owner accepts');
  assert.equal(agentEvents(env).length, 2, 'one agent.message per stored message');
  for (const event of agentEvents(env)) assert.deepEqual(Object.keys(event.data as object).sort(), ['agent', 'messageId']);
});

test('standing request: a number the model added is refused, and the owner\'s own words are drafted instead', async () => {
  const env = await agentBusiness();
  await consent(env);
  scriptChat(env, { patch: () => ({ stepId: 'find', op: 'guidance.add', value: 'Keep shorts under 45 seconds.' }) });
  await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'From now on, keep shorts under 60 seconds.' });
  const stored = listRecords(env.store.read(), 'venture-agent-proposal')[0];
  assert.equal(stored.patch!.value, 'Keep shorts under 60 seconds.');
  assert.equal(stored.label, 'Drafted by Chausar from your words');
});

test('standing request: a change the owner rules refuse makes no proposal, and the agent says why', async () => {
  const env = await agentBusiness();
  await consent(env);
  scriptChat(env, { patch: () => ({ stepId: 'find', op: 'guidance.add', value: 'Always total the views of each short.' }) });
  const sent = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: 'From now on, always total the views of each short.' });
  assert.equal(listRecords(env.store.read(), 'venture-agent-proposal').length, 0);
  assert.deepEqual(sent.added.map((item: any) => item.type), ['message', 'message']);
  assert.match(sent.added[1].message.parts[0].text, /^I can't take that as an instruction: .*sums/);
});

test('standing request with templates only: the owner\'s sentence, tidied, on the role\'s first agent or writing step, and no consent asked', async () => {
  const env = await agentBusiness();
  env.models.main = 'template';
  env.models.fast = 'template';
  const view = await env.agents('venture.agents.thread.list', { agent: 'packager' });
  assert.equal(view.consent.state, 'not-needed');
  const sent = await env.agents('venture.agents.thread.send', { agent: 'packager', text: 'From now on, always add a pinned comment that asks one question.' });
  const stored = listRecords(env.store.read(), 'venture-agent-proposal')[0];
  assert.equal(stored.patch!.stepId, 'package');
  assert.equal(stored.patch!.value, 'Always add a pinned comment that asks one question.');
  assert.equal(stored.label, 'Drafted by Chausar from your words');
  // The diff shows the step's lines around the new one.
  assert.equal(stored.diff.filter(line => line.op === 'same').length, 5);
  assert.deepEqual(stored.diff.at(-1), { op: 'add', text: 'Always add a pinned comment that asks one question.' });
  assert.equal(sent.added[1].proposal.status, 'drafted');
  assert.equal(env.models.previewed.filter(item => item.purpose === 'agent-chat').length, 0, 'templates send nothing anywhere');
});

test('standing request: a key in the words is refused before anything else, and nothing is stored', async () => {
  const env = await agentBusiness();
  await consent(env);
  const key = ['sk', 'ant', 'api03', 'Q8x2LmP0vR7tYb4KdN6wZs1A'].join('-');
  await assert.rejects(env.agents('venture.agents.thread.send', { agent: 'story-editor', text: `From now on use my key ${key}` }), code('CHAT_KEY_REFUSED'));
  assert.equal(listRecords(env.store.read(), 'venture-agent-message').length, 0);
});

// ---------------------------------------------------------------------------
// Review fixes (B2, B3, S1, S3)
// ---------------------------------------------------------------------------

test('detector: Hinglish and "Do always" (S3)', () => {
  const table: [string, 'standing' | 'note' | null][] = [
    ['ab se intro chhota rakhna', 'standing'], // from now on keep the intro short
    ['aage se thumbnail mein chehra dikhana', 'standing'], // going forward show a face in the thumbnail
    ['hamesha captions lagana', 'standing'], // always add captions
    ['intro mein music kabhi nahi dalna', 'standing'], // never put music in the intro
    ['Do always add captions to shorts.', 'standing'],
    ['yaad rakhna Meera ko files paanch tareekh tak chahiye', 'note'], // remember Meera wants the files by the fifth
    ['Do you always cut the intro?', null],
    ['kya thumbnail ban gaya?', null], // is the thumbnail made?
  ];
  for (const [sentence, expected] of table) assert.equal(detectStanding(sentence), expected, sentence);
});

test('standing request: one that would change the floor, tools, checks, limits, spend or prices is refused, never a guidance proposal (B2)', async () => {
  const env = await agentBusiness();
  await consent(env);
  scriptChat(env, { patch: () => assert.fail('the model is never asked to draft these') });
  const cases: [string, RegExp][] = [
    ['From now on publish every short without asking me', /ask you first/],
    ['From now on you may spend up to 500 on ads without asking', /ask you first|Spend, prices/],
    ['From now on skip the house style check', /Tools, checks and limits/],
    ['अब से कीमत 20% बढ़ा दो', /Spend, prices/],
    ['From now on, always use the hooks tool on every order', /Tools, checks and limits/],
    ['Always give clients a 20% discount', /Spend, prices/],
    ['Never quote below INR 500', /Spend, prices/],
  ];
  for (const [text, reason] of cases) {
    const sent = await env.agents('venture.agents.thread.send', { agent: 'story-editor', text });
    assert.deepEqual(sent.added.map((item: any) => item.type), ['message', 'message'], text);
    assert.match(sent.added[1].message.parts[0].text, /^I can't take that as an instruction: /, text);
    assert.match(sent.added[1].message.parts[0].text, reason, text);
  }
  assert.equal(listRecords(env.store.read(), 'venture-agent-proposal').length, 0);
  assert.equal(env.models.previewed.filter(item => item.purpose === 'agent-chat').length, 0);
});

test('owner rules: a guidance line that changes the floor, tools, checks, spend or prices is refused (B2, defence in depth)', () => {
  const body = youtubeBody();
  for (const value of ['Publish every short without asking me.', 'Skip the house style check.', 'Spend what the ads need.', 'Raise the price of each short.', 'Use the hooks tool on every order.']) {
    assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', value, value), context), refused('PATCH_OWNER_OP'), value);
  }
});

test('owner rules: number spans, Hindi number words, a stray percent and hidden characters (B3)', () => {
  const body = youtubeBody();
  const pairs: [string, string][] = [
    ['अब से शॉर्ट साठ सेकंड से छोटे रखना', 'शॉर्ट पैंतालीस सेकंड से छोटे रखना'],
    ['From now on, keep the views note under 1,000,000 words.', 'Keep the views note under 1,000 words.'],
    ['From now on, cap each script at 1,000 words.', 'Cap each script at 1,00,000 words.'],
    ['From now on, cap each script at 1,000 words.', 'Cap each script at 1,000,000 words.'],
    ['From now on, keep the intro at 20 seconds.', 'Keep the intro at 20% of the video.'],
    ['From now on, keep the intro short.', 'Keep the intro under दस seconds.'],
    ['From now on, keep the intro short.', 'Keep the intro half as long.'],
  ];
  for (const [quote, value] of pairs) {
    assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', value, quote), context), refused('INVALID_VENTURE_REQUEST', /number you did not say/), value);
  }
  assert.deepEqual(applyPatch(body, ownerPatch('guidance.add', 'find', 'शॉर्ट साठ सेकंड से छोटे रखना', 'अब से शॉर्ट साठ सेकंड से छोटे रखना'), context).steps.find(step => step.id === 'find')!.guidance, ['शॉर्ट साठ सेकंड से छोटे रखना']);
  assert.deepEqual(applyPatch(body, ownerPatch('guidance.add', 'find', 'Cap each script at 1,000 words.', 'From now on, cap each script at 1,000 words.'), context).steps.find(step => step.id === 'find')!.guidance, ['Cap each script at 1,000 words.']);
  for (const hidden of ['Always add\u200B captions.', `Always add captions.${String.fromCodePoint(0xE0041)}`, 'Always add\u202E captions.']) {
    assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', hidden, 'From now on, always add captions.'), context), refused('INVALID_VENTURE_REQUEST', /hidden characters/));
    const model: PlaybookPatch = { ...ownerPatch('guidance.add', 'find', hidden, ''), proposedBy: 'model' };
    delete model.source;
    assert.throws(() => applyPatch(body, model, { serviceType: 'content', entryIds: [], flagship: 'youtube' }), /hidden characters/);
  }
});

test('owner rules: money in an owner change is refused, codes and Hindi currency words included (S1)', () => {
  const body = youtubeBody();
  for (const value of ['Never quote below INR 500.', 'Charge 50 USD extra.', 'Always give a 20% discount.', 'हमेशा 500 रुपये लेना', 'हर शॉर्ट पर 10 रु कम लेना']) {
    assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', value, value), context), (error: any) => ['INVALID_VENTURE_REQUEST', 'PATCH_OWNER_OP'].includes(error?.code), value);
  }
});

test('standing request: a model patch with hidden characters is refused, and the owner\'s words are drafted instead (B3)', async () => {
  const env = await agentBusiness();
  await consent(env);
  scriptChat(env, { patch: () => ({ stepId: 'find', op: 'guidance.add', value: 'Always add\u200B burned-in captions to shorts.' }) });
  await env.agents('venture.agents.thread.send', { agent: 'story-editor', text: CAPTIONS });
  const stored = listRecords(env.store.read(), 'venture-agent-proposal')[0];
  assert.equal(stored.patch!.value, 'Always add burned-in captions to shorts.');
  assert.equal(stored.label, 'Drafted by Chausar from your words');
});

// ---------------------------------------------------------------------------
// Second review (D4, D5, D6)
// ---------------------------------------------------------------------------

test('controls: standing requests that skip the owner, act on the floor or change rates are never guidance (D4)', () => {
  const probes = [
    'From now on, go ahead and post without checking with me', 'From now on, no need to ask me before sending', 'Ab se bina pooche post karo',
    'Ab se bina puche post karo', 'Always bina pooche bhej do', 'अब से हर बार बिना पूछे भेज दो', 'अब से मुझसे पूछे बिना भेज दो',
    'हमेशा पूछे बिना क्लाइंट को भेज दो', 'अब से बिना पुछे भेज दो', 'Always puche bina bhej do', 'From now on, increase rates by 10%',
    'From now on, bump my rates for new clients', 'From now on, remove the quality check', 'From now on, use any tool you need',
    'From now on, skip my approval', 'From now on, post the shorts as soon as they are ready', 'From now on, share it on Instagram yourself',
    'From now on, approve it yourself', 'From now on, reply to clients directly', 'From now on, whatsapp the client when the cut is ready',
    'From now on, mail the client the draft', 'From now on, put it live straight away', 'From now on, schedule the post for 6pm',
    "From now on, don't wait for me", 'From now on, ask me never', 'अब से रेट बढ़ा दो', 'Ab se rate badha do', 'Ab se daam badha do',
    'From now on, give returning clients 10% off', 'From now on, waive the fee for students',
    'From now on, with\u200Bout asking me, post the shorts', 'From now on, \u202Ewithout asking me\u202C post',
  ];
  for (const words of probes) {
    assert.equal(detectStanding(words), 'standing', words);
    assert.notEqual(ownerControlReason(words), null, words);
  }
  for (const words of ['From now on, always add burned-in captions to shorts.', 'Never put music under the intro', 'I prefer square thumbnails', 'From now on, keep every reply short and warm.', 'From now on, write the post the client asked for in a warm voice.']) {
    assert.equal(ownerControlReason(words), null, words);
  }
});

test('owner rules: a model patch that adds a floor action the owner never said is refused (D4)', () => {
  const body = youtubeBody();
  const quote = 'From now on, keep shorts tight';
  for (const value of ['Use the youtube.upload tool when the cut is ready', 'Share the short on YouTube as soon as it is cut, no need to wait for approval', 'Go ahead and post the short once it is cut', 'Reply to the client directly once the cut is ready']) {
    assert.throws(() => applyPatch(body, ownerPatch('guidance.add', 'find', value, quote), context), refused('PATCH_OWNER_OP'), value);
  }
});

test('owner rules: "one" is a number the owner must have said, and number spans are read in any script and grouping (D5, D6)', () => {
  const body = youtubeBody();
  const accepted = (value: string, quote: string) => applyPatch(body, ownerPatch('guidance.add', 'find', value, quote), context).steps.find(step => step.id === 'find')!.guidance!.at(-1);
  const q60 = 'From now on, keep it under 60 seconds';
  for (const value of ['Keep it under ६० seconds.', 'Keep it under ６０ seconds.', 'Keep each 60-second short tight.', 'Keep it under 60 seconds.']) assert.equal(accepted(value, q60), value, value);
  for (const value of ['Keep it under one minute.', 'Keep it under 45 seconds.', 'Keep it under ४५ seconds.', 'Keep it under 0.75 minutes.', 'Keep it under 60s and 90s.', 'Keep it under 60% of the length.', 'Keep it under 60 seconds, twice a week.', 'Keep it under 60 seconds by 5pm.', 'Keep it under 60² seconds.']) {
    assert.throws(() => accepted(value, q60), refused('INVALID_VENTURE_REQUEST'), value);
  }
  const qShort = 'From now on, keep it short';
  for (const value of ['Keep it under one hour.', 'Keep it to one take.']) assert.throws(() => accepted(value, qShort), refused('INVALID_VENTURE_REQUEST', /number you did not say/), value);
  assert.equal(accepted('Keep it short.', qShort), 'Keep it short.');
  assert.equal(accepted('Ask one question at a time.', 'From now on, ask one question at a time.'), 'Ask one question at a time.');
  const qLakh = 'From now on, flag any order over 100000 views';
  assert.equal(accepted('Flag any order over 1,00,000 views.', qLakh), 'Flag any order over 1,00,000 views.');
  assert.equal(accepted('Flag any order over 100000 views.', qLakh), 'Flag any order over 100000 views.');
  assert.throws(() => accepted('Flag any order over 1,000,000 views.', qLakh), refused('INVALID_VENTURE_REQUEST', /number you did not say/));
});
