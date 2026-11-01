// Wave 6 package 6H2 (DECISIONS D41): recorded flows. The owner does a website task once in Chausar's browser window;
// Chausar keeps it as a recipe of plain steps with blanks; a dry run, one approval, then exact replay with no AI that
// stops before any submit, pay or post step for that run's own approval. A changed page stops the run. Passwords, card
// numbers and codes are never recorded or replayed. No real browser here: a scripted page port.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FLOW_MAX_STEPS, effectOf, recipeDigest, recipeFromRecording, secretOf, validateRecipe,
  type FlowRecipe, type RecordedControl, type RecordedEvent,
} from '../runtime/venture/flows/recipe.ts';
import { replayFlow, type FlowBrowserPort, type FlowFind, type FlowPageFacts } from '../runtime/venture/flows/replay.ts';

const fp = (seed: string) => seed.repeat(64).slice(0, 64);
function control(fields: Partial<RecordedControl> & { fingerprint: string }): RecordedControl {
  return {
    tag: 'input', type: 'text', name: null, id: null, testId: null, ariaLabel: null, labelText: null, autocomplete: null, role: null,
    inForm: true, formAction: 'http://127.0.0.1:4100/save', text: '', href: null, candidates: [{ kind: 'id', value: 'x' }], ...fields,
  };
}
const NAME = control({ name: 'client', id: 'client', labelText: 'Client name', fingerprint: fp('a'), candidates: [{ kind: 'id', value: 'client' }, { kind: 'name', value: 'client' }] });
const AMOUNT = control({ name: 'hours', id: 'hours', labelText: 'Hours', fingerprint: fp('b'), candidates: [{ kind: 'id', value: 'hours' }] });
const PASSWORD = control({ type: 'password', name: 'pw', id: 'pw', labelText: 'Password', fingerprint: fp('c'), candidates: [{ kind: 'id', value: 'pw' }] });
const CARD = control({ name: 'cardnumber', autocomplete: 'cc-number', labelText: 'Card number', fingerprint: fp('d'), candidates: [{ kind: 'name', value: 'cardnumber' }] });
const OTP = control({ name: 'code', autocomplete: 'one-time-code', labelText: 'Code', fingerprint: fp('e'), candidates: [{ kind: 'name', value: 'code' }] });
const AGREE = control({ type: 'checkbox', name: 'agree', id: 'agree', labelText: 'I agree', fingerprint: fp('f'), candidates: [{ kind: 'id', value: 'agree' }] });
const NEXT = control({ tag: 'button', type: 'button', id: 'next', text: 'Next', inForm: false, formAction: null, fingerprint: fp('1'), candidates: [{ kind: 'id', value: 'next' }] });
const SAVE = control({ tag: 'button', type: 'submit', id: 'save', text: 'Save timesheet', fingerprint: fp('2'), candidates: [{ kind: 'id', value: 'save' }] });
const PAY = control({ tag: 'button', type: 'submit', id: 'pay', text: 'Pay now', fingerprint: fp('3'), candidates: [{ kind: 'id', value: 'pay' }] });

const RECORDING: RecordedEvent[] = [
  { kind: 'open', url: 'http://127.0.0.1:4100/timesheet' },
  { kind: 'click', control: NAME }, // a focus click on a text box is not a step
  { kind: 'input', control: NAME, value: 'Asha' },
  { kind: 'input', control: NAME, value: 'Asha Rao' }, // typing again on the same box keeps the last value
  { kind: 'input', control: AMOUNT, value: '6' },
  { kind: 'input', control: PASSWORD, value: null },
  { kind: 'input', control: AGREE, value: 'true' },
  { kind: 'click', control: NEXT },
  { kind: 'submit', control: SAVE },
];

test('a recording becomes plain steps with blanks; typed words become blanks, a password becomes a stop for the owner', () => {
  const { recipe, samples } = recipeFromRecording(RECORDING, { name: 'Timesheet' });
  assert.equal(recipe.origin, 'http://127.0.0.1:4100');
  assert.deepEqual(recipe.steps.map(step => step.kind), ['open', 'fill', 'fill', 'secret', 'fill', 'click', 'gate']);
  assert.deepEqual(recipe.blanks, [{ name: 'blank-1', label: 'Client name' }, { name: 'blank-2', label: 'Hours' }]);
  assert.deepEqual(samples, { 'blank-1': 'Asha Rao', 'blank-2': '6' });
  const [, client, , secret, agree, , gate] = recipe.steps as any[];
  assert.deepEqual(client.value, { blank: 'blank-1' });
  assert.equal(client.target.fingerprint, fp('a'));
  assert.deepEqual(client.target.candidates, [{ kind: 'id', value: 'client' }, { kind: 'name', value: 'client' }]);
  assert.equal(secret.secret, 'password');
  assert.equal('value' in secret, false, 'a password step keeps no value at all');
  assert.deepEqual(agree.value, { fixed: 'true' });
  assert.equal(gate.effect, 'submit');
  assert.equal(validateRecipe(recipe), recipe);
  assert.match(recipeDigest(recipe), /^[a-f0-9]{64}$/);
  assert.notEqual(recipeDigest(recipe), recipeDigest({ ...recipe, name: 'Other' }));
});

test('a card number or a one-time code is never kept, even if a page leaked its value into the recording', () => {
  const { recipe, samples } = recipeFromRecording([
    { kind: 'open', url: 'https://shop.example/pay' },
    { kind: 'input', control: CARD, value: '4111 1111 1111 1111' },
    { kind: 'input', control: OTP, value: '123456' },
    { kind: 'submit', control: PAY },
  ], { name: 'Pay' });
  assert.deepEqual(recipe.steps.map(step => step.kind === 'secret' ? step.secret : step.kind), ['open', 'card', 'otp', 'gate']);
  assert.deepEqual(samples, {});
  assert.equal(JSON.stringify(recipe).includes('4111'), false);
  assert.equal(JSON.stringify(recipe).includes('123456'), false);
  assert.equal((recipe.steps[3] as any).effect, 'pay');
});

test('secrets and effects are read from the control by code', () => {
  assert.equal(secretOf(PASSWORD), 'password');
  assert.equal(secretOf(CARD), 'card');
  assert.equal(secretOf(control({ name: 'cvv', fingerprint: fp('9') })), 'card');
  assert.equal(secretOf(OTP), 'otp');
  assert.equal(secretOf(NAME), null);
  assert.equal(effectOf(PAY), 'pay');
  assert.equal(effectOf(control({ tag: 'button', type: 'submit', text: 'Publish post', fingerprint: fp('8') })), 'post');
  assert.equal(effectOf(SAVE), 'submit');
});

test('a recipe is refused when it leaves its site, has an unused or missing blank, a CAPTCHA, or too many steps', () => {
  const { recipe } = recipeFromRecording(RECORDING, { name: 'Timesheet' });
  const refused = (changed: FlowRecipe) => assert.throws(() => validateRecipe(changed), (error: any) => error.code === 'FLOW_INVALID');
  refused({ ...recipe, steps: [{ kind: 'open', url: 'https://other.example/x' }, ...recipe.steps.slice(1)] });
  refused({ ...recipe, blanks: [...recipe.blanks, { name: 'blank-9', label: 'Unused' }] });
  refused({ ...recipe, blanks: recipe.blanks.slice(1) });
  refused({ ...recipe, steps: [...recipe.steps, { kind: 'fill', control: 'text', target: { candidates: [{ kind: 'name', value: 'g-recaptcha-response' }], fingerprint: fp('7'), label: 'captcha' }, value: { fixed: 'x' } }] });
  refused({ ...recipe, steps: [recipe.steps[0], ...Array.from({ length: FLOW_MAX_STEPS }, () => recipe.steps[5])] });
  refused({ ...recipe, origin: 'http://192.168.1.5:80' });
  assert.throws(() => recipeFromRecording([{ kind: 'input', control: NAME, value: 'x' }], { name: 'No start' }), (error: any) => error.code === 'FLOW_INVALID');
});

// ---------------------------------------------------------------------------
// Replay against a scripted page
// ---------------------------------------------------------------------------

type Element = { fingerprint: string; count?: number; submitLike?: boolean; secret?: boolean; filled?: boolean; shows?: (value: string) => string };
function page(elements: Record<string, Element>, options: { title?: string; captcha?: boolean; url?: string } = {}) {
  const calls: string[] = [];
  const facts = (): FlowPageFacts => ({ url: options.url ?? 'http://127.0.0.1:4100/timesheet', title: options.title ?? 'Timesheet', captcha: options.captcha ?? false });
  const key = (target: { candidates: { value: string }[] }) => target.candidates[0].value;
  const port: FlowBrowserPort = {
    async open(_run, url) { calls.push(`open ${url}`); return facts(); },
    async record() { throw new Error('not used'); },
    async find(_run, target): Promise<FlowFind> {
      const found = elements[key(target)];
      calls.push(`find ${key(target)}`);
      return found ? { count: found.count ?? 1, fingerprint: found.fingerprint, submitLike: !!found.submitLike, secret: !!found.secret, filled: !!found.filled } : { count: 0, fingerprint: null, submitLike: false, secret: false, filled: false };
    },
    async fill(_run, target, _control, value) { calls.push(`fill ${key(target)}=${value}`); const found = elements[key(target)]; return { shown: found?.shows ? found.shows(value) : value }; },
    async click(_run, target, approved) { calls.push(`click ${key(target)}${approved ? ' approved' : ''}`); return { facts: facts(), answered: true }; },
    async facts() { return facts(); },
    async controls() { return []; },
    async close() { calls.push('close'); },
  };
  return { port, calls };
}
const ELEMENTS: Record<string, Element> = {
  client: { fingerprint: fp('a') }, hours: { fingerprint: fp('b') }, pw: { fingerprint: fp('c'), secret: true, filled: false },
  agree: { fingerprint: fp('f') }, next: { fingerprint: fp('1') }, save: { fingerprint: fp('2'), submitLike: true },
};
const { recipe: TIMESHEET } = recipeFromRecording(RECORDING, { name: 'Timesheet' });
const VALUES = { 'blank-1': 'Meera', 'blank-2': '4' };

test('a run fills the blanks exactly, stops for the owner at a password, and never types one', async () => {
  const { port, calls } = page(ELEMENTS);
  const stop = await replayFlow({ port, runId: 'run_1', recipe: TIMESHEET, values: VALUES, mode: 'run' });
  assert.equal(stop.outcome, 'needs-you');
  assert.equal((stop as any).step, 3);
  assert.deepEqual(calls, ['open http://127.0.0.1:4100/timesheet', 'find client', 'fill client=Meera', 'find hours', 'fill hours=4', 'find pw']);
});

test('after the owner typed the password, the run goes on and stops before the submit for that run\'s approval, unclicked', async () => {
  const { port, calls } = page({ ...ELEMENTS, pw: { ...ELEMENTS.pw, filled: true } });
  const stop = await replayFlow({ port, runId: 'run_1', recipe: TIMESHEET, values: VALUES, mode: 'run', from: 3 });
  assert.deepEqual(stop, { outcome: 'held', step: 6, effect: 'submit', line: 'Chausar stopped before Save timesheet. Approve this exact submit to go on.' });
  assert.deepEqual(calls, ['find pw', 'find agree', 'fill agree=true', 'find next', 'click next', 'find save']);
  assert.equal(calls.some(call => call.startsWith('click save')), false);
});

test('a dry run uses the samples and ends at the first submit without pressing it', async () => {
  const { port, calls } = page({ ...ELEMENTS, pw: { ...ELEMENTS.pw, filled: true } });
  const stop = await replayFlow({ port, runId: 'dry_1', recipe: TIMESHEET, values: { 'blank-1': 'Asha Rao', 'blank-2': '6' }, mode: 'dry' });
  assert.equal(stop.outcome, 'tested');
  assert.equal(calls.some(call => call.startsWith('click save')), false);
});

test('a changed page stops the run: another fingerprint, two matches, or a box that does not show the exact words', async () => {
  for (const changed of [
    { client: { fingerprint: fp('z') } },
    { client: { fingerprint: fp('a'), count: 2 } },
    { client: { fingerprint: fp('a'), shows: (value: string) => value.toUpperCase() } },
  ]) {
    const { port, calls } = page({ ...ELEMENTS, ...changed });
    const stop = await replayFlow({ port, runId: 'run_2', recipe: TIMESHEET, values: VALUES, mode: 'run' });
    assert.equal(stop.outcome, 'changed');
    assert.equal((stop as any).step, 1);
    assert.equal(calls.some(call => call.startsWith('fill hours')), false, 'nothing after the changed step');
  }
});

test('a click step that became a submit on the page is never pressed without approval', async () => {
  const { port, calls } = page({ ...ELEMENTS, pw: { ...ELEMENTS.pw, filled: true }, next: { fingerprint: fp('1'), submitLike: true } });
  const stop = await replayFlow({ port, runId: 'run_3', recipe: TIMESHEET, values: VALUES, mode: 'run', from: 3 });
  assert.equal(stop.outcome, 'changed');
  assert.equal(calls.includes('click next'), false);
});

test('a CAPTCHA or security check is a hard stop: nothing is solved or tried around it', async () => {
  for (const options of [{ captcha: true }, { title: 'Just a moment...' }]) {
    const { port, calls } = page(ELEMENTS, options);
    const stop = await replayFlow({ port, runId: 'run_4', recipe: TIMESHEET, values: VALUES, mode: 'run' });
    assert.equal(stop.outcome, 'challenge');
    assert.deepEqual(calls, ['open http://127.0.0.1:4100/timesheet']);
  }
});

test('a page that left the recipe\'s site stops the run', async () => {
  const { port } = page(ELEMENTS, { url: 'https://elsewhere.example/' });
  const stop = await replayFlow({ port, runId: 'run_5', recipe: TIMESHEET, values: VALUES, mode: 'run' });
  assert.equal(stop.outcome, 'changed');
});

test('a run needs a value for every blank and nothing else', async () => {
  const { port } = page(ELEMENTS);
  await assert.rejects(replayFlow({ port, runId: 'run_6', recipe: TIMESHEET, values: { 'blank-1': 'Meera' }, mode: 'run' }), (error: any) => error.code === 'FLOW_INVALID');
  await assert.rejects(replayFlow({ port, runId: 'run_6', recipe: TIMESHEET, values: { ...VALUES, extra: 'x' }, mode: 'run' }), (error: any) => error.code === 'FLOW_INVALID');
});

test('a site whose terms bar automated use, LinkedIn first, is never recorded or run (a hard stop)', () => {
  for (const url of ['https://www.linkedin.com/feed/', 'https://linkedin.com/in/x']) {
    assert.throws(() => recipeFromRecording([{ kind: 'open', url }, { kind: 'input', control: NAME, value: 'x' }], { name: 'Barred' }), (error: any) => error.code === 'FLOW_INVALID' && /does not allow automated use/.test(error.message));
  }
});
