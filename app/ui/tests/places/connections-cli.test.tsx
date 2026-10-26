import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { MODEL_PRESETS } from '../../src/engine/fixtures-business';
import { EngineError, type AgentView, type CliStatusView, type EngineClient, type MethodName, type ModelPresetLite, type RoleModelView } from '../../src/engine/types';
import { assertInkRules } from '../helpers/ink-rules';

/**
 * Your AI with the real CLI status (W4 4H2; spec 5.3 and 8; catalogue K10, M19). The engine (4H1) looks at the owner's
 * Claude Code and Codex on this computer and says what it found: where (one step away), the version, whether its help
 * lists every flag Chausar sends, whether it is signed in (only from the tool's own status command), the Claude Code
 * terms, the last real task, one line and one fix. The screen shows exactly that, never a fake success; "Check again"
 * asks for a fresh look. The hosted app uses keys only, in the engine's words. A preset the engine refuses with
 * CLI_FLAGS_UNSUPPORTED cannot be connected. In the agent panel each role lists the AI that serves its kind of job and
 * that AI's price line.
 */

type Intercept = (params: unknown, original: () => Promise<unknown>) => unknown;
interface Start { hash?: string; language?: 'en' | 'hi'; hosted?: boolean; engine?: FakeEngine; intercept?: Partial<Record<MethodName, Intercept>> }
function start({ hash = '#/connections', language = 'en', hosted = false, engine, intercept = {} }: Start = {}) {
  window.location.hash = hash;
  const fake = createFakeClient(engine ?? new FakeEngine(hosted ? { hosted: true } : undefined));
  const request = fake.request.bind(fake);
  const calls: { method: string; params: unknown }[] = [];
  const client: EngineClient = {
    ...fake,
    transport: hosted ? 'hosted' : fake.transport,
    request: ((method: MethodName, params?: unknown) => {
      calls.push({ method, params });
      const own = intercept[method];
      if (own) return Promise.resolve().then(() => own(params, () => request(method, params as never)));
      return request(method, params as never);
    }) as EngineClient['request'],
  };
  render(<App client={client} language={language} />);
  return { calls, engine: fake.engine };
}

/** A region by its heading's words, checked to be named by it (a role query over the whole page is slow in jsdom). */
async function region(title: string, selector = 'h2'): Promise<HTMLElement> {
  const heading = await screen.findByText(title, { selector });
  const section = heading.closest('section') as HTMLElement;
  expect(section.getAttribute('aria-labelledby')).toBe(heading.id);
  return section;
}
/** One tool's card in the CLI tile, by its name. */
const tool = (section: HTMLElement, name: string) => within(section).getByText(name, { selector: 'h3' }).closest('li') as HTMLElement;
/** The facts behind a tool's disclosure, as label: value pairs. */
function facts(card: HTMLElement): Record<string, string> {
  const out: Record<string, string> = {};
  for (const term of card.querySelectorAll('dt')) out[term.textContent ?? ''] = term.nextElementSibling?.textContent ?? '';
  return out;
}

const SEEN: CliStatusView = {
  cli: 'codex', label: 'Codex', found: true, path: 'C:\\Tools\\codex\\codex.exe', version: '0.131.0', flags: 'match', missingFlags: [], signedIn: 'unknown',
  terms: 'not-needed', lastTask: null, state: 'unverified',
  line: "Codex 0.131.0 is on this computer. Chausar can't check your sign-in without running a task. It will say so if the first task fails.", fix: null,
};
const MISMATCH: CliStatusView = {
  ...SEEN, flags: 'mismatch', missingFlags: ['--output-schema', '--sandbox'], state: 'needs-setup',
  line: "Your Codex 0.131.0 doesn't know --output-schema and --sandbox.", fix: 'Update it, or use an OpenAI key.',
};
// Only Codex ran: Claude Code is located, never run, behind the terms gate (cli-status.ts cliListLine).
const LIST_LINE = 'Chausar ran only the version, help and sign-in commands of Codex on this computer. It never reads its sign-in files or keys.';
const CODEX_FIX = "Chausar's reviewed setup for Codex isn't on this computer yet. Use an OpenAI key for now.";

describe('the fake engine answers the CLI status and the role models as the engine does', () => {
  it('on the desktop: Claude Code waits on the terms (located, never run) and Codex on its reviewed setup, in that order', async () => {
    const answer = (await new FakeEngine().request('venture.models.cli.status', {})) as { clis: CliStatusView[]; line: string };
    expect(answer.line).toBe(LIST_LINE);
    expect(answer.clis.map((c) => c.cli)).toEqual(['claude-code', 'codex']);
    const [claude, codex] = answer.clis as [CliStatusView, CliStatusView];
    expect(claude).toMatchObject({
      label: 'Claude Code', terms: 'pending', version: null, flags: 'unknown', signedIn: 'unknown', state: 'needs-setup', lastTask: null,
      line: "Chausar hasn't yet accepted Anthropic's terms for running Claude Code.", fix: 'Use an Anthropic key for now.',
    });
    expect(codex).toMatchObject({ label: 'Codex', terms: 'not-needed', flags: 'match', state: 'needs-setup', fix: CODEX_FIX });
    // The home folder shows as ~ (cli-status.ts homePath).
    expect(claude.path).toBe('~\\.local\\bin\\claude.exe');
    // The preset list says the same thing the status does.
    expect(MODEL_PRESETS.find((p) => p.id === 'claude-code-cli')!.availabilityReason).toBe(`${claude.line} ${claude.fix}`);
    expect(MODEL_PRESETS.find((p) => p.id === 'codex-cli')!.availabilityReason).toBe(codex.fix);
    // Never signed in without the tool's own status command saying so, and never ready before a real task worked.
    for (const view of answer.clis) {
      expect(view.state).not.toBe('ready');
      expect(view.found || view.path === null).toBe(true);
    }
  });

  it('refuses a payload it does not take, and the hosted app looks at nothing', async () => {
    await expect(new FakeEngine().request('venture.models.cli.status', { fresh: 'yes' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(new FakeEngine().request('venture.models.cli.status', { other: true })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Send the required fields and nothing else.' });
    await expect(new FakeEngine({ hosted: true }).request('venture.models.cli.status', {})).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE', message: 'The hosted app uses keys only.' });
  });

  it("roles: each agent's tiers with the AI serving them and its price line; with only templates, agents wait on Connect your AI", async () => {
    const lumen = (await new FakeEngine().request('venture.models.roles', {})) as { roles: RoleModelView[]; line: string };
    expect(lumen.roles.length).toBeGreaterThan(0);
    for (const role of lumen.roles) {
      for (const tier of role.tiers) expect(tier).toMatchObject({ presetId: 'built-in-templates', usable: false, price: 'Free. Nothing is sent to any AI.' });
    }
    expect(lumen.line).toContain('A different AI for each role is not offered.');
    expect(lumen.line).toContain('Connect your AI: until then, agents that need it wait.');
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const ledgerline = (await engine.request('venture.models.roles', {})) as { roles: RoleModelView[]; line: string };
    const fast = ledgerline.roles.flatMap((r) => r.tiers).find((tier) => tier.tier === 'fast')!;
    expect(fast).toMatchObject({ presetId: 'anthropic-haiku-5-5', usable: true, price: 'USD 0.1000 in, USD 0.5000 out per million tokens. Anthropic list price for prompts up to 100K tokens, checked 15 Oct 2026.' });
    expect(ledgerline.line).not.toContain('Connect your AI');
  });
});

describe('Your AI: Your AI apps', () => {
  it('lists Claude Code and Codex with their state and, while not ready, the one fix at rest; the line and facts one fold away', async () => {
    start();
    const section = await region('Your AI apps');
    await within(section).findByText('Claude Code', { selector: 'h3' });
    const claude = tool(section, 'Claude Code');
    // The terms gate is pending: said plainly, never drawn as available.
    expect(claude.querySelector('[data-cli-state]')!.getAttribute('data-cli-state')).toBe('needs-setup');
    expect(claude.textContent).toContain('Needs setup');
    expect(claude.textContent).not.toContain('Ready');
    expect(claude.textContent).toContain("Chausar hasn't yet accepted Anthropic's terms for running Claude Code.");
    expect(claude.querySelector('[data-fix-line]')!.textContent).toBe('Use an Anthropic key for now.');
    // Not ready: the fix is the next step, at rest; the engine's line and the facts are one fold away.
    const fold = claude.querySelector('details')!;
    expect(fold.open).toBe(false);
    expect(fold.contains(claude.querySelector('[data-fix-line]'))).toBe(false);
    expect(fold.contains(within(claude).getByText("Chausar hasn't yet accepted Anthropic's terms for running Claude Code."))).toBe(true);
    fireEvent.click(within(claude).getByText('Details'));
    expect(facts(claude)).toMatchObject({ Found: 'Yes', Version: 'Not read', Flags: 'Not checked', 'Signed in': "Can't tell yet", 'Anthropic terms': 'Not yet accepted by Chausar', 'Last task': 'None yet' });
    const codex = tool(section, 'Codex');
    expect(codex.textContent).toContain('Codex 0.131.0 is on this computer. Chausar runs it only through the reviewed Codex setup.');
    expect(codex.querySelector('[data-fix-line]')!.textContent).toBe(CODEX_FIX);
    expect(codex.querySelector('details')!.textContent).toContain('C:\\Tools\\codex\\codex.exe');
    fireEvent.click(within(codex).getByText('Details'));
    expect(facts(codex)).toMatchObject({ Found: 'Yes', Where: 'C:\\Tools\\codex\\codex.exe', Version: '0.131.0', Flags: 'Knows every flag Chausar uses', 'Signed in': 'Yes' });
    // Codex is not behind any terms, so no terms line is drawn for it.
    expect(facts(codex)['Anthropic terms']).toBeUndefined();
    // What the look ran: once, for the tile, at rest.
    expect(section.querySelector('[data-cli-ran]')!.textContent).toBe(LIST_LINE);
    expect(section.textContent!.split(LIST_LINE)).toHaveLength(2);
    expect(section.querySelector('[data-cli-ran]')!.closest('details')).toBeNull();
    assertInkRules(document.body);
  });

  it('a tool whose last task failed says so on its chip, with the fix at rest', async () => {
    const failed: CliStatusView = {
      ...SEEN, signedIn: 'yes', lastTask: { at: '2026-10-23T09:00:00.000Z', outcome: 'failed' },
      line: 'Codex 0.131.0 is on this computer and signed in. Its last task failed.', fix: "Check that you're signed in to Codex, then try again.",
    };
    start({ intercept: { 'venture.models.cli.status': async (_params, original) => {
      const answer = (await original()) as { clis: CliStatusView[]; line: string };
      return { ...answer, clis: [answer.clis[0]!, failed] };
    } } });
    const section = await region('Your AI apps');
    await within(section).findByText('Last task failed');
    const codex = tool(section, 'Codex');
    expect(codex.querySelector('[data-cli-state] [data-tone]')!.getAttribute('data-tone')).toBe('wait');
    expect(codex.textContent).not.toContain('Not yet tried');
    expect(codex.querySelector('[data-fix-line]')!.textContent).toBe("Check that you're signed in to Codex, then try again.");
    fireEvent.click(within(codex).getByText('Details'));
    expect(facts(codex)['Last task']).toMatch(/^Failed, /);
  });

  it('a ready tool shows only its state at rest; what it found is one fold away', async () => {
    const ready: CliStatusView = { ...SEEN, signedIn: 'yes', lastTask: { at: '2026-10-23T09:00:00.000Z', outcome: 'succeeded' }, state: 'ready', line: 'Codex 0.131.0 is on this computer and signed in. Its last task worked.' };
    start({ intercept: { 'venture.models.cli.status': async (_params, original) => {
      const answer = (await original()) as { clis: CliStatusView[]; line: string };
      return { ...answer, clis: [answer.clis[0]!, ready] };
    } } });
    const section = await region('Your AI apps');
    await within(section).findByText('Ready');
    const codex = tool(section, 'Codex');
    const line = within(codex).getByText(ready.line);
    expect(line.closest('details')).not.toBeNull();
    expect(codex.querySelector('[data-fix-line]')).toBeNull();
  });

  it('Check again asks the engine for a fresh look and shows what it found now', async () => {
    let fresh = false;
    const { calls } = start({ intercept: { 'venture.models.cli.status': async (params, original) => {
      const answer = (await original()) as { clis: CliStatusView[]; line: string };
      if ((params as { fresh?: boolean }).fresh) fresh = true;
      return fresh ? { ...answer, clis: [answer.clis[0]!, SEEN] } : answer;
    } } });
    const section = await region('Your AI apps');
    await within(section).findByText('Codex', { selector: 'h3' });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Check again' })); });
    await waitFor(() => expect(tool(section, 'Codex').querySelector('[data-cli-state]')!.getAttribute('data-cli-state')).toBe('unverified'));
    const codex = tool(section, 'Codex');
    expect(codex.textContent).toContain('Not yet tried');
    // No fix: the engine's line is the next thing to read, at rest.
    expect(codex.querySelector('[data-fix-line]')).toBeNull();
    expect(within(codex).getByText(SEEN.line).closest('details')).toBeNull();
    fireEvent.click(within(codex).getByText('Details'));
    expect(facts(codex)['Signed in']).toBe("Can't tell yet");
    expect(calls.filter((c) => c.method === 'venture.models.cli.status').map((c) => c.params)).toEqual([{}, { fresh: true }]);
    expect(within(section).getByRole('status').textContent).toBe('Checked again just now.');
  });

  it('a tool that does not know a flag Chausar sends names the flags, with the engine fix', async () => {
    start({ intercept: { 'venture.models.cli.status': async (_params, original) => {
      const answer = (await original()) as { clis: CliStatusView[]; line: string };
      return { ...answer, clis: [answer.clis[0]!, MISMATCH] };
    } } });
    const section = await region('Your AI apps');
    await within(section).findByText("Your Codex 0.131.0 doesn't know --output-schema and --sandbox.");
    const codex = tool(section, 'Codex');
    expect(codex.querySelector('[data-fix-line]')!.textContent).toBe('Update it, or use an OpenAI key.');
    fireEvent.click(within(codex).getByText('Details'));
    expect(facts(codex).Flags).toBe("Doesn't know --output-schema, --sandbox");
  });

  it('a tool that is not installed says so, with nothing behind the disclosure but that', async () => {
    start({ intercept: { 'venture.models.cli.status': async (_params, original) => {
      const answer = (await original()) as { clis: CliStatusView[]; line: string };
      const missing: CliStatusView = { ...SEEN, found: false, path: null, version: null, flags: 'unknown', state: 'needs-setup', line: "Codex isn't installed on this computer.", fix: 'Install Codex and sign in to it, then check again.' };
      return { ...answer, clis: [answer.clis[0]!, missing] };
    } } });
    const section = await region('Your AI apps');
    await within(section).findByText("Codex isn't installed on this computer.");
    const codex = tool(section, 'Codex');
    fireEvent.click(within(codex).getByText('Details'));
    expect(facts(codex)).toEqual({ Found: 'No' });
  });

  it("the hosted app uses keys only: the engine's line, no Check again, and no AI app the engine says is unavailable", async () => {
    start({ hosted: true });
    const section = await region('Your AI apps');
    expect(await within(section).findByText('The hosted app uses keys only.')).toBeTruthy();
    expect(within(section).queryByRole('button', { name: 'Check again' })).toBeNull();
    expect(section.querySelector('[role="alert"]')).toBeNull();
    const ai = await region('Your AI');
    fireEvent.click(await within(ai).findByText('Every choice'));
    expect(ai.querySelector('[data-runs-on="this-computer"]')).toBeNull();
    expect(within(ai).queryByText('Claude Code on this computer')).toBeNull();
    expect(ai.querySelector('[data-runs-on="provider-api"]')).not.toBeNull();
  });

  it('a choice is hidden by what the engine says of it, not by where the app runs', async () => {
    start({ intercept: { 'venture.models.presets': async (_params, original) => {
      const presets = (await original()) as ModelPresetLite[];
      return presets.map((p) => (p.id === 'codex-cli' ? { ...p, availability: 'unavailable' as const, availabilityReason: 'Runs only in the desktop app.' } : p));
    } } });
    const ai = await region('Your AI');
    fireEvent.click(await within(ai).findByText('Every choice'));
    await within(ai).findByText('Claude Code on this computer');
    expect(within(ai).queryByText('Codex on this computer')).toBeNull();
  });

  it('a status Chausar cannot read is said as a problem, in its words', async () => {
    start({ intercept: { 'venture.models.cli.status': () => { throw new EngineError('CLI_UNAVAILABLE', "Chausar can't look for command-line tools here."); } } });
    const section = await region('Your AI apps');
    expect((await within(section).findByRole('alert')).textContent).toContain("Chausar can't look for command-line tools here.");
  });
});

describe('Your AI: a command-line AI the engine refuses', () => {
  const flagsWords = "Your Codex 0.131.0 doesn't know --output-schema and --sandbox. Update it, or use an OpenAI key.";
  const presetsWith = (codex: Partial<ModelPresetLite>): Intercept => async (_params, original) => {
    const presets = (await original()) as ModelPresetLite[];
    return presets.map((p) => (p.id === 'codex-cli' ? { ...p, ...codex } : p));
  };

  it('a preset that needs setup for its flags offers no Connect and shows the engine words', async () => {
    start({ intercept: { 'venture.models.presets': presetsWith({ availability: 'needs-setup', availabilityReason: flagsWords }) } });
    const ai = await region('Your AI');
    fireEvent.click(await within(ai).findByText('Every choice'));
    const codex = (await within(ai).findByText('Codex on this computer')).closest('li')!;
    expect(codex.querySelector('[data-fix-line]')!.textContent).toBe(flagsWords);
    expect(within(codex).queryByRole('button', { name: 'Connect' })).toBeNull();
  });

  it('Connect refused with CLI_FLAGS_UNSUPPORTED shows the engine words and connects nothing; a CLI asks for no key', async () => {
    const { calls } = start({ intercept: {
      'venture.models.presets': presetsWith({ availability: 'unverified', availabilityReason: 'Uses the reviewed Codex install. A past gpt-6-luna probe failed.' }),
      'venture.models.connect': () => { throw new EngineError('CLI_FLAGS_UNSUPPORTED', flagsWords); },
    } });
    const ai = await region('Your AI');
    fireEvent.click(await within(ai).findByText('Every choice'));
    const codex = (await within(ai).findByText('Codex on this computer')).closest('li')!;
    fireEvent.click(within(codex).getByRole('button', { name: 'Connect' }));
    expect(codex.querySelector('input[type="password"]')).toBeNull();
    fireEvent.click(within(codex).getByRole('checkbox', { name: 'I agree' }));
    await act(async () => { fireEvent.click(within(codex).getByRole('button', { name: 'Connect' })); });
    await waitFor(() => expect(within(codex).getByRole('alert').textContent).toBe(`Couldn't connect: ${flagsWords}`));
    expect(calls.filter((c) => c.method === 'venture.models.connect').map((c) => (c.params as { presetId: string }).presetId)).toEqual(['codex-cli']);
    expect(ai.textContent).not.toContain('Connected: Codex on this computer');
  });

  it('Check again reads the presets again, so Your AI and the status never disagree', async () => {
    let checked = false;
    start({ intercept: {
      'venture.models.cli.status': async (params, original) => { if ((params as { fresh?: boolean }).fresh) checked = true; return original(); },
      'venture.models.presets': async (_params, original) => {
        const presets = (await original()) as ModelPresetLite[];
        return checked ? presets.map((p) => (p.id === 'codex-cli' ? { ...p, availability: 'needs-setup' as const, availabilityReason: flagsWords } : p)) : presets;
      },
    } });
    const section = await region('Your AI apps');
    await within(section).findByText('Codex', { selector: 'h3' });
    await act(async () => { fireEvent.click(within(section).getByRole('button', { name: 'Check again' })); });
    const ai = await region('Your AI');
    fireEvent.click(within(ai).getByText('Every choice'));
    await waitFor(() => expect((within(ai).getByText('Codex on this computer').closest('li')!).querySelector('[data-fix-line]')!.textContent).toBe(flagsWords));
  });
});

describe('Team: which AI serves each role', () => {
  it("the agent panel lists the role's kinds of job with the AI that serves each and its price line, and how to change it", async () => {
    start({ hash: '#/team?sheet=agent:editor' });
    const panel = (await screen.findByText('Editor', { selector: 'aside h2' })).closest('aside') as HTMLElement;
    const ai = await region('Its AI', 'h3');
    expect(panel.contains(ai)).toBe(true);
    await within(ai).findByText(/^Quick work:/);
    expect(ai.textContent).toContain('Quick work: Built-in templates (no AI)');
    expect(ai.textContent).toContain('Free. Nothing is sent to any AI.');
    expect(ai.textContent).toContain('Connect your AI: until then, agents that need it wait.');
    // How a role's AI is chosen is the engine's line, one fold away.
    const how = within(ai).getByText("How each role's AI is chosen").closest('details')!;
    expect(how.open).toBe(false);
    expect(how.textContent).toContain('A different AI for each role is not offered.');
    expect(within(ai).getByRole('link', { name: 'Choose under Your AI' }).getAttribute('href')).toBe('#/connections/ai');
    assertInkRules(document.body);
  });

  it('with an AI connected, each kind of job names it with its list price as the engine writes it', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const team = (await engine.request('venture.team.list', {})) as { agents: AgentView[] };
    const first = team.agents[0]!;
    start({ hash: `#/team?sheet=agent:${first.id}`, engine });
    const ai = await region('Its AI', 'h3');
    await waitFor(() => expect(ai.textContent).toMatch(/Claude Haiku 5\.5|Claude Sonnet 5\.5/));
    // The price is the engine's list price line, without a receipt: marked as its words.
    const price = within(ai).getAllByText(/per million tokens/)[0]!;
    expect(price.closest('[data-engine-line]')).not.toBeNull();
    expect(ai.textContent).not.toContain('Connect your AI');
    assertInkRules(document.body);
  });

  it("the panel's run results say who wrote them, in the engine's words", async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    start({ hash: '#/team?sheet=agent:bookkeeper', engine });
    const panel = (await screen.findByText('Bookkeeper', { selector: 'aside h2' })).closest('aside') as HTMLElement;
    fireEvent.click(within(panel).getByRole('tab', { name: 'Runs' }));
    const run = (await within(panel).findByText('Matched September bank lines to invoices')).closest('li') as HTMLElement;
    expect(run.querySelector('[data-written-by]')?.textContent).toBe('Written by Claude Sonnet 5.5');
    assertInkRules(document.body);
  });

  it("Work's run sheet says who wrote the run's draft, after its other sections", async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    start({ hash: '#/work?sheet=run:27', engine });
    const sheet = (await screen.findByText('Matched September bank lines to invoices', { selector: 'aside h2' })).closest('aside') as HTMLElement;
    await waitFor(() => expect(sheet.querySelector('[data-written-by]')?.textContent).toBe('Written by Claude Sonnet 5.5'));
    assertInkRules(document.body);
  });

  it('a run the engine names no writer for claims none', async () => {
    start({ hash: '#/team?sheet=agent:researcher' });
    const panel = (await screen.findByText('Researcher', { selector: 'aside h2' })).closest('aside') as HTMLElement;
    fireEvent.click(within(panel).getByRole('tab', { name: 'Runs' }));
    const run = (await within(panel).findByText('Estimated reach for episode 14')).closest('li') as HTMLElement;
    expect(run.querySelector('[data-written-by]')).toBeNull();
  });

  it("an agent card shows the engine's Connect your AI while no AI can run", async () => {
    // Lumen has no AI connected, so its idle Publisher waits on one (the fake team follows the engine's rule).
    start({ hash: '#/team' });
    await waitFor(() => expect(screen.getAllByText('Connect your AI').length).toBeGreaterThan(0));
  });
});

describe('in Hindi', () => {
  it('the CLI tile and the agent panel speak Hindi, with the engine words kept as they are', async () => {
    start({ language: 'hi' });
    const section = await region('आपके AI ऐप');
    await within(section).findByText('Claude Code', { selector: 'h3' });
    expect(within(section).getByRole('button', { name: 'फिर से जाँचें' })).toBeTruthy();
    expect(section.textContent).toContain("Chausar hasn't yet accepted Anthropic's terms for running Claude Code.");
    expect(section.textContent).not.toMatch(/connections\.cli\./);
  });
});

vi.setConfig({ testTimeout: 15_000 });
