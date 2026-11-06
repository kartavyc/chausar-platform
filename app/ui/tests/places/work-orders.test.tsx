import { describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { App } from '../../src/shell/App';
import { FakeEngine, createFakeClient } from '../../src/engine/fake';
import { orderView, previousFailure } from '../../src/places/work/orders';
import { fileProblem } from '../../src/places/work/files';
import { EngineError, type BlueprintViewLite, type DeliveryLite, type InvoiceLite, type MethodName, type OrderLite, type RunSummary, type UploadLite } from '../../src/engine/types';

const order = (over: Partial<OrderLite> = {}): OrderLite => ({
  id: 'o1', at: '2026-10-20T09:00:00.000Z', clientId: 'c1', offerId: 'offer_1', quantity: '1', request: 'Books for October',
  status: 'open', priceReceiptId: 'R-1', deliveredOn: null, ...over,
});
const run = (status: DeliveryLite['status'], over: Partial<DeliveryLite> = {}): DeliveryLite => ({
  id: `d-${status}`, at: '2026-10-21T09:00:00.000Z', orderId: 'o1', status, practice: false, deliverable: null, verdict: null, ...over,
});
const invoice = (status: InvoiceLite['status'], over: Partial<InvoiceLite> = {}): InvoiceLite => ({
  id: `i-${status}`, at: '2026-10-21T10:00:00.000Z', orderId: 'o1', clientId: 'c1', number: status === 'draft' ? null : 'INV-0041', status,
  issueDate: null, dueDate: null, ...over,
});
const summary = (runId: string, state: RunSummary['state']): RunSummary => ({ runId, businessId: 'b', agent: 'Bookkeeper', purpose: 'Draft a reply', state, startedAt: '', elapsed: '1m' });

describe('an order in one plain state', () => {
  it('received: nothing has run yet, and it can start', () => {
    const view = orderView(order(), [], []);
    expect(view.state).toBe('received');
    expect(view.action).toBe('start');
  });

  it('working, or waiting on you, from the engine run state when there is one', () => {
    expect(orderView(order(), [run('brief-waiting')], [], [summary('d-brief-waiting', 'active')]).state).toBe('working');
    expect(orderView(order(), [run('brief-waiting')], [], [summary('d-brief-waiting', 'waiting')]).state).toBe('waiting');
    expect(orderView(order(), [run('needs-answer')], []).state).toBe('waiting');
    expect(orderView(order(), [run('waiting-for-you', { awaitingYou: false })], []).state).toBe('working');
    expect(orderView(order(), [run('brief-waiting')], []).state).toBe('working');
    expect(orderView(order(), [run('needs-answer')], []).action).toBeUndefined();
  });

  it('draft ready, approved, sent back and stopped follow the newest run', () => {
    expect(orderView(order(), [run('ready-for-review')], []).state).toBe('draft-ready');
    const approved = orderView(order(), [run('accepted')], []);
    expect(approved.state).toBe('approved');
    expect(approved.action).toBe('deliver');
    expect(orderView(order(), [run('edited')], []).state).toBe('approved');
    const back = orderView(order(), [run('rejected')], []);
    expect(back.state).toBe('returned');
    expect(back.action).toBe('run-again');
    const stopped = orderView(order(), [run('failed')], []);
    expect(stopped.state).toBe('stopped');
    expect(stopped.action).toBe('run-again');
  });

  it('only the newest run counts, and a later run on the same moment wins', () => {
    const older = run('failed', { id: 'd1', at: '2026-10-20T09:00:00.000Z' });
    const newer = run('ready-for-review', { id: 'd2', at: '2026-10-21T09:00:00.000Z' });
    expect(orderView(order(), [newer, older], []).state).toBe('draft-ready');
    expect(orderView(order(), [older, newer], []).run?.id).toBe('d2');
    const same = [run('failed', { id: 'a', at: 'x' }), run('accepted', { id: 'b', at: 'x' })];
    expect(orderView(order(), same, []).run?.id).toBe('b');
    expect(orderView(order(), [run('failed', { orderId: 'other' })], []).state).toBe('received');
  });

  it('a practice draft is never shown as one for the client', () => {
    expect(orderView(order(), [run('ready-for-review', { practice: true })], []).state).toBe('practice');
    const practice = orderView(order(), [run('accepted', { practice: true })], []);
    expect(practice.state).toBe('practice');
    expect(practice.action).toBeUndefined();
  });

  it('delivered, then invoiced, then paid, whatever the runs say', () => {
    const delivered = orderView(order({ status: 'delivered', deliveredOn: '2026-10-21' }), [run('accepted')], []);
    expect(delivered.state).toBe('delivered');
    expect(delivered.action).toBeUndefined();
    expect(delivered.draftInvoice).toBe(false);
    expect(orderView(order({ status: 'delivered', deliveredOn: '2026-10-21' }), [], [invoice('draft')]).draftInvoice).toBe(true);
    const invoiced = orderView(order({ status: 'invoiced' }), [run('accepted')], [invoice('issued')]);
    expect(invoiced.state).toBe('invoiced');
    expect(invoiced.invoice?.number).toBe('INV-0041');
    expect(invoiced.action).toBe('deliver');
    expect(orderView(order({ status: 'invoiced' }), [], []).state).toBe('invoiced');
    expect(orderView(order(), [], [invoice('part-paid')]).partPaid).toBe(true);
    expect(orderView(order({ status: 'delivered', deliveredOn: '2026-10-21' }), [], [invoice('paid')]).state).toBe('paid');
    expect(orderView(order(), [], [invoice('void')]).state).toBe('received');
  });

  it('cancelled overrides everything and offers nothing', () => {
    const view = orderView(order({ status: 'cancelled' }), [run('failed')], [invoice('issued')]);
    expect(view.state).toBe('cancelled');
    expect(view.action).toBeUndefined();
  });

  it('only an open order starts or runs again', () => {
    expect(orderView(order({ status: 'invoiced' }), [run('failed')], []).action).toBeUndefined();
  });
});

describe('a failed run', () => {
  it('says its real error, else the summary result, else nothing', () => {
    expect(previousFailure({ ...summary('r1', 'failed'), result: 'Stopped: no ffmpeg.' }, 'The renderer stopped: ffmpeg was not found.')).toBe('The renderer stopped: ffmpeg was not found.');
    expect(previousFailure({ ...summary('r1', 'failed'), result: 'Stopped: no ffmpeg.' }, undefined)).toBe('Stopped: no ffmpeg.');
    expect(previousFailure(summary('r1', 'failed'), undefined)).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------------------------------------------
// Rights at intake. Lumen's "Shorts from your long video" is the YouTube playbook's own-footage offer: the engine
// refuses its order with RIGHTS_REQUIRED unless the order says whose footage it is. The sheet asks for exactly what
// the plan says the offer accepts (BlueprintViewLite.intake).
// ---------------------------------------------------------------------------------------------------------------

type Call = { method: string; params: unknown };
type Intercept = Partial<Record<MethodName, (params: unknown) => unknown>>;
const FIELDS = ['format', 'aiVoice', 'aiPresenter', 'paidPromotion', 'cutFile'] as const;

/** Lumen, with its shorts offer priced so it can be ordered. */
async function lumen() {
  const engine = new FakeEngine();
  await engine.request('venture.blueprint.update', { patch: { offers: [{ id: 'offer_shorts', unitPrice: '8000' }] } });
  return engine;
}

async function openOrder(engine: FakeEngine, intercept: Intercept = {}) {
  window.location.hash = '#/work';
  const client = createFakeClient(engine);
  const calls: Call[] = [];
  const request = client.request.bind(client);
  client.request = ((method: MethodName, params?: unknown) => {
    calls.push({ method, params });
    const own = intercept[method];
    if (own) return Promise.resolve().then(() => own(params));
    return request(method, params as never);
  }) as typeof client.request;
  render(<App client={client} language="en" />);
  await act(async () => { fireEvent.click(await screen.findByRole('button', { name: 'New order' })); window.dispatchEvent(new HashChangeEvent('hashchange')); });
  const sheet = await screen.findByRole('complementary', { name: 'New order' });
  const clientField = await within(sheet).findByLabelText('Client');
  await within(clientField).findByRole('option', { name: 'Boat Audio' });
  const service = within(sheet).getByLabelText('Service');
  await within(service).findByRole('option', { name: 'Shorts from your long video' });
  fireEvent.change(clientField, { target: { value: 'c-boat' } });
  fireEvent.change(within(sheet).getByLabelText('What they asked for'), { target: { value: 'Six shorts from episode 15' } });
  const add = () => within(sheet).getByRole('button', { name: 'Add order' }) as HTMLButtonElement;
  return { calls, sheet, service, add };
}
const created = (calls: Call[]) => calls.find((c) => c.method === 'venture.order.create')?.params as Record<string, unknown> | undefined;

describe('a new order for an offer that cuts footage', () => {
  it("asks whose footage it is and what the checks need, and sends that with the order", async () => {
    const { calls, sheet, service, add } = await openOrder(await lumen());
    fireEvent.change(service, { target: { value: 'offer_shorts' } });
    const rights = within(sheet).getByRole('group', { name: 'Rights to the footage' });
    // The shorts offer takes only the client's own footage, so that is the one choice, already chosen.
    expect(within(rights).getAllByRole('radio').map((r) => (r as HTMLInputElement).labels?.[0]?.textContent)).toEqual(["The client's own footage"]);
    expect((within(rights).getByRole('radio', { name: "The client's own footage" }) as HTMLInputElement).checked).toBe(true);
    expect(within(sheet).queryByLabelText('Licence reference')).toBeNull();
    expect(add().disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Who owns the footage'), { target: { value: 'Boat Audio' } });
    expect(add().disabled).toBe(false);
    fireEvent.click(within(within(sheet).getByRole('group', { name: 'Long video or Shorts' })).getByRole('radio', { name: 'Shorts' }));
    fireEvent.click(within(sheet).getByRole('checkbox', { name: 'Uses an AI voice' }));
    expect(within(sheet).getByLabelText('Finished cut on this computer')).toBeTruthy();
    await act(async () => { fireEvent.click(add()); });
    expect(created(calls)).toEqual({
      clientId: 'c-boat', offerId: 'offer_shorts', request: 'Six shorts from episode 15',
      intake: { rights: { basis: 'own-footage', holder: 'Boat Audio' }, format: 'short', aiVoice: true, aiPresenter: false, paidPromotion: false },
    });
    expect(await screen.findByText('Six shorts from episode 15')).toBeTruthy();
  });

  it('a licence or a clip programme needs its reference, and the reference goes with the order', async () => {
    const engine = await lumen();
    const view = (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
    const clips: BlueprintViewLite = { ...view, intake: { offer_shorts: { rights: ['licence', 'creator-clip-programme'], fields: [...FIELDS] } } };
    const { calls, sheet, service, add } = await openOrder(engine, {
      'venture.blueprint.get': () => clips,
      'venture.order.create': (params) => ({ id: 'o-clips', at: '2026-10-21T10:00:00.000Z', clientId: 'c-boat', offerId: 'offer_shorts', quantity: '1', request: (params as { request: string }).request, status: 'open', priceReceiptId: 'R-1', deliveredOn: null }),
    });
    fireEvent.change(service, { target: { value: 'offer_shorts' } });
    const rights = within(sheet).getByRole('group', { name: 'Rights to the footage' });
    expect(within(rights).queryByRole('radio', { name: "The client's own footage" })).toBeNull();
    fireEvent.click(within(rights).getByRole('radio', { name: 'A licence from the rights holder' }));
    fireEvent.change(within(sheet).getByLabelText('Who owns the footage'), { target: { value: 'The Big Show' } });
    expect(add().disabled).toBe(true);
    fireEvent.change(within(sheet).getByLabelText('Licence reference'), { target: { value: 'LIC-2026-14' } });
    expect(add().disabled).toBe(false);
    fireEvent.click(within(rights).getByRole('radio', { name: "The creator's clip programme" }));
    expect(within(sheet).queryByLabelText('Licence reference')).toBeNull();
    fireEvent.change(within(sheet).getByLabelText('Programme reference'), { target: { value: 'https://bigshow.example/clips' } });
    await act(async () => { fireEvent.click(add()); });
    expect((created(calls)?.intake as { rights: unknown }).rights).toEqual({ basis: 'creator-clip-programme', holder: 'The Big Show', reference: 'https://bigshow.example/clips' });
  });

  it('says plainly when the engine still refuses for rights, and keeps what was typed', async () => {
    const { sheet, service, add } = await openOrder(await lumen(), {
      'venture.order.create': () => { throw new EngineError('RIGHTS_REQUIRED', 'The rights to this footage ended on 2026-09-30.'); },
    });
    fireEvent.change(service, { target: { value: 'offer_shorts' } });
    fireEvent.change(within(sheet).getByLabelText('Who owns the footage'), { target: { value: 'Boat Audio' } });
    await act(async () => { fireEvent.click(add()); });
    expect(await within(sheet).findByText("The rights don't cover this order. The rights to this footage ended on 2026-09-30.")).toBeTruthy();
    expect((within(sheet).getByLabelText('Who owns the footage') as HTMLInputElement).value).toBe('Boat Audio');
  });

  it('a service that cuts no footage asks nothing about rights and sends no intake', async () => {
    const { calls, sheet, service, add } = await openOrder(await lumen());
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    expect(within(sheet).queryByRole('group', { name: 'Rights to the footage' })).toBeNull();
    expect(within(sheet).queryByRole('checkbox', { name: 'Uses an AI voice' })).toBeNull();
    await act(async () => { fireEvent.click(add()); });
    expect(created(calls)).toEqual({ clientId: 'c-boat', offerId: 'offer_sponsor', request: 'Six shorts from episode 15' });
  });
});

// A social agency's content calendar asks for its calendar and the client's own word lists (Ink v2 wave 2): the
// engine plans the dated slots from what the sheet sends, and the checks read the lists.
describe('a new order for a content calendar', () => {
  const socialView = async (engine: FakeEngine): Promise<BlueprintViewLite> => {
    const view = (await engine.request('venture.blueprint.get', {})) as BlueprintViewLite;
    return { ...view, intake: { offer_sponsor: { rights: [], fields: ['aiVoice', 'aiPresenter', 'paidPromotion', 'calendar', 'clientRules'] } } };
  };
  const made = (params: unknown) => ({
    id: 'o-cal', at: '2026-10-21T10:00:00.000Z', clientId: 'c-boat', offerId: 'offer_sponsor', quantity: '1', request: (params as { request: string }).request,
    status: 'open', priceReceiptId: 'R-1', deliveredOn: null,
  });

  it("asks for the month, channels, posts and weekdays, and the client's word lists, and sends them with the order", async () => {
    const engine = await lumen();
    const social = await socialView(engine);
    const { calls, sheet, service, add } = await openOrder(engine, { 'venture.blueprint.get': () => social, 'venture.order.create': made });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    const calendar = within(sheet).getByRole('group', { name: 'Posting calendar' });
    fireEvent.change(within(calendar).getByLabelText('Month'), { target: { value: '2026-11' } });
    fireEvent.click(within(calendar).getByRole('checkbox', { name: 'LinkedIn' }));
    fireEvent.click(within(calendar).getByRole('checkbox', { name: 'Instagram' }));
    fireEvent.change(within(calendar).getByLabelText('Posts per channel'), { target: { value: '3' } });
    for (const day of ['Friday', 'Monday', 'Wednesday']) fireEvent.click(within(calendar).getByRole('checkbox', { name: day }));
    const words = within(sheet).getByRole('group', { name: "Your client's words" });
    fireEvent.change(within(words).getByLabelText('Words to avoid'), { target: { value: 'cheap, guaranteed results' } });
    fireEvent.change(within(words).getByLabelText('Competitors'), { target: { value: 'Yoga Hub' } });
    fireEvent.change(within(words).getByLabelText('Their own names, never flagged'), { target: { value: 'Cheap Seats Yoga' } });
    expect(add().disabled).toBe(false);
    await act(async () => { fireEvent.click(add()); });
    expect(created(calls)?.intake).toEqual({
      aiVoice: false, aiPresenter: false, paidPromotion: false,
      calendar: { month: '2026-11', channels: ['linkedin', 'instagram'], postsPerChannel: 3, weekdays: [1, 3, 5] },
      clientRules: { bannedWords: ['cheap', 'guaranteed results'], bannedTopics: [], competitors: ['Yoga Hub'], protectedPhrases: ['Cheap Seats Yoga'] },
    });
  });

  it('sends no calendar while the month is empty, and no word lists while they are empty', async () => {
    const engine = await lumen();
    const social = await socialView(engine);
    const { calls, service, add } = await openOrder(engine, { 'venture.blueprint.get': () => social, 'venture.order.create': made });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    await act(async () => { fireEvent.click(add()); });
    expect(created(calls)?.intake).toEqual({ aiVoice: false, aiPresenter: false, paidPromotion: false });
  });

  it('says the engine\'s words when it refuses the calendar, and keeps what was typed', async () => {
    const engine = await lumen();
    const social = await socialView(engine);
    const { sheet, service, add } = await openOrder(engine, {
      'venture.blueprint.get': () => social,
      'venture.order.create': () => { throw new EngineError('INVALID_VENTURE_REQUEST', '2026-11 has 13 posting days on the weekdays you picked, fewer than the posts per channel. Add a weekday or post less.'); },
    });
    fireEvent.change(service, { target: { value: 'offer_sponsor' } });
    const calendar = within(sheet).getByRole('group', { name: 'Posting calendar' });
    fireEvent.change(within(calendar).getByLabelText('Month'), { target: { value: '2026-11' } });
    await act(async () => { fireEvent.click(add()); });
    expect(await within(sheet).findByText(/13 posting days on the weekdays you picked/)).toBeTruthy();
    expect((within(calendar).getByLabelText('Month') as HTMLInputElement).value).toBe('2026-11');
  });
});

describe('the fake engine keeps the rights rule', () => {
  it('refuses an order for a footage offer without rights it accepts, and keeps one with them', async () => {
    const engine = await lumen();
    const base = { clientId: 'c-boat', offerId: 'offer_shorts', request: 'Six shorts from episode 15' };
    const refused = (params: unknown) => expect(engine.request('venture.order.create', params as never)).rejects.toMatchObject({ code: 'RIGHTS_REQUIRED' });
    await refused(base);
    await refused({ ...base, intake: { rights: { basis: 'own-footage', holder: ' ' } } });
    await refused({ ...base, intake: { rights: { basis: 'licence', holder: 'The Big Show', reference: 'LIC-1' } } });
    const order = (await engine.request('venture.order.create', { ...base, intake: { rights: { basis: 'own-footage', holder: 'Boat Audio' }, format: 'short' } })) as OrderLite;
    expect(order.offerId).toBe('offer_shorts');
    await expect(engine.request('venture.order.create', { clientId: 'c-boat', offerId: 'offer_sponsor', request: 'One mention', intake: { rights: { basis: 'own-footage', holder: 'Boat Audio' } } }))
      .rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
  });
});

describe('transcripts from the client', () => {
  it('the sheet takes SRT and VTT files under the size limit', () => {
    expect(fileProblem({ name: 'episode.srt', size: 4000 })).toBeNull();
    expect(fileProblem({ name: 'episode.VTT', size: 4000 })).toBeNull();
    expect(fileProblem({ name: 'episode.srt', size: 2_000_000 })).toBe('size');
    expect(fileProblem({ name: 'notes.txt', size: 40 })).toBe('type');
  });

  it('the fake engine keeps them as transcripts', async () => {
    const engine = new FakeEngine();
    const content = btoa('1\n00:00:00,000 --> 00:00:04,000\nWhy your savings shrink.\n');
    const srt = (await engine.request('venture.files.add', { orderId: 'o-boat-14', name: 'episode.srt', contentBase64: content })) as { format: string };
    expect(srt.format).toBe('transcript');
    const vtt = (await engine.request('venture.files.add', { orderId: 'o-boat-14', name: 'episode.vtt', contentBase64: content })) as { format: string };
    expect(vtt.format).toBe('transcript');
  });
});

// A transcript made on this computer (Ink v2 wave 2, 2E2): an order whose intake names the finished cut, and that has
// no transcript yet, offers to make one with the ffmpeg and whisper.cpp already on this computer (desktop only).
describe('a transcript made on this computer', () => {
  const CUT = 'D:\\footage\\episode-15.mp4';
  /** Lumen with a shorts order: its cut named at intake, or not. */
  async function footage(cutFile: string | null) {
    const engine = await lumen();
    const intake = { rights: { basis: 'own-footage', holder: 'Boat Audio' }, format: 'short' as const, ...(cutFile ? { cutFile } : {}) };
    const order = (await engine.request('venture.order.create', { clientId: 'c-boat', offerId: 'offer_shorts', request: 'Six shorts from episode 15', intake })) as OrderLite;
    return { engine, order };
  }
  function show(engine: FakeEngine, orderId: string, options: { intercept?: Intercept; hosted?: boolean } = {}) {
    window.location.hash = `#/work?order=${orderId}`;
    const client = createFakeClient(engine);
    const calls: Call[] = [];
    const request = client.request.bind(client);
    client.request = ((method: MethodName, params?: unknown) => {
      calls.push({ method, params });
      const own = options.intercept?.[method];
      if (own) return Promise.resolve().then(() => own(params));
      return request(method, params as never);
    }) as typeof client.request;
    render(<App client={options.hosted ? { ...client, transport: 'hosted' } : client} language="en" />);
    return calls;
  }
  const MAKE = 'Make a transcript on this computer';

  it('an order with a cut and no transcript offers it; it calls the engine, then lists the transcript as an order file', async () => {
    const { engine, order } = await footage(CUT);
    const calls = show(engine, order.id);
    const make = await screen.findByRole('button', { name: MAKE });
    expect(screen.getByText('Uses the ffmpeg and whisper.cpp already on this computer. Nothing is uploaded or installed.')).toBeTruthy();
    // Before the owner starts: one quiet line naming the cut file it will read.
    expect(screen.getByText('Reads the cut episode-15.mp4 on this computer.')).toBeTruthy();
    await act(async () => { fireEvent.click(make); });
    expect(calls.filter((c) => c.method === 'venture.files.transcribe').map((c) => c.params)).toEqual([{ orderId: order.id }]);
    expect(await screen.findByText('Transcript: episode-15.srt')).toBeTruthy();
    expect(screen.getByText('Made on this computer from the cut.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: MAKE })).toBeNull();
    const files = (await engine.request('venture.files.list', { orderId: order.id })) as UploadLite[];
    // The fake keeps where it came from on the file itself, as the engine does.
    expect(files.map((f) => [f.name, f.format, f.origin])).toEqual([['episode-15.srt', 'transcript', 'local-transcription']]);
  });

  it("shows the engine's words when it refuses, and keeps the button", async () => {
    const { engine, order } = await footage(CUT);
    show(engine, order.id, { intercept: { 'venture.files.transcribe': () => { throw new EngineError('TRANSCRIBE_NOT_AVAILABLE', 'ffmpeg not found on this computer. Chausar never installs it.'); } } });
    const make = await screen.findByRole('button', { name: MAKE });
    await act(async () => { fireEvent.click(make); });
    expect(await screen.findByText("Couldn't make the transcript: ffmpeg not found on this computer. Chausar never installs it.")).toBeTruthy();
    expect(screen.getByRole('button', { name: MAKE })).toBeTruthy();
  });

  it('is not offered for an order that names no cut', async () => {
    const plain = await footage(null);
    show(plain.engine, plain.order.id);
    await screen.findByRole('heading', { name: 'Runs' });
    expect(screen.queryByRole('button', { name: MAKE })).toBeNull();
  });

  it('is not offered when the client sent a transcript, which is listed as theirs', async () => {
    const sent = await footage(CUT);
    await sent.engine.request('venture.files.add', { orderId: sent.order.id, name: 'episode.srt', contentBase64: btoa('1\n00:00:00,000 --> 00:00:04,000\nWhy your savings shrink.\n') });
    show(sent.engine, sent.order.id);
    expect(await screen.findByText('Transcript: episode.srt')).toBeTruthy();
    expect(screen.queryByText('Made on this computer from the cut.')).toBeNull();
    expect(screen.queryByRole('button', { name: MAKE })).toBeNull();
  });

  it('is not offered on the hosted server, which reads no file on your computer', async () => {
    const hosted = await footage(CUT);
    show(hosted.engine, hosted.order.id, { hosted: true });
    await screen.findByRole('heading', { name: 'Runs' });
    expect(screen.queryByRole('button', { name: MAKE })).toBeNull();
  });

  it('the fake engine keeps the rules: no cut, a transcript already there and the hosted server are refused', async () => {
    const plain = await footage(null);
    await expect(plain.engine.request('venture.files.transcribe', { orderId: plain.order.id })).rejects.toMatchObject({ code: 'INVALID_VENTURE_REQUEST' });
    const made = await footage(CUT);
    const upload = (await made.engine.request('venture.files.transcribe', { orderId: made.order.id })) as UploadLite;
    expect([upload.name, upload.format, upload.origin]).toEqual(['episode-15.srt', 'transcript', 'local-transcription']);
    await expect(made.engine.request('venture.files.transcribe', { orderId: made.order.id })).rejects.toMatchObject({ code: 'TRANSCRIPT_EXISTS' });
    const hosted = new FakeEngine({ hosted: true });
    await expect(hosted.request('venture.files.transcribe', { orderId: 'o-boat-14' })).rejects.toMatchObject({ code: 'TIER_UNAVAILABLE' });
    // The fake's own way of keeping a transcript made here is not a method its public request answers.
    await expect(made.engine.request('fake.files.keepMade' as never, { orderId: made.order.id, name: 'x.srt', contentBase64: btoa('1\n00:00:00,000 --> 00:00:01,000\nHi\n') } as never)).rejects.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });
});
