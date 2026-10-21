import { describe, expect, it } from 'vitest';
import { FakeEngine } from '../../src/engine/fake';
import type { InterviewViewLite, PlanPreviewLite, QueueList, WorkspaceCreated, WorkspaceStatusLite } from '../../src/engine/types';

const IDEA = 'Monthly bookkeeping for cafes and small shops in Pune.';
const refusal = async (promise: Promise<unknown>) => { try { await promise; } catch (error) { return error as { code: string; message: string }; } throw new Error('expected a refusal'); };

describe('fake engine: a computer with no business yet (the real engine order for onboarding)', () => {
  it('has no business and no open vault; the vault methods refuse until one exists', async () => {
    const engine = new FakeEngine({ fresh: true });
    expect(await engine.request('workspace.status')).toMatchObject({ open: false });
    expect(await engine.request('workspace.list')).toEqual({ businesses: [], complete: true });
    expect(await refusal(engine.request('venture.queue.list', { scope: 'all' }))).toMatchObject({ code: 'VAULT_LOCKED' });
    expect(await refusal(engine.request('venture.create', { idea: IDEA, countryCode: 'IN' }))).toMatchObject({ code: 'VAULT_LOCKED' });
  });

  it('answers countries and the template preview before any vault, and checks the sentence and the country', async () => {
    const engine = new FakeEngine({ fresh: true });
    const countries = await engine.request('venture.countries') as { code: string; name: string }[];
    expect(countries.map((c) => c.code)).toContain('IN');
    expect(countries.at(-1)).toMatchObject({ code: 'XX', name: 'Another country (prices in US dollars)' });
    const preview = await engine.request('venture.preview', { idea: IDEA, countryCode: 'IN' }) as PlanPreviewLite;
    expect(preview).toMatchObject({ idea: IDEA, serviceLabel: 'Bookkeeping studio', serviceType: { value: 'bookkeeping' }, country: { code: 'IN' }, by: 'template', saved: false });
    expect(await refusal(engine.request('venture.preview', { idea: 'short', countryCode: 'IN' }))).toMatchObject({ code: 'INVALID_VENTURE_REQUEST', message: 'Your idea must be between 10 and 2000 characters.' });
    expect(await refusal(engine.request('venture.preview', { idea: IDEA, countryCode: 'QQ' }))).toMatchObject({ code: 'UNKNOWN_COUNTRY' });
  });

  it('makes the vault on this computer with no passphrase, and refuses a second one while it is open', async () => {
    const engine = new FakeEngine({ fresh: true });
    const made = await engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null }) as WorkspaceCreated;
    expect(made).toMatchObject({ workspace: { name: 'Bookkeeping studio' }, unlock: 'this-computer', recoveryCode: null });
    expect(await engine.request('workspace.status') as WorkspaceStatusLite).toMatchObject({ open: true, workspace: { name: 'Bookkeeping studio' } });
    expect(await refusal(engine.request('workspace.create', { name: 'Another', pack: 'services', folder: null }))).toMatchObject({ code: 'VAULT_OPEN' });
    expect(await engine.request('venture.get')).toBeNull();
  });

  it('without protected storage asks for a passphrase, checks it, and returns the recovery code once', async () => {
    const engine = new FakeEngine({ fresh: true, deviceKeys: false });
    expect(await refusal(engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null }))).toMatchObject({ code: 'DEVICE_KEYS_UNAVAILABLE' });
    expect(await refusal(engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null, passphrase: 'short' }))).toMatchObject({ code: 'WEAK_PASSPHRASE' });
    const made = await engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null, passphrase: 'correct horse battery' }) as WorkspaceCreated;
    expect(made).toMatchObject({ unlock: 'passphrase', recoveryCode: 'K7QM4X2D9PLR8T3WNB6Y5HJC' });
  });

  it('hosted: refuses a folder, and always returns the recovery code', async () => {
    const engine = new FakeEngine({ fresh: true, hosted: true });
    expect(await engine.request('workspace.status')).toMatchObject({ open: false, hosted: { businesses: [] } });
    expect(await refusal(engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null }))).toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services' })).toMatchObject({ recoveryCode: 'K7QM4X2D9PLR8T3WNB6Y5HJC' });
  });

  it('create, the template interview and the plan: required questions need answers; then the plan row comes first, then setup', async () => {
    const engine = new FakeEngine({ fresh: true, now: () => '2026-10-21T12:00:00.000Z' });
    await engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null });
    await engine.request('venture.create', { idea: IDEA, countryCode: 'IN', workingName: 'Bookkeeping studio' });
    expect(await refusal(engine.request('venture.create', { idea: IDEA, countryCode: 'IN' }))).toMatchObject({ code: 'VENTURE_EXISTS' });
    const view = await engine.request('venture.interview.next', { useTemplate: true }) as InterviewViewLite;
    expect(view.interview.questions.map((q) => [q.id, q.required])).toEqual([['q_1', false], ['q_pricing_model', true], ['q_price', false], ['q_tax', true]]);
    expect(await refusal(engine.request('venture.blueprint.draft', { useTemplate: true }))).toMatchObject({ code: 'INTERVIEW_INCOMPLETE' });
    expect(await refusal(engine.request('venture.interview.answer', { questionId: 'q_tax', answer: { skipped: true } }))).toMatchObject({ message: 'This question needs an answer.' });
    for (const [questionId, answer] of [['q_1', { skipped: true }], ['q_pricing_model', { choiceId: 'monthly' }], ['q_price', { skipped: true }], ['q_tax', { yes: false }]] as const) {
      await engine.request('venture.interview.answer', { questionId, answer });
    }
    await engine.request('venture.blueprint.draft', { useTemplate: true });
    const queue = await engine.request('venture.queue.list', { scope: 'all' }) as QueueList;
    expect(queue.rows.map((r) => [r.kind, r.title])).toEqual([
      ['plan', 'Your plan is ready. Read it.'],
      ['setup', 'Connect your AI'],
      ['setup', 'Set your prices'],
      ['setup', 'Keep this business'],
    ]);
    for (const row of queue.rows) expect(row.actions.filter((a) => a.primary)).toHaveLength(1);
    expect(await engine.request('venture.get')).toMatchObject({ venture: { workingName: 'Bookkeeping studio', serviceType: 'bookkeeping' } });
  });

  it('closing the open business lets a new one be made, and both stay on this computer', async () => {
    const engine = new FakeEngine();
    expect(await engine.request('workspace.status')).toMatchObject({ open: true, workspace: { name: 'Lumen Studio' } });
    await engine.request('workspace.lock');
    expect(await engine.request('workspace.status')).toMatchObject({ open: false, closedByOwner: true });
    await engine.request('workspace.create', { name: 'Bookkeeping studio', pack: 'services', folder: null });
    const list = await engine.request('workspace.list') as { businesses: { name: string; recovery: string }[] };
    expect(list.businesses.map((b) => [b.name, b.recovery])).toEqual([['Lumen Studio', 'made'], ['Ledgerline', 'made'], ['Sitara Events', 'made'], ['Bookkeeping studio', 'not-made']]);
  });
});
