import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type DeliveryLite, type MethodName, type ClientAiConsentView, type JudgePreview } from '../../src/engine/types';

// Work > order, Ink v2 wave 2 package 2C2 (Q1 screen): the rules judge on a ready draft. "Ask the judge" previews the
// call (venture.delivery.judge), "Send to the judge" sends it with the digest read (venture.delivery.judgeSend), and
// the verdict the engine stored reads as the judge check's own detail, also when the judge ran on its own (judgeAuto).

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en'; engine?: FakeEngine; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

const NOW = '2026-10-23T10:00:00.000Z';
const PASSED = 'Every rule passed its own floor. Each yes cited something code found in the job.';
const FAILED = 'Failed: tone-fits. Only 0 of 1 vote said yes with checked evidence; this rule needs 1. The quality check said: "The reply promises a free first session."';
const UNSETTLED = 'Not settled: goal-met. A vote without checked evidence never counts as a pass. 1 of 1 vote could not be checked, so this rule is not settled.';
const NO_AI = 'Connect an AI for quick work first; the quality check runs on your own AI.';
const JUDGE_ON = "The quality check reads every draft that goes to a client or the public once it passes the code checks. It runs on your own AI, so your client's words go to your AI with the draft, and each check costs a little.";
const EDITED = "Your edit is your own words, so the quality check does not read it. Any verdict here is on the agent's draft.";

async function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
  const engine = options.engine ?? new FakeEngine({ now: () => NOW });
  if (hash.includes('o-boat-14')) await allowQuality(engine);
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
/** Lumen with an AI for quick work, so the judge can run on it. */
async function withAi(): Promise<FakeEngine> {
  const engine = new FakeEngine({ now: () => NOW });
  await engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'a-test-key-for-the-fake' });
  await allowQuality(engine);
  return engine;
}
const judgeRegion = () => screen.findByRole('region', { name: 'Quality check' });
const lineOf = async (scope: HTMLElement, title: string) => (await within(scope).findByText(title)).closest('li')!;

const READY: DeliveryLite = {
  id: 'd-ep14-script', at: '2026-10-21T08:30:00.000Z', orderId: 'o-boat-14', status: 'ready-for-review', practice: false,
  practiceNow: false, servedBy: 'model',
  deliverable: { title: 'Sponsor script for episode 14' }, verdict: null, awaitingYou: true,
  checks: [{ check: 'no-numeric-prose', passed: true, detail: 'No numbers in the prose.' }], canAccept: true, acceptBlocked: null,
};
const withVerdict = (check: NonNullable<DeliveryLite['checks']>[number], extra: Partial<DeliveryLite> = {}): DeliveryLite => ({
  ...READY, checks: [...READY.checks!, check],
  judge: { status: 'done', preview: null, auto: false, estimatedMaxCostDisplay: 'under $0.01 (estimate)', line: null, draftDigest: 'f'.repeat(64) },
  ...extra,
});

describe('Work: asking the judge about a ready draft', () => {
  it('a ready draft that passed every check offers Check quality; with no AI the engine says why it cannot', async () => {
    const { calls } = await start('#/work?order=o-boat-14');
    const judge = await judgeRegion();
    const line = await lineOf(judge, 'Sponsor script for episode 14');
    expect(within(judge).queryByText('Practice sponsor script')).toBeNull();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Check quality' })); });
    expect(calls.find((c) => c.method === 'venture.delivery.judge')?.params).toEqual({ runId: 'd-ep14-script' });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe(`Couldn't check quality: ${NO_AI}`));
  });

  it('shows the cost estimate, sends with the digest read, and then reads the verdict as the judge check wrote it', async () => {
    const { calls } = await start('#/work?order=o-boat-14', { engine: await withAi() });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Check quality' })); });
    await within(line).findByText('The quality check uses your own AI. It costs at most under $0.01 (estimate).');
    expect(within(line).getByText("Your client's words go to your AI with the draft.")).toBeTruthy();
    expect(calls.some((c) => c.method === 'venture.delivery.judgeSend')).toBe(false);
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Send for quality check' })); });
    const sent = calls.find((c) => c.method === 'venture.delivery.judgeSend')?.params as { runId: string; digest: string };
    expect(sent.runId).toBe('d-ep14-script');
    expect(sent.digest).toMatch(/^[a-f0-9]{64}$/);
    await waitFor(() => expect(within(line).getByText(`Quality check passed: ${PASSED}`)).toBeTruthy());
    expect(within(line).queryByRole('button', { name: 'Check quality' })).toBeNull();
    expect(within(line).queryByRole('button', { name: 'Send for quality check' })).toBeNull();
  });

  it("a failed verdict quotes the rule, and says Accept is blocked in the engine's words", async () => {
    const failed = withVerdict({ check: 'rules-judge', passed: false, detail: FAILED }, { canAccept: false, acceptBlocked: `This draft failed a check: ${FAILED} Edit it or reject it.` });
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failed] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(`Quality check found a problem: ${FAILED}`)).toBeTruthy();
    expect(within(line).getByText(`Accept is blocked. This draft failed a check: ${FAILED} Edit it or reject it.`)).toBeTruthy();
    expect(within(line).queryByRole('button', { name: 'Check quality' })).toBeNull();
  });

  it('a send that comes back failed shows the verdict at once', async () => {
    const failed = withVerdict({ check: 'rules-judge', passed: false, detail: FAILED }, { canAccept: false, acceptBlocked: `This draft failed a check: ${FAILED} Edit it or reject it.` });
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: { 'venture.delivery.judgeSend': () => failed },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Check quality' })); });
    await act(async () => { fireEvent.click(await within(line).findByRole('button', { name: 'Send for quality check' })); });
    await waitFor(() => expect(within(line).getByText(`Quality check found a problem: ${FAILED}`)).toBeTruthy());
    expect(within(line).getByText(/^Accept is blocked\./)).toBeTruthy();
  });

  it('a verdict no checked vote settled reads Not checked and blocks nothing', async () => {
    const unsettled = withVerdict({ check: 'rules-judge', passed: false, notChecked: true, detail: UNSETTLED });
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [unsettled] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(`Not checked: ${UNSETTLED}`)).toBeTruthy();
    expect(within(line).queryByText(/Accept is blocked/)).toBeNull();
  });

  it("a refused send is said in the engine's words", async () => {
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: { 'venture.delivery.judgeSend': () => { throw new EngineError('APPROVAL_STALE', 'The draft changed since you asked the quality check. Ask again.'); } },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Check quality' })); });
    await act(async () => { fireEvent.click(await within(line).findByRole('button', { name: 'Send for quality check' })); });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe("Couldn't send for quality check: The draft changed since you asked the quality check. Ask again."));
  });

  it('after a stale send and a list that says the judge failed, the line offers Check quality, not Send', async () => {
    const why = 'Quality check did not finish: Check quality again; the call you read is no longer available. Check quality again.';
    const waiting: DeliveryLite = {
      ...READY,
      judge: { status: 'waiting', auto: false, line: null, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)', preview: { digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)' } },
    };
    const failedNow: DeliveryLite = { ...READY, judge: { status: 'failed', preview: null, auto: false, line: why, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: null } };
    let stale = false;
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: {
        'venture.delivery.list': () => [stale ? failedNow : waiting],
        'venture.delivery.judge': () => ({ runId: 'd-ep14-script', digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)', containsClientData: true }),
        'venture.delivery.judgeSend': () => { stale = true; throw new EngineError('APPROVAL_STALE', 'Check quality again; the call you read is no longer available.'); },
      },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Send for quality check' })); });
    await waitFor(() => expect(within(line).getByText(why)).toBeTruthy());
    expect(within(line).getByRole('button', { name: 'Check quality' })).toBeTruthy();
    expect(within(line).queryByRole('button', { name: 'Send for quality check' })).toBeNull();
  });

  it('a call the owner read stays only until a send is refused: then the list decides', async () => {
    const why = 'Quality check did not finish: Check quality again; the call you read is no longer available. Check quality again.';
    const failedNow: DeliveryLite = { ...READY, judge: { status: 'failed', preview: null, auto: false, line: why, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: null } };
    let stale = false;
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: {
        'venture.delivery.list': () => [stale ? failedNow : READY],
        'venture.delivery.judge': () => ({ runId: 'd-ep14-script', digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)', containsClientData: true }),
        'venture.delivery.judgeSend': () => { stale = true; throw new EngineError('APPROVAL_STALE', 'Check quality again; the call you read is no longer available.'); },
      },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Check quality' })); });
    await act(async () => { fireEvent.click(await within(line).findByRole('button', { name: 'Send for quality check' })); });
    await waitFor(() => expect(within(line).getByText(why)).toBeTruthy());
    expect(within(line).getByRole('button', { name: 'Check quality' })).toBeTruthy();
    expect(within(line).queryByRole('button', { name: 'Send for quality check' })).toBeNull();
  });

  it('a draft with a failed code check, a draft not ready, a practice draft, one practice at this stage and a template outline get no Check quality', async () => {
    const failedCheck: DeliveryLite = { ...READY, checks: [{ check: 'house-style', passed: false, detail: 'The draft uses a long dash.' }], canAccept: false, acceptBlocked: 'This draft failed a check: The draft uses a long dash. Edit it or reject it.' };
    const practice: DeliveryLite = { ...READY, id: 'd-practice-2', practice: true, deliverable: { title: 'Practice script' } };
    const writing: DeliveryLite = { ...READY, id: 'd-writing', status: 'brief-waiting', deliverable: { title: 'Script being written' } };
    const practiceNow: DeliveryLite = { ...READY, id: 'd-shadow', practiceNow: true, deliverable: { title: 'Script at shadow' } };
    const outline: DeliveryLite = { ...READY, id: 'd-outline', servedBy: 'template', deliverable: { title: 'Outline from templates' } };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failedCheck, practice, writing, practiceNow, outline] } });
    await waitFor(() => expect(screen.getAllByText('Sponsor script for episode 14').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Check quality' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Quality check' })).toBeNull();
  });
});

describe('Work: the judge on its own', () => {
  it('shows the verdict the judge gave on its own, that the owner edited the draft after it, and links to the setting', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('workspace.open', { folder: 'ledgerline' });
    await start('#/work?order=o-mehta-sep', { engine });
    const line = await lineOf(await judgeRegion(), 'Books for September');
    expect(within(line).getByText(`Quality check passed: ${PASSED}`)).toBeTruthy();
    expect(within(line).getByText(EDITED)).toBeTruthy();
    expect(within(line).getByRole('link', { name: 'Quality was checked automatically, as your setting says.' }).getAttribute('href')).toBe('#/business/practice');
    expect(within(line).queryByRole('button')).toBeNull();
  });

  it("the automatic call waiting for the first consent shows the setting's words right before Send for quality check", async () => {
    const waiting: DeliveryLite = {
      ...READY,
      judge: {
        status: 'waiting', auto: true, line: JUDGE_ON, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)',
        preview: { digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)' },
      },
    };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [waiting] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    const words = within(line).getByText(JUDGE_ON);
    const send = within(line).getByRole('button', { name: 'Send for quality check' });
    // The setting's words come right before the button, so the owner reads them before sending.
    expect(words.nextElementSibling?.contains(send)).toBe(true);
  });

  it('a call the owner asked for shows no setting words', async () => {
    await start('#/work?order=o-boat-14', { engine: await withAi() });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Check quality' })); });
    await within(line).findByRole('button', { name: 'Send for quality check' });
    expect(within(line).queryByText(JUDGE_ON)).toBeNull();
  });

  it("a call waiting at the run's spend cap shows the engine's line, the cost and Send for quality check", async () => {
    const capped = 'Quality check did not run on its own: this run is at its spend cap. Send it yourself with the cost shown.';
    const waiting: DeliveryLite = {
      ...READY,
      judge: {
        status: 'waiting', auto: true, line: capped, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)',
        preview: { digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'under $0.01 (estimate)' },
      },
    };
    const { calls } = await start('#/work?order=o-boat-14', {
      intercept: { 'venture.delivery.list': () => [waiting], 'venture.delivery.judgeSend': () => withVerdict({ check: 'rules-judge', passed: true, detail: PASSED }) },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(capped)).toBeTruthy();
    expect(within(line).getByText('The quality check uses your own AI. It costs at most under $0.01 (estimate).')).toBeTruthy();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Send for quality check' })); });
    expect(calls.find((c) => c.method === 'venture.delivery.judgeSend')?.params).toEqual({ runId: 'd-ep14-script', digest: 'd'.repeat(64) });
    await waitFor(() => expect(within(line).getByText(`Quality check passed: ${PASSED}`)).toBeTruthy());
  });

  it("a judge that could not run says why, and Check quality tries again", async () => {
    const why = 'Quality check did not run: Your AI refused the key. Check quality to try again.';
    const failed: DeliveryLite = { ...READY, judge: { status: 'failed', preview: null, auto: true, line: why, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: null } };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failed] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(why)).toBeTruthy();
    expect(within(line).getByRole('button', { name: 'Check quality' })).toBeTruthy();
  });


});

describe('the fake engine judges by the engine rules', () => {
  it('previews once, sends once with the digest read, and stores the verdict on the draft', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await allowQuality(engine);
    await expect(engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })).rejects.toMatchObject({ code: 'NO_MODEL_CONNECTED', message: NO_AI });
    await expect(engine.request('venture.delivery.judge', { runId: 'nope' })).rejects.toMatchObject({ code: 'DELIVERY_NOT_FOUND' });
    await expect(engine.request('venture.delivery.judge', { runId: 'd-ep12-script' })).rejects.toMatchObject({ code: 'JUDGE_NOT_READY' });
    await engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'a-test-key-for-the-fake' });
    const preview = (await engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })) as { digest: string; containsClientData: boolean; estimatedMaxCostDisplay: string };
    expect(preview.digest).toMatch(/^[a-f0-9]{64}$/);
    expect(preview.containsClientData).toBe(true);
    expect(await engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })).toEqual(preview);
    await expect(engine.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: 'short' })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    await expect(engine.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: '0'.repeat(64) })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
    await expect(engine.request('venture.delivery.judgeSend', { runId: 'd-ep12-script', digest: preview.digest })).rejects.toMatchObject({ code: 'JUDGE_NOT_WAITING' });
    const view = (await engine.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: preview.digest })) as DeliveryLite;
    expect(view.checks?.find((c) => c.check === 'rules-judge')).toEqual({ check: 'rules-judge', passed: true, detail: PASSED });
    expect(view.judge).toMatchObject({ status: 'done', preview: null, auto: false });
    await expect(engine.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: preview.digest })).rejects.toMatchObject({ code: 'JUDGE_ALREADY_SENT' });
    await expect(engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })).rejects.toMatchObject({ code: 'JUDGE_ALREADY_SENT' });
    const listed = (await engine.request('venture.delivery.list', {})) as DeliveryLite[];
    expect(listed.find((d) => d.id === 'd-ep14-script')?.judge?.status).toBe('done');
  });

  it('refuses a template outline and a draft that is practice at this stage', async () => {
    for (const [change, code, message] of [
      [{ servedBy: 'template' }, 'JUDGE_NOT_READY', 'The quality check reads drafts an agent wrote; this is a template outline.'],
      [{ practiceNow: true }, 'PRACTICE_DRAFT', 'This is a practice draft, so it never goes to a client. To use drafts, set How much it asks you to Approve each.'],
    ] as const) {
      const engine = await withAi();
      const work = (engine as unknown as { work: { reviseRun(biz: string, runId: string, revise: (run: DeliveryLite) => DeliveryLite): DeliveryLite } }).work;
      work.reviseRun('lumen', 'd-ep14-script', (run) => ({ ...run, ...change }));
      await expect(engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })).rejects.toMatchObject({ code, message });
    }
  });

  it('an unchanged quality request has no fixed preview expiry', async () => {
    const engine = await withAi();
    const preview = await engine.request('venture.delivery.judge', { runId: 'd-ep14-script' });
    expect(preview).not.toHaveProperty('expiresAt');
  });

  it("a send the owner asked for records no standing consent; sending the automatic call shown with the setting's words does", async () => {
    const engine = await withAi();
    const asked = (await engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })) as { digest: string };
    await engine.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: asked.digest });
    expect(await engine.request('venture.judge.auto.get', {})).toMatchObject({ auto: true, consentAt: null });

    const again = await withAi();
    const call = (await again.request('venture.delivery.judge', { runId: 'd-ep14-script' })) as { digest: string };
    // The engine's automatic judge leaves the same call waiting with the setting's words when no consent is recorded yet.
    const work = (again as unknown as { work: { reviseRun(biz: string, runId: string, revise: (run: DeliveryLite) => DeliveryLite): DeliveryLite } }).work;
    work.reviseRun('lumen', 'd-ep14-script', (run) => ({ ...run, judge: { ...run.judge!, auto: true, line: JUDGE_ON } }));
    await again.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: call.digest });
    expect(await again.request('venture.judge.auto.get', {})).toMatchObject({ auto: true, consentAt: NOW });
  });

  it('nothing waits before the judge was asked, so a send is refused', async () => {
    const engine = await withAi();
    const listed = (await engine.request('venture.delivery.list', {})) as DeliveryLite[];
    expect(listed.find((d) => d.id === 'd-ep14-script')).toMatchObject({ canAccept: true, acceptBlocked: null });
    await expect(engine.request('venture.delivery.judgeSend', { runId: 'd-ep14-script', digest: 'a'.repeat(64) })).rejects.toMatchObject({ code: 'JUDGE_NOT_WAITING' });
  });
});

async function allowQuality(engine: FakeEngine) {
  const view = await engine.request('venture.client.aiConsent.get', { clientId: 'c-boat' }) as ClientAiConsentView;
  await engine.request('venture.client.aiConsent.agree', { clientId: 'c-boat', disclosureDigest: view.disclosureDigest });
}
it('manual quality requires client permission and cannot revive an old preview after a new grant', async () => {
  const engine = new FakeEngine({ now: () => NOW });
  await engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'a-test-key-for-the-fake' });
  await expect(engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })).rejects.toMatchObject({ code: 'CLIENT_AI_CONSENT_REQUIRED' });
  await allowQuality(engine);
  const old = await engine.request('venture.delivery.judge', { runId: 'd-ep14-script' }) as JudgePreview;
  await engine.request('venture.client.aiConsent.withdraw', { clientId: 'c-boat' });
  await expect(engine.request('venture.delivery.judgeSend', { runId: old.runId, digest: old.digest })).rejects.toMatchObject({ code: 'CLIENT_AI_CONSENT_REQUIRED' });
  await allowQuality(engine);
  await expect(engine.request('venture.delivery.judgeSend', { runId: old.runId, digest: old.digest })).rejects.toMatchObject({ code: 'CLIENT_AI_CONSENT_CHANGED' });
  const fresh = await engine.request('venture.delivery.judge', { runId: old.runId }) as JudgePreview;
  expect(fresh.digest).not.toBe(old.digest);
  await expect(engine.request('venture.delivery.judgeSend', { runId: old.runId, digest: old.digest })).rejects.toMatchObject({ code: 'APPROVAL_STALE' });
  expect((await engine.request('venture.delivery.judgeSend', { runId: fresh.runId, digest: fresh.digest }) as DeliveryLite).judge?.status).toBe('done');
});
