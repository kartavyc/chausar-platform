import { it, expect, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { EngineClient, ToolsLite } from '../../src/engine/types';

it('each AI card settles independently while the other tool is still checking', async () => {
  const engine = new FakeEngine({ fresh: true });
  const client = createFakeClient(engine);
  const request = client.request.bind(client);
  const answer = await request('venture.ai.tools', {});
  const tools: ToolsLite = { ...answer, tools: answer.tools.map(tool => tool.cli === 'claude-code' ? { ...tool, found: true, signedIn: 'yes', tested: 'passed' } : tool) };
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  const calls = vi.fn(async (method: string, params?: { cli?: string }) => {
    if (method !== 'venture.ai.tools') return request(method as never, params as never);
    if (params?.cli !== 'claude-code') await pending;
    return { ...tools, tools: params?.cli ? tools.tools.filter(tool => tool.cli === params.cli) : tools.tools };
  });
  const slow: EngineClient = { ...client, request: calls as EngineClient['request'] };
  window.location.hash = '#/today';
  const view = render(<App client={slow} language="en" />);
  try {
    const claude = await screen.findByRole('region', { name: 'Claude Code' });
    expect(await within(claude).findByText('Signed in')).toBeTruthy();
    const codex = screen.getByRole('region', { name: 'Codex' });
    expect(codex.textContent).toContain('Checking');
    expect(within(codex).queryByRole('button', { name: 'Sign in with Codex' })).toBeNull();
    expect(calls.mock.calls.some(([method]) => method === 'venture.ai.login.start')).toBe(false);
    await act(async () => { finish(); });
    expect(await within(codex).findByRole('button', { name: 'Sign in with Codex' })).toBeTruthy();
  } finally {
    await act(async () => { finish(); });
    view.unmount();
  }
});
it('the fake accepts the same scoped read and rejects unknown tool fields', async () => {
  const client = createFakeClient(new FakeEngine({ fresh: true }));
  const all = await client.request('venture.ai.tools', {});
  const scoped = await client.request('venture.ai.tools', { cli: 'claude-code' });
  expect(scoped).toEqual({ ...all, tools: all.tools.filter(tool => tool.cli === 'claude-code') });
  await expect(client.request('venture.ai.tools', { cli: 'other' } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  await expect(client.request('venture.ai.tools', { cli: 'codex', extra: true } as never)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
});