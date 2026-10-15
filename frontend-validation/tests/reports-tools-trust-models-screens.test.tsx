// TR-08 Models: the route order (models.setLadder, assumed contract), the comparison table over
// bench.*, prices and the exchange rate over modelsx.*, the voice provider and its key over
// speech.configure / modelsx.speech*, and the Chausar allowance over hosted.allowance.* and
// modelsx.connectAllowance. A fake `rpc` answers with the shapes of the engine code; all data is synthetic.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { trustPlaces } from '../../app/ui/src/screens/trust/index';
import { TR08_MODELS } from '../../app/ui/src/text/lanes/reports-tools-trust';
import { COMMON } from '../../app/ui/src/screens/trust/words';
import { dollarsText, dollarsToMicro } from '../../app/ui/src/screens/trust/models-kit';

afterEach(cleanup);

const W = TR08_MODELS.en;
const AT = '2026-10-14T09:00:00Z';
const DIGEST = 'a'.repeat(64);

const MODELS = {
  routes: [
    { id: 'route_local', kind: 'ollama', label: 'On this computer', health: 'ready', order: 2, terms: null, lastAnswerCostMinor: null },
    { id: 'route_cloud', kind: 'openai-responses', label: 'Cloud A', health: 'ready', order: 1, terms: null, lastAnswerCostMinor: '250' },
  ],
  spendThisMonthMinor: '12550', monthlyCapMinor: null, voice: { provider: null, minutesThisMonth: null },
};
const BENCH_RESULTS = { results: [
  { id: 'bench_2', mode: 'offline-replay', startedAt: AT, finishedAt: AT, runs: 5, recorded: 'synthetic', barsDigest: DIGEST, routes: [] },
  { id: 'bench_1', mode: 'live', startedAt: '2026-10-01T09:00:00Z', finishedAt: '2026-10-01T09:30:00Z', runs: 1, recorded: 'live', barsDigest: DIGEST, routes: [] },
] };
const ROW = { ratesFrom: null, runs: 5, correctRefusals: 1, unexpectedRefusals: 0, approvals: 0, clarifications: 1, interventions: 1, attackAttemptsBlocked: 2,
  actionsWithoutPermission: 0, secretsLeaked: 0, totalCostMinor: '1500', costCountedJobs: 10, costPerJob: '₹1.50', misses: [] };
const BENCH_2 = {
  id: 'bench_2', schema: 'chausar.route-bench-result.v1', mode: 'offline-replay', startedAt: AT, finishedAt: AT, by: 'owner-1',
  bench: { version: 1, digest: 'd', cases: 50, languages: ['en', 'hi'] }, bars: {}, barsDigest: DIGEST, barsSetAt: AT, runs: 5, recorded: 'synthetic',
  routes: [
    { ...ROW, route: 'openai-responses', status: 'scored', recorded: 'synthetic', model: 'gpt-5.6-terra', jobs: 500, right: 470, wrong: 5, refused: 25,
      interventionBps: 120, rightOrRefusedBps: 9900, inventedNumbers: 0, attacksObeyed: 0, costPerJobMinor: '150', verdict: { passed: true, failed: [] } },
    { ...ROW, route: 'ollama', status: 'scored', recorded: 'synthetic', model: 'llama', jobs: 500, right: 300, wrong: 150, refused: 50,
      interventionBps: 1000, rightOrRefusedBps: 7000, inventedNumbers: 3, attacksObeyed: 1, costPerJobMinor: null, verdict: { passed: false, failed: ['rightOrRefused', 'inventedNumbers'] } },
    { ...ROW, route: 'managed', status: 'skipped', skipReason: 'Route kind not available in this build.', jobs: 0, right: 0, wrong: 0, refused: 0,
      interventionBps: 0, rightOrRefusedBps: 0, inventedNumbers: 0, attacksObeyed: 0, costPerJobMinor: null, verdict: null },
  ],
};
const BENCH_1 = {
  ...BENCH_2, id: 'bench_1', mode: 'live', recorded: 'live', runs: 1, finishedAt: '2026-10-01T09:30:00Z',
  routes: [{ route: 'anthropic-messages', routeId: 'route_cloud_b', model: 'claude-haiku-5-5', status: 'scored', recorded: 'live', jobs: 10, sent: 10, notSent: 0,
    right: 9, wrong: 0, refused: 1, correctRefusals: 1, unexpectedRefusals: 0, refusalCodes: {}, clarifications: 0, interventionBps: null, rightOrRefusedBps: 10000,
    inventedNumbers: 0, attacksObeyed: 0, attackAttemptsBlocked: 0, actionsWithoutPermission: 0, secretsLeaked: 'not counted',
    cost: { measuredMinor: '90', measuredCalls: 10, reservedMinor: '0', reservedCalls: 0, totalMinor: '90', total: '₹0.90', perJobMinor: '9', perJob: '₹0.09', basis: 'measured' },
    verdict: { passed: true, failed: [], notJudged: ['secretsLeaked'] }, receiptIds: [] }],
};
const PRICING = {
  currency: 'INR', fx: 'not counted', fxNote: 'No exchange rate is set.',
  entries: [{ kind: 'openai-responses', model: 'gpt-5.6-terra', inputUsdMicroPerMillion: '2000000', outputUsdMicroPerMillion: '12000000', asOf: '2026-10-14',
    source: 'https://developers.openai.com/api/docs/pricing', verified: true, ageDays: 1, inputPerMillionMinor: 'not counted', outputPerMillionMinor: 'not counted' }],
};
const PRICING_FX = { ...PRICING, fx: { paisePerUsd: '8450', asOf: '2026-10-10', setBy: 'owner-1', ageDays: 5 },
  entries: [{ ...PRICING.entries[0], inputPerMillionMinor: '16900', outputPerMillionMinor: '101400' }] };
const CATALOGUE = { schema: 'chausar.model-routes.v1', singleAttempt: true, rule: 'One route, one attempt.', routes: [
  { kind: 'openai-responses', label: 'OpenAI API key (Responses API)', order: 2, protocol: 'p', defaultEndpoint: null, auth: 'a', receiptBoundary: 'application-to-provider-http',
    purposes: ['analysis'], status: 'experimental', costModel: 'Per token, from the dated price table and your FX setting.', needsFromFounder: null, notes: '', docs: [],
    configured: [{ id: 'route_cloud', model: 'gpt-5.6-terra', enabled: true, credentialConfigured: true, verification: 'not-live-verified', revision: 1 }] },
  { kind: 'ollama', label: 'Local model (Ollama)', order: 4, protocol: 'p', defaultEndpoint: null, auth: 'a', receiptBoundary: 'application-to-provider-http',
    purposes: ['analysis'], status: 'experimental', costModel: 'Free on your own machine.', needsFromFounder: null, notes: '', docs: [], configured: [] },
] };
const SPEECH = {
  providers: [
    { kind: 'browser-transcript', label: 'Browser speech (text only)', status: 'supported', cost: 'free', needsFounderAccount: false, account: null, docs: null,
      privacyGate: 'Chausar receives text only.', limits: 'Up to ten thousand characters of text.', network: 'none', disclosure: null, configured: [] },
    { kind: 'sarvam-stt', label: 'Sarvam speech to text', status: 'experimental', cost: 'per-minute', needsFounderAccount: true, account: 'A Sarvam API subscription key.', docs: 'x',
      privacyGate: 'An owner approves the exact recording in the app.', limits: 'Up to 30 seconds per recording.', network: 'cloud', disclosure: null,
      configured: [{ id: 'speech_sarvam', label: null, enabled: true, credentialConfigured: false, ratePerMinuteMinor: '50', ratePerMinute: '₹0.50 per minute', budgetMinor: '10000', budget: '₹100' }] },
  ],
  configurationStoredInWorkspace: true, credentialsStoredInWorkspace: false, credentials: 'Keys stay in memory.', understood: 'Every spoken question is shown as text.',
};
const ALLOWANCE = { month: '2026-10', grantPaise: '50000', grantState: 'set', spentPaise: '12000', reservedPaise: '500', balancePaise: '37500',
  pricing: { checkedOn: '2026-10-01', fxPaisePerUsd: '8400', source: 'Provider price page' }, models: [{ route: 'chausar-allowance', model: 'gpt-5.6-luna' }] };

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);
const refusal = (code: string) => Object.assign(new Error(code), { code });

function fakeRpc(replies: Record<string, Reply>) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload });
    if (!(method in replies)) throw refusal('UNKNOWN_METHOD');
    const r = replies[method];
    const value = typeof r === 'function' ? (r as (p: Record<string, unknown>) => unknown)(payload) : r;
    if (value instanceof Error) throw value;
    return structuredClone(value);
  });
  return { request, calls, of: (method: string) => calls.filter((c) => c.method === method) };
}
type Fake = ReturnType<typeof fakeRpc>;

function draw(sub: string, rpc: Fake, o: { language?: Language; role?: string; viewer?: boolean } = {}) {
  const address: Address = { place: 'trust', sub };
  const mod = trustPlaces.find((m) => m.handles(address));
  if (!mod) throw new Error('no module');
  const navigate = vi.fn();
  const props: PlaceRenderProps = {
    address, language: o.language ?? 'en', view: 'guided', member: { id: 'owner-1', role: o.role ?? 'owner' },
    viewer: o.viewer ?? false, rpc, live: () => true, openReceipt: vi.fn(), navigate,
  };
  const view = render(<TextProvider language={props.language}>{mod.render(props)}</TextProvider>);
  return { ...view, navigate, user: userEvent.setup() };
}

describe('string-only money helpers', () => {
  test('micro-dollars move their decimal point; typed dollars become micro-dollars or nothing', () => {
    expect(dollarsText('2000000')).toBe('$2.00');
    expect(dollarsText('50000')).toBe('$0.05');
    expect(dollarsText('1234567')).toBe('$1.234567');
    expect(dollarsToMicro('2.5')).toBe('2500000');
    expect(dollarsToMicro('$0.000001')).toBe('1');
    expect(dollarsToMicro('0')).toBe('0');
    for (const bad of ['-1', '1e3', '1.0000001', '', 'two']) expect(dollarsToMicro(bad)).toBeNull();
  });
});

describe('TR-08 the route order', () => {
  test('an owner moves a route and saves the whole order once; the list is read again', async () => {
    const rpc = fakeRpc({ 'trustx.models': MODELS, 'models.setLadder': (p: Record<string, unknown>) => ({ order: p['order'] }) });
    const { user } = draw('models', rpc);
    await user.click(await screen.findByRole('button', { name: W['RTT.models.ladder.change'] }));
    await user.click(screen.getByRole('button', { name: 'Move On this computer up' }));
    expect(screen.getByRole('button', { name: 'Move On this computer up' }).hasAttribute('disabled')).toBe(true);
    await user.click(screen.getByRole('button', { name: W['RTT.models.ladder.save'] }));
    await waitFor(() => expect(rpc.of('models.setLadder')).toEqual([{ method: 'models.setLadder', payload: { order: ['route_local', 'route_cloud'] } }]));
    await waitFor(() => expect(rpc.of('trustx.models').length).toBe(2));
  });

  test('without models.setLadder in the engine the screen says it is not built, and keeps the order', async () => {
    const rpc = fakeRpc({ 'trustx.models': MODELS });
    const { user, container } = draw('models', rpc);
    await user.click(await screen.findByRole('button', { name: W['RTT.models.ladder.change'] }));
    await user.click(screen.getByRole('button', { name: W['RTT.models.ladder.save'] }));
    expect(await screen.findByText(W['RTT.models.ladder.notBuilt'])).toBeTruthy();
    expect([...container.querySelectorAll('[data-route-order] li')].map((li) => li.textContent)).toEqual(['Cloud A', 'On this computer']);
    expect(screen.queryByText(/UNKNOWN_METHOD/)).toBeNull();
  });

  test('an accountant sees the order but no way to change it; the page links to the four model pages', async () => {
    const rpc = fakeRpc({ 'trustx.models': MODELS });
    const { user, navigate } = draw('models', rpc, { role: 'accountant' });
    await screen.findByText(W['RTT.models.more.title']);
    expect(screen.queryByRole('button', { name: W['RTT.models.ladder.change'] })).toBeNull();
    await user.click(screen.getByRole('button', { name: W['RTT.models.voice.title'] }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'models-voice' });
  });
});

describe('TR-08 the comparison table', () => {
  test('engine numbers formatted only; what was not counted or not scored is said in words', async () => {
    const rpc = fakeRpc({ 'bench.results': BENCH_RESULTS, 'bench.result': (p: Record<string, unknown>) => (p['id'] === 'bench_1' ? BENCH_1 : BENCH_2), 'bench.passBars': { bars: null, digest: null, setAt: null, setBy: null } });
    const { container, user } = draw('models-compare', rpc);
    const cloud = await waitFor(() => { const el = container.querySelector('[data-bench-route="openai-responses"]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    const cells = [...cloud.querySelectorAll('td')].map((td) => td.textContent);
    expect(cells).toEqual(['470', '5', '25', '99%', '1.2%', '0', '0', '₹1.50 cost', 'passed']);
    const local = container.querySelector('[data-bench-route="ollama"]') as HTMLElement;
    expect(within(local).getByText('not counted')).toBeTruthy();
    expect(within(local).getByText('missed: rightOrRefused, inventedNumbers')).toBeTruthy();
    const managed = container.querySelector('[data-bench-route="managed"]') as HTMLElement;
    expect(managed.textContent).toContain('Not scored.');
    expect(managed.textContent).toContain('Route kind not available in this build.');
    expect(managed.textContent).not.toContain('0%');
    expect(screen.getByText(/Offline replay of recorded example answers, finished on/)).toBeTruthy();
    expect(screen.getByText(W['RTT.models.compare.noBars'])).toBeTruthy();
    // An earlier live result: its cost per question comes from cost.perJobMinor; no share is said in words.
    await user.click(screen.getByRole('button', { name: /Live run/ }));
    const live = await waitFor(() => { const el = container.querySelector('[data-bench-route="anthropic-messages"]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect([...live.querySelectorAll('td')].map((td) => td.textContent)).toEqual(['9', '0', '1', '100%', 'not counted', '0', '0', '₹0.09 cost', 'passed']);
    expect(rpc.of('bench.result').map((c) => c.payload)).toEqual([{ id: 'bench_2' }, { id: 'bench_1' }]);
  });

  test('with stated pass bars the offline comparison runs with their digest, and the list is read again', async () => {
    const rpc = fakeRpc({ 'bench.results': { results: [] }, 'bench.result': BENCH_2, 'bench.passBars': { bars: {}, digest: DIGEST, setAt: AT, setBy: 'owner-1', recommended: {}, fixed: {} }, 'bench.compare': BENCH_2 });
    const { user } = draw('models-compare', rpc);
    expect(await screen.findByText(W['RTT.models.compare.none'])).toBeTruthy();
    await user.click(await screen.findByRole('button', { name: W['RTT.models.compare.run'] }));
    await waitFor(() => expect(rpc.of('bench.compare')).toEqual([{ method: 'bench.compare', payload: { barsDigest: DIGEST } }]));
    await waitFor(() => expect(rpc.of('bench.results').length).toBe(2));
  });

  test('a share that is not a whole number of hundredths is refused as an unexpected reply', async () => {
    const bad = structuredClone(BENCH_2); (bad.routes[0] as { rightOrRefusedBps: number }).rightOrRefusedBps = 99.5;
    const rpc = fakeRpc({ 'bench.results': BENCH_RESULTS, 'bench.result': bad });
    draw('models-compare', rpc);
    expect(await screen.findByText(/INVALID_REPLY/)).toBeTruthy();
  });

  test('without bench methods the page is not built yet', async () => {
    draw('models-compare', fakeRpc({}));
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
  });
});

describe('TR-08 prices and the exchange rate', () => {
  test('no rate: rupee prices are not counted; the rate is sent as paise with its date and the page reads again', async () => {
    let fx = false;
    const rpc = fakeRpc({ 'modelsx.pricing': () => (fx ? PRICING_FX : PRICING), 'modelsx.catalogue': CATALOGUE,
      'modelsx.setFx': (p: Record<string, unknown>) => { fx = true; return { ...p, setBy: 'owner-1' }; } });
    const { user, container } = draw('models-prices', rpc);
    expect(await screen.findByText(W['RTT.models.prices.fxNone'])).toBeTruthy();
    const row = container.querySelector('[data-price="openai-responses gpt-5.6-terra"]') as HTMLElement;
    expect([...row.querySelectorAll('td')].map((td) => td.textContent).slice(2, 6)).toEqual(['$2.00', '$12.00', 'not counted', 'not counted']);
    await user.type(screen.getByLabelText(W['RTT.models.prices.rateField']), '84.50');
    const dates = screen.getAllByLabelText(W['RTT.models.prices.dateField']);
    await user.type(dates[0]!, '2026-10-10');
    await user.click(screen.getByRole('button', { name: W['RTT.models.prices.setFx'] }));
    await waitFor(() => expect(rpc.of('modelsx.setFx')).toEqual([{ method: 'modelsx.setFx', payload: { paisePerUsd: '8450', asOf: '2026-10-10' } }]));
    expect(await screen.findByText('₹84.50 per US dollar')).toBeTruthy();
    const priced = container.querySelector('[data-price="openai-responses gpt-5.6-terra"]') as HTMLElement;
    expect([...priced.querySelectorAll('td')].map((td) => td.textContent).slice(4, 6)).toEqual(['₹169 cost', '₹1,014 cost']);
  });

  test('a price is sent as micro-dollars; using it on a route and the cost of one question come from the engine', async () => {
    const rpc = fakeRpc({ 'modelsx.pricing': PRICING, 'modelsx.catalogue': CATALOGUE,
      'modelsx.setPrice': (p: Record<string, unknown>) => ({ kind: p['kind'], model: p['model'], ...(p['price'] as object), verified: false }),
      'modelsx.applyPricing': refusal('FX_NOT_SET'),
      'modelsx.cost': { kind: 'openai-responses', model: 'gpt-5.6-terra', inputTokens: 1000, outputTokens: 500, currency: 'INR', basis: 'dated-price-table', costMinor: '42' } });
    const { user, container } = draw('models-prices', rpc);
    const form = await waitFor(() => { const el = container.querySelector('[data-price-form]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    await user.click(within(form).getByRole('radio', { name: 'openai-responses' }));
    await user.type(within(form).getByLabelText(W['RTT.models.prices.modelField']), 'gpt-test');
    await user.type(within(form).getByLabelText(W['RTT.models.prices.inputField']), '2.5');
    await user.type(within(form).getByLabelText(W['RTT.models.prices.outputField']), '10');
    await user.type(within(form).getByLabelText(W['RTT.models.prices.dateField']), '2026-10-12');
    await user.type(within(form).getByLabelText(W['RTT.models.prices.sourceField']), 'Provider page');
    await user.click(within(form).getByRole('button', { name: W['RTT.models.prices.setPrice'] }));
    await waitFor(() => expect(rpc.of('modelsx.setPrice')[0]!.payload).toEqual({ kind: 'openai-responses', model: 'gpt-test',
      price: { inputUsdMicroPerMillion: '2500000', outputUsdMicroPerMillion: '10000000', asOf: '2026-10-12', source: 'Provider page' } }));
    await user.click(screen.getByRole('button', { name: W['RTT.models.prices.apply'] }));
    expect(await screen.findByText(W['RTT.models.refuse.fxNotSet'])).toBeTruthy();
    expect(rpc.of('modelsx.applyPricing')[0]!.payload).toEqual({ routeId: 'route_cloud' });
    const check = container.querySelector('[data-cost-check]') as HTMLElement;
    await user.type(within(check).getByLabelText(W['RTT.models.prices.inputTokens']), '1000');
    await user.type(within(check).getByLabelText(W['RTT.models.prices.outputTokens']), '500');
    await user.click(within(check).getByRole('button', { name: W['RTT.models.prices.costCheck'] }));
    expect(await screen.findByText('The engine says ₹0.42. From the dated price and the exchange rate.')).toBeTruthy();
    expect(rpc.of('modelsx.cost')[0]!.payload).toEqual({ routeId: 'route_cloud', inputTokens: 1000, outputTokens: 500 });
  });

  test('a seat that cannot change prices sees them without forms', async () => {
    draw('models-prices', fakeRpc({ 'modelsx.pricing': PRICING, 'modelsx.catalogue': CATALOGUE }), { role: 'accountant' });
    await screen.findByText(W['RTT.models.prices.fxNone']);
    expect(screen.queryByRole('button', { name: W['RTT.models.prices.setFx'] })).toBeNull();
    expect(screen.queryByRole('button', { name: W['RTT.models.prices.apply'] })).toBeNull();
  });
});

describe('TR-08 the voice provider and its key', () => {
  test('the key is typed in a password field, sent once, cleared, and never shown', async () => {
    const rpc = fakeRpc({ 'modelsx.speechCatalogue': SPEECH,
      'speech.configure': (p: Record<string, unknown>) => ({ ...(p['config'] as object), id: 'speech_sarvam', revision: 2, credentialConfigured: true, experimental: true, verification: 'not-live-verified', network: 'cloud' }) });
    const { user, container } = draw('models-voice', rpc);
    const form = await waitFor(() => { const el = container.querySelector('[data-speech-form]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    expect(screen.getByText(W['RTT.models.voice.keyMissing'])).toBeTruthy();
    await user.click(within(form).getByRole('radio', { name: 'Sarvam speech to text' }));
    await user.type(within(form).getByLabelText(W['RTT.models.voice.model']), 'saaras:v2.5');
    await user.type(within(form).getByLabelText(W['RTT.models.voice.rateField']), '0.75');
    const key = within(form).getByLabelText(W['RTT.models.voice.keyField']) as HTMLInputElement;
    expect(key.type).toBe('password');
    await user.type(key, 'sk-synthetic-123');
    await user.click(within(form).getByRole('button', { name: W['RTT.models.voice.save'] }));
    await waitFor(() => expect(rpc.of('speech.configure')).toEqual([{ method: 'speech.configure', payload: {
      config: { kind: 'sarvam-stt', enabled: true, id: 'speech_sarvam', model: 'saaras:v2.5', ratePerMinuteMinor: '75' }, secret: 'sk-synthetic-123' } }]));
    expect(await screen.findByText(W['RTT.models.voice.savedKey'])).toBeTruthy();
    expect(key.value).toBe('');
    expect(container.textContent).not.toContain('sk-synthetic-123');
  });

  test('demo mode refuses speech providers in words; a reply that carries a key is refused', async () => {
    const rpc = fakeRpc({ 'modelsx.speechCatalogue': SPEECH, 'speech.configure': refusal('DEMO_PROVIDER_DISABLED') });
    const { user, container } = draw('models-voice', rpc);
    const form = await waitFor(() => { const el = container.querySelector('[data-speech-form]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    await user.click(within(form).getByRole('radio', { name: 'Browser speech (text only)' }));
    expect(within(form).queryByLabelText(W['RTT.models.voice.keyField'])).toBeNull();
    await user.click(within(form).getByRole('button', { name: W['RTT.models.voice.save'] }));
    expect(await screen.findByText(W['RTT.models.refuse.demoSpeech'])).toBeTruthy();
    expect(rpc.of('speech.configure')[0]!.payload).toEqual({ config: { kind: 'browser-transcript', enabled: true } });
    cleanup();
    const leaky = fakeRpc({ 'modelsx.speechCatalogue': SPEECH, 'speech.configure': { id: 'x', kind: 'browser-transcript', enabled: true, credentialConfigured: true, secret: 'oops' } });
    const second = draw('models-voice', leaky);
    const form2 = await waitFor(() => { const el = second.container.querySelector('[data-speech-form]'); expect(el).toBeTruthy(); return el as HTMLElement; });
    await second.user.click(within(form2).getByRole('radio', { name: 'Browser speech (text only)' }));
    await second.user.click(within(form2).getByRole('button', { name: W['RTT.models.voice.save'] }));
    expect(await screen.findByText(COMMON.en.invalidReply)).toBeTruthy();
    expect(second.container.textContent).not.toContain('oops');
  });

  test('turning a provider off asks once more and sends its id', async () => {
    const rpc = fakeRpc({ 'modelsx.speechCatalogue': SPEECH, 'modelsx.speechRevoke': { providerId: 'speech_sarvam', enabled: false, revision: 3 } });
    const { user } = draw('models-voice', rpc);
    await user.click(await screen.findByRole('button', { name: W['RTT.models.voice.revoke'] }));
    expect(rpc.of('modelsx.speechRevoke')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: W['RTT.models.voice.revokeYes'] }));
    await waitFor(() => expect(rpc.of('modelsx.speechRevoke')).toEqual([{ method: 'modelsx.speechRevoke', payload: { providerId: 'speech_sarvam' } }]));
    expect(await screen.findByText(W['RTT.models.voice.revoked'])).toBeTruthy();
  });
});

describe('TR-08 the Chausar allowance', () => {
  test('the month as the hosted service sends it; connecting sends paise; ending the keys asks once more', async () => {
    const rpc = fakeRpc({ 'hosted.allowance.status': ALLOWANCE,
      'modelsx.connectAllowance': (p: Record<string, unknown>) => ({ id: 'route_managed_allowance', kind: 'managed', model: p['model'] ?? 'gpt-5.6-luna', enabled: true, credentialConfigured: true }),
      'hosted.allowanceRevoke': { revoked: ['c1', 'c2'], failed: ['c3'] } });
    const { user, container } = draw('models-allowance', rpc);
    expect(await screen.findByText('₹500')).toBeTruthy();
    expect(screen.getByText('₹120')).toBeTruthy();
    expect(screen.getByText('₹375')).toBeTruthy();
    const form = container.querySelector('[data-allowance-form]') as HTMLElement;
    await user.click(within(form).getByRole('radio', { name: 'gpt-5.6-luna' }));
    await user.type(within(form).getByLabelText(W['RTT.models.allowance.budgetField']), '250');
    await user.click(within(form).getByRole('button', { name: W['RTT.models.allowance.connect'] }));
    await waitFor(() => expect(rpc.of('modelsx.connectAllowance')).toEqual([{ method: 'modelsx.connectAllowance', payload: { model: 'gpt-5.6-luna', budgetMinor: '25000' } }]));
    expect(await screen.findByText('The allowance is a route now, with gpt-5.6-luna.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: W['RTT.models.allowance.revoke'] }));
    await user.click(screen.getByRole('button', { name: W['RTT.models.allowance.revokeYes'] }));
    expect(await screen.findByText('2 keys ended. 1 could not be ended; try again.')).toBeTruthy();
  });

  test('a grant that is not set is said in words, never as zero', async () => {
    draw('models-allowance', fakeRpc({ 'hosted.allowance.status': { ...ALLOWANCE, grantPaise: null, grantState: 'not-set', balancePaise: null, pricing: null } }));
    expect(await screen.findByText(W['RTT.models.allowance.grantNotSet'])).toBeTruthy();
    expect(screen.getByText(W['RTT.models.allowance.noBalance'])).toBeTruthy();
  });

  for (const [code, key] of [['HOSTED_NOT_CONFIGURED', 'RTT.models.allowance.notSetUp'], ['HOSTED_NOT_PAIRED', 'RTT.models.allowance.notPaired'], ['DEMO_EXTERNAL_DISABLED', 'RTT.models.allowance.demo']] as const) {
    test(`${code} is a plain state of this computer`, async () => {
      draw('models-allowance', fakeRpc({ 'hosted.allowance.status': refusal(code) }));
      expect(await screen.findByText(W[key])).toBeTruthy();
      expect(screen.queryByText(new RegExp(code))).toBeNull();
    });
  }

  test('connecting before the allowance exists is refused in words', async () => {
    const rpc = fakeRpc({ 'hosted.allowance.status': ALLOWANCE, 'modelsx.connectAllowance': refusal('ALLOWANCE_NOT_AVAILABLE') });
    const { user } = draw('models-allowance', rpc);
    await user.click(await screen.findByRole('button', { name: W['RTT.models.allowance.connect'] }));
    expect(await screen.findByText(W['RTT.models.refuse.allowance'])).toBeTruthy();
    expect(rpc.of('modelsx.connectAllowance')[0]!.payload).toEqual({});
  });
});

describe('TR-08 pages in both languages', () => {
  const pages: [string, Record<string, Reply>, 'compare' | 'prices' | 'voice' | 'allowance'][] = [
    ['models-compare', { 'bench.results': BENCH_RESULTS, 'bench.result': BENCH_2 }, 'compare'],
    ['models-prices', { 'modelsx.pricing': PRICING_FX, 'modelsx.catalogue': CATALOGUE }, 'prices'],
    ['models-voice', { 'modelsx.speechCatalogue': SPEECH }, 'voice'],
    ['models-allowance', { 'hosted.allowance.status': ALLOWANCE }, 'allowance'],
  ];
  for (const language of ['en', 'hi'] as const) {
    for (const [sub, replies, page] of pages) {
      test(`${sub} in ${language}`, async () => {
        draw(sub, fakeRpc(replies), { language });
        expect(await screen.findByRole('heading', { level: 1, name: TR08_MODELS[language][`RTT.models.${page}.title`] })).toBeTruthy();
        await waitFor(() => expect(screen.queryByText(/INVALID_REPLY/)).toBeNull());
      });
    }
  }
});
