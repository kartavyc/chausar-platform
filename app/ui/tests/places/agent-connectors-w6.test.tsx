// W6 6F5 (D34): AI settings gain one switch per tool: use the Gmail connection the owner made in ChatGPT or Claude.
// Off by default; the words say every send still asks; saving keeps the choice through the fake engine, which uses the
// engine's own settings checks.
import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { GmailConnection } from '../../src/places/connections/GmailConnection';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { AiSettingsView } from '../../../../platform/runtime/venture/agent-runtime/settings';

describe('AI settings: the tool\'s own Gmail connection (6F5)', () => {
  it('is off by default for both tools, and turning it on for Codex saves only that', async () => {
    const engine = new FakeEngine({ latencyMs: 0 });
    render(<EngineProvider client={createFakeClient(engine)}><GmailConnection providers={['codex', 'claude']} /></EngineProvider>);
    const fold = (await screen.findByText('Gmail', { selector: 'summary' })).closest('details')!;
    await act(async () => { fold.open = true; fold.dispatchEvent(new Event('toggle')); });
    const codex = await screen.findByLabelText('Let Codex use the Gmail you connected in ChatGPT. Every send still asks you.') as HTMLInputElement;
    const claude = screen.getByLabelText('Let Claude use the Gmail you connected in Claude. Every send still asks you.') as HTMLInputElement;
    expect(codex.checked).toBe(false); expect(claude.checked).toBe(false);
    fireEvent.click(codex);
    fireEvent.click(screen.getByRole('button', { name: 'Save Gmail choice' }));
    await screen.findByText('Gmail choice saved.');
    const saved = (await engine.request('venture.agentSettings.get', {}) as AiSettingsView).settings;
    expect(saved.codex.connectors).toBe(true);
    expect(saved.claude.connectors).toBeUndefined();
  });
});
