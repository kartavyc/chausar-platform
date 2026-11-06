import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { GmailConnection } from '../../src/places/connections/GmailConnection';
import type { EngineClient } from '../../src/engine/types';
import { AgentSettings } from '../../src/places/connections/AgentSettings';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { AiSettingsView } from '../../../../platform/runtime/venture/agent-runtime/settings';

describe('AI settings', () => {
  it('requires a separate configuration confirmation before saving external tools', async () => {
    window.location.hash = '#/connections/ai';
    const engine = new FakeEngine({ latencyMs: 0 });
    render(<EngineProvider client={createFakeClient(engine)}><AgentSettings /></EngineProvider>);
    const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    fireEvent.click(await screen.findByRole('button', { name: 'Add server' }));
    fireEvent.change(screen.getByLabelText('Server name'), { target: { value: 'Local sample' } });
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'http://127.0.0.1:1234/mcp' } });
    expect(screen.getByRole('button', { name: 'Save AI settings' }).getAttribute('aria-disabled')).toBe('true');
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.mcpServers).toEqual([]);
    fireEvent.click(screen.getByLabelText('Allow these exact server connections for future jobs. Calls that can change things still ask.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved.');
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.mcpServers[0]).toMatchObject({ name: 'Local sample', url: 'http://127.0.0.1:1234/mcp' });
  });
  it('fake settings keep exact defaults, reject unsupported fields and retain an owner model choice', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const initial = await engine.request('venture.agentSettings.get', {}) as AiSettingsView;
    expect(initial.settings.codex.main.model).toBe('gpt-6.1-terra');
    expect(initial.boundaries).toEqual({ jobFolderOnly: true, windowsSandbox: 'unelevated', shell: 'unavailable', mcp: 'chausar-proxy', externalMcp: 'approval-required' });
    initial.settings.codex.main.model = 'owner-chosen-model';
    initial.settings.agentAutoReview[initial.agents[0]!.id] = false;
    await engine.request('venture.agentSettings.set', { settings: initial.settings });
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings).toEqual(initial.settings);
    await expect(engine.request('venture.agentSettings.get', { extra: true })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.agentSettings.set', { settings: { ...initial.settings, codex: { ...initial.settings.codex, shell: true } } })).rejects.toMatchObject({ code: 'AI_SETTING_UNSUPPORTED' });
    await expect(engine.request('venture.agentSettings.set', { settings: { ...initial.settings, agentAutoReview: { 'foreign-agent': true } } })).rejects.toMatchObject({ code: 'AGENT_NOT_FOUND' });
  });

  it('edits quick/main models and routine approval on the existing AI page without implying outside approval', async () => {
    window.location.hash = '#/connections/ai';
    const engine = new FakeEngine({ latencyMs: 0 });
    render(<EngineProvider client={createFakeClient(engine)}><AgentSettings providers={['codex']} /></EngineProvider>);
    const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    const settings = within(fold);
    const advanced = (await settings.findByText('Advanced', { selector: 'summary' })).closest('details')!;
    await act(async () => { advanced.open = true; advanced.dispatchEvent(new Event('toggle')); });
    const model = await settings.findByLabelText('Codex main model');
    fireEvent.change(model, { target: { value: 'owner-chosen-model' } });
    fireEvent.change(settings.getByLabelText('How hard it thinks'), { target: { value: 'normal' } });
    await act(async () => { engine.emit({ type: 'queue.changed', businessId: 'lumen', at: new Date().toISOString() }); });
    await waitFor(() => expect((settings.getByLabelText('Codex main model') as HTMLInputElement).value).toBe('owner-chosen-model'));
    fireEvent.click(settings.getByRole('button', { name: 'Save AI settings' }));
    await settings.findByText('AI settings saved.');
    await waitFor(async () => expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.codex.main).toEqual({ model: 'owner-chosen-model', effort: 'medium' }));
    expect(settings.getByText('Every send, post, payment and deletion still asks you.')).toBeTruthy();
    expect(settings.getByText('Job folder only. Windows uses unelevated access.')).toBeTruthy();
    expect(settings.getByText('Shell access is not available yet.')).toBeTruthy();
    expect(settings.getByText('External tools go through Chausar. Only checked read tools skip asking you.')).toBeTruthy();
  });
});

describe('AI settings: the models Codex lists (C1 task 13)', () => {
  async function open(engine: FakeEngine) {
    window.location.hash = '#/connections/ai';
    render(<EngineProvider client={createFakeClient(engine)}><AgentSettings providers={['codex', 'claude']} /></EngineProvider>);
    const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    await screen.findAllByText('Advanced', { selector: 'summary' });
    for (const summary of within(fold).getAllByText('Advanced', { selector: 'summary' })) {
      const advanced = summary.closest('details')!;
      await act(async () => { advanced.open = true; advanced.dispatchEvent(new Event('toggle')); });
    }
    return within(fold);
  }

  it('the fake answers with the engine shape: models last, null by default, a set list in order', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const plain = await engine.request('venture.agentSettings.get', {}) as AiSettingsView;
    expect(Object.keys(plain)).toEqual(['settings', 'boundaries', 'agents', 'modelChoices', 'models']);
    expect(plain.models).toEqual({ codex: null });
    engine.codexModels(['gpt-6.1-terra', 'gpt-6-luna']);
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).models).toEqual({ codex: ['gpt-6.1-terra', 'gpt-6-luna'] });
  });

  it('with a list, the Codex model is a choice of its ids and Another model; the picked id is saved unchanged', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    engine.codexModels(['gpt-6.1-terra', 'gpt-6-luna']);
    const settings = await open(engine);
    const main = await settings.findByRole('combobox', { name: 'Codex main model' }) as HTMLSelectElement;
    expect([...main.options].map((o) => o.textContent)).toEqual(['gpt-6.1-terra', 'gpt-6-luna', 'Another model']);
    expect(main.value).toBe('gpt-6.1-terra');
    expect(settings.queryByText("Codex didn't list its models here. Type the exact model id.")).toBeNull();
    fireEvent.change(main, { target: { value: 'gpt-6-luna' } });
    fireEvent.click(settings.getByRole('button', { name: 'Save AI settings' }));
    await settings.findByText('AI settings saved.');
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.codex.main.model).toBe('gpt-6-luna');
    fireEvent.change(settings.getByRole('combobox', { name: 'Codex main model' }), { target: { value: '__another-model__' } });
    const field = settings.getByLabelText('Codex main model id') as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'gpt-7-test' } });
    fireEvent.click(settings.getByRole('button', { name: 'Save AI settings' }));
    await waitFor(async () => expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.codex.main.model).toBe('gpt-7-test'));
    const after = await settings.findByRole('combobox', { name: 'Codex main model' }) as HTMLSelectElement;
    expect([...after.options][0]!.textContent).toBe("gpt-7-test, not in Codex's list");
  });

  it('without a list, the exact-id field and one line say so; Claude stays a field', async () => {
    const settings = await open(new FakeEngine({ latencyMs: 0 }));
    expect(((await settings.findByLabelText('Codex main model')) as HTMLElement).tagName).toBe('INPUT');
    expect(settings.getByText("Codex didn't list its models here. Type the exact model id.")).toBeTruthy();
    expect((settings.getByLabelText('Claude Code main model') as HTMLElement).tagName).toBe('INPUT');
  });
});


describe('simple AI settings for the AI in use (B4)', () => {
  it('shows only the chosen AI, simple jobs and one effort/online control, with exact IDs under Advanced', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    render(<EngineProvider client={createFakeClient(engine)}><AgentSettings providers={['codex']} /></EngineProvider>);
    const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    const settings = within(fold);
    const main = await settings.findByRole('combobox', { name: 'Main jobs' }) as HTMLSelectElement;
    expect([...main.options].map(option => option.textContent)).toEqual(['Faster', 'Smarter']);
    expect(settings.queryByRole('group', { name: 'Claude Code' })).toBeNull();
    expect(settings.getAllByRole('combobox', { name: 'How hard it thinks' })).toHaveLength(1);
    expect(settings.getAllByRole('combobox', { name: 'Can look things up online' })).toHaveLength(1);
    expect(settings.queryByRole('textbox', { name: 'Codex main model' })).toBeNull();
    fireEvent.change(main, { target: { value: 'faster' } });
    fireEvent.click(settings.getByRole('button', { name: 'Save AI settings' }));
    await settings.findByText('AI settings saved.');
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.codex.main.model).toBe('gpt-6-luna');
    const advanced = settings.getByText('Advanced', { selector: 'summary' }).closest('details')!;
    await act(async () => { advanced.open = true; advanced.dispatchEvent(new Event('toggle')); });
    expect((await within(advanced).findByLabelText('Codex main model') as HTMLInputElement).value).toBe('gpt-6-luna');
  });
  it('the fake returns the same engine-owned choices independently of saved model ids', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const first = await engine.request('venture.agentSettings.get', {}) as AiSettingsView;
    expect(first.modelChoices).toEqual({ codex: { faster: 'gpt-6-luna', smarter: 'gpt-6.1-terra' }, claude: { faster: 'claude-haiku-5-5', smarter: 'claude-sonnet-5-5' } });
    first.settings.codex.main.model = 'owner-model';
    expect((await engine.request('venture.agentSettings.set', { settings: first.settings }) as AiSettingsView).modelChoices).toEqual(first.modelChoices);
  });
});


it('saving AI models preserves a Gmail choice changed on its own connection while this form was open (B4)', async () => {
  const engine = new FakeEngine({ latencyMs: 0 });
  render(<EngineProvider client={createFakeClient(engine)}><AgentSettings providers={['codex']} /></EngineProvider>);
  const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
  await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
  const settings = within(fold);
  fireEvent.change(await settings.findByRole('combobox', { name: 'Main jobs' }), { target: { value: 'faster' } });
  const current = await engine.request('venture.agentSettings.get', {}) as AiSettingsView;
  current.settings.codex.connectors = true;
  await act(async () => { await engine.request('venture.agentSettings.set', { settings: current.settings }); });
  fireEvent.click(settings.getByRole('button', { name: 'Save AI settings' }));
  await settings.findByText('AI settings saved.');
  const saved = (await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings;
  expect(saved.codex.connectors).toBe(true);
  expect(saved.codex.main.model).toBe('gpt-6-luna');
});


it.each(['models', 'gmail'] as const)('overlapping %s-first saves preserve both exact choices (B4 review)', async first => {
  const engine = new FakeEngine({ latencyMs: 0 });
  const base = createFakeClient(engine);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let sets = 0;
  const client: EngineClient = { ...base, request: (async (method: string, params?: Record<string, unknown>) => {
    if (method === 'venture.agentSettings.set' && ++sets === 1) await gate;
    return base.request(method as never, params as never);
  }) as EngineClient['request'] };
  render(<EngineProvider client={client}><AgentSettings providers={['codex']} /><GmailConnection providers={['codex']} /></EngineProvider>);
  for (const title of ['AI settings', 'Gmail']) {
    const fold = (await screen.findByText(title, { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
  }
  fireEvent.change(await screen.findByRole('combobox', { name: 'Main jobs' }), { target: { value: 'faster' } });
  fireEvent.click(await screen.findByLabelText('Let Codex use the Gmail you connected in ChatGPT. Every send still asks you.'));
  fireEvent.click(screen.getByRole('button', { name: first === 'models' ? 'Save AI settings' : 'Save Gmail choice' }));
  await waitFor(() => expect(sets).toBe(1));
  fireEvent.click(screen.getByRole('button', { name: first === 'models' ? 'Save Gmail choice' : 'Save AI settings' }));
  // Give the second transaction time to reach its read/write while the first write remains held.
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
  await act(async () => { release(); });
  await screen.findByText('AI settings saved.');
  await screen.findByText('Gmail choice saved.');
  const saved = (await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings;
  expect(saved.codex.main.model).toBe('gpt-6-luna');
  expect(saved.codex.connectors).toBe(true);
});
