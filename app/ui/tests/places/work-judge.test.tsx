import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { EngineError, type DeliveryLite, type MethodName } from '../../src/engine/types';

// Work > order, Ink v2 wave 2 package 2C2 (Q1 screen): the rules judge on a ready draft. "Ask the judge" previews the
// call (venture.delivery.judge), "Send to the judge" sends it with the digest read (venture.delivery.judgeSend), and
// the verdict the engine stored reads as the judge check's own detail, also when the judge ran on its own (judgeAuto).

type Call = { method: string; params: unknown };
interface StartOptions { language?: 'en' | 'hi'; engine?: FakeEngine; intercept?: Partial<Record<MethodName, (params: unknown) => unknown>> }

const NOW = '2026-10-23T10:00:00.000Z';
const PASSED = 'Every rule passed its own floor. Each yes cited something code found in the run.';
const FAILED = 'Failed: tone-fits. Only 0 of 1 vote said yes with checked evidence; this rule needs 1. The judge said: "The reply promises a free first session."';
const UNSETTLED = 'Not settled: goal-met. A vote without checked evidence never counts as a pass. 1 of 1 vote could not be checked, so this rule is not settled.';
const NO_AI = 'Connect an AI for quick work first; the judge runs on your own AI.';
const JUDGE_ON = "The judge reads every draft that goes to a client or the public once it passes the code checks. It runs on your own AI, so your client's words go to your AI with the draft, and each check costs a little.";
const EDITED = "Your edit is your own words, so the judge does not read it. Any verdict here is on the agent's draft.";

async function start(hash: string, options: StartOptions = {}) {
  window.location.hash = hash;
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
/** Lumen with an AI for quick work, so the judge can run on it. */
async function withAi(): Promise<FakeEngine> {
  const engine = new FakeEngine({ now: () => NOW });
  await engine.request('venture.models.connect', { presetId: 'anthropic-haiku-5-5', consentDigest: 'consent-anthropic', apiKey: 'a-test-key-for-the-fake' });
  return engine;
}
const judgeRegion = () => screen.findByRole('region', { name: 'The judge' });
const lineOf = async (scope: HTMLElement, title: string) => (await within(scope).findByText(title)).closest('li')!;

const READY: DeliveryLite = {
  id: 'd-ep14-script', at: '2026-10-21T08:30:00.000Z', orderId: 'o-boat-14', status: 'ready-for-review', practice: false,
  practiceNow: false, servedBy: 'model',
  deliverable: { title: 'Sponsor script for episode 14' }, verdict: null, awaitingYou: true,
  checks: [{ check: 'no-numeric-prose', passed: true, detail: 'No numbers in the prose.' }], canAccept: true, acceptBlocked: null,
};
const withVerdict = (check: NonNullable<DeliveryLite['checks']>[number], extra: Partial<DeliveryLite> = {}): DeliveryLite => ({
  ...READY, checks: [...READY.checks!, check],
  judge: { status: 'done', preview: null, auto: false, estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', line: null, draftDigest: 'f'.repeat(64) },
  ...extra,
});

describe('Work: asking the judge about a ready draft', () => {
  it('a ready draft that passed every check offers Ask the judge; with no AI the engine says why it cannot', async () => {
    const { calls } = await start('#/work?order=o-boat-14');
    const judge = await judgeRegion();
    const line = await lineOf(judge, 'Sponsor script for episode 14');
    expect(within(judge).queryByText('Practice sponsor script')).toBeNull();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Ask the judge' })); });
    expect(calls.find((c) => c.method === 'venture.delivery.judge')?.params).toEqual({ runId: 'd-ep14-script' });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe(`Couldn't ask the judge: ${NO_AI}`));
  });

  it('shows the cost estimate, sends with the digest read, and then reads the verdict as the judge check wrote it', async () => {
    const { calls } = await start('#/work?order=o-boat-14', { engine: await withAi() });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Ask the judge' })); });
    await within(line).findByText('The judge reads this draft on your own AI. It costs at most USD 0.0031 (estimate, price unconfirmed).');
    expect(within(line).getByText("Your client's words go to your AI with the draft.")).toBeTruthy();
    expect(calls.some((c) => c.method === 'venture.delivery.judgeSend')).toBe(false);
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Send to the judge' })); });
    const sent = calls.find((c) => c.method === 'venture.delivery.judgeSend')?.params as { runId: string; digest: string };
    expect(sent.runId).toBe('d-ep14-script');
    expect(sent.digest).toMatch(/^[a-f0-9]{64}$/);
    await waitFor(() => expect(within(line).getByText(`The judge passed this draft: ${PASSED}`)).toBeTruthy());
    expect(within(line).queryByRole('button', { name: 'Ask the judge' })).toBeNull();
    expect(within(line).queryByRole('button', { name: 'Send to the judge' })).toBeNull();
  });

  it("a failed verdict quotes the rule, and says Accept is blocked in the engine's words", async () => {
    const failed = withVerdict({ check: 'rules-judge', passed: false, detail: FAILED }, { canAccept: false, acceptBlocked: `This draft failed a check: ${FAILED} Edit it or reject it.` });
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failed] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(`The judge found a problem: ${FAILED}`)).toBeTruthy();
    expect(within(line).getByText(`Accept is blocked. This draft failed a check: ${FAILED} Edit it or reject it.`)).toBeTruthy();
    expect(within(line).queryByRole('button', { name: 'Ask the judge' })).toBeNull();
  });

  it('a send that comes back failed shows the verdict at once', async () => {
    const failed = withVerdict({ check: 'rules-judge', passed: false, detail: FAILED }, { canAccept: false, acceptBlocked: `This draft failed a check: ${FAILED} Edit it or reject it.` });
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: { 'venture.delivery.judgeSend': () => failed },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Ask the judge' })); });
    await act(async () => { fireEvent.click(await within(line).findByRole('button', { name: 'Send to the judge' })); });
    await waitFor(() => expect(within(line).getByText(`The judge found a problem: ${FAILED}`)).toBeTruthy());
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
      intercept: { 'venture.delivery.judgeSend': () => { throw new EngineError('APPROVAL_STALE', 'The draft changed since you asked the judge. Ask again.'); } },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Ask the judge' })); });
    await act(async () => { fireEvent.click(await within(line).findByRole('button', { name: 'Send to the judge' })); });
    await waitFor(() => expect(within(line).getByRole('alert').textContent).toBe("Couldn't send to the judge: The draft changed since you asked the judge. Ask again."));
  });

  it('after a stale send and a list that says the judge failed, the line offers Ask the judge, not Send', async () => {
    const why = 'The judge did not finish: Ask the judge again; the call you read is no longer available. Ask the judge again.';
    const waiting: DeliveryLite = {
      ...READY,
      judge: { status: 'waiting', auto: false, line: null, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', preview: { digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', expiresAt: '2026-10-23T10:30:00.000Z' } },
    };
    const failedNow: DeliveryLite = { ...READY, judge: { status: 'failed', preview: null, auto: false, line: why, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: null } };
    let stale = false;
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: {
        'venture.delivery.list': () => [stale ? failedNow : waiting],
        'venture.delivery.judge': () => ({ runId: 'd-ep14-script', digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', expiresAt: '2026-10-23T10:30:00.000Z', containsClientData: true }),
        'venture.delivery.judgeSend': () => { stale = true; throw new EngineError('APPROVAL_STALE', 'Ask the judge again; the call you read is no longer available.'); },
      },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Send to the judge' })); });
    await waitFor(() => expect(within(line).getByText(why)).toBeTruthy());
    expect(within(line).getByRole('button', { name: 'Ask the judge' })).toBeTruthy();
    expect(within(line).queryByRole('button', { name: 'Send to the judge' })).toBeNull();
  });

  it('a call the owner read stays only until a send is refused: then the list decides', async () => {
    const why = 'The judge did not finish: Ask the judge again; the call you read is no longer available. Ask the judge again.';
    const failedNow: DeliveryLite = { ...READY, judge: { status: 'failed', preview: null, auto: false, line: why, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: null } };
    let stale = false;
    await start('#/work?order=o-boat-14', {
      engine: await withAi(),
      intercept: {
        'venture.delivery.list': () => [stale ? failedNow : READY],
        'venture.delivery.judge': () => ({ runId: 'd-ep14-script', digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', expiresAt: '2026-10-23T10:30:00.000Z', containsClientData: true }),
        'venture.delivery.judgeSend': () => { stale = true; throw new EngineError('APPROVAL_STALE', 'Ask the judge again; the call you read is no longer available.'); },
      },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Ask the judge' })); });
    await act(async () => { fireEvent.click(await within(line).findByRole('button', { name: 'Send to the judge' })); });
    await waitFor(() => expect(within(line).getByText(why)).toBeTruthy());
    expect(within(line).getByRole('button', { name: 'Ask the judge' })).toBeTruthy();
    expect(within(line).queryByRole('button', { name: 'Send to the judge' })).toBeNull();
  });

  it('a draft with a failed code check, a draft not ready, a practice draft, one practice at this stage and a template outline get no Ask the judge', async () => {
    const failedCheck: DeliveryLite = { ...READY, checks: [{ check: 'house-style', passed: false, detail: 'The draft uses a long dash.' }], canAccept: false, acceptBlocked: 'This draft failed a check: The draft uses a long dash. Edit it or reject it.' };
    const practice: DeliveryLite = { ...READY, id: 'd-practice-2', practice: true, deliverable: { title: 'Practice script' } };
    const writing: DeliveryLite = { ...READY, id: 'd-writing', status: 'brief-waiting', deliverable: { title: 'Script being written' } };
    const practiceNow: DeliveryLite = { ...READY, id: 'd-shadow', practiceNow: true, deliverable: { title: 'Script at shadow' } };
    const outline: DeliveryLite = { ...READY, id: 'd-outline', servedBy: 'template', deliverable: { title: 'Outline from templates' } };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failedCheck, practice, writing, practiceNow, outline] } });
    await waitFor(() => expect(screen.getAllByText('Sponsor script for episode 14').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: 'Ask the judge' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'The judge' })).toBeNull();
  });
});

describe('Work: the judge on its own', () => {
  it('shows the verdict the judge gave on its own, that the owner edited the draft after it, and links to the setting', async () => {
    const engine = new FakeEngine({ now: () => NOW });
    await engine.request('workspace.open', { folder: 'ledgerline' });
    await start('#/work?order=o-mehta-sep', { engine });
    const line = await lineOf(await judgeRegion(), 'Books for September');
    expect(within(line).getByText(`The judge passed this draft: ${PASSED}`)).toBeTruthy();
    expect(within(line).getByText(EDITED)).toBeTruthy();
    expect(within(line).getByRole('link', { name: 'The judge read it on its own, as your setting says.' }).getAttribute('href')).toBe('#/business/practice');
    expect(within(line).queryByRole('button')).toBeNull();
  });

  it("the automatic call waiting for the first consent shows the setting's words right before Send to the judge", async () => {
    const waiting: DeliveryLite = {
      ...READY,
      judge: {
        status: 'waiting', auto: true, line: JUDGE_ON, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)',
        preview: { digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', expiresAt: '2026-10-23T10:30:00.000Z' },
      },
    };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [waiting] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    const words = within(line).getByText(JUDGE_ON);
    const send = within(line).getByRole('button', { name: 'Send to the judge' });
    // The setting's words come right before the button, so the owner reads them before sending.
    expect(words.nextElementSibling?.contains(send)).toBe(true);
  });

  it('a call the owner asked for shows no setting words', async () => {
    await start('#/work?order=o-boat-14', { engine: await withAi() });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Ask the judge' })); });
    await within(line).findByRole('button', { name: 'Send to the judge' });
    expect(within(line).queryByText(JUDGE_ON)).toBeNull();
  });

  it("a call waiting at the run's spend cap shows the engine's line, the cost and Send to the judge", async () => {
    const capped = 'The judge did not run on its own: this run is at its spend cap. Send it yourself with the cost shown.';
    const waiting: DeliveryLite = {
      ...READY,
      judge: {
        status: 'waiting', auto: true, line: capped, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)',
        preview: { digest: 'd'.repeat(64), estimatedMaxCostDisplay: 'USD 0.0031 (estimate, price unconfirmed)', expiresAt: '2026-10-23T10:15:00.000Z' },
      },
    };
    const { calls } = await start('#/work?order=o-boat-14', {
      intercept: { 'venture.delivery.list': () => [waiting], 'venture.delivery.judgeSend': () => withVerdict({ check: 'rules-judge', passed: true, detail: PASSED }) },
    });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(capped)).toBeTruthy();
    expect(within(line).getByText('The judge reads this draft on your own AI. It costs at most USD 0.0031 (estimate, price unconfirmed).')).toBeTruthy();
    await act(async () => { fireEvent.click(within(line).getByRole('button', { name: 'Send to the judge' })); });
    expect(calls.find((c) => c.method === 'venture.delivery.judgeSend')?.params).toEqual({ runId: 'd-ep14-script', digest: 'd'.repeat(64) });
    await waitFor(() => expect(within(line).getByText(`The judge passed this draft: ${PASSED}`)).toBeTruthy());
  });

  it("a judge that could not run says why, and Ask the judge tries again", async () => {
    const why = 'The judge did not run: Your AI refused the key. Ask the judge to try again.';
    const failed: DeliveryLite = { ...READY, judge: { status: 'failed', preview: null, auto: true, line: why, draftDigest: 'e'.repeat(64), estimatedMaxCostDisplay: null } };
    await start('#/work?order=o-boat-14', { intercept: { 'venture.delivery.list': () => [failed] } });
    const line = await lineOf(await judgeRegion(), 'Sponsor script for episode 14');
    expect(within(line).getByText(why)).toBeTruthy();
    expect(within(line).getByRole('button', { name: 'Ask the judge' })).toBeTruthy();
  });

  it('reads in Hindi too', async () => {
    await start('#/work?order=o-boat-14', { language: 'hi' });
    await waitFor(() => expect(document.body.querySelector('[data-judge-line="d-ep14-script"] button')).not.toBeNull());
    expect(screen.queryByRole('button', { name: 'Ask the judge' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'The judge' })).toBeNull();
  });
});

describe('the fake engine judges by the engine rules', () => {
  it('previews once, sends once with the digest read, and stores the verdict on the draft', async () => {
    const engine = new FakeEngine({ now: () => NOW });
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
      [{ servedBy: 'template' }, 'JUDGE_NOT_READY', 'The judge reads drafts an agent wrote; this is a template outline.'],
      [{ practiceNow: true }, 'PRACTICE_DRAFT', 'Practice drafts are not for clients. Move to approve each to use drafts.'],
    ] as const) {
      const engine = await withAi();
      const work = (engine as unknown as { work: { reviseRun(biz: string, runId: string, revise: (run: DeliveryLite) => DeliveryLite): DeliveryLite } }).work;
      work.reviseRun('lumen', 'd-ep14-script', (run) => ({ ...run, ...change }));
      await expect(engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })).rejects.toMatchObject({ code, message });
    }
  });

  it('a call waits thirty minutes, as the model port keeps a preview', async () => {
    const engine = await withAi();
    const preview = (await engine.request('venture.delivery.judge', { runId: 'd-ep14-script' })) as { expiresAt: string };
    expect(preview.expiresAt).toBe('2026-10-23T10:30:00.000Z');
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
