import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { AgentThreadView, PersonaView, TeamListView } from '../../src/engine/types';
import type { Language } from '../../src/text';
import { assertInkRules, assertOnePrimary } from '../helpers/ink-rules';

/*
 * W4 4J22b on Team, from 4J17, 4J18 and 4J12: the agent panel's Persona (how the agent talks, tried on the practice
 * clients with what that cost, set as a version only after the owner's second yes, undone with the view's undo),
 * Skills (each with a "Try this" starter that fills the chat box and never sends), Can do (what it can see, what it
 * can do, and what is off, each line with its honest state, in the engine's words), the agent file (Export, without
 * notes; an imported file is a change to accept in Chat), and helpers nested under the agent they help.
 */

type Fake = ReturnType<typeof createFakeClient>;
const NOW = '2026-10-26T09:00:00.000Z';

function start(hash: string, { engine = new FakeEngine({ now: () => NOW }), language = 'en', stub }: { engine?: FakeEngine; language?: Language; stub?: (method: string, params: unknown, real: unknown) => unknown } = {}) {
  window.location.hash = hash;
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  const spy = vi.fn(async (method: string, params?: unknown) => {
    const real = await request(method as never, params as never);
    const stubbed = stub?.(method, params, real);
    return stubbed === undefined ? real : stubbed;
  });
  client.request = spy as unknown as Fake['request'];
  render(<App client={client} language={language} />);
  return { spy, engine };
}

const settle = () => act(async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); });
const press = async (element: HTMLElement) => { await act(async () => { fireEvent.click(element); window.dispatchEvent(new HashChangeEvent('hashchange')); }); await settle(); };
const type = async (element: HTMLElement, value: string) => { await act(async () => { fireEvent.change(element, { target: { value } }); }); };
const calls = (spy: { mock: { calls: unknown[][] } }, method: string) => spy.mock.calls.filter(([m]) => m === method).map(([, p]) => p as Record<string, unknown>);
const panel = async (name: string) => (await screen.findByRole('complementary', { name })) as HTMLElement;
/** The open tab's panel, once what it reads has arrived. */
const tabPanel = async (name: string) => {
  const aside = await panel(name);
  const tab = await within(aside).findByRole('tabpanel');
  await waitFor(() => expect(tab.textContent).not.toMatch(/^Loading/));
  return tab;
};
/** How it talks: the persona, inside the Instructions tab (one row of tabs, the review of 26 Oct). */
const PERSONA = '#/team?sheet=agent:editor&tab=instructions';
/** How it talks is a closed fold in Instructions at rest; the owner opens it by its summary. */
const personaOf = async (name: string) => {
  const tab = await tabPanel(name);
  const fold = (await within(tab).findByText('How it talks', { selector: 'summary *, summary' })).closest('details') as HTMLDetailsElement;
  expect(fold.open).toBe(false);
  await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
  return (await within(fold).findByRole('region', { name: 'How it talks' })) as HTMLElement;
};

beforeEach(() => {
  Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:agent-file'), revokeObjectURL: vi.fn() });
});
afterEach(() => { window.location.hash = ''; vi.restoreAllMocks(); });

describe('the agent panel: Persona (W4 4J22b, from 4J17)', () => {
  it('sits in Instructions with every field, empty until the owner sets one, the engine\'s line, and Save locked until a change', async () => {
    start(PERSONA);
    const aside = await panel('Editor');
    expect(within(aside).getByRole('tab', { name: /^Instructions/ }).getAttribute('aria-selected')).toBe('true');
    const tab = await personaOf('Editor');
    for (const name of ['Tone', 'Greeting', 'Hand-off line', 'Topics it stays away from', 'Sign-off']) expect((within(tab).getByRole('textbox', { name }) as HTMLInputElement).value).toBe('');
    expect(within(tab).getByRole('combobox', { name: 'Reply length' })).toBeTruthy();
    expect(tab.textContent).toContain("Editor has no persona yet, so it talks the way its role says. Its role and the facts it uses stay the same whatever you set.");
    expect(within(tab).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    await type(within(tab).getByRole('textbox', { name: 'Tone' }), 'Calm');
    expect(within(tab).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBeNull();
    await type(within(tab).getByRole('textbox', { name: 'Tone' }), '');
    expect(within(tab).getByRole('button', { name: 'Save' }).getAttribute('aria-disabled')).toBe('true');
    assertInkRules(document.body);
    assertOnePrimary(tab);
  });

  it('Test tries the unsaved persona on the practice clients and shows what it cost; nothing is saved; a change clears it', async () => {
    const { spy } = start(PERSONA);
    const tab = await personaOf('Editor');
    await type(within(tab).getByRole('textbox', { name: 'Tone' }), 'Warm and brief');
    await type(within(tab).getByRole('textbox', { name: 'Greeting' }), 'Hi there');
    await press(within(tab).getByRole('button', { name: 'Test' }));
    expect(calls(spy, 'venture.persona.test')).toEqual([{ agent: 'editor', persona: { tone: 'Warm and brief', replyLength: null, greeting: 'Hi there', handOffLine: null, blockedTopics: [], signOff: null } }]);
    const results = within(tab).getByRole('list', { name: 'How it would reply' });
    expect(within(results).getAllByRole('listitem')).toHaveLength(3);
    expect(results.textContent).toContain('A clear request');
    expect(results.textContent).toContain('Hi there.');
    expect(tab.querySelector('[data-persona-cost]')!.textContent).toBe('It cost USD 0.0000.');
    expect(tab.textContent).toContain('Tried on 3 practice clients with built-in templates. Nothing was saved.');
    expect(calls(spy, 'venture.persona.set')).toEqual([]);
    assertInkRules(document.body);
    await type(within(tab).getByRole('textbox', { name: 'Tone' }), 'Warm');
    expect(within(tab).queryByRole('list', { name: 'How it would reply' })).toBeNull();
    expect(tab.querySelector('[data-persona-cost]')).toBeNull();
  });

  it('Save asks once more, then sets a version; Undo sets the version before, as the engine\'s view gives it', async () => {
    const { spy } = start(PERSONA);
    const tab = await personaOf('Editor');
    await type(within(tab).getByRole('textbox', { name: 'Tone' }), 'Warm and brief');
    await press(within(tab).getByRole('button', { name: 'Save' }));
    expect(calls(spy, 'venture.persona.set')).toEqual([]);
    expect(within(tab).getByText("Use this from Editor's next run?")).toBeTruthy();
    await press(within(tab).getByRole('button', { name: 'Yes, use it' }));
    expect(calls(spy, 'venture.persona.set')).toHaveLength(1);
    expect(within(tab).getByRole('status').textContent).toBe("Version 1 is in use from Editor's next run.");

    await type(within(tab).getByRole('textbox', { name: 'Tone' }), 'Calm');
    await press(within(tab).getByRole('button', { name: 'Save' }));
    await press(within(tab).getByRole('button', { name: 'Yes, use it' }));
    expect(within(tab).getByRole('status').textContent).toBe("Version 2 is in use from Editor's next run. Version 1 is kept; undo sets it again.");
    await press(within(tab).getByRole('button', { name: 'Go back to how it talked in version 1' }));
    await press(within(tab).getByRole('button', { name: 'Yes, use it' }));
    const sets = calls(spy, 'venture.persona.set');
    expect(sets).toHaveLength(3);
    expect((sets[2]!.persona as { tone: string }).tone).toBe('Warm and brief');
    await waitFor(() => expect((within(tab).getByRole('textbox', { name: 'Tone' }) as HTMLInputElement).value).toBe('Warm and brief'));
  });

  it('a field the engine refuses keeps the words and shows its rule', async () => {
    start(PERSONA);
    const tab = await personaOf('Editor');
    await type(within(tab).getByRole('textbox', { name: 'Tone' }), 'Promise replies within 2 hours');
    await press(within(tab).getByRole('button', { name: 'Save' }));
    await press(within(tab).getByRole('button', { name: 'Yes, use it' }));
    expect(within(tab).getByRole('alert').textContent).toContain("The tone has a number. Numbers come from your plan and Chausar's calculator.");
    expect((within(tab).getByRole('textbox', { name: 'Tone' }) as HTMLInputElement).value).toBe('Promise replies within 2 hours');
  });
});

describe('the agent panel: Skills, at the top of Can do (W4 4J22b, from 4J17)', () => {
  it('lists each skill with its line, and Try this fills the chat box once, without sending', async () => {
    const { spy } = start('#/team?sheet=agent:editor&tab=cando');
    const tab = await tabPanel('Editor');
    const skills = await within(tab).findByRole('list', { name: "Editor's skills" });
    expect(within(skills).getAllByRole('listitem').map((item) => item.querySelector('h4')!.textContent)).toEqual(['Cut the episode', 'Cut shorts from the episode']);
    expect(skills.textContent).toContain('How would you cut the episode for my next order?');
    await press(within(skills).getAllByRole('button', { name: 'Try this' })[0]!);
    const aside = await panel('Editor');
    expect(within(aside).getByRole('tab', { name: 'Chat' }).getAttribute('aria-selected')).toBe('true');
    const box = await within(aside).findByRole('textbox', { name: /^Message / });
    expect((box as HTMLTextAreaElement).value).toBe('How would you cut the episode for my next order?');
    expect(calls(spy, 'venture.agents.thread.send')).toEqual([]);
    // Used once: back on Chat after another tab, the box is empty again.
    await press(within(aside).getByRole('tab', { name: 'Notes' }));
    await press(within(aside).getByRole('tab', { name: 'Chat' }));
    expect((await within(aside).findByRole('textbox', { name: /^Message / }) as HTMLTextAreaElement).value).toBe('');
  });
});

describe('the agent panel: Can do (W4 4J22b, from 4J18)', () => {
  it('says the team shares one tool list and lists what it can see, can do and what is off, each with its state', async () => {
    start('#/team?sheet=agent:editor&tab=cando');
    const tab = await tabPanel('Editor');
    expect(tab.textContent).toContain("The order's AI team shares one tool list");
    for (const name of ['What it can see', 'What it can do', "If it is off here, it can't do it"]) expect(within(tab).getByRole('heading', { level: 3, name })).toBeTruthy();
    const provider = within(tab).getByText('Send each step, with what it reads, to your own AI provider: your key or the CLI you set up.').closest('li')!;
    expect(provider.querySelector('[data-state]')!.textContent).toBe('Works');
    for (const item of tab.querySelectorAll('li[data-item]')) expect(item.querySelector('[data-state]')?.textContent, item.textContent ?? '').toMatch(/^(Works|Reads|Only recorded|You pass it on|Planned|Off)$/);
    assertInkRules(document.body);
  });

  it('marks a step this build cannot do yet as planned, never as working', async () => {
    start('#/team?sheet=agent:publisher&tab=cando');
    const tab = await tabPanel('Publisher');
    const step = within(tab).getByText(/Planned: it needs Instagram to write/).closest('li')!;
    expect(step.querySelector('[data-state]')!.textContent).toBe('Planned');
  });

  it('words the states in Hindi, the lines staying the engine\'s', async () => {
    start('#/team?sheet=agent:editor&tab=cando', { language: 'hi' });
    const tab = await tabPanel('Editor');
    expect([...tab.querySelectorAll('[data-state]')].map((chip) => chip.textContent)).toContain('चलता है');
  });
});

describe('the agent file (W4 4J22b, from 4J17)', () => {
  it('Export saves the file the engine makes, which holds no notes', async () => {
    const { spy } = start(PERSONA);
    const tab = await personaOf('Editor');
    expect(tab.textContent).toContain('The file holds its steps, persona and standing orders, never its notes. To make a copy of Editor in another business, import it there.');
    await press(within(tab).getByRole('button', { name: 'Export' }));
    expect(calls(spy, 'venture.agents.export')).toEqual([{ agent: 'editor' }]);
    const file = await spy.mock.results.find((_, at) => spy.mock.calls[at]![0] === 'venture.agents.export')!.value as { fileName: string; text: string };
    expect(file.fileName).toBe('chausar-agent-editor.json');
    expect(file.text).not.toMatch(/"notes"/);
    expect(within(tab).getByText('Saved chausar-agent-editor.json.')).toBeTruthy();
  });

  it('an imported file becomes a change to accept in that agent\'s chat, named and linked; nothing changes yet', async () => {
    const { spy, engine } = start(PERSONA);
    const tab = await personaOf('Editor');
    const exported = await engine.request('venture.agents.export', { agent: 'editor' }) as { text: string };
    const file = JSON.parse(exported.text) as { persona: { tone: string | null } };
    file.persona.tone = 'Short and warm';
    const input = within(tab).getByLabelText('Import an agent file') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([JSON.stringify(file)], 'editor.json', { type: 'application/json' })] } }); });
    await settle();
    await waitFor(() => expect(calls(spy, 'venture.agents.import')).toHaveLength(1));
    expect(await within(tab).findByText("It waits in Editor's chat for your yes. Nothing changes until you accept it.")).toBeTruthy();
    expect(within(tab).getByRole('link', { name: "Open Editor's chat" }).getAttribute('href')).toBe('#/team?sheet=agent:editor&tab=chat');
    expect(calls(spy, 'venture.persona.set')).toEqual([]);
    const persona = await engine.request('venture.persona.get', { agent: 'editor' }) as PersonaView;
    expect(persona.persona.tone).toBeNull();
    const thread = await engine.request('venture.agents.thread.list', { agent: 'editor' }) as AgentThreadView;
    expect(thread.items.some((item) => item.type === 'proposal' && item.proposal.kind === 'import' && item.proposal.title === 'Import an agent file into Editor?')).toBe(true);
  });

  it('a file for another agent goes to that agent, and the line names it and links to its chat', async () => {
    const { engine } = start(PERSONA);
    const tab = await personaOf('Editor');
    const exported = await engine.request('venture.agents.export', { agent: 'researcher' }) as { text: string };
    const file = JSON.parse(exported.text) as { persona: { tone: string | null } };
    file.persona.tone = 'Curious';
    const input = within(tab).getByLabelText('Import an agent file') as HTMLInputElement;
    await act(async () => { fireEvent.change(input, { target: { files: [new File([JSON.stringify(file)], 'researcher.json', { type: 'application/json' })] } }); });
    await settle();
    expect(await within(tab).findByText("It waits in Researcher's chat for your yes. Nothing changes until you accept it.")).toBeTruthy();
    expect(within(tab).getByRole('link', { name: "Open Researcher's chat" }).getAttribute('href')).toBe('#/team?sheet=agent:researcher&tab=chat');
  });
});

describe('Team: helpers nested under their parent (W4 4J22b, from 4J12)', () => {
  /** The engine nests a helper by parentId and rolls its spend up into the parent's ("... with its helpers"). */
  const nest = (method: string, _params: unknown, real: unknown) => {
    if (method !== 'venture.team.list') return undefined;
    const view = structuredClone(real) as TeamListView;
    return {
      ...view,
      agents: view.agents.map((agent) => (agent.id === 'researcher' ? { ...agent, department: 'production' as const, parentId: 'editor' }
        : agent.id === 'editor' ? { ...agent, spend: 'USD 0.0420 with its helpers' } : agent)),
    };
  };

  it('draws a helper inside its parent\'s place, and the parent says its spend counts its helpers', async () => {
    start('#/team?dept=prod', { stub: nest });
    const editor = await screen.findByRole('listitem', { name: 'Editor' });
    const helpers = within(editor).getByRole('list', { name: 'Helpers of Editor' });
    expect(within(helpers).getByRole('listitem', { name: 'Researcher' })).toBeTruthy();
    expect(within(helpers).getByText('Helps Editor')).toBeTruthy();
    expect(editor.querySelector('[data-helpers-spend]')!.textContent).toBe('Its spend counts its helpers. See it in Money.');
    assertInkRules(document.body);
  });

  it('an agent with no helper has no helpers list', async () => {
    start('#/team?dept=prod');
    const editor = await screen.findByRole('listitem', { name: 'Editor' });
    expect(within(editor).queryByRole('list', { name: 'Helpers of Editor' })).toBeNull();
    expect(editor.querySelector('[data-helpers-spend]')).toBeNull();
  });
});

it('owner-only native work is absent from sample agent assignments and their capability claims', async () => {
  const module = JSON.stringify(pathToFileURL(resolve(process.cwd(), 'platform/runtime/venture/playbooks/steps.ts')).href);
  const native = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', `
    import {flagshipDelivery} from ${module};
    const y=flagshipDelivery('youtube'),ca=flagshipDelivery('ca-firm');
    console.log(JSON.stringify({publish:y.steps.find(s=>s.id==='publish').doneBy,
      publishRole:y.roleOf.publish??null,file:ca.steps.find(s=>s.id==='file').doneBy,fileRole:ca.roleOf.file??null}));
  `], { encoding: 'utf8' })) as { publish: string; publishRole: null; file: string; fileRole: null };
  expect(native).toEqual({ publish: 'you', publishRole: null, file: 'you', fileRole: null });

  const client = createFakeClient(new FakeEngine());
  const team = await client.request('venture.team.list', {});
  expect(team.agents.find(a => a.id === 'editor')!.steps.some(s => s.id === 'publish')).toBe(native.publishRole !== null);
  expect(team.agents.find(a => a.id === 'producer')!.steps.map(s => s.id)).toEqual(['brief']);
  const editor = await client.request('venture.agents.capabilities', { agent: 'editor' });
  expect(editor.items.some(i => i.key === 'step:publish')).toBe(false);
  expect(editor.items.find(i => i.key === 'effect:send')?.state).toBe('off');
  const producer = await client.request('venture.agents.capabilities', { agent: 'producer' });
  expect(producer.items.filter(i => ['step:price', 'step:send'].includes(i.key))).toEqual([]);
  expect(producer.items.find(i => i.key === 'outbox:mail-app')?.state).toBe('records');
  const publisher = await client.request('venture.agents.capabilities', { agent: 'publisher' });
  expect(publisher.items.find(i => i.key === 'step:post')?.state).toBe('planned');

  await client.request('workspace.open', { folder: 'ledgerline' });
  const books = await client.request('venture.team.list', {});
  expect(books.agents.find(a => a.id === 'bookkeeper')!.steps.some(s => s.id === 'portal')).toBe(native.fileRole !== null);
  expect(books.agents.find(a => a.id === 'billing')!.steps.find(s => s.id === 'issue')).toMatchObject({ gate: 'hold', floor: true });
  const billing = await client.request('venture.agents.capabilities', { agent: 'billing' });
  expect(billing.items.find(i => i.key === 'step:issue')?.state).toBe('works');
  await expect(client.request('venture.team.gate', { agentId: 'billing', stepId: 'issue', gate: 'auto' })).rejects.toMatchObject({ code: 'GATE_FLOOR' });

  start('#/team?sheet=agent:editor&tab=cando');
  const tab = await tabPanel('Editor');
  expect(tab.textContent).not.toContain('Publish to YouTube');
  expect(tab.textContent).toContain("Can't send anything to a client, a contact or the public.");
});
