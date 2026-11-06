// Prompt-leak lint (catalogue H20): words meant for the AI, not the reader ("as an AI", "here is a post", "[hook]",
// "<placeholder>", scaffold labels) fail a draft's checks before the owner sees it as ready. Code only, no model. The
// lint runs on every flagship draft (YouTube, CA firm, social agency), on each social post, and on the exact text of
// every post before it is proposed (build/posting.ts, tested in venture-posting-safety.test.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Deliverable, VentureRecord } from '../runtime/venture/contracts.ts';
import { houseStyleFindings } from '../runtime/venture/records.ts';
import { PROMPT_LEAK_CHECK, promptLeakLine, promptLeaks } from '../runtime/venture/playbooks/prompt-leak.ts';
import { SOCIAL_CHECK_IDS, checkSocialDraft, type ClientRules } from '../runtime/venture/playbooks/social/checks.ts';
import { runFlagshipChecks, type FlagshipCheckInput } from '../runtime/venture/playbooks/draft-checks.ts';
import { runView } from '../runtime/venture/delivery/runs.ts';
import { readFile } from 'node:fs/promises';

const phrases = (text: string, scope: 'draft' | 'post' = 'draft') => promptLeaks(text, scope).map(item => item.phrase.toLowerCase());

test('the lint finds AI self-talk, chat preambles and closers, placeholders and template markers', () => {
  const leaky: [string, string][] = [
    ['As an AI, I cannot taste the coffee, but here goes.', 'as an ai,'],
    ['As an AI language model I would say the thali is great.', 'as an ai language model'],
    ['Here is a post for your cafe: Sunday thali at noon.', 'here is a post'],
    ["Here's your LinkedIn caption: we open at 8.", "here's your linkedin caption"],
    ['Sure! Here are three tweets about filter coffee:', 'sure! here are'],
    ['Pastries at 8.\nHere are two captions:\nFresh bakes daily.', 'here are two captions'],
    ['X: Here is a post: Sunday thali at noon.', 'here is a post'],
    ['Fresh pastries at 8. Feel free to tweak this.', 'feel free to tweak this'],
    ['[hook] Fresh pastries at 8.', '[hook]'],
    ['Book now at [insert link].', '[insert link]'],
    ['Thanks, [Your Name]', '[your name]'],
    ['Fresh pastries at 8. <placeholder>', '<placeholder>'],
    ['Hi {{client_name}}, your table is ready.', '{{client_name}}'],
    ['Fresh pastries at 8. I hope this helps!', 'i hope this helps'],
    ["Fresh pastries at 8. Let me know if you'd like another version.", "let me know if you'd like"],
    ['TODO: add the price. Fresh pastries at 8.', 'todo'],
    ['Lorem ipsum dolor sit amet.', 'lorem ipsum'],
    ['एक एआई के रूप में, मैं यह कहूँगा।', 'एक एआई के रूप में'],
  ];
  for (const [text, phrase] of leaky) assert.ok(phrases(text).some(found => found.includes(phrase)), `${text} -> ${JSON.stringify(promptLeaks(text))}`);
});

/** Honest sentences a client or a post may well carry: none of them is a leak, in a draft or in a post. */
const HONEST = [
  'Fresh pastries at 8. Made with AI.',
  'Our presenter is an AI avatar, made with AI. Sunday thali at noon.',
  'Here is the menu for Diwali: thali, sweets and chai.',
  'Title: Hidden bank fees\n0:00 Why fees matter\n1:30 The fees to check',
  'GST working for September (draft for the CA of record).',
  'We are open 8 to 11 [weekdays only].',
  "Here's a thread on GST",
  "Here's my latest article",
  'Here are your options',
  'Here is the description of our course',
  'Here is a post we loved from a client',
  'Our bakery wrote this. Here is a post: it went well.',
  'Let me know if you need any other documents',
  'Feel free to change your booking',
  'Part 2: the GST changes for small shops',
  'Option A: thali with chai. Option B: dosa.',
  'Body: strong. Mind: calm.',
  'Here is the draft GST working for September, for your review',
];

test('the lint leaves honest words alone: AI disclosure, ordinary "here is", closers about other things, ordinary labels', () => {
  for (const text of [...HONEST, 'Hook: Three cafes, one street, one owner.']) assert.deepEqual(promptLeaks(text), [], text);
  for (const text of HONEST) assert.deepEqual(promptLeaks(text, 'post'), [], `post: ${text}`);
});

test('in the exact text of a post, a template label at the start of a line or a heading is a leak too', () => {
  assert.deepEqual(phrases('Hook: Three cafes, one street.'), []);
  assert.ok(phrases('Hook: Three cafes, one street.', 'post').some(found => found.startsWith('hook:')));
  assert.ok(phrases('Sunday thali at noon.\nCTA: Book a table today.', 'post').some(found => found.startsWith('cta:')));
  assert.ok(phrases('## Caption\nSunday thali at noon.', 'post').some(found => found.startsWith('##')));
  assert.ok(phrases('Version 2: Sunday thali at noon.', 'post').some(found => found.startsWith('version 2:')));
  assert.deepEqual(phrases('Sunday thali at noon. Book: call 98200 00000.', 'post'), [], 'a label mid-line is ordinary text');
  assert.deepEqual(phrases('Sunday thali at noon. #Sunday #Pune', 'post'), []);
});

test('the owner reads one plain line naming what leaked, at most three phrases', () => {
  assert.equal(promptLeakLine([]), null);
  const line = promptLeakLine(promptLeaks('As an AI, here is a post: [hook] <placeholder> {{name}}'))!;
  assert.match(line, /^The draft still has words meant for the AI, not the reader: /);
  assert.equal((line.match(/"/g) ?? []).length, 6, line);
  assert.match(promptLeakLine(promptLeaks('[hook] Sunday.'), 'post')!, /^The post still has/);
  assert.deepEqual(houseStyleFindings(line), []);
  assert.ok(!line.includes(String.fromCharCode(0x2014)));
});

const client: ClientRules = { businessName: 'Lumen Studio', known: ['Lumen Studio'], proofFiles: [] };

test('social checks: a post with a leak is blocked by its own check id, before the owner sees it as ready', () => {
  assert.ok(SOCIAL_CHECK_IDS.includes(PROMPT_LEAK_CHECK));
  const leaky = checkSocialDraft({ id: 'p1', channel: 'x', text: 'Here is a post for you: Sunday thali at noon.' }, client);
  assert.equal(leaky.passed, false);
  const finding = leaky.findings.find(item => item.check === PROMPT_LEAK_CHECK)!;
  assert.equal(finding.severity, 'block');
  assert.match(finding.line, /here is a post/i);
  const scaffold = checkSocialDraft({ id: 'p2', channel: 'x', text: 'CTA: Book a table at Lumen Studio.' }, client);
  assert.ok(scaffold.findings.some(item => item.check === PROMPT_LEAK_CHECK), JSON.stringify(scaffold.findings));
  const clean = checkSocialDraft({ id: 'p3', channel: 'x', text: 'Sunday at Lumen Studio. Book a table.' }, client);
  assert.ok(!clean.findings.some(item => item.check === PROMPT_LEAK_CHECK), JSON.stringify(clean.findings));
});

const text = (value: string) => ({ kind: 'text' as const, text: value });
const draft = (lines: string[]): Deliverable => ({ title: 'Posts for October', sections: [{ heading: 'Posts', parts: lines.map(text) }], questionsForClient: [] });
const input = (flagship: string, lines: string[], servedBy: 'model' | 'template' = 'model'): FlagshipCheckInput => ({
  flagship, offerKey: null, servedBy, deliverable: draft(lines), request: 'Posts for Lumen Studio in October.', intake: null,
  files: [], receipts: [], known: ['Lumen Studio'], mode: 'client', today: '2026-10-21', dateOrder: 'day-month-year', finishing: null,
});
const leakResult = async (value: FlagshipCheckInput) => (await runFlagshipChecks(value)).find(item => item.check === PROMPT_LEAK_CHECK);

test('every flagship draft gets the prompt-leak check; a leak fails it, so Accept is blocked', async () => {
  for (const flagship of ['social-agency', 'youtube', 'ca-firm']) {
    const leaky = await leakResult(input(flagship, ['X: Here is a post: Sunday thali at Lumen Studio.']));
    assert.equal(leaky?.outcome, 'fail', flagship);
    assert.equal(leaky?.playbook, flagship);
    assert.match(leaky!.detail, /here is a post/i);
    const clean = await leakResult(input(flagship, ['X: Sunday thali at Lumen Studio.']));
    assert.equal(clean?.outcome, 'pass', `${flagship}: ${clean?.detail}`);
  }
  // A social post line is read as the exact post: a template label inside it fails, though the package format passes.
  assert.equal((await leakResult(input('social-agency', ['X: CTA: Book a table at Lumen Studio.'])))?.outcome, 'fail');
  assert.equal((await leakResult(input('youtube', ['Hook: Three cafes, one street.'])))?.outcome, 'pass');
  // Template outlines are not agent drafts: the playbook's checks do not run on them, the lint included.
  assert.equal(await leakResult(input('social-agency', ['X: [hook]'], 'template')), undefined);
  assert.deepEqual(await runFlagshipChecks(input('some-other-playbook', ['As an AI, hello.'])), []);

  const leak = (await runFlagshipChecks(input('social-agency', ['X: As an AI, I love Sunday thali at Lumen Studio.']))).filter(item => item.check === PROMPT_LEAK_CHECK);
  const venture = { launchStage: 'approve-each' } as VentureRecord;
  const run = runView({ status: 'ready-for-review', practice: false, servedBy: 'model', checks: [{ check: 'house-style', passed: true, detail: 'ok' }], playbookChecks: leak } as never, venture, Date.parse('2026-10-21T10:00:00Z'));
  assert.equal(run.canAccept, false);
  assert.match(run.acceptBlocked ?? '', /words meant for the AI/);
});

test('static: the lint file keeps the house style and has no long dash', async () => {
  const source = await readFile(new URL('../runtime/venture/playbooks/prompt-leak.ts', import.meta.url), 'utf8');
  assert.ok(!source.includes(String.fromCharCode(0x2014)));
  assert.deepEqual(houseStyleFindings(source), []);
});
