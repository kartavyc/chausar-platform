// W6 6F1, 6F2, 6F9: the fake engine answers the MCP list, OAuth sign-in and packs as the engine does; the AI settings
// fold offers the curated servers and packs; a run's card shows a server question's fields and a Sunra cost receipt.
import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { AgentSettings } from '../../src/places/connections/AgentSettings';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient } from '../../src/engine/types';
import { RunSheet } from '../../src/parts/RunSheet';
import { TextProvider } from '../../src/text';
import { ClockProvider } from '../../src/shell/clock';
import type { AiSettingsView } from '../../../../platform/runtime/venture/agent-runtime/settings';
import { CURATED_MCP_SERVERS } from '../../../../platform/runtime/venture/agent-runtime/mcp-registry';

const PACK = { format: 'chausar-pack/1', id: 'notes-pack', name: 'Client notes pack', version: '1.0.0', about: 'Plain guidance for client notes.',
  skills: [{ id: 'notes', title: 'Writing client notes', markdown: '# Writing client notes\n\nKeep them short.' }], mcpServers: [], calculators: [] };

async function openSettings(engine: FakeEngine) {
  render(<EngineProvider client={createFakeClient(engine)}><AgentSettings /></EngineProvider>);
  const fold = (await screen.findByText('AI settings', { selector: 'summary' })).closest('details')!;
  await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
  return within(fold);
}
async function openFold(summary: HTMLElement) {
  const fold = summary.closest('details')!;
  await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
  return within(fold);
}

describe('6F1 and 6F2 in the fake engine', () => {
  it('lists the curated servers and answers OAuth sign-in up to protected storage, as the engine does', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const list = await engine.request('venture.mcpRegistry.list', {}) as { servers: { id: string }[]; source: string };
    expect(list.source).toBe('https://registry.modelcontextprotocol.io');
    expect(list.servers.map(row => row.id)).toEqual(CURATED_MCP_SERVERS.map(row => row.id));
    await expect(engine.request('venture.mcpRegistry.list', { extra: 1 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const view = await engine.request('venture.agentSettings.get', {}) as AiSettingsView;
    view.settings.mcpServers = [{ id: 'plain', name: 'Plain', transport: 'http', url: 'https://example.com/mcp' }, { id: 'signed', name: 'Signed', transport: 'http', url: 'https://example.com/signed', oauth: true }];
    await engine.request('venture.agentSettings.set', { settings: view.settings, approveMcpConfiguration: true });
    await expect(engine.request('venture.mcpOAuth.start', { serverId: 'plain' })).rejects.toMatchObject({ code: 'MCP_OAUTH_NOT_SET' });
    await expect(engine.request('venture.mcpOAuth.start', { serverId: 'signed' })).rejects.toMatchObject({ code: 'CREDENTIAL_UNAVAILABLE' });
    await expect(engine.request('venture.mcpOAuth.start', { serverId: 'missing' })).rejects.toMatchObject({ code: 'MCP_SERVER_NOT_FOUND' });
    await expect(engine.request('venture.agentApproval.decide', { runId: '31', digest: 'invented', decision: 'approve', content: { colour: 'green' } })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
  });

  it('previews, adds, lists and removes a pack with the engine\'s digest and refusals', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const preview = await engine.request('venture.packs.add', { pack: PACK }) as { added: boolean; digest: string };
    expect(preview.added).toBe(false);
    await expect(engine.request('venture.packs.add', { pack: { ...PACK, version: '1.0.1' }, digest: preview.digest })).rejects.toMatchObject({ code: 'PREVIEW_CHANGED' });
    await expect(engine.request('venture.packs.add', { pack: { ...PACK, hooks: { onInstall: 'x' } } })).rejects.toMatchObject({ code: 'PACK_CODE_REFUSED' });
    expect((await engine.request('venture.packs.add', { pack: PACK, digest: preview.digest }) as { added: boolean }).added).toBe(true);
    await expect(engine.request('venture.packs.add', { pack: PACK, digest: preview.digest })).rejects.toMatchObject({ code: 'PACK_EXISTS' });
    expect((await engine.request('venture.packs.list', {}) as { packs: { id: string }[] }).packs.map(row => row.id)).toEqual(['notes-pack']);
    await engine.request('venture.packs.remove', { packId: 'notes-pack' });
    await expect(engine.request('venture.packs.remove', { packId: 'notes-pack' })).rejects.toMatchObject({ code: 'PACK_NOT_FOUND' });
  });
});

describe('6F1 and 6F2 in AI settings', () => {
  it('adds a suggested server with its sign-in setting; saving still needs the exact confirmation', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const settings = await openSettings(engine);
    const suggested = await openFold(await settings.findByText('Suggested servers', { selector: 'summary' }));
    fireEvent.click(await suggested.findByRole('button', { name: 'Add Notion' }));
    expect((settings.getAllByLabelText('Server name') as HTMLInputElement[]).map(input => input.value)).toContain('Notion');
    expect((settings.getByLabelText('Sign in with the service') as HTMLInputElement).checked).toBe(true);
    expect(settings.getByRole('button', { name: 'Save AI settings' }).getAttribute('aria-disabled')).toBe('true');
    expect(suggested.getByRole('button', { name: 'Add Notion' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('shows a chosen pack before adding it, then lists it', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    const settings = await openSettings(engine);
    const packs = await openFold(await settings.findByText('Add-on packs', { selector: 'summary' }));
    await packs.findByText('No packs added.');
    const file = new File([JSON.stringify(PACK)], 'notes.json', { type: 'application/json' });
    await act(async () => { fireEvent.change(packs.getByLabelText('Choose a pack file'), { target: { files: [file] } }); });
    await packs.findByText('Plain guidance for client notes.');
    expect((await engine.request('venture.packs.list', {}) as { packs: unknown[] }).packs).toEqual([]);
    await act(async () => { fireEvent.click(packs.getByRole('button', { name: 'Add this pack' })); });
    await packs.findByText('Pack added.');
    expect((await engine.request('venture.packs.list', {}) as { packs: { id: string }[] }).packs.map(row => row.id)).toEqual(['notes-pack']);
    await waitFor(() => expect(packs.getByRole('button', { name: 'Remove pack' })).toBeTruthy());
  });
});

function sheetWith(pending: unknown, decide: (params: unknown) => Promise<unknown>) {
  const client = createFakeClient(new FakeEngine()), base = client.request.bind(client);
  client.request = (async (method, params) => {
    if (method === 'venture.agentApproval.decide') return decide(params);
    const answer = await base(method as never, params as never);
    return method === 'venture.runs.get' ? { ...answer as object, agentProgress: { messages: [], tools: [], pendingApproval: pending } } : answer;
  }) as EngineClient['request'];
  render(<TextProvider language="en"><ClockProvider now={() => new Date('2026-10-30T12:00:00Z')}><EngineProvider client={client}><RunSheet runId="31" onClose={() => {}} /></EngineProvider></ClockProvider></TextProvider>);
}

describe('6F1 and 6F9 on the run card', () => {
  it('a server question shows its fields and sends the owner\'s answer only with Send answer', async () => {
    const decide = vi.fn(async (_params: unknown) => ({ runId: '31', decision: 'approve' }));
    sheetWith({ digest: 'question_sample', request: { kind: 'external-input', requestId: 'r', threadId: 't', turnId: 't', itemId: 'i', name: 'Ask sample asks you', description: 'Which sample colour should the test use?',
      arguments: { server: 'ask', message: 'Which sample colour should the test use?', fields: { type: 'object', properties: { colour: { type: 'string', title: 'Colour', enum: ['green', 'blue'] } }, required: ['colour'] } } } }, decide);
    const send = await screen.findByRole('button', { name: 'Send answer' });
    fireEvent.change(screen.getByLabelText('Colour'), { target: { value: 'blue' } });
    await act(async () => { fireEvent.click(send); });
    expect(decide).toHaveBeenCalledExactlyOnceWith({ runId: '31', digest: 'question_sample', decision: 'approve', content: { colour: 'blue' } });
  });

  it('a Sunra card shows the rupee cost from code with its receipt mark', async () => {
    sheetWith({ digest: 'gen_sample', request: { kind: 'external-tool', requestId: 'r', threadId: 't', turnId: 't', itemId: 'i', name: 'Sunra: submit', description: 'Make one image with Sunra for ₹3.98. Approve only this exact request.',
      arguments: { cost: { display: '₹3.98', paise: '398', currency: 'INR', basis: 'fixed', receiptId: 'mediagen_sample' }, tool: 'submit', input: { endpointId: 'a/b/text-to-image' } } } }, async () => ({}));
    await screen.findByRole('button', { name: 'Approve step' });
    const cost = screen.getByText('Cost').parentElement!;
    expect(cost.querySelector('[data-figure]')).toBeTruthy();
    expect(cost.querySelector('[data-receipt]')).toBeTruthy();
    expect(within(cost).getByText('₹3.98')).toBeTruthy();
  });
});


it('empty external tool sections stay quiet with one small Add server action (B4)', async () => {
  const settings = await openSettings(new FakeEngine({ latencyMs: 0 }));
  expect(settings.queryByRole('group', { name: 'External tools (MCP)' })).toBeNull();
  const add = settings.getByRole('button', { name: 'Add server' });
  expect(add.getAttribute('data-size')).toBe('sm');
});
