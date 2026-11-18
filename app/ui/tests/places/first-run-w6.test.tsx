import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { FAKE_DEVICE_CODE } from '../../src/engine/fake-first-run';
import { EngineError, type EngineClient, type ModelStatusLite, type ToolLite, type ToolsLite } from '../../src/engine/types';
import firstRun from '../../src/text/en/first-run.json';
import { answerSideWork, confirmProfession } from './first-run-steps';
import { ClockProvider } from '../../src/shell/clock';
import { AI_PLAN_RISK } from '../../../../platform/runtime/venture/models/plan-risk';

/**
 * W6 first run: Connect your AI (6C1), About you as A that becomes B (6C2, DECISIONS D16a) and Connect what your
 * business needs (6C7), on the fake engine, which answers as the engine does.
 */
const CA = "I'm a CA with six years in audit and want to do books and GST for small shops near me.";

function timeZone(zone: string) {
  const original = Intl.DateTimeFormat.prototype.resolvedOptions;
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(function (this: Intl.DateTimeFormat) {
    return { ...original.call(this), timeZone: zone };
  });
}
function reducedMotion(on: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: on && query.includes('prefers-reduced-motion'), media: query, onchange: null,
    addListener: () => {}, removeListener: () => {}, addEventListener: () => {}, removeEventListener: () => {}, dispatchEvent: () => false,
  }) as MediaQueryList);
}
function start(engine = new FakeEngine({ fresh: true })) {
  window.location.hash = '#/today';
  const fake = createFakeClient(engine);
  const calls: [string, Record<string, unknown>][] = [];
  const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => { calls.push([method, structuredClone(params ?? {})]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { engine, calls };
}
/** Presses a button once it can be pressed: step 1's sign-in buttons wait for the first look at this computer. */
async function press(name: string | RegExp) {
  const button = await screen.findByRole('button', { name }, { timeout: 4000 });
  await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false), { timeout: 4000 });
  await act(async () => { fireEvent.click(button); });
}

const CHATGPT = 'Sign in with ChatGPT';
const CLAUDE = 'Sign in with Claude';
const NO_CLAUDE = 'Install Claude Code with its own installer, then check again.';
type Call = [string, Record<string, unknown>];
const made = (calls: Call[], method: string) => calls.filter(([name]) => name === method);
const firstOf = (calls: Call[], method: string) => calls.findIndex(([name]) => name === method);

/** What the owner sees in the main region: not what a closed fold holds, and not what only a screen reader hears. */
function seen(root: Element = screen.getByRole('main')): string {
  const out: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const parent = node.parentElement;
    if (!parent || parent.closest('.sr-only, [hidden]')) continue;
    const fold = parent.closest('details');
    if (fold && !fold.open && parent.closest('summary')?.parentElement !== fold) continue;
    out.push((node.textContent ?? '').trim());
  }
  return out.filter(Boolean).join(' ');
}
const moreOptions = async () => (await screen.findByText('More options', { selector: 'summary' }, { timeout: 4000 })).closest('details')!;
async function openMore() {
  const fold = await moreOptions();
  if (!fold.open) await act(async () => { fireEvent.click(fold.querySelector('summary')!); });
  return fold;
}
async function skipAi() {
  const fold = await openMore();
  await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Continue without AI for now' })); });
}
/** The fake computer with the tools answered another way: Claude Code found too, or Codex as the engine refuses one. */
function startWith(change: (tool: ToolLite) => ToolLite, engine = new FakeEngine({ fresh: true }), refuse: Readonly<Record<string, EngineError>> = {}) {
  window.location.hash = '#/today';
  const fake = createFakeClient(engine);
  const calls: Call[] = [];
  const client: EngineClient = { ...fake, request: (async (method: string, params?: Record<string, unknown>) => {
    calls.push([method, structuredClone(params ?? {})]);
    if (refuse[method]) throw refuse[method];
    const answer = await fake.request(method as never, params as never) as unknown;
    if (method !== 'venture.ai.tools') return answer;
    const tools = answer as ToolsLite;
    return { ...tools, tools: tools.tools.map(change) };
  }) as EngineClient['request'] };
  render(<App client={client} language="en" />);
  return { engine, calls };
}
const claudeFound = (signedIn: 'yes' | 'no') => (tool: ToolLite): ToolLite => (tool.cli === 'claude-code'
  ? { ...tool, found: true, signedIn, login: { state: 'idle', code: null, link: null, line: null }, ...(signedIn === 'yes' ? { tested: 'passed' as const } : {}) }
  : tool);

afterEach(() => { vi.restoreAllMocks(); });

describe('first run, step 1: a simple sign-in', () => {
  it('shows the title, one line and two sign-in buttons, ChatGPT the one filled button, and nothing technical', async () => {
    timeZone('Asia/Kolkata');
    startWith(claudeFound('no'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect your AI' })).toBeTruthy();
    const chatgpt = await screen.findByRole('button', { name: CHATGPT });
    const claude = screen.getByRole('button', { name: CLAUDE });
    expect(chatgpt.getAttribute('data-variant')).toBe('primary');
    expect(claude.getAttribute('data-variant')).toBe('secondary');
    const main = screen.getByRole('main');
    // The fold with the tools' full consent shows once this computer has been looked at.
    await within(main).findByText("What's sent");
    // Nothing to fix under either button: both can work. What each does carry, at rest and in small type, is the
    // platform's own risk in the engine's own words (the founder's rule; found missing on 15 Nov 2026).
    expect(main.querySelectorAll('[data-choice-line]')).toHaveLength(0);
    const risks = [...main.querySelectorAll('[data-plan-risk]')];
    expect(risks.map((line) => [line.closest('[data-choice]')!.getAttribute('data-choice'), line.textContent])).toEqual([['codex', AI_PLAN_RISK.codex], ['claude-code', AI_PLAN_RISK['claude-code']]]);
    expect(chatgpt.getAttribute('aria-describedby')).toBe(risks[0]!.id);
    expect(claude.getAttribute('aria-describedby')).toBe(risks[1]!.id);
    // It is plain to see: not inside the closed "What's sent" fold.
    for (const line of risks) expect(line.closest('details')).toBeNull();
    expect((await moreOptions()).open).toBe(false);
    const words = seen(main);
    expect(words).not.toMatch(/Codex|Claude Code/);
    expect(words).not.toMatch(/\d+\.\d+\.\d+/);
    expect(words).not.toMatch(/installed|[a-f0-9]{64}|[\\/]/i);
    for (const gone of ['Use this Codex', 'Use Codex', 'Sign in with Codex', 'Add a key', 'Skip for now: use templates', 'Stop looking']) expect(words).not.toContain(gone);
    expect(words).toContain('Your Chausar team runs on your own ChatGPT or Claude plan. Chausar never sees your password.');
    const steps = screen.getByRole('list', { name: 'Setup steps' });
    expect(within(steps).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['1Connect your AI', '2Your work', '3Your business']);
    // The screen's words at rest with both tools here: 93 measured before the two risk lines (28 words), 121 with them.
    expect(words).toContain(AI_PLAN_RISK.codex);
    expect(words.split(/\s+/).length).toBeLessThanOrEqual(121);
  });

  it('keeps its words few: the sample computer showed 150 words at rest before the simple sign-in, and 120 at most now', async () => {
    start();
    // The sample computer has no Claude Code, so the one line under that button is counted too (102 measured), and
    // the ChatGPT button carries the platform's own risk line (15 words): 117 measured, held at 120.
    await screen.findByRole('button', { name: CLAUDE, description: NO_CLAUDE }, { timeout: 4000 });
    await screen.findByText("What's sent");
    expect(seen()).toContain(AI_PLAN_RISK.codex);
    // A tool that is not here shows how to get it, not the risk of a plan the owner cannot use yet.
    expect(seen()).not.toContain(AI_PLAN_RISK['claude-code']);
    expect(seen().split(/\s+/).length).toBeLessThanOrEqual(120);
  });

  it('the risk lines are the engine\'s own words: the text pack holds them exactly', () => {
    expect(firstRun['first-run.ai.risk.codex']).toBe(AI_PLAN_RISK.codex);
    expect(firstRun['first-run.ai.risk.claude-code']).toBe(AI_PLAN_RISK['claude-code']);
  });

  it('a Codex waiting for the owner\'s yes shows no version, file or separate step: the same two buttons', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.reviewCodex();
    start(engine);
    const chatgpt = await screen.findByRole('button', { name: CHATGPT });
    await waitFor(() => expect(screen.getByRole('button', { name: CLAUDE, description: NO_CLAUDE })).toBeTruthy());
    // Nothing to fix under it: only the platform's own risk line, as on any ChatGPT button that can work.
    expect(chatgpt.closest('[data-choice]')!.querySelectorAll('[data-choice-line]')).toHaveLength(0);
    expect(screen.getByRole('button', { name: CHATGPT, description: AI_PLAN_RISK.codex })).toBe(chatgpt);
    const words = seen();
    expect(words).not.toMatch(/Codex|0\.166\.0|AppData|Use it\?/);
    expect(screen.queryByRole('button', { name: 'Use this Codex' })).toBeNull();
  });

  it('one click runs the owner\'s yes, then the sign-in, then the connection, in that order', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.reviewCodex();
    const { calls } = start(engine);
    await press(CHATGPT);
    // The tool's own sign-in waits for the owner: its code, one progress line and the way out.
    expect(await screen.findByText(FAKE_DEVICE_CODE, {}, { timeout: 4000 })).toBeTruthy();
    expect(screen.getByText('Waiting for you to finish signing in').getAttribute('role')).toBe('status');
    expect(screen.getByRole('button', { name: 'Open the sign-in page again' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel sign-in' })).toBeTruthy();
    expect(seen()).not.toMatch(/Codex/);
    // The fake Codex finishes after three looks; nothing more is pressed.
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' }, { timeout: 10000 })).toBeTruthy();
    const trust = firstOf(calls, 'venture.ai.setup.trust'), login = firstOf(calls, 'venture.ai.login.start'), connect = firstOf(calls, 'venture.ai.connect');
    expect(trust).toBeGreaterThan(-1);
    expect(login).toBeGreaterThan(trust);
    expect(connect).toBeGreaterThan(login);
    expect(calls[trust]![1]).toEqual({ cli: 'codex', sha256: 'c'.repeat(64) });
    expect(calls[login]![1]).toEqual({ cli: 'codex' });
    expect(calls[connect]![1]).toMatchObject({ presetId: 'codex-cli' });
    expect(typeof calls[connect]![1].consentDigest).toBe('string');
    for (const method of ['venture.ai.setup.trust', 'venture.ai.login.start', 'venture.ai.connect']) expect(made(calls, method)).toHaveLength(1);
    // The owner's yes was still asked by the app's own dialog, once.
    expect(engine.firstRun.dialogs).toHaveLength(1);
    expect(screen.getByText('Connected: ChatGPT plan')).toBeTruthy();
    // C1 task 11: step 1 reads "Your AI" with its check; what was connected is its title and its words for screen readers.
    const first = within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem')[0]!;
    expect(first.querySelector('[data-step-word]')?.textContent).toBe('Your AI');
    expect(first.querySelector('svg')).toBeTruthy();
    expect(first.getAttribute('title')).toBe('Connected: ChatGPT plan');
    expect(first.textContent).toBe('Your AIConnected: ChatGPT plan');
  }, 20000);

  it('a tool already signed in connects on the one click and never starts a sign-in', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    const { calls } = start(engine);
    await press(CHATGPT);
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' }, { timeout: 4000 })).toBeTruthy();
    expect(made(calls, 'venture.ai.login.start')).toHaveLength(0);
    expect(made(calls, 'venture.ai.setup.trust')).toHaveLength(0);
    expect(made(calls, 'venture.ai.connect').map(([, params]) => params.presetId)).toEqual(['codex-cli']);
  });

  it('Cancel sign-in stops the tool\'s sign-in, and nothing is connected', async () => {
    const { calls } = start();
    await press(CHATGPT);
    expect(await screen.findByText(FAKE_DEVICE_CODE, {}, { timeout: 4000 })).toBeTruthy();
    await press('Cancel sign-in');
    await waitFor(() => expect(screen.queryByText(FAKE_DEVICE_CODE)).toBeNull());
    expect(made(calls, 'venture.ai.login.cancel').map(([, params]) => params)).toEqual([{ cli: 'codex' }]);
    expect(screen.queryByRole('button', { name: 'Cancel sign-in' })).toBeNull();
    expect((screen.getByRole('button', { name: CHATGPT }) as HTMLButtonElement).disabled).toBe(false);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(made(calls, 'venture.ai.connect')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeTruthy();
  });

  it('Sign in with Claude connects a signed-in Claude Code the same way', async () => {
    const { calls } = startWith(claudeFound('yes'));
    await press(CLAUDE);
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' }, { timeout: 4000 })).toBeTruthy();
    expect(made(calls, 'venture.ai.connect').map(([, params]) => params.presetId)).toEqual(['claude-code-cli']);
    expect(screen.getByText('Connected: Claude plan')).toBeTruthy();
  });
});

describe('first run, step 1: a choice that cannot work says the engine\'s one line under its button', () => {
  const lineUnder = (name: string) => screen.getByRole('button', { name }).closest('[data-choice]')!.querySelectorAll('[data-choice-line]');

  it('a tool that is not on this computer: its fix words, and a click only looks again', async () => {
    const { calls } = start();
    expect(await screen.findByRole('button', { name: CLAUDE, description: NO_CLAUDE }, { timeout: 4000 })).toBeTruthy();
    expect(lineUnder(CLAUDE)).toHaveLength(1);
    expect(lineUnder(CLAUDE)[0]!.textContent).toBe(NO_CLAUDE);
    expect(screen.queryByRole('alert')).toBeNull();
    const looks = made(calls, 'venture.ai.tools').length;
    await press(CLAUDE);
    await waitFor(() => expect(made(calls, 'venture.ai.tools').length).toBe(looks + 1));
    await waitFor(() => expect((screen.getByRole('button', { name: CLAUDE }) as HTMLButtonElement).disabled).toBe(false));
    expect(made(calls, 'venture.ai.login.start')).toHaveLength(0);
    expect(lineUnder(CLAUDE)[0]!.textContent).toBe(NO_CLAUDE);
  });

  it('a Codex the engine refuses (too old): the engine\'s words, no file path, and no sign-in', async () => {
    const TOO_OLD = 'This is Codex 0.150.0. Chausar works with Codex 0.166.0. Update it, then check again.';
    const { calls } = startWith((tool) => (tool.cli === 'codex'
      ? { ...tool, signedIn: 'unknown', setup: { state: 'refused', origin: null, path: String.raw`~\AppData\Roaming\npm\codex.exe`, version: '0.150.0', sha256: 'd'.repeat(64), line: TOO_OLD } }
      : tool));
    expect(await screen.findByRole('button', { name: CHATGPT, description: TOO_OLD }, { timeout: 4000 })).toBeTruthy();
    expect(lineUnder(CHATGPT)).toHaveLength(1);
    expect(seen()).not.toMatch(/AppData|codex\.exe/);
    await press(CHATGPT);
    await waitFor(() => expect((screen.getByRole('button', { name: CHATGPT }) as HTMLButtonElement).disabled).toBe(false));
    expect(made(calls, 'venture.ai.login.start')).toHaveLength(0);
    expect(made(calls, 'venture.ai.setup.trust')).toHaveLength(0);
    expect(made(calls, 'venture.ai.connect')).toHaveLength(0);
  });

  it('the browser version: "Do this inside the Chausar app." under the button, and nothing is started', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.reviewCodex();
    engine.firstRun.codexDialog('missing');
    const { calls } = start(engine);
    await press(CHATGPT);
    expect(await screen.findByRole('button', { name: CHATGPT, description: 'Do this inside the Chausar app.' })).toBeTruthy();
    expect(lineUnder(CHATGPT)).toHaveLength(1);
    expect(screen.getByRole('alert').textContent).toBe('Do this inside the Chausar app.');
    expect(made(calls, 'venture.ai.login.start')).toHaveLength(0);
    expect(made(calls, 'venture.ai.connect')).toHaveLength(0);
  });

  // A2 second review: Cancel in main's own dialog changes nothing, and the step says so calmly, not as an error.
  it('Cancel in Chausar\'s own dialog says nothing changed, calmly, and starts nothing', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.reviewCodex();
    engine.firstRun.codexDialog('cancel');
    const { calls } = start(engine);
    await press(CHATGPT);
    const said = await screen.findByText("Nothing changed. Codex wasn't chosen.");
    expect(said.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(lineUnder(CHATGPT)).toHaveLength(1);
    expect((screen.getByRole('button', { name: CHATGPT }) as HTMLButtonElement).disabled).toBe(false);
    expect(made(calls, 'venture.ai.login.start')).toHaveLength(0);
    expect(made(calls, 'venture.ai.connect')).toHaveLength(0);
  });

  it('a Codex that says it is signed in but fails the tiny test shows why, and a click looks again without connecting (A2)', async () => {
    const FAILED = 'Codex has used up your plan for now. Wait for it to reset, or choose another AI under Connections, Your AI.';
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    engine.firstRun.failTest(FAILED);
    const { calls } = start(engine);
    expect(await screen.findByRole('button', { name: CHATGPT, description: FAILED }, { timeout: 4000 })).toBeTruthy();
    expect(lineUnder(CHATGPT)).toHaveLength(1);
    expect(screen.getAllByText(FAILED)).toHaveLength(1);
    const looks = made(calls, 'venture.ai.tools').length;
    await press(CHATGPT);
    await waitFor(() => expect(made(calls, 'venture.ai.tools').length).toBe(looks + 1));
    await waitFor(() => expect((screen.getByRole('button', { name: CHATGPT }) as HTMLButtonElement).disabled).toBe(false));
    expect(made(calls, 'venture.ai.login.start')).toHaveLength(0);
    expect(made(calls, 'venture.ai.connect')).toHaveLength(0);
    expect(screen.getByRole('heading', { level: 1, name: 'Connect your AI' })).toBeTruthy();
  });

  it('a connection the engine refuses says so under the button, and the same button tries again (B4)', async () => {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    const fake = createFakeClient(engine);
    let refuse = true;
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.ai.connect' && refuse
      ? Promise.reject(new EngineError('MODEL_UNAVAILABLE', "Chausar's reviewed setup for Codex isn't on this computer yet."))
      : fake.request(method as never, params as never))) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await press(CHATGPT);
    await waitFor(() => expect(screen.getByRole('alert').textContent).toBe("Chausar's reviewed setup for Codex isn't on this computer yet."));
    expect(lineUnder(CHATGPT)).toHaveLength(1);
    expect(screen.getByRole('button', { name: CHATGPT, description: "Chausar's reviewed setup for Codex isn't on this computer yet." })).toBeTruthy();
    refuse = false;
    await press(CHATGPT);
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' }, { timeout: 4000 })).toBeTruthy();
  });

  it('a look at this computer that fails says so once, with Try again', async () => {
    const { calls } = startWith((tool) => tool, new FakeEngine({ fresh: true }), { 'venture.ai.tools': new EngineError('MODEL_UNAVAILABLE', 'Chausar could not look at this computer. Try again.') });
    const alert = await screen.findByRole('alert', {}, { timeout: 4000 });
    expect(alert.textContent).toBe('Chausar could not look at this computer. Try again.');
    const looks = made(calls, 'venture.ai.tools').length;
    await press(firstRun['first-run.ai.tryAgain']);
    await waitFor(() => expect(made(calls, 'venture.ai.tools').length).toBeGreaterThan(looks));
  });
});

describe('first run, step 1: More options holds the key and the way on without AI', () => {
  it('is closed at rest, and holds exactly the two other ways', async () => {
    start();
    const fold = await moreOptions();
    expect(fold.open).toBe(false);
    expect(within(fold).getAllByRole('button').map((button) => button.textContent)).toEqual(['Use an AI key instead', 'Continue without AI for now']);
    // "Open a business you already have" stays where the first run puts it, outside the fold.
    expect(fold.contains(screen.getByRole('button', { name: 'Open a business you already have' }))).toBe(false);
  });

  it('Use an AI key instead opens the same key form; a key not yet working says so by its button (B4)', async () => {
    start();
    const fold = await openMore();
    await act(async () => { fireEvent.click(within(fold).getByRole('button', { name: 'Use an AI key instead' })); });
    const panel = await within(fold).findByRole('region', { name: firstRun['first-run.ai.key.name'] });
    expect(await within(panel).findByRole('heading', { name: 'Your AI' })).toBeTruthy();
    await act(async () => { fireEvent.click(within(panel).getByRole('button', { name: firstRun['first-run.ai.keyContinue'] })); });
    await waitFor(() => expect(within(panel).getByRole('alert').textContent).toBe(firstRun['first-run.ai.keyFirst']));
    // One filled button a view: while the key form is open, its Continue is the filled one.
    expect(screen.getByRole('button', { name: CHATGPT }).getAttribute('data-variant')).toBe('secondary');
  });

  it('Continue without AI for now goes on with templates', async () => {
    const { calls } = start();
    await skipAi();
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' })).toBeTruthy();
    expect(within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem')[0]!.textContent).toBe('No AI yet');
    expect(made(calls, 'venture.ai.connect')).toHaveLength(0);
  });
});

describe('first run, step 2: About you, A that becomes B', () => {
  it('opens as A: the message box, the country from the time zone, and the eleven field tiles', async () => {
    timeZone('Asia/Kolkata');
    start();
    await skipAi();
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Tell Chausar about your work' })).toBeTruthy();
    expect(await screen.findByText('India, from your time zone')).toBeTruthy();
    expect(await screen.findByRole('button', { name: /^Money and tax/ })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: /^(Money and tax|Teaching and coaching|Creative work|Writing and content|Local services|Documents and reports|Research and analysis|People and careers|Shop and back office|Tech services|Licensed work)/ })).toHaveLength(11);
    expect(screen.getByRole('button', { name: /^Something else/ })).toBeTruthy();
  });

  it('does not change while the owner types; Send turns it into B with one motion, and Back to fields returns to A', async () => {
    reducedMotion(false);
    const { calls } = start();
    await skipAi();
    const box = await screen.findByRole('textbox', { name: 'Tell Chausar about your work' });
    fireEvent.change(box, { target: { value: CA.slice(0, 20) } });
    fireEvent.change(box, { target: { value: CA } });
    expect(screen.queryByRole('region', { name: 'Talk to Chausar' })).toBeNull();
    expect(calls.some(([method]) => method === 'venture.about.read')).toBe(false);
    await press('Send');
    const chat = await screen.findByRole('region', { name: 'Talk to Chausar' });
    const preview = screen.getByRole('region', { name: 'Your business, live' });
    expect(chat.closest('[data-motion]')?.getAttribute('data-motion')).toBe('once');
    expect(chat.className).toMatch(/rise/);
    expect(preview.className).toMatch(/slide/);
    expect(within(chat).getByText(CA)).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.about.read')?.[1]).toEqual({ text: CA });
    // No AI is connected: the keyword guess picks Money and tax and says so; offers carry no amount.
    expect(await within(chat).findByText('No AI is connected, so this plan comes from templates for Money and tax.')).toBeTruthy();
    expect(within(preview).getByText('Monthly books')).toBeTruthy();
    expect(preview.textContent).not.toMatch(/₹|\d/);
    await press('Back to fields');
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' })).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Tell Chausar about your work' }) as HTMLTextAreaElement).value).toBe(CA);
  });

  it('a read that fails says so in the preview, not that it is updating or reading (B3)', async () => {
    reducedMotion(false);
    const engine = new FakeEngine({ fresh: true });
    const fake = createFakeClient(engine);
    const client: EngineClient = {
      ...fake,
      request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.about.read'
        ? Promise.reject(new EngineError('MODEL_UNAVAILABLE', 'Your AI did not answer. Try again in a moment.', undefined, true))
        : fake.request(method as never, params as never))) as EngineClient['request'],
    };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await skipAi();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: CA } });
    await press('Send');
    // B4: the failure is Chausar's turn in the chat, with its way on; the preview only says it stopped.
    const chat = await screen.findByRole('region', { name: firstRun['first-run.about.chat'] });
    await waitFor(() => expect(within(chat).getByRole('alert').textContent).toBe('Your AI did not answer. Try again in a moment.'));
    expect(chat.querySelector('[data-failed-turn]')).toBeTruthy();
    expect(within(chat).getByRole('button', { name: firstRun['first-run.ai.tryAgain'] })).toBeTruthy();
    const preview = screen.getByRole('region', { name: 'Your business, live' });
    expect(within(preview).getByText(firstRun['first-run.about.stopped'])).toBeTruthy();
    expect(within(preview).queryByRole('alert')).toBeNull();
    expect(screen.queryByText(firstRun['first-run.about.updating'])).toBeNull();
    expect(screen.queryByText(firstRun['first-run.about.reading'])).toBeNull();
    expect(screen.getAllByText('Your AI did not answer. Try again in a moment.')).toHaveLength(1);
  });

  it('moves nothing with reduced motion', async () => {
    reducedMotion(true);
    start();
    await skipAi();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: CA } });
    await press('Send');
    const chat = await screen.findByRole('region', { name: 'Talk to Chausar' });
    expect(chat.closest('[data-motion]')?.getAttribute('data-motion')).toBe('none');
  });

  it('a tile goes straight to the plan with no chat, and the field can be corrected there', async () => {
    const { calls } = start();
    await skipAi();
    const steps = () => within(screen.getByRole('list', { name: 'Setup steps' })).getAllByRole('listitem');
    expect(steps().map((step) => step.getAttribute('aria-current'))).toEqual([null, 'step', null]);
    await press(/^Teaching and coaching/);
    const preview = await screen.findByRole('region', { name: 'Your business, live' });
    // C1 task 11 (row 10): the plan card titled "Your business" sits under step 3, "Your business".
    expect(steps().map((step) => step.getAttribute('aria-current'))).toEqual([null, null, 'step']);
    expect(screen.queryByRole('region', { name: 'Talk to Chausar' })).toBeNull();
    expect(within(preview).getByText('Weekly classes')).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.about.pick')?.[1]).toEqual({ familyId: 'teaching' });
    await act(async () => { fireEvent.change(within(preview).getByRole('combobox', { name: 'Field' }), { target: { value: 'creative' } }); });
    expect(await within(preview).findByText('Video edits')).toBeTruthy();
    await press('Back to fields');
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' })).toBeTruthy();
  });
});

describe('first run: the side-work question (6C6, DECISIONS D5)', () => {
  it('asks it once the field is kept, locks Continue until answered, and records the answer after the business is made', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    // A5: the field's professions come first; "None of these" keeps the field, which this test is about.
    await confirmProfession();
    const check = await screen.findByRole('region', { name: 'Day job and rules' }, { timeout: 4000 });
    expect(screen.getByRole('heading', { level: 1, name: 'Day job and rules' })).toBeTruthy();
    expect(within(check).getByRole('radiogroup', { name: 'Does your employment contract allow side work? This is your responsibility.' })).toBeTruthy();
    expect(within(check).getByText('Chausar does not read your contract. You decide, and you are responsible for it.')).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.compliance.get')?.[1]).toEqual({ profession: 'teaching' });
    // Nothing is kept yet: the vault waits for the answer.
    expect(calls.some(([method]) => method === 'workspace.create')).toBe(false);
    expect(within(check).getByRole('button', { name: 'Continue', description: 'Locked. Answer the question first.' }).getAttribute('aria-disabled')).toBe('true');
    // B4: the lock alone says it: no extra line under the button.
    expect(within(check).queryByText('Answer the question first.')).toBeNull();
    await act(async () => { fireEvent.click(within(check).getByRole('radio', { name: 'I am not sure' })); });
    await act(async () => { fireEvent.click(within(check).getByRole('button', { name: 'Continue' })); });
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    const made = calls.findIndex(([method]) => method === 'venture.create');
    const set = calls.findIndex(([method]) => method === 'venture.compliance.set');
    expect(made).toBeGreaterThan(-1);
    expect(set).toBeGreaterThan(made);
    expect(calls[set]![1]).toMatchObject({ profession: 'teaching', sideWork: 'not-sure' });
  }, 20000);
});

describe('first run, step 3: Connect what your business needs', () => {
  it('keeps the plan, saves the field, lists the services with honest labels, and skipping everything opens Today', async () => {
    timeZone('Asia/Kolkata');
    const { calls } = start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    // The fake computer keeps its key: no passphrase, and the recovery code only on hosted.
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    expect(calls.find(([method]) => method === 'venture.create')?.[1]).toMatchObject({ idea: 'Tuition classes and lessons for students and adult learners', countryCode: 'IN' });
    expect(calls.find(([method]) => method === 'venture.owner.set')?.[1]).toEqual({ familyId: 'teaching' });
    const list = await screen.findByRole('list', { name: 'Services for Teaching and coaching' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('[class*="needName"]')?.textContent)).toEqual(['Google Calendar', 'WhatsApp', 'Razorpay', 'Tally forms', 'Telegram alerts', 'Phone approvals']);
    expect(within(rows[0]!).getByText('Reads')).toBeTruthy();
    expect(within(rows[0]!).getByRole('button', { name: 'Set up' })).toBeTruthy();
    // A planned service says what it waits on and offers nothing to connect.
    expect(within(rows[4]!).getByText('Planned')).toBeTruthy();
    expect(within(rows[4]!).queryByRole('button')).toBeNull();
    // No row has a Skip of its own: Go to Today is the one click that skips them all.
    expect(within(list).queryByRole('button', { name: 'Skip' })).toBeNull();
    await press('Go to Today');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect(await screen.findByRole('navigation', {}, { timeout: 4000 })).toBeTruthy();
  });
});

describe('the fresh first run, walked to Today (6J4 guide walk)', () => {
  it('after Sign in with ChatGPT, Today has no Connect your AI card: the AI came along into the business', async () => {
    timeZone('Asia/Kolkata');
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    start(engine);
    await press(CHATGPT);
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    await press('Go to Today');
    await waitFor(() => expect(window.location.hash).toBe('#/today'));
    expect((await screen.findAllByText('Your plan is ready. Read it.', {}, { timeout: 4000 })).length).toBeGreaterThan(0);
    expect(screen.queryAllByText('Connect your AI')).toEqual([]);
    // As the engine's handover does: the business has the AI, and the draft desk is wiped.
    const models = await engine.request('venture.models.status', {}) as ModelStatusLite;
    expect(models.tiers.main.presetId).toBe('codex-cli');
    expect(models.connections.filter((c) => c.status === 'connected').map((c) => c.presetId)).toEqual(['codex-cli']);
    expect(((await engine.request('venture.ai.status', {})) as ModelStatusLite).connections).toEqual([]);
  }, 20000);

  it('skipping the AI still leaves the Connect your AI card on Today', async () => {
    timeZone('Asia/Kolkata');
    start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    await press('Go to Today');
    expect((await screen.findAllByText('Connect your AI', {}, { timeout: 4000 })).length).toBeGreaterThan(0);
  }, 20000);
});

describe('Connections: the services this business needs', () => {
  it('lists the same services on their own page, with a quiet way there from Connections', async () => {
    window.location.hash = '#/connections';
    render(<App client={createFakeClient(new FakeEngine({ now: () => '2026-10-23T13:35:00.000Z' }))} language="en" />);
    const link = await screen.findByRole('link', { name: 'Services you need' }, { timeout: 4000 });
    expect(link.getAttribute('href')).toBe('#/connections/needs');
    await act(async () => { window.location.hash = '#/connections/needs'; });
    const list = await screen.findByRole('list', { name: /^Services for/ }, { timeout: 4000 });
    expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(0);
    // Nothing to skip here: the list stays for later.
    expect(within(list).queryByRole('button', { name: 'Skip' })).toBeNull();
  });
});

describe('first run: buttons that say why (B4)', () => {
  it('Send waits for words or a file', async () => {
    start();
    await skipAi();
    const box = await screen.findByRole('textbox', { name: 'Tell Chausar about your work' });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(box, { target: { value: CA } });
    expect((screen.getByRole('button', { name: 'Send' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('Keep this plan says to pick a field when the AI could not tell it', async () => {
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const read = { family: null, offers: [], country: null, evidence: null, idea: null, source: 'ai' as const };
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.about.read' ? Promise.resolve(structuredClone(read)) : fake.request(method as never, params as never))) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await skipAi();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: CA } });
    await press('Send');
    const keep = await screen.findByRole('button', { name: 'Keep this plan', description: 'Pick a field first' });
    expect((keep as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('one-shot A1 row 3: the plan saved is the plan shown', () => {
  it('Keep this plan saves exactly the name and offers the card showed, with a neutral price unit', async () => {
    timeZone('Asia/Kolkata');
    const fake = createFakeClient(new FakeEngine({ fresh: true }));
    const read = {
      family: { id: 'creative', label: 'Creative work', line: 'Design, photos, video and writing.' },
      offers: [
        { name: 'Birthday party photography', line: 'Candid photos of the party, edited and shared.' },
        { name: 'Shop product photos', line: 'Clean photos of what a shop sells.' },
        { name: 'Monthly photo support', line: 'A set of photos each month for a shop.' },
      ],
      country: null, evidence: null, idea: 'Photography for parties and shops in Pune', source: 'ai' as const,
    };
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => (method === 'venture.about.read' ? Promise.resolve(structuredClone(read)) : fake.request(method as never, params as never))) as EngineClient['request'] };
    window.location.hash = '#/today';
    render(<App client={client} language="en" />);
    await skipAi();
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: 'I run a small weekend photography studio in Pune.' } });
    await press('Send');
    expect(await screen.findByText('Birthday party photography')).toBeTruthy();
    // C4 task 1: the name is a field now, holding the suggested name.
    const shownName = await waitFor(() => { const value = (document.querySelector('[data-plan-name]') as HTMLInputElement).value; expect(value.length).toBeGreaterThan(0); return value; });
    const keep = await screen.findByRole('button', { name: 'Keep this plan' });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await answerSideWork();
    expect(await screen.findByRole('heading', { level: 1, name: 'Connect what your business needs' }, { timeout: 4000 })).toBeTruthy();
    const plan = (await fake.request('venture.blueprint.get', {}))!;
    expect(plan.blueprint.offers.map((offer) => offer.name.value)).toEqual(['Birthday party photography', 'Shop product photos', 'Monthly photo support']);
    expect(plan.blueprint.offers[0]!.description.value).toBe('Candid photos of the party, edited and shared.');
    expect(plan.blueprint.name.value).toBe(shownName);
    // Review of A1 (row 3): no template offer is left and no per month. The reading here was scripted, so this business
    // holds no AI call that read the owner, and (A1 re-review) the words are labelled the template's, not the AI's.
    expect(plan.blueprint.source).toBe('template');
    expect(plan.blueprint.offers.every((offer) => offer.name.by === 'template' && offer.pricing.model === 'project')).toBe(true);
    expect(plan.blueprint.version).toBe(1);
  });
});

/*
 * One-shot C4 task 2: an optional first name on About you, kept in the first run only, and saved once the business is
 * open, so Today greets the owner by name. Left empty, nothing is written.
 */
describe('first run: a first name in About you (C4 task 2)', () => {
  const at = (hour: number, minute = 0) => () => new Date(Date.UTC(2026, 9, 23, hour, minute) - 330 * 60_000);
  function startAt() {
    timeZone('Asia/Kolkata');
    window.location.hash = '#/today';
    const fake = createFakeClient(new FakeEngine({ fresh: true, now: () => at(19, 5)().toISOString() }));
    const calls: [string, Record<string, unknown>][] = [];
    const client: EngineClient = { ...fake, request: ((method: string, params?: Record<string, unknown>) => { calls.push([method, structuredClone(params ?? {})]); return fake.request(method as never, params as never); }) as EngineClient['request'] };
    render(<ClockProvider now={at(19, 5)}><App client={client} language="en" /></ClockProvider>);
    return calls;
  }
  async function keepToToday(firstName: string) {
    await skipAi();
    if (firstName) fireEvent.change(await screen.findByRole('textbox', { name: 'Your first name' }), { target: { value: firstName } });
    fireEvent.change(await screen.findByRole('textbox', { name: 'Tell Chausar about your work' }), { target: { value: 'Tuition classes for school students in Pune.' } });
    await press('Send');
    const keep = await screen.findByRole('button', { name: 'Keep this plan' }, { timeout: 4000 });
    await waitFor(() => expect(keep.hasAttribute('disabled')).toBe(false));
    await act(async () => { fireEvent.click(keep); });
    await answerSideWork();
    await press('Go to Today');
  }

  it('a typed name greets the owner on Today', async () => {
    const calls = startAt();
    await keepToToday('Asha');
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening, Asha' }, { timeout: 4000 })).toBeTruthy();
    expect(calls.some(([method, params]) => method === 'venture.owner.set' && params.firstName === 'Asha')).toBe(true);
  });

  it('left empty, no first name is written', async () => {
    const calls = startAt();
    await keepToToday('');
    expect(await screen.findByRole('heading', { level: 1, name: 'Good evening' }, { timeout: 4000 })).toBeTruthy();
    expect(calls.some(([method, params]) => method === 'venture.owner.set' && 'firstName' in params)).toBe(false);
  });
});

/*
 * One-shot C4 task 4: a Codex that fails still leaves three ways on (the same button to try again, Sign in with Claude
 * when Claude Code is signed in here, Continue without AI for now under More options), and the services step says how
 * many are set up.
 */
describe('first run: ways on after a Codex failure, and the services count (C4 task 4)', () => {
  const FAILED = 'Codex has used up your plan for now. Wait for it to reset, or choose another AI under Connections, Your AI.';
  function startFailed(claudeSignedIn: boolean) {
    const engine = new FakeEngine({ fresh: true });
    engine.firstRun.signIn();
    engine.firstRun.failTest(FAILED);
    return startWith(claudeSignedIn ? claudeFound('yes') : (tool) => tool, engine).calls;
  }

  it('with Claude Code signed in: Sign in with Claude connects it', async () => {
    const calls = startFailed(true);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    await press(CLAUDE);
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' }, { timeout: 4000 })).toBeTruthy();
    expect(calls.some(([method, params]) => method === 'venture.ai.connect' && params.presetId === 'claude-code-cli')).toBe(true);
  });

  it('with Claude Code absent: the way on without AI is under More options', async () => {
    startFailed(false);
    expect(await screen.findByText(FAILED)).toBeTruthy();
    await skipAi();
    expect(await screen.findByRole('heading', { level: 1, name: 'What work do you do?' }, { timeout: 4000 })).toBeTruthy();
  });

  // Simplified on the founder's word (14 Nov 2026): no count and no Skip on each row. Set up opens the card's own
  // guide under its row, so setup never moves; one line says all of it is optional, and Go to Today is always there.
  it('the services step opens a card\'s setup in place, and never leaves setup', async () => {
    timeZone('Asia/Kolkata');
    start();
    await skipAi();
    await press(/^Teaching and coaching/);
    await press('Keep this plan');
    await answerSideWork();
    const list = await screen.findByRole('list', { name: 'Services for Teaching and coaching' }, { timeout: 4000 });
    expect(screen.getByText('All optional. They stay in Connections for later.')).toBeTruthy();
    expect(screen.queryByText(/set up\. You can do this later/)).toBeNull();
    const calendar = within(list).getAllByRole('listitem')[0]!;
    await act(async () => { fireEvent.click(within(calendar).getByRole('button', { name: 'Set up' })); });
    const flow = await within(calendar).findByRole('group', { name: 'Set up Google Calendar' });
    // The fake's sample cards do not hold this one; first-run-needs.test.tsx reads a card's guide here.
    expect(await within(flow).findByText("This connection isn't listed.")).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Connect what your business needs' })).toBeTruthy();
    expect(window.location.hash).toBe('#/today');
    expect(screen.queryByRole('navigation')).toBeNull();
    await act(async () => { fireEvent.click(within(flow).getByRole('button', { name: 'Close' })); });
    expect(within(calendar).queryByRole('group', { name: 'Set up Google Calendar' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Go to Today' })).toBeTruthy();
  });
});
