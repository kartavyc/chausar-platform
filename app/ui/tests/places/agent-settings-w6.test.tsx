import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentSettings } from '../../src/places/connections/AgentSettings';
import { EngineProvider } from '../../src/engine/context';
import { App } from '../../src/shell/App';
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
    fireEvent.click(screen.getByLabelText('Allow these exact server connections for future jobs. Every tool call still asks.'));
    fireEvent.click(screen.getByRole('button', { name: 'Save AI settings' }));
    await screen.findByText('AI settings saved.');
    expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.mcpServers[0]).toMatchObject({ name: 'Local sample', url: 'http://127.0.0.1:1234/mcp' });
  });
  it('fake settings keep exact defaults, reject unsupported fields and retain an owner model choice', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const initial = await engine.request('venture.agentSettings.get', {}) as AiSettingsView;
    expect(initial.settings.codex.main.model).toBe('gpt-6.1-sol');
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
    render(<App client={createFakeClient(engine)} language="en" />);
    const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    const settings = within(fold);
    const model = await settings.findByLabelText('Codex main model');
    fireEvent.change(model, { target: { value: 'owner-chosen-model' } });
    fireEvent.change(settings.getByLabelText('Codex main effort'), { target: { value: 'low' } });
    await act(async () => { engine.emit({ type: 'queue.changed', businessId: 'lumen', at: new Date().toISOString() }); });
    await waitFor(() => expect((settings.getByLabelText('Codex main model') as HTMLInputElement).value).toBe('owner-chosen-model'));
    fireEvent.click(settings.getByRole('button', { name: 'Save AI settings' }));
    await settings.findByText('AI settings saved.');
    await waitFor(async () => expect((await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings.codex.main).toEqual({ model: 'owner-chosen-model', effort: 'low' }));
    expect(settings.getByText('Every send, post, payment and deletion still asks you.')).toBeTruthy();
    expect(settings.getByText('Job folder only. Windows uses unelevated access.')).toBeTruthy();
    expect(settings.getByText('Shell access is not available yet.')).toBeTruthy();
    expect(settings.getByText('External tools go through Chausar. Every call asks you.')).toBeTruthy();
  });
});
