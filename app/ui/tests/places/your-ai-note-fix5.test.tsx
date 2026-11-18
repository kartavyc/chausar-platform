import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { connectionWords } from '../../src/places/connections/ConnectionWords';
import hindi from '../../src/text/hi/connection-words.json';

// Re-check 085 (17 Nov 2026): Your AI said "Not yet checked on a real task." beside an AI every task had run through.
// The engine's note now follows the last real task (models/presets.ts verificationNoteNow); Ledgerline's sample has had
// paid calls through its key, so its connected rows say the last task worked, in English and in the Hindi pack.
async function ledgerline() {
  const engine = new FakeEngine();
  await engine.request('workspace.open', { folder: 'ledgerline' });
  window.location.hash = '#/connections';
  render(<App client={createFakeClient(engine)} language="en" />);
}

describe('Your AI: the note beside a connected AI', () => {
  it('says the last task worked where real tasks ran', async () => {
    await ledgerline();
    expect((await screen.findAllByText(/Its last task worked\./)).length).toBeGreaterThan(0);
    expect(screen.queryByText(/Claude Haiku 5\.5.*Not yet checked with a live key/)).toBeNull();
  });

  it('is said in the Hindi pack too: each note the engine can give has its Hindi line', () => {
    const t = (key: string) => (hindi as Record<string, string>)[key] ?? key;
    expect(connectionWords(t, 'Its last task worked.')).toBe('इसका पिछला काम ठीक से हुआ।');
    expect(connectionWords(t, 'Its last task failed.')).toBe('इसका पिछला काम पूरा नहीं हुआ।');
    expect(connectionWords(t, 'Not yet checked on a real task.')).toBe('असली काम पर अभी जाँच नहीं हुई है।');
  });
});

// Fix round 6 (17 Nov 2026): Connections named only the model for quick work, plans and drafts (gpt-6-luna) while an
// order's receipt said "gpt-6.1-terra · Main model". Agent jobs run on the main model AI settings chooses, so the row
// of the AI that runs them names it in the receipt's words, when it is not the row's own model.
describe('Your AI: the model agent jobs run on', () => {
  it('is named beside the AI that runs them, in the receipt\'s words, only when it differs', async () => {
    const engine = new FakeEngine();
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const status = await engine.request('venture.models.status', {}) as { connections: { presetId: string; jobModel: string | null }[] };
    expect(status.connections.find((row) => row.presetId === 'anthropic-sonnet-5-5')!.jobModel).toBe('claude-sonnet-5-5');
    expect(status.connections.find((row) => row.presetId === 'anthropic-haiku-5-5')!.jobModel).toBeNull();
    const view = await engine.request('venture.agentSettings.get', {}) as { settings: { claude: { main: { model: string; effort: string } } } };
    await engine.request('venture.agentSettings.set', { settings: { ...view.settings, claude: { ...view.settings.claude, main: { ...view.settings.claude.main, model: 'claude-opus-5-5' } } } });
    window.location.hash = '#/connections';
    render(<App client={createFakeClient(engine)} language="en" />);
    expect(await screen.findByText(/Plans and drafts · claude-sonnet-5-5 · Main model for jobs: claude-opus-5-5 · /)).toBeTruthy();
    expect(screen.queryByText(/Quick work · claude-haiku-5-5 · Main model for jobs/)).toBeNull();
  });
});
