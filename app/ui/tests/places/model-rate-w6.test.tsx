import { it, expect } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineProvider } from '../../src/engine/context';
import { TextProvider } from '../../src/text';
import { SpendPolicy } from '../../src/places/money/SpendPolicy';
it('the owner saves an exact gateway model price and keeps cache prices when editing it again', async () => {
  const engine = new FakeEngine();
  await engine.request('venture.spend.policy.set', { rates: [{ item: 'model:openrouter', model: 'openai/gpt-6-luna', unit: 'per-million-tokens', inputUsdPerMillion: '1', outputUsdPerMillion: '2', cacheReadUsdPerMillion: '0.1', cacheWriteUsdPerMillion: '1.25', source: 'Synthetic rate', checkedOn: '2026-10-30' }] });
  render(<TextProvider language="en"><EngineProvider client={createFakeClient(engine)}><SpendPolicy /></EngineProvider></TextProvider>);
  fireEvent.click(await screen.findByRole('button', { name: 'Change' }));
  const model = await screen.findByLabelText('Model ID');
  expect((model as HTMLInputElement).value).toBe('openai/gpt-6-luna');
  fireEvent.change(model, { target: { value: 'openai/another-model' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save' }));
  fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
  await waitFor(async () => {
    const policy = await createFakeClient(engine).request('venture.spend.policy.get', {});
    expect(policy.rates[0]).toMatchObject({ model: 'openai/another-model', cacheReadUsdPerMillion: '0.10', cacheWriteUsdPerMillion: '1.25' });
  });
});
