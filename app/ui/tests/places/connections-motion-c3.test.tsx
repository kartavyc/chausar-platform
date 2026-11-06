import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { EngineProvider } from '../../src/engine/context';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import type { ModelPresetLite } from '../../src/engine/types';
import { YourAi } from '../../src/places/connections/YourAi';
import { McpServers } from '../../src/places/connections/McpServers';
import { Packs } from '../../src/places/connections/Packs';

const real = window.getComputedStyle.bind(window);
beforeEach(() => {
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real(element, pseudo);
    if (!element.hasAttribute('data-leaving') && !element.hasAttribute('data-swap-old')) return style;
    return new Proxy(style, { get(target, key) { if (key === 'transitionDuration' || key === 'animationDuration') return '140ms'; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; } });
  });
});
afterEach(() => { delete document.documentElement.dataset.motion; });

it.each([false, true])('keeps the AI choice while its connected details leave and arrive, motion off=%s', async off => {
  if (off) document.documentElement.dataset.motion = 'off';
  const engine = new FakeEngine({ latencyMs: 0 });
  await engine.request('workspace.open', { folder: 'ledgerline' });
  const client = createFakeClient(engine);
  const { container } = render(<EngineProvider client={client}><YourAi focus={false} /></EngineProvider>);
  const row = (await screen.findByText('Anthropic key')).closest('li')!;
  const detail = within(row).getByText('Details', { selector: 'summary' }).closest('details')!;
  await act(async () => { detail.open = true; fireEvent(detail, new Event('toggle')); });
  await within(row).findByRole('button', { name: 'Disconnect' });
  expect(row.querySelector('[data-arriving]')).toBeNull();
  await act(async () => { fireEvent.click(within(row).getByRole('button', { name: 'Disconnect' })); });
  await within(row).findByRole('button', { name: 'Connect' });
  expect(container.querySelector('[data-row-id="ai-add-anthropic"]')).toBe(row);
  const gone = row.querySelector<HTMLElement>('[data-leaving]');
  if (off) expect(gone).toBeNull();
  else {
    expect(gone).not.toBeNull();
    expect(gone?.hasAttribute('inert')).toBe(true);
    expect(gone?.getAttribute('aria-hidden')).toBe('true');
    expect(row.querySelector('[data-swap-old]')?.textContent).toBe('Connected');
    for (const leaving of row.querySelectorAll('[data-leaving]')) fireEvent.transitionEnd(leaving);
    expect(row.querySelector('[data-leaving]')).toBeNull();
  }
  const presets = await engine.request('venture.models.presets', {}) as ModelPresetLite[];
  const preset = presets.find(preset => preset.id === 'anthropic-haiku-5-5')!;
  await act(async () => {
    await engine.request('venture.models.connect', { presetId: preset.id, consentDigest: preset.consentDigest, apiKey: ['synthetic', 'key'].join('-') });
    engine.emit({ type: 'queue.changed', businessId: 'ledgerline', at: new Date().toISOString() });
  });
  await within(row).findByRole('button', { name: 'Disconnect' });
  expect(container.querySelector('[data-row-id="ai-add-anthropic"]')).toBe(row);
  const model = row.querySelector('[data-model-connection]')?.closest('li');
  expect(model).toBeTruthy();
  expect(model?.hasAttribute('data-arriving')).toBe(!off);
});

it('a newly added server arrives while its initial loaded fields stay still', () => {
  const client = createFakeClient(new FakeEngine({ latencyMs: 0 }));
  const props = { onChange: vi.fn(), busy: false, saved: false, onCredentialSaved: vi.fn() };
  const { container, rerender } = render(<EngineProvider client={client}><McpServers servers={[]} {...props} /></EngineProvider>);
  expect(container.querySelector('[data-arriving]')).toBeNull();
  rerender(<EngineProvider client={client}><McpServers servers={[{ id: 'server1', name: 'Notes', transport: 'http', url: 'https://example.test/mcp' }]} {...props} /></EngineProvider>);
  expect(screen.getByLabelText('Server name').closest('[data-server-id]')?.hasAttribute('data-arriving')).toBe(true);
  rerender(<EngineProvider client={client}><McpServers servers={[]} {...props} /></EngineProvider>);
  expect(screen.queryByLabelText('Server name')).toBeNull();
  expect(container.querySelector('[data-leaving]')).toBeNull();
});

it('the first approved pack arrives after an empty loaded list', async () => {
  const engine = new FakeEngine({ latencyMs: 0 }), client = createFakeClient(engine);
  render(<EngineProvider client={client}><Packs /></EngineProvider>);
  const fold = screen.getByText('Add-on packs', { selector: 'summary' }).closest('details')!;
  await act(async () => { fold.open = true; fireEvent(fold, new Event('toggle')); });
  await within(fold).findByLabelText('Choose a pack file');
  const pack = { format: 'chausar-pack/1', id: 'motion-notes', name: 'Motion notes', version: '1.0.0', about: 'Plain sample guidance.', skills: [{ id: 'notes', title: 'Notes', markdown: '# Notes\nKeep them short.' }], mcpServers: [], calculators: [] };
  await act(async () => { fireEvent.change(within(fold).getByLabelText('Choose a pack file'), { target: { files: [new File([JSON.stringify(pack)], 'notes.json', { type: 'application/json' })] } }); });
  await act(async () => { fireEvent.click(await within(fold).findByRole('button', { name: 'Add this pack' })); });
  const remove = await within(fold).findByRole('button', { name: 'Remove pack' });
  expect(remove.closest('li')?.hasAttribute('data-arriving')).toBe(true);
  await waitFor(() => expect(fold.textContent).toContain('Pack added.'));
});
