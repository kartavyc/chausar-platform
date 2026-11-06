import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type MethodName } from '../../src/engine/types';

// Business > Practice, Ink v2 wave 2 package 2C2 (Q2 screen): rehearse with the practice clients
// (venture.simulation.*), run the improvement loop, use a kept version and go back from it (venture.improve.*), and
// the judge's own setting (venture.judge.auto.*). The engine decides and words every result; the page shows it.

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; engine?: FakeEngine; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

const NOW = '2026-10-23T10:00:00.000Z';
const ENOUGH = 'There are enough reviewed drafts to improve the playbook. The improvement loop tries one change and keeps it only if it wins.';
const JUDGE_ON = "The judge reads every draft that goes to a client or the public once it passes the code checks. It runs on your own AI, so your client's words go to your AI with the draft, and each check costs a little.";
const JUDGE_OFF = 'The judge reads a draft only when you ask it to, from the draft in Work.';
const OWN_AI = 'This runs on your own AI, or on built-in templates when none is connected. The cost shows when it finishes.';

function start(options: StartOptions = {}) {
  window.location.hash = '#/business/practice';
  const engine = options.engine ?? new FakeEngine({ now: () => NOW });
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = options.intercept?.[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language={options.language ?? 'en'} />);
  return { engine, calls };
}
const region = (name: string) => screen.findByRole('region', { name });
const press = async (scope: HTMLElement, name: string | RegExp) => {
  const button = await within(scope).findByRole('button', { name });
  await act(async () => { fireEvent.click(button); });
};

describe('Business: practice clients', () => {
  it('lists the practice clients; Rehearse now runs them and shows how many passed, each failure and the cost as the engine wrote it', async () => {
    const { calls } = start();
    expect(await screen.findByRole('heading', { level: 1, name: 'Practice and improve' })).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Business pages' });
    expect(within(nav).getByRole('link', { name: 'Practice and improve' }).getAttribute('aria-current')).toBe('page');
    const practice = await region('Practice clients');
    expect(await within(practice).findByText('A clear request')).toBeTruthy();
    expect(within(practice).getByText('A dentist who wants regular blog posts for the clinic site.')).toBeTruthy();
    expect(within(practice).getByText('A pushy client')).toBeTruthy();
    await press(practice, 'Rehearse now');
    expect(calls.find((c) => c.method === 'venture.simulation.run')?.params).toEqual({});
    await waitFor(() => expect(within(practice).getByText('2 of 3 passed')).toBeTruthy());
    expect(within(practice).getByText('A pushy client: The draft uses a word on the avoid list: free.')).toBeTruthy();
    expect(within(practice).getByText('Cost: USD 0.0000')).toBeTruthy();
    expect(within(practice).getByText('Written from built-in templates, not by AI.')).toBeTruthy();
    expect(within(practice).getByText(OWN_AI)).toBeTruthy();
  });

  it('a rehearsal partly by AI and partly from templates says so', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const real = (await engine.request('venture.simulation.run', {})) as Record<string, unknown>;
    start({ engine, intercept: { 'venture.simulation.run': () => ({ ...real, modelMode: 'mixed' }) } });
    const practice = await region('Practice clients');
    await press(practice, 'Rehearse now');
    expect(await within(practice).findByText('Written partly by your AI and partly from built-in templates.')).toBeTruthy();
  });

  it('cases made from your feedback are listed apart: Rehearse now runs only the practice clients', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const queue = (await engine.request('venture.queue.list', { scope: 'all' })) as { rows: { id: string; digest: string }[] };
    const plan = queue.rows.find((row) => row.id === 'q-plan')!;
    await engine.request('venture.queue.decide', { id: plan.id, digest: plan.digest, action: 'approve', viewed: true });
    const { calls } = start({ engine });
    const practice = await region('Practice clients');
    await within(practice).findByText('A clear request');
    expect(practice.querySelectorAll('[data-practice-client]')).toHaveLength(3);
    expect(within(practice).queryByText('Practice case from a draft you edited')).toBeNull();
    const cases = await region('Cases from your feedback');
    expect(within(cases).getByText('Practice case from a draft you edited')).toBeTruthy();
    expect(within(cases).getByText(/drafts you rejected or edited/)).toBeTruthy();
    await press(practice, 'Rehearse now');
    expect(calls.find((c) => c.method === 'venture.simulation.run')?.params).toEqual({});
    expect(await within(practice).findByText('2 of 3 passed')).toBeTruthy();
  });

  it('the business menu leads here', async () => {
    window.location.hash = '#/today';
    render(<App client={createFakeClient(new FakeEngine({ now: () => NOW }))} language="en" />);
    fireEvent.click(await screen.findByRole('button', { name: /Lumen Studio/ }));
    const menu = await screen.findByRole('group', { name: 'Business menu for Lumen Studio' });
    expect(within(menu).getByRole('link', { name: 'Practice and improve' }).getAttribute('href')).toBe('#/business/practice');
  });

  it("a refusal to rehearse is said in the engine's words", async () => {
    start({ intercept: { 'venture.simulation.run': () => { throw new EngineError('BLUEPRINT_NOT_ACCEPTED', 'Accept your plan first.'); } } });
    const practice = await region('Practice clients');
    await press(practice, 'Rehearse now');
    await waitFor(() => expect(within(practice).getByRole('alert').textContent).toBe("Couldn't rehearse: Accept your plan first."));
  });
});

describe('Business: improving the playbook', () => {
  it("reads the readiness in the engine's words; before anything failed the engine refuses the loop and says why", async () => {
    const { calls } = start();
    const improve = await region('Improve the playbook');
    expect(await within(improve).findByText(ENOUGH)).toBeTruthy();
    expect(within(improve).getByText('Version in use: 4, from your plan')).toBeTruthy();
    expect(within(improve).getByText(OWN_AI)).toBeTruthy();
    expect(within(improve).queryByRole('button', { name: /Go back/ })).toBeNull();
    await press(improve, 'Run the improvement loop');
    expect(calls.find((c) => c.method === 'venture.improve.run')?.params).toEqual({});
    await waitFor(() => expect(within(improve).getByRole('alert').textContent).toBe("Couldn't run the loop: There is nothing to improve yet: no draft was rejected or edited, no check failed and no rehearsal failed."));
  });

  it('the loop is not offered while the engine says it is planned', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    const real = (await engine.request('venture.improve.status', {})) as Record<string, unknown> & { readiness: Record<string, unknown> };
    start({ engine, intercept: { 'venture.improve.status': () => ({ ...real, readiness: { ...real.readiness, status: 'planned' } }) } });
    const improve = await region('Improve the playbook');
    await within(improve).findByText(ENOUGH);
    expect((within(improve).getByRole('button', { name: 'Run the improvement loop' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('after a failed rehearsal the loop keeps a candidate; Use this version asks twice, adopts it by digest, and Go back asks twice and rolls back', async () => {
    const { calls } = start();
    const practice = await region('Practice clients');
    await press(practice, 'Rehearse now');
    await within(practice).findByText('2 of 3 passed');
    const improve = await region('Improve the playbook');
    await press(improve, 'Run the improvement loop');
    await within(improve).findByText('The last run found a better version.');
    expect(within(improve).getByText('Adds to "Draft the reply": Keep the plan price from Chausar and offer no free work.')).toBeTruthy();
    const run = calls.find((c) => c.method === 'venture.improve.run');
    expect(run).toBeTruthy();
    await press(improve, 'Use this version');
    expect(calls.some((c) => c.method === 'venture.improve.adopt')).toBe(false);
    expect(within(improve).getByText('New drafts will use this version. You can go back later. Use it?')).toBeTruthy();
    const confirm = within(improve).getAllByRole('button', { name: 'Use this version' }).at(-1)!;
    await act(async () => { fireEvent.click(confirm); });
    const adopt = calls.find((c) => c.method === 'venture.improve.adopt')?.params as { runId: string; digest: string };
    expect(adopt.runId).toMatch(/^imp-/);
    expect(adopt.digest).toMatch(/^[a-f0-9]{64}$/);
    await within(improve).findByText('Version in use: 5, from an improvement run');
    expect(within(improve).queryByRole('button', { name: 'Use this version' })).toBeNull();

    await press(improve, 'Go back to version 4');
    expect(calls.some((c) => c.method === 'venture.improve.rollback')).toBe(false);
    expect(within(improve).getByText('New drafts will use version 4 again. The newer version stays stored. Go back?')).toBeTruthy();
    const back = within(improve).getAllByRole('button', { name: 'Go back to version 4' }).at(-1)!;
    await act(async () => { fireEvent.click(back); });
    const rollback = calls.find((c) => c.method === 'venture.improve.rollback')?.params as { playbookId: string; digest: string };
    expect(rollback.playbookId).toBe('pb-lumen-4');
    expect(rollback.digest).toMatch(/^[a-f0-9]{64}$/);
    await within(improve).findByText('Version in use: 4, from your plan');
    expect(within(improve).queryByRole('button', { name: /Go back/ })).toBeNull();
    // The version it went back from is not offered again.
    expect(within(improve).queryByRole('button', { name: 'Use this version' })).toBeNull();
  });

  it("a stale candidate and a refused rollback are said in the engine's words", async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.simulation.run', {});
    await engine.request('venture.improve.run', {});
    start({
      engine,
      intercept: {
        'venture.improve.adopt': () => { throw new EngineError('CANDIDATE_STALE', 'Your plan changed since this run. Run the loop again.'); },
      },
    });
    const improve = await region('Improve the playbook');
    await press(improve, 'Use this version');
    await act(async () => { fireEvent.click(within(improve).getAllByRole('button', { name: 'Use this version' }).at(-1)!); });
    await waitFor(() => expect(within(improve).getByRole('alert').textContent).toBe("Couldn't switch: Your plan changed since this run. Run the loop again."));
  });

  it("a rollback the engine refuses shows its words", async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('venture.simulation.run', {});
    const kept = (await engine.request('venture.improve.run', {})) as { id: string; digest: string };
    await engine.request('venture.improve.adopt', { runId: kept.id, digest: kept.digest });
    start({
      engine,
      intercept: {
        'venture.improve.rollback': () => { throw new EngineError('ROLLBACK_STALE', 'Your plan changed since that version, so it no longer fits. Run the loop again instead.'); },
      },
    });
    const improve = await region('Improve the playbook');
    await press(improve, 'Go back to version 4');
    await act(async () => { fireEvent.click(within(improve).getAllByRole('button', { name: 'Go back to version 4' }).at(-1)!); });
    await waitFor(() => expect(within(improve).getByRole('alert').textContent).toBe("Couldn't go back: Your plan changed since that version, so it no longer fits. Run the loop again instead."));
  });
});

describe('Business: the judge setting', () => {
  it("is on by default with the engine's line; turning it off is one press, turning it on asks first and records the consent", async () => {
    const { calls } = start();
    const judge = await region('The judge');
    expect(await within(judge).findByText(JUDGE_ON)).toBeTruthy();
    expect(within(judge).getByText('On')).toBeTruthy();
    const reads = () => calls.filter((c) => c.method === 'venture.judge.auto.get').length;
    const before = reads();
    await press(judge, 'Turn off');
    expect(calls.find((c) => c.method === 'venture.judge.auto.set')?.params).toEqual({ auto: false });
    await within(judge).findByText(JUDGE_OFF);
    // The page reads the setting again after each change, so a consent recorded elsewhere shows too.
    expect(reads()).toBeGreaterThan(before);
    expect(within(judge).getByText('Off')).toBeTruthy();
    await press(judge, 'Turn on');
    expect(calls.filter((c) => c.method === 'venture.judge.auto.set')).toHaveLength(1);
    expect(within(judge).getByText("Your client's words will go to your own AI with each draft for a client or the public. Turn it on?")).toBeTruthy();
    await act(async () => { fireEvent.click(within(judge).getAllByRole('button', { name: 'Turn on' }).at(-1)!); });
    expect(calls.filter((c) => c.method === 'venture.judge.auto.set').at(-1)?.params).toEqual({ auto: true });
    await within(judge).findByText(JUDGE_ON);
    expect(within(judge).getByText('You agreed on 23 Oct 2026.')).toBeTruthy();
  });

  it("a refusal to change it is said in the engine's words", async () => {
    start({ intercept: { 'venture.judge.auto.set': () => { throw new EngineError('APP_APPROVAL_REQUIRED', 'Only you change when the judge runs, inside the Chausar app.'); } } });
    const judge = await region('The judge');
    await within(judge).findByText(JUDGE_ON);
    await press(judge, 'Turn off');
    await waitFor(() => expect(within(judge).getByRole('alert').textContent).toBe("Couldn't change this: Only you change when the judge runs, inside the Chausar app."));
  });

  it('the page reads in Hindi too', async () => {
    start({ language: 'hi' });
    await waitFor(() => expect(document.querySelector('a[href="#/business/practice"]')).not.toBeNull());
    expect(document.querySelector('a[href="#/business/practice"]')?.textContent).not.toBe('Practice and improve');
    await waitFor(() => expect(document.querySelectorAll('[data-practice-client]').length).toBe(3));
    expect(screen.queryByRole('button', { name: 'Rehearse now' })).toBeNull();
  });
});

describe('the fake engine practises and improves by the engine rules', () => {
  it('refuses what the engine refuses, with its codes', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await expect(engine.request('venture.simulation.run', { episodes: 4 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.simulation.run', { scenarioIds: ['nobody'] })).rejects.toMatchObject({ code: 'SCENARIO_NOT_FOUND' });
    await expect(engine.request('venture.simulation.run', { colour: 'blue' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.improve.run', { maxRounds: 9 })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.improve.run', {})).rejects.toMatchObject({ code: 'IMPROVEMENT_NOT_READY' });
    await expect(engine.request('venture.improve.rollback', { playbookId: 'pb-lumen-4', digest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'ROLLBACK_NOTHING' });
    const run = (await engine.request('venture.simulation.run', { useTemplate: true })) as { summary: { passed: number; scenarios: number }; modelMode: string };
    expect(run.summary).toEqual({ scenarios: 3, passed: 2, failed: 1 });
    expect(run.modelMode).toBe('template');
    const kept = (await engine.request('venture.improve.run', {})) as { id: string; digest: string; status: string };
    expect(kept.status).toBe('kept-candidate');
    await expect(engine.request('venture.improve.adopt', { runId: kept.id, digest: 'b'.repeat(64) })).rejects.toMatchObject({ code: 'CANDIDATE_STALE' });
    await expect(engine.request('venture.improve.adopt', { runId: 'imp-none', digest: kept.digest })).rejects.toMatchObject({ code: 'IMPROVEMENT_NOT_FOUND' });
    const used = (await engine.request('venture.improve.adopt', { runId: kept.id, digest: kept.digest })) as { version: number; origin: string; parentId: string };
    expect(used).toMatchObject({ version: 5, origin: 'improvement', parentId: 'pb-lumen-4' });
    await expect(engine.request('venture.improve.adopt', { runId: kept.id, digest: kept.digest })).rejects.toMatchObject({ code: 'CANDIDATE_STALE' });
    const status = (await engine.request('venture.improve.status', {})) as { inUse: { hash: string; rollback: { playbookId: string; digest: string } } };
    await expect(engine.request('venture.improve.rollback', { playbookId: 'pb-lumen-4', digest: 'c'.repeat(64) })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await expect(engine.request('venture.improve.rollback', { playbookId: 'pb-lumen-9', digest: status.inUse.hash })).rejects.toMatchObject({ code: 'ROLLBACK_NOTHING' });
    // The status names the older version with its number; the method takes only its id and the hash read.
    await expect(engine.request('venture.improve.rollback', status.inUse.rollback)).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const back = (await engine.request('venture.improve.rollback', { playbookId: status.inUse.rollback.playbookId, digest: status.inUse.rollback.digest })) as { version: number };
    expect(back.version).toBe(4);
    const after = (await engine.request('venture.improve.status', {})) as { candidate: unknown; activePlaybookId: string };
    expect(after).toMatchObject({ candidate: null, activePlaybookId: 'pb-lumen-4' });
  });

  it("a business whose plan is not accepted can't rehearse yet", async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const scenarios = (await engine.request('venture.simulation.scenarios', {})) as { id: string; source: string; title: string }[];
    // The edited September books are a signal, so its case is listed after the three practice clients.
    expect(scenarios.map((s) => [s.id, s.source])).toEqual([
      ['bookkeeping-clean', 'template'], ['bookkeeping-messy', 'template'], ['bookkeeping-pushback', 'template'], ['signal-sig-d-mehta-sep', 'signal'],
    ]);
    expect(scenarios[3]!.title).toBe('Practice case from a draft you edited');
    await expect(engine.request('venture.simulation.run', {})).rejects.toMatchObject({ code: 'BLUEPRINT_NOT_ACCEPTED' });
  });

  it('a rehearsal with no clients named runs only the template practice clients; a signal case runs when named', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('workspace.open', { folder: 'ledgerline' });
    const queue = (await engine.request('venture.queue.list', { scope: 'all' })) as { rows: { id: string; digest: string }[] };
    const plan = queue.rows.find((row) => row.id === 'q-plan')!;
    await engine.request('venture.queue.decide', { id: plan.id, digest: plan.digest, action: 'approve', viewed: true });
    const all = (await engine.request('venture.simulation.run', {})) as { scenarioIds: string[] };
    expect(all.scenarioIds).toEqual(['bookkeeping-clean', 'bookkeeping-messy', 'bookkeeping-pushback']);
    const one = (await engine.request('venture.simulation.run', { scenarioIds: ['signal-sig-d-mehta-sep'] })) as { scenarioIds: string[]; summary: { scenarios: number } };
    expect(one).toMatchObject({ scenarioIds: ['signal-sig-d-mehta-sep'], summary: { scenarios: 1 } });
  });

  it('the judge setting starts on with no consent; off clears it; on records it', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    expect(await engine.request('venture.judge.auto.get', {})).toEqual({ auto: true, consentAt: null, line: JUDGE_ON });
    expect(await engine.request('venture.judge.auto.set', { auto: false })).toEqual({ auto: false, consentAt: null, line: JUDGE_OFF });
    expect(await engine.request('venture.judge.auto.set', { auto: true })).toEqual({ auto: true, consentAt: NOW, line: JUDGE_ON });
    await expect(engine.request('venture.judge.auto.set', { auto: 'yes' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
});
