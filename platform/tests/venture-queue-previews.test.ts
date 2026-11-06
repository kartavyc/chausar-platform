// Ink v2 wave 4, package 4J3 (W3's U8): the previews Today's cards show before they are opened. Each comes from the
// owner's own records: a video's package, length and checks; an invoice's paper lines with their receipt; a CA paper's
// working with its receipts; a post's exact text and counts against the platform's limits; a question's choices. A
// field without its source is left out, model words with an unbacked number say so, and a row with nothing to show
// has no preview. Previews are added after the row's digest, so drawing one never changes what the owner approves.
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Context } from '../runtime/contracts.ts';
import type {
  CaFirmRecord, ConnectorPostRecord, InvoiceRecord, InvoiceView, PreviewFigure, QueueList, QueuePreview, QueueRow, UploadRecord, VentureDeps, VentureRecord,
  WorkReceiptRecord,
} from '../runtime/venture/contracts.ts';
import { digest, ventureAction } from '../runtime/venture/records.ts';
import { handlers as money } from '../runtime/venture/money/index.ts';
import { handlers as views } from '../runtime/venture/views/index.ts';
import { handlers as delivery } from '../runtime/venture/delivery/index.ts';
import { withPreviews } from '../runtime/venture/views/previews.ts';
import { CLIENT_NAME, call, harness, owner, seedBlueprint, seedOrder, seedRun, setStage, setup, type Env } from './venture-views-env.ts';
import { CHAPTERS, editListCall, put, record, seedYoutube, transcriptUpload, youtubeDraft } from './venture-previews-env.ts';

const list = (env: Env) => call<QueueList>(env, 'venture.queue.list', {});
const rowOf = async (env: Env, kind: QueueRow['kind']) => {
  const row = (await list(env)).rows.find(item => item.kind === kind);
  assert.ok(row, `a ${kind} row`);
  return row;
};
const preview = <K extends QueuePreview['kind']>(row: QueueRow, kind: K) => {
  assert.equal(row.preview?.kind, kind, `${row.id} has a ${kind} preview`);
  return row.preview as Extract<QueuePreview, { kind: K }>;
};
const rowDigest = (row: QueueRow) => {
  const { digest: _digest, meta: _meta, sendsTo: _sends, attempt: _attempt, counts: _counts, price: _price, changeCount: _change, preview: _preview, ...rest } = row;
  delete (rest as { amounts?: unknown }).amounts;
  return digest(rest);
};

type Handler = (deps: VentureDeps, ctx: Context, payload: unknown) => Promise<unknown>;
/** The method that serves each kind of receipt a preview figure names, and the package that answers it. */
const SERVED_BY: Readonly<Record<PreviewFigure['receiptKind'], [Record<string, Handler | undefined>, string]>> = {
  price: [money as Record<string, Handler>, 'venture.receipt.get'], sum: [money as Record<string, Handler>, 'venture.receipt.get'],
  ca: [views as Record<string, Handler>, 'venture.ca.receipt'], work: [delivery as Record<string, Handler>, 'venture.work.get'],
};
/** Every figure of a preview, in the order it shows them. */
function figuresOf(shown: QueuePreview): PreviewFigure[] {
  if (shown.kind !== 'paper') return [];
  return shown.paper === 'invoice' ? [...shown.lines, shown.subtotal, ...(shown.discount ? [shown.discount] : []), ...shown.taxLines, shown.total] : shown.working;
}
/** Opens each figure's receipt through the method its receiptKind names, as the screen does, and checks it is that receipt. */
async function opensEach(env: Env, shown: QueuePreview): Promise<void> {
  const figures = figuresOf(shown);
  assert.ok(figures.length > 0);
  for (const figure of figures) {
    const [table, method] = SERVED_BY[figure.receiptKind];
    const receipt = await table[method]!(env.deps, owner, { id: figure.receiptId }) as { id: string };
    assert.equal(receipt.id, figure.receiptId, `${figure.label} opens through ${method}`);
  }
}

const PASSED = [
  { check: 'receipts' as const, passed: true, detail: 'Every number has a receipt.' },
  { check: 'house-style' as const, passed: true, detail: 'Plain words.' },
];
const PLAYBOOK_PASSED = [
  { playbook: 'youtube', check: 'chapters', outcome: 'pass' as const, detail: '3 chapters that YouTube will show.' },
  { playbook: 'youtube', check: 'finishing', outcome: 'not-run' as const, detail: 'not run: no cut was named for this order.' },
];

test('previews: a YouTube draft shows its title, length from the edit list, chapters and check counts; nothing else', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env);
  const transcript = await put(env, tx => transcriptUpload(tx, order.id, 702000));
  await seedRun(env, order, {
    status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room', CHAPTERS),
    renderedText: 'Title: The mic that beat the room', checks: PASSED, playbookChecks: PLAYBOOK_PASSED,
    harness: harness({ phase: 'done', uploadIds: [transcript.id], toolCalls: [editListCall(16800, 25)] }),
  });
  const row = await rowOf(env, 'draft');
  assert.equal(row.title, `Draft reply for ${CLIENT_NAME}`);
  // 16,800 frames at 25 a second is 672 seconds: the edit list wins over the transcript's 702 seconds.
  assert.deepEqual(preview(row, 'video'), {
    kind: 'video', title: { text: 'The mic that beat the room' }, format: 'long',
    duration: { seconds: 672, display: '11 min 12 s', clock: '11:12', from: 'edit-list' },
    chapters: 3, checks: { passed: 3, run: 3, notRun: 1 },
  });
  // The preview came after the digest: the digest is still over the row as the engine made it.
  assert.equal(row.digest, rowDigest(row));
});

test('previews: without an edit list the length comes from the transcript; no chapters unless their check passed', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env);
  const transcript = await put(env, tx => transcriptUpload(tx, order.id, 702000));
  await seedRun(env, order, {
    status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room', CHAPTERS),
    renderedText: 'Title: The mic that beat the room', checks: PASSED,
    playbookChecks: [{ playbook: 'youtube', check: 'chapters', outcome: 'not-run', detail: 'not run: no transcript.' }],
    harness: harness({ phase: 'done', uploadIds: [transcript.id] }),
  });
  const video = preview(await rowOf(env, 'draft'), 'video');
  assert.deepEqual(video.duration, { seconds: 702, display: '11 min 42 s', clock: '11:42', from: 'transcript' });
  assert.equal('chapters' in video, false);
  assert.deepEqual(video.checks, { passed: 2, run: 2, notRun: 1 });
});

test('previews: no field is filled without its source, and a number the model wrote in the title is an estimate', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env, { format: 'short' });
  await seedRun(env, order, {
    status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('Hit 12,000 views with a mic'), renderedText: 'x', checks: [],
  });
  assert.deepEqual(preview(await rowOf(env, 'draft'), 'video'), {
    kind: 'video', title: { text: 'Hit 12,000 views with a mic', estimate: true }, format: 'short', checks: { passed: 0, run: 0, notRun: 0 },
  });
});

test('previews: a poster shows only when a still from the cut is kept, as a JPEG data address', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env, { cutFile: 'D:\\footage\\episode-14.mp4' });
  await seedRun(env, order, { status: 'ready-for-review', playbookId: playbook.id, deliverable: youtubeDraft('The mic that beat the room'), renderedText: 'x', checks: PASSED });
  assert.equal('poster' in preview(await rowOf(env, 'draft'), 'video'), false);
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]).toString('base64');
  const still = await put(env, tx => record<UploadRecord>(tx, 'venture-upload', {
    name: 'episode-14 still.jpg', format: 'image', bytes: 12, digest: digest(jpeg), contentBase64: jpeg, scope: { kind: 'poster', orderId: order.id },
    clientData: true, origin: 'poster',
  }));
  assert.deepEqual(preview(await rowOf(env, 'draft'), 'video').poster, { uploadId: still.id, src: `data:image/jpeg;base64,${jpeg}` });
  // The address is made from the checked bytes, never from the stored text: stored text with a break in it comes out whole.
  await put(env, tx => tx.replace<UploadRecord>({ ...tx.find('venture-upload', still.id)!, contentBase64: `${jpeg.slice(0, 8)}\n${jpeg.slice(8)}` }));
  assert.deepEqual(preview(await rowOf(env, 'draft'), 'video').poster, { uploadId: still.id, src: `data:image/jpeg;base64,${jpeg}` });
  // Stored text that is not a JPEG shows no image at all.
  await put(env, tx => tx.replace<UploadRecord>({ ...tx.find('venture-upload', still.id)!, contentBase64: Buffer.from('<svg onload="x()"/>').toString('base64') }));
  assert.equal('poster' in preview(await rowOf(env, 'draft'), 'video'), false);
});

test('previews: an invoice shows its paper lines, tax lines and total with the price receipt, and its due words', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 15 }) as InvoiceView;
  const receiptId = prepared.invoice.priceReceiptId;
  const receiptKind = 'price' as const;
  const paper = preview(await rowOf(env, 'invoice'), 'paper');
  assert.deepEqual(paper, {
    kind: 'paper', paper: 'invoice', title: 'TAX INVOICE (draft)', from: 'Ledger Cafe Books', to: CLIENT_NAME,
    lines: [{ label: 'Monthly books', quantity: '1', unit: 'INR 2,499.00', value: 'INR 2,499.00', receiptId, receiptKind }],
    subtotal: { label: 'Subtotal', value: 'INR 2,499.00', receiptId, receiptKind },
    taxLines: [{ label: 'CGST at 9%', value: 'INR 224.91', receiptId, receiptKind }, { label: 'SGST at 9%', value: 'INR 224.91', receiptId, receiptKind }],
    total: { label: 'Total', value: 'INR 2,948.82', receiptId, receiptKind },
    due: { days: 15, date: '2026-10-30', display: 'Due in 15 days' },
  });
  await opensEach(env, paper);
});

test('previews: an invoice names the plan version it was priced with, and one that disagrees with its receipt has no paper', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  const prepared = await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id }) as InvoiceView;
  // The business takes a new name in a later plan version: the invoice was priced, and is still from, the first.
  const renamed = await seedBlueprint(env, { version: 2 });
  await ventureAction(env.deps, owner, 'admin', 'seed.rename', tx => {
    tx.replace({ ...tx.find('venture-blueprint', renamed.id)!, name: { value: 'Renamed Books', label: 'told-by-you' as const, by: 'owner' as const } });
  });
  const paper = preview(await rowOf(env, 'invoice'), 'paper');
  assert.equal(paper.paper === 'invoice' && paper.from, 'Ledger Cafe Books');
  // A total that is not its price receipt's shows no figures at all.
  await ventureAction(env.deps, owner, 'admin', 'seed.tamper', tx => {
    tx.replace<InvoiceRecord>({ ...tx.find('venture-invoice', prepared.invoice.id)!, totalMinor: '1' });
  });
  assert.equal('preview' in await rowOf(env, 'invoice'), false);
});

test('previews: simple first, an invoice from a business not registered for GST carries no tax lines', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env, { taxAssumed: true });
  const { order } = await seedOrder(env, plan);
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id, dueInDays: 0 });
  const paper = preview(await rowOf(env, 'invoice'), 'paper');
  assert.equal(paper.paper, 'invoice');
  if (paper.paper !== 'invoice') return;
  assert.deepEqual(paper.taxLines, []);
  assert.equal(paper.title, 'INVOICE (draft)');
  assert.deepEqual(paper.due, { days: 0, date: '2026-10-15', display: 'Due on receipt' });
  assert.equal(JSON.stringify(paper).includes('GST'), false);
});

test('previews: a CA sign-off shows the working figures, each with its receipt and the method that opens it, and who signs it', async () => {
  const env = await setup();
  const inputs = { sales: [] };
  // A CA engine's receipt, kept whole on its work receipt (tools-ca.ts): venture.ca.receipt opens it.
  const engine = await put(env, tx => record<WorkReceiptRecord>(tx, 'venture-work-receipt', {
    operation: 'ca.engine', runRef: { kind: 'delivery', runId: 'delivery_x' }, currency: 'INR', inputs: { tables: [], columns: {}, rowIds: [] }, steps: [],
    figures: [
      { key: 'taxable', label: 'Taxable value', minor: '1600000', display: 'INR 16,000.00', currency: 'INR', unit: 'money' },
      { key: 'cgst', label: 'CGST at 9%', minor: '144000', display: 'INR 1,440.00', currency: 'INR', unit: 'money' },
    ],
    reconciliation: null, allowedNumbers: [], explanation: 'GST on sales.', digest: 'receipt-digest',
    ca: { engine: 'gst-working', inputs, inputsDigest: digest(inputs), caReceiptId: 'ca-receipt', table: null, tables: [], sections: [], assumptions: [], openQuestions: [], working: {} },
  }));
  // A calculator work receipt with no engine on it: venture.work.get opens it.
  const work = await put(env, tx => record<WorkReceiptRecord>(tx, 'venture-work-receipt', {
    operation: 'work.totals', runRef: { kind: 'delivery', runId: 'delivery_x' }, currency: 'INR', inputs: { tables: [], columns: {}, rowIds: [] }, steps: [],
    figures: [{ key: 'total', label: 'Sales register total', minor: '1600000', display: 'INR 16,000.00', currency: 'INR', unit: 'money' }],
    reconciliation: null, allowedNumbers: [], explanation: 'Sales register.', digest: 'work-digest',
  }));
  await put(env, tx => {
    record<CaFirmRecord>(tx, 'venture-ca-firm', { entry: 'ca-of-record', name: 'Meera Joshi', membershipNumber: '123456', firmName: null, firmRegistrationNumber: null });
    record<CaFirmRecord>(tx, 'venture-ca-firm', {
      entry: 'signoff-request', subjectKind: 'gst-working', title: 'GST working for September', clientName: 'Mehta Traders', workingDigest: 'w', receiptIds: [engine.id, work.id], playbookHash: null,
    });
  });
  const shown = preview(await rowOf(env, 'signoff'), 'paper');
  assert.deepEqual(shown, {
    kind: 'paper', paper: 'working', title: 'GST working for September', client: 'Mehta Traders',
    working: [
      { label: 'Taxable value', value: 'INR 16,000.00', receiptId: engine.id, receiptKind: 'ca' },
      { label: 'CGST at 9%', value: 'INR 1,440.00', receiptId: engine.id, receiptKind: 'ca' },
      { label: 'Sales register total', value: 'INR 16,000.00', receiptId: work.id, receiptKind: 'work' },
    ],
    more: 0, signer: { name: 'Meera Joshi', state: 'to-send' },
  });
  await opensEach(env, shown);
  // venture.receipt.get serves price and sum receipts only: a work receipt id there is refused, so the kind matters.
  await assert.rejects(money['venture.receipt.get']!(env.deps, owner, { id: engine.id }));
});

test('previews: a post shows its account, platform, exact text and counts against the platform limits', async () => {
  const env = await setup();
  const text = 'We tested five budget mics in one room. #mics #audio';
  const post = await put(env, tx => record<ConnectorPostRecord>(tx, 'venture-connector-post', {
    connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Lumen Studio', text, agent: 'Publisher', digest: 'post-digest', state: 'described',
    describe: 'Post to LinkedIn.', risk: null, claimedAt: null, decidedBy: null, outcome: null, journal: [], descriptionComplete: true,
  }));
  const row = await rowOf(env, 'connector');
  assert.deepEqual(row.viewRef, { kind: 'draft', id: post.id });
  // An agent wrote it, and it holds numbers in words no receipt backs: the text stays exact, flagged as a model estimate.
  assert.deepEqual(preview(row, 'post'), {
    kind: 'post', connectorId: 'linkedin', platform: 'LinkedIn', account: 'Lumen Studio', mode: 'owner-browser-session', text, textEstimate: true,
    counts: [{ label: 'characters', count: [...text].length, limit: 3000 }],
  });
});

test("previews: a model's post that names an amount is flagged with its text exact; the owner's own words are not", async () => {
  const env = await setup();
  const post = (fields: Record<string, unknown>) => put(env, tx => record<ConnectorPostRecord>(tx, 'venture-connector-post', {
    connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Lumen Studio', digest: 'post-digest', state: 'described',
    describe: 'Post to LinkedIn.', risk: null, claimedAt: null, decidedBy: null, outcome: null, journal: [], ...fields,
  }));
  const amountText = 'Get the mic for Rs500 this week';
  await post({ text: amountText, agent: 'Publisher' });
  const flagged = preview(await rowOf(env, 'connector'), 'post');
  assert.deepEqual([flagged.text, flagged.textEstimate], [amountText, true]);
  const other = await setup();
  await put(other, tx => record<ConnectorPostRecord>(tx, 'venture-connector-post', {
    connectorId: 'linkedin', mode: 'owner-browser-session', account: 'Lumen Studio', digest: 'post-digest', state: 'described', text: 'Our 3 best mics of 2026', agent: null,
    describe: 'Post to LinkedIn.', risk: null, claimedAt: null, decidedBy: null, outcome: null, journal: [],
  }));
  assert.equal('textEstimate' in preview(await rowOf(other, 'connector'), 'post'), false);
});

test('previews: a post from a Short names the Short and its length; X counts its own way and has a hashtag rule only where one exists', async () => {
  const env = await setup();
  const { order, playbook } = await seedYoutube(env, { format: 'short' });
  const transcript = await put(env, tx => transcriptUpload(tx, order.id, 48000));
  const run = await seedRun(env, order, {
    status: 'accepted', playbookId: playbook.id, deliverable: youtubeDraft('The mic that surprised us'), renderedText: 'x', checks: PASSED,
    harness: harness({ phase: 'done', uploadIds: [transcript.id] }), verdict: { choice: 'accepted', reason: null, at: '2026-10-15T10:00:00.000Z' },
  });
  await put(env, tx => record<ConnectorPostRecord>(tx, 'venture-connector-post', {
    connectorId: 'x', mode: 'api', account: null, text: 'A short about mics', agent: null, digest: 'post-digest', state: 'described',
    describe: 'Post to X.', risk: null, claimedAt: null, decidedBy: null, outcome: null, journal: [], draftId: run.id, draftDigest: 'd',
  }));
  const post = preview(await rowOf(env, 'connector'), 'post');
  assert.equal(post.platform, 'X');
  assert.equal(post.account, null);
  assert.deepEqual(post.counts, [{ label: 'characters', count: 18, limit: 280 }]);
  assert.deepEqual(post.short, { title: { text: 'The mic that surprised us' }, length: { seconds: 48, display: '48 s', clock: '0:48', from: 'transcript' } });
});

test('previews: an Instagram post counts its hashtags against the platform cap of 5', async () => {
  const env = await setup();
  await put(env, tx => record<ConnectorPostRecord>(tx, 'venture-connector-post', {
    connectorId: 'instagram', mode: 'api', account: 'lumen.studio', text: 'Mics #a #b #c #d #e #f', agent: null, digest: 'post-digest', state: 'described',
    describe: 'Post to Instagram.', risk: null, claimedAt: null, decidedBy: null, outcome: null, journal: [],
  }));
  const post = preview(await rowOf(env, 'connector'), 'post');
  assert.deepEqual(post.counts, [{ label: 'characters', count: 22, limit: 2200 }, { label: 'hashtags', count: 6, limit: 5 }]);
});

test("previews: a question with choices lists each option, and a model's figure on an option is only an estimate", async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  await seedRun(env, order, {
    status: 'needs-answer',
    harness: harness({
      phase: 'needs-answer',
      handoffs: [{
        to: 'owner', question: 'Which title for episode 15?', turn: 1, answer: null, answeredBy: null,
        choices: [
          { label: 'A', text: 'I tried every budget mic' },
          { label: 'B', text: 'The cheap mic that beat my 20,000 one', estimate: { label: 'Views in 30 days', value: '12,000 to 18,000' } },
        ],
      }],
    }),
  });
  const choice = preview(await rowOf(env, 'question'), 'choice');
  assert.deepEqual(choice.options, [
    { label: 'A', text: { text: 'I tried every budget mic' } },
    { label: 'B', text: { text: 'The cheap mic that beat my 20,000 one', estimate: true }, estimate: { label: 'Views in 30 days', value: '12,000 to 18,000' } },
  ]);
  assert.equal(choice.question.text, 'Which title for episode 15?');
});

test('previews: a row with nothing to show has none, and the hook keeps every row, id and digest', async () => {
  const env = await setup();
  env.workspace.keep = 'not-made';
  await seedBlueprint(env, { status: 'draft' });
  const rows = (await list(env)).rows;
  assert.ok(rows.length >= 3);
  for (const row of rows) assert.equal('preview' in row, false, row.id);
  // A question with one choice is no choice; a plain question has no preview.
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await setStage(env, 'approve-each');
  await seedRun(env, order, {
    status: 'needs-answer',
    harness: harness({ phase: 'needs-answer', handoffs: [{ to: 'owner', question: 'Which bank account?', turn: 1, answer: null, answeredBy: null, choices: [{ label: 'A', text: 'Current' }] }] }),
  });
  assert.equal('preview' in await rowOf(env, 'question'), false);
  const state = env.store.read();
  const before = (await list(env)).rows.map(({ preview: _preview, ...row }) => row);
  const after = withPreviews(state, structuredClone(before) as QueueRow[]);
  assert.deepEqual(after.map(row => [row.id, row.digest]), before.map(row => [row.id, row.digest]));
});

test('previews: a business still in its interview has no country yet, and its rows come back as they are', async () => {
  const env = await setup();
  const plan = await seedBlueprint(env);
  const { order } = await seedOrder(env, plan);
  await money['venture.invoice.prepare']!(env.deps, owner, { orderId: order.id });
  const rows = (await list(env)).rows.map(({ preview: _preview, ...row }) => row) as QueueRow[];
  const state = env.store.read();
  const venture = state.conversations.find(item => item?.kind === 'venture-record') as VentureRecord;
  (venture as { country: unknown }).country = null;
  const after = withPreviews(state, structuredClone(rows));
  assert.deepEqual(after, rows);
});
