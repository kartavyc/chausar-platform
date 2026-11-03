import { expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';

it('the fake rejects retired per-turn APIs instead of reviving a model preview', async () => {
  const engine = new FakeEngine({ latencyMs: 0 });
  for (const name of ['approve', 'answer', 'delegate']) await expect(engine.request(`venture.delivery.${name}`, { runId: '31', digest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
});
it('fake delivery adapters contain no retired per-turn dispatch or approval branch', () => {
  const files = import.meta.glob('../../src/engine/fake-*.ts', { query: '?raw', import: 'default', eager: true });
  const retired = ['approve', 'answer', 'delegate'].map(name => `venture.delivery.${name}`);
  for (const [path, text] of Object.entries(files)) for (const method of retired) expect(String(text), path).not.toContain(method);
});
it('retired model-chain adapters cannot create another per-turn preview', () => {
  const files = import.meta.glob('../../src/engine/fake-*.ts', { query: '?raw', import: 'default', eager: true });
  for (const name of ['fake-article-chain.ts', 'fake-social-chain.ts', 'fake-narration-chain.ts', 'fake-youtube-service-run.ts']) {
    const entry = Object.entries(files).find(([path]) => path.endsWith('/' + name));
    expect(entry, name).toBeDefined();
    expect(String(entry![1]), name).not.toMatch(/\b(?:async\s+)?start\s*\(/);
  }
});
