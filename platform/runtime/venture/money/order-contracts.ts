// Chausar venture launcher, money (Ink v2 wave 4, package 4J12, catalogue H24): the contract for one order. It says
// what the order is for (goal, scope, constraints), what must not change (protected phrases and files, which code
// enforces on every draft), what is delivered and when it counts as done (deliverables, done by the order's own
// stages) and how done is proved (acceptance checks with stable ids). For an offer marked contract: 'required', or an
// order that has a contract at all, no run starts until the owner signs the newest revision (ORDER_CONTRACT_UNSIGNED).
// Revisions append and never change once written; signing binds to the digest the owner saw. Anything outside the app
// (an agent, the phone, MCP) may propose scope and check changes only, never the goal, constraints, protections or
// deliverables (CONTRACT_FIELD_LOCKED), and never drop a check. Done needs evidence, skipped needs a reason, only the
// auditor reopens. The contract records what the owner agreed: it has no price field and never changes a price.
// The idea follows BaoCut's task contracts and pi-plans' task tool (2026-10-21 harvest); this is a rewrite.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { digest, exactPayload, findRecord, identifier, isAppChannel, listRecords, plainText, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import type {
  ContractMark, Deliverable, OrderContract, OrderContractItem, OrderContractRecord, OrderContractView, OrderRecord, PlaybookCheckResult, VentureDeps, VentureRecord,
} from '../contracts.ts';
import { acceptedBlueprintOrNull } from '../delivery/shared.ts';
import { orderUploads } from '../delivery/harness/env.ts';
import { stageListFor } from '../playbooks/order-stages.ts';
import { pickPlaybook } from '../playbooks/registry.ts';
import { secretFindings } from '../core/secrets.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import type { W4RowItem } from '../views/queue-w4.ts';
import { ERASED_NAMED } from '../agents/notes.ts';

const CONTRACT_FIELDS = ['goal', 'scope', 'constraints', 'protected', 'deliverables', 'checks'] as const;
/** What only the owner sets, inside the app. Anyone else may change scope and checks only. */
const OWNER_FIELDS = ['goal', 'constraints', 'protected', 'deliverables'] as const;
const ITEM_ID = /^[a-z][a-z0-9-]{0,39}$/;

export const CONTRACT_STALE = "This order's contract changed since you looked. Look again before signing it.";
const FIRST_IS_OWNERS = "Only you write an order's first contract, inside the app.";
const LOCKED_FIELD = "Only you change an order's goal, constraints, protected items and deliverables, inside the app. A proposal may change the scope and the checks.";
const NO_DROPPED_CHECK = 'A proposal may add or reword acceptance checks, never drop one.';
const KEY_IN_CONTRACT = "That looks like a key. Keys go in Connections, never in an order's contract.";
const HELD_PROPOSAL = 'This proposal had words aimed at an agent or a checker, so Chausar did not keep it.';
const ID_IN_PROPOSAL = "This proposal held a card, bank account, Aadhaar, PAN or one-time code number. An agent's proposal never carries one, so Chausar did not keep it.";
const DIGITS_IN_PHRASE = 'A protected phrase is words only. Numbers come from the calculator and their receipts, so leave them out.';

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** Every revision of an order's contract, oldest first. */
function revisionsOf(state: State, ventureId: string, orderId: string): OrderContractRecord[] {
  return listRecords(state, 'venture-order-contract', ventureId).filter(record => record.orderId === orderId).sort((a, b) => a.revision - b.revision);
}

/** The newest revision of an order's contract, or null. */
export function latestContract(state: State, ventureId: string, orderId: string): OrderContractRecord | null {
  return revisionsOf(state, ventureId, orderId).at(-1) ?? null;
}

/** Whether the order's offer, in the accepted plan, needs a signed contract. */
export function contractRequired(state: State, venture: VentureRecord, order: Pick<OrderRecord, 'offerId'>): boolean {
  return acceptedBlueprintOrNull(state, venture)?.offers.find(offer => offer.id === order.offerId)?.contract === 'required';
}

/**
 * Refuses a run on an order whose offer needs a contract, or that has one, until the owner signed its newest
 * revision (ORDER_CONTRACT_UNSIGNED). delivery/runs.ts calls it before any preview and again in the commit.
 */
export function refuseUnsignedContract(state: State, venture: VentureRecord, order: Pick<OrderRecord, 'id' | 'offerId'>): void {
  const latest = latestContract(state, venture.id, order.id);
  if (!latest && !contractRequired(state, venture, order)) return;
  if (!latest) throw new ChausarError('ORDER_CONTRACT_UNSIGNED', 'This order needs a contract you sign before any work starts. Write it on the order, then sign it.');
  check(latest.signedAt !== null, 'ORDER_CONTRACT_UNSIGNED', `Revision ${latest.revision} of this order's contract waits for you to sign it. No work starts on this order until you do.`);
}

/**
 * The same for a run already going: before a step is approved and sent, an answer moves it on, a heavy-work brief
 * starts or a stopped run resumes, each in the commit that does it, so a revision proposed meanwhile stops it there.
 */
export function refuseUnsignedRun(state: State, venture: VentureRecord, run: { orderId: string }): void {
  const order = findRecord(state, 'venture-order', run.orderId);
  if (order && order.ventureId === venture.id) refuseUnsignedContract(state, venture, order);
}

/** The stage ids an order goes through (playbooks/order-stages.ts): its flagship playbook's, else the fixed steps. */
function stagesOf(state: State, venture: VentureRecord, order: OrderRecord): string[] {
  const offer = acceptedBlueprintOrNull(state, venture)?.offers.find(item => item.id === order.offerId);
  const flagship = offer?.playbookOffer ? pickPlaybook(venture.idea)?.id ?? null : null;
  return stageListFor(flagship).map(stage => stage.id);
}

/** Each deliverable's and check's state from its newest mark: reopened is open again. */
function itemsOf(record: OrderContractRecord): OrderContractItem[] {
  const newest = new Map<string, ContractMark>();
  for (const mark of record.marks ?? []) newest.set(mark.itemId, mark);
  const item = (id: string, kind: OrderContractItem['kind']): OrderContractItem => {
    const mark = newest.get(id);
    if (!mark || mark.state === 'reopened') return { id, kind, state: 'open', evidence: null, reason: null };
    return { id, kind, state: mark.state, evidence: mark.evidence, reason: mark.reason };
  };
  return [...record.contract.deliverables.map(entry => item(entry.id, 'deliverable')), ...record.contract.checks.map(entry => item(entry.id, 'check'))];
}

/** The view of one revision, with the line the owner reads. */
function contractView(record: OrderContractRecord): OrderContractView {
  const line = record.signedAt
    ? `You signed revision ${record.revision}. Work on this order follows it.`
    : record.proposedBy === 'agent'
      ? `An agent proposed revision ${record.revision}. It changes the scope or the checks only. Sign it to let work go on.`
      : `Revision ${record.revision} waits for you to sign it. No work starts on this order until you do.`;
  return {
    orderId: record.orderId, contract: record.contract, revision: record.revision, digest: record.digest,
    signed: record.signedAt ? { at: record.signedAt, by: record.signedBy ?? '' } : null, line, proposedBy: record.proposedBy, items: itemsOf(record),
  };
}

// ---------------------------------------------------------------------------
// The contract's words
// ---------------------------------------------------------------------------

function list(value: unknown, field: string, min: number, max: number): unknown[] {
  check(Array.isArray(value) && value.length >= min && value.length <= max, 'INVALID_VENTURE_REQUEST', `${field} needs between ${min} and ${max} items.`);
  return value;
}
const words = (value: unknown, field: string, max = 200) => plainText(value, field, { min: 1, max });
function itemId(value: unknown, field: string): string {
  check(typeof value === 'string' && ITEM_ID.test(value), 'INVALID_VENTURE_REQUEST', `${field} needs a short id in small letters, digits and dashes.`);
  return value;
}

/**
 * Reads a contract: exactly its six fields, each within bounds. Deliverable and check ids are stable short ids, none
 * shared; each deliverable is done at one of the order's own stages. A key-shaped string anywhere is refused.
 */
export function parseContract(value: unknown, stages: readonly string[]): OrderContract {
  const body = exactPayload(value, CONTRACT_FIELDS, CONTRACT_FIELDS);
  const contract: OrderContract = {
    goal: plainText(body.goal, 'The goal', { min: 3, max: 300 }),
    scope: list(body.scope, 'The scope', 1, 12).map(item => words(item, 'A scope line')),
    constraints: list(body.constraints, 'The constraints', 0, 12).map(item => words(item, 'A constraint')),
    protected: list(body.protected, 'The protected items', 0, 20).map(item => {
      const entry = exactPayload(item, ['kind', 'value'], ['kind', 'value']);
      check(entry.kind === 'phrase' || entry.kind === 'file', 'INVALID_VENTURE_REQUEST', 'A protected item is a phrase or a file.');
      const value = words(entry.value, 'A protected item');
      check(entry.kind === 'file' || !/\d/.test(value), 'INVALID_VENTURE_REQUEST', DIGITS_IN_PHRASE);
      return { kind: entry.kind, value };
    }),
    deliverables: list(body.deliverables, 'The deliverables', 1, 12).map(item => {
      const entry = exactPayload(item, ['id', 'what', 'stage', 'doneWhen'], ['id', 'what', 'stage', 'doneWhen']);
      check(typeof entry.stage === 'string' && stages.includes(entry.stage), 'INVALID_VENTURE_REQUEST', `A deliverable is done at one of this order's stages: ${stages.join(', ')}.`);
      return { id: itemId(entry.id, 'A deliverable'), what: words(entry.what, 'What is delivered'), stage: entry.stage as string, doneWhen: words(entry.doneWhen, 'When it is done', 300) };
    }),
    checks: list(body.checks, 'The acceptance checks', 0, 20).map(item => {
      const entry = exactPayload(item, ['id', 'what'], ['id', 'what']);
      return { id: itemId(entry.id, 'An acceptance check'), what: words(entry.what, 'What the check asks', 300) };
    }),
  };
  const ids = [...contract.deliverables.map(item => item.id), ...contract.checks.map(item => item.id)];
  check(new Set(ids).size === ids.length, 'INVALID_VENTURE_REQUEST', 'Each deliverable and check needs its own id.');
  const values = contract.protected.map(item => `${item.kind}:${item.value}`);
  check(new Set(values).size === values.length, 'INVALID_VENTURE_REQUEST', 'A protected item is listed twice.');
  const text = [contract.goal, ...contract.scope, ...contract.constraints, ...contract.protected.map(item => item.value),
    ...contract.deliverables.flatMap(item => [item.what, item.doneWhen]), ...contract.checks.map(item => item.what)];
  check(text.every(line => secretFindings(line).length === 0), 'INVALID_VENTURE_REQUEST', KEY_IN_CONTRACT);
  return contract;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Why a proposal from outside the app may not be kept, or null: an owner's field changed, or a check dropped. */
function lockedChange(before: OrderContract, after: OrderContract): string | null {
  if (OWNER_FIELDS.some(field => !same(before[field], after[field]))) return LOCKED_FIELD;
  const kept = new Set(after.checks.map(item => item.id));
  return before.checks.every(item => kept.has(item.id)) ? null : NO_DROPPED_CHECK;
}

/** The digest the owner signs: of the order, the revision number and the contract. Marks are not in it. */
const contractDigest = (orderId: string, revision: number, contract: OrderContract) => digest({ orderId, revision, contract });

function orderOf(state: State, venture: VentureRecord, orderId: string): OrderRecord {
  const order = findRecord(state, 'venture-order', orderId);
  check(order && order.ventureId === venture.id, 'ORDER_NOT_FOUND', 'That order was not found.');
  return order;
}

// ---------------------------------------------------------------------------
// Methods
// ---------------------------------------------------------------------------

/** venture.order.contract { orderId } (read): the newest revision of the order's contract, or null when it has none. */
export async function orderContractGet(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OrderContractView | null> {
  const body = exactPayload(payload, ['orderId'], ['orderId']);
  const orderId = identifier(body.orderId, 'Order');
  const { state, venture } = readVenture(deps, ctx);
  orderOf(state, venture, orderId);
  const latest = latestContract(state, venture.id, orderId);
  return latest ? contractView(latest) : null;
}

/**
 * Stores a new revision of an order's contract and returns it, unsigned. Inside the app it is the owner's; from
 * anywhere else it is an agent's, which may change only the scope and the checks of the revision before it and never
 * write the first one (CONTRACT_FIELD_LOCKED), and whose words pass the untrusted screen and hold no id number. The
 * same contract as an unsigned newest revision stores nothing new. Marks carry over for the items the new revision keeps.
 */
export function proposeContract(tx: VentureTx, order: OrderRecord, contract: OrderContract, by: 'owner' | 'agent'): OrderContractRecord {
  const latest = latestContract(tx.state, tx.venture!.id, order.id);
  if (by === 'agent') {
    check(latest, 'CONTRACT_FIELD_LOCKED', FIRST_IS_OWNERS);
    const refusal = lockedChange(latest.contract, contract);
    check(refusal === null, 'CONTRACT_FIELD_LOCKED', refusal ?? '');
    // An agent's words reach the owner and later turns: they are untrusted content, screened in enforce mode.
    const screened = screenUntrusted({ source: 'tool-output', text: JSON.stringify(contract) }, { mode: 'enforce' });
    check(screened.status !== 'quarantined', 'INVALID_VENTURE_REQUEST', HELD_PROPOSAL);
    check(!screened.findings.some(finding => finding.kind === 'id'), 'INVALID_VENTURE_REQUEST', ID_IN_PROPOSAL);
  }
  // The same words again are the same unsigned revision; once signed, they are a new revision to sign.
  if (latest && !latest.signedAt && same(latest.contract, contract)) return latest;
  const revision = (latest?.revision ?? 0) + 1;
  const ids = new Set([...contract.deliverables.map(item => item.id), ...contract.checks.map(item => item.id)]);
  const record: OrderContractRecord = {
    ...tx.base('venture-order-contract'), orderId: order.id, contract, revision, proposedBy: by, digest: contractDigest(order.id, revision, contract),
    signedAt: null, signedBy: null, marks: (latest?.marks ?? []).filter(mark => ids.has(mark.itemId)),
  };
  tx.put(record);
  tx.emit('queue.changed', {});
  return record;
}

/** venture.order.contract.propose { orderId, contract } (prepare): a new revision, unsigned (proposeContract). */
export async function orderContractPropose(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OrderContractView> {
  const body = exactPayload(payload, ['orderId', 'contract'], ['orderId', 'contract']);
  const orderId = identifier(body.orderId, 'Order');
  const by = isAppChannel(ctx) ? 'owner' as const : 'agent' as const;
  return ventureAction(deps, ctx, 'prepare', 'order.contract.propose', tx => {
    const order = orderOf(tx.state, tx.venture!, orderId);
    const contract = parseContract(body.contract, stagesOf(tx.state, tx.venture!, order));
    return contractView(proposeContract(tx, order, contract, by));
  });
}

/**
 * venture.order.contract.sign { orderId, digest } (approve, app only): the owner signs the newest revision they saw.
 * Any other digest is APPROVAL_STALE. Signing writes down the digests of the order's protected files as they are now,
 * so a run that changes one fails its checks. Signing the same revision again writes them down afresh (after the owner
 * looked at a changed file). Nothing about the order or its price changes.
 */
export async function orderContractSign(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OrderContractView> {
  requireAppChannel(ctx, 'venture.order.contract.sign');
  const body = exactPayload(payload, ['orderId', 'digest'], ['orderId', 'digest']);
  const orderId = identifier(body.orderId, 'Order');
  check(typeof body.digest === 'string' && /^[0-9a-f]{64}$/.test(body.digest), 'APPROVAL_STALE', CONTRACT_STALE);
  const seen = body.digest;
  return ventureAction(deps, ctx, 'approve', 'order.contract.sign', tx => {
    const order = orderOf(tx.state, tx.venture!, orderId);
    const latest = latestContract(tx.state, tx.venture!.id, order.id);
    check(latest, 'ORDER_CONTRACT_UNSIGNED', 'This order has no contract to sign yet. Write one first.');
    check(latest.digest === seen, 'APPROVAL_STALE', CONTRACT_STALE);
    const uploads = orderUploads(tx.state, tx.venture!.id, order.id);
    const files = latest.contract.protected.filter(item => item.kind === 'file')
      .map(item => ({ name: item.value, digests: uploads.filter(upload => upload.name === item.value).map(upload => upload.digest).sort() }));
    const signed = tx.replace<OrderContractRecord>({ ...latest, signedAt: tx.now, signedBy: ctx.memberId, files });
    tx.emit('queue.changed', {});
    return contractView(signed);
  });
}

// ---------------------------------------------------------------------------
// Marks on deliverables and checks
// ---------------------------------------------------------------------------

export type ContractMarkInput = { itemId: string; state: ContractMark['state']; evidence?: string; reason?: string; by: ContractMark['by'] };

/**
 * Marks one deliverable or acceptance check of the order's signed contract, inside the caller's transaction (the
 * harness and the auditor call it; there is no method). Done needs evidence and skipped a reason, each from an open
 * item; reopening a done or skipped item is the auditor's alone (CONTRACT_FIELD_LOCKED) and says why. Marks append.
 */
export function markContractItem(tx: VentureTx, orderId: string, input: ContractMarkInput): OrderContractView {
  const latest = latestContract(tx.state, tx.venture!.id, orderId);
  check(latest && latest.signedAt, 'ORDER_CONTRACT_UNSIGNED', 'Work is marked only under a contract you signed.');
  const item = itemsOf(latest).find(entry => entry.id === input.itemId);
  check(item, 'INVALID_VENTURE_REQUEST', "That item is not in this order's contract.");
  let mark: ContractMark;
  if (input.state === 'reopened') {
    check(input.by === 'auditor', 'CONTRACT_FIELD_LOCKED', 'Only the auditor reopens an item that is done or skipped.');
    check(item.state !== 'open', 'INVALID_VENTURE_REQUEST', 'That item is open already.');
    mark = { itemId: item.id, state: 'reopened', evidence: null, reason: plainText(input.reason, 'Why it reopens', { min: 3, max: 300 }), by: input.by, at: tx.now };
  } else {
    check(input.state === 'done' || input.state === 'skipped', 'INVALID_VENTURE_REQUEST', 'An item is done, skipped or reopened.');
    check(item.state === 'open', 'INVALID_VENTURE_REQUEST', `That item is ${item.state} already.`);
    mark = input.state === 'done'
      ? { itemId: item.id, state: 'done', evidence: plainText(input.evidence, 'Done needs evidence: what shows it', { min: 3, max: 300 }), reason: null, by: input.by, at: tx.now }
      : { itemId: item.id, state: 'skipped', evidence: null, reason: plainText(input.reason, 'Skipped needs a reason', { min: 3, max: 300 }), by: input.by, at: tx.now };
  }
  return contractView(tx.replace<OrderContractRecord>({ ...latest, marks: [...(latest.marks ?? []), mark] }));
}

// ---------------------------------------------------------------------------
// Protected items, enforced on every draft
// ---------------------------------------------------------------------------

/** A draft's own words, as the protected check reads them: its title, headings and text parts, a line each. */
export function draftWords(deliverable: Pick<Deliverable, 'title' | 'sections'>): string {
  return [deliverable.title, ...deliverable.sections.flatMap(section => [section.heading, ...section.parts.flatMap(part => (part.kind === 'text' ? [part.text] : []))])].join('\n');
}

/** One protected item a draft did not keep: changed (it is there in another form) or missing. */
export type ProtectedBreak = { kind: 'phrase' | 'file'; value: string; how: 'changed' | 'missing' };
const loose = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * What a draft did not keep of a contract's protected items. A phrase must stand in the draft exactly as written;
 * the same words in another case or punctuation are a change, and no sign of it is missing. A file must have the
 * digests it had when the owner signed (signedFiles); another digest is a change, none at all is missing.
 */
export function protectedBreaks(contract: OrderContract, signedFiles: readonly { name: string; digests: readonly string[] }[], draft: { text: string; files: readonly { name: string; digest: string }[] }): ProtectedBreak[] {
  const breaks: ProtectedBreak[] = [];
  for (const item of contract.protected) {
    if (item.kind === 'phrase') {
      if (draft.text.includes(item.value)) continue;
      const word = loose(item.value);
      breaks.push({ kind: 'phrase', value: item.value, how: word && loose(draft.text).includes(word) ? 'changed' : 'missing' });
      continue;
    }
    const before = [...(signedFiles.find(entry => entry.name === item.value)?.digests ?? [])].sort();
    const now = draft.files.filter(file => file.name === item.value).map(file => file.digest).sort();
    if (same(before, now)) continue;
    breaks.push({ kind: 'file', value: item.value, how: now.length ? 'changed' : 'missing' });
  }
  return breaks;
}

/**
 * The contract's check on a run's draft, as a playbook check (playbook 'contract', check 'protected'): fail when the
 * draft changed or dropped a protected item of the signed revision, pass when it kept them all. None when the order
 * has no signed contract or it protects nothing. files: the order's files now, read from the records when not given.
 */
export function contractChecks(state: State, venture: VentureRecord, orderId: string, draft: { text: string; files?: readonly { name: string; digest: string }[] }): PlaybookCheckResult[] {
  const signed = revisionsOf(state, venture.id, orderId).filter(record => record.signedAt).at(-1);
  if (!signed || !signed.contract.protected.length) return [];
  const files = draft.files ?? orderUploads(state, venture.id, orderId).map(upload => ({ name: upload.name, digest: upload.digest }));
  const breaks = protectedBreaks(signed.contract, signed.files ?? [], { text: draft.text, files });
  const named = breaks.map(item => `${item.kind === 'phrase' ? `the phrase "${item.value}"` : `the file ${item.value}`} (${item.how})`);
  return [{
    playbook: 'contract', check: 'protected', outcome: breaks.length ? 'fail' : 'pass',
    detail: breaks.length ? `The draft did not keep what the signed contract protects: ${named.join('; ')}.` : 'The draft keeps everything the signed contract protects.',
  }];
}

// ---------------------------------------------------------------------------
// Forget (DPDP)
// ---------------------------------------------------------------------------

/**
 * Forget of a person in the owner's network (network/forget.ts removePersonData): every contract line that names them
 * (goal, scope, constraints, deliverables, checks, the marks' evidence and reasons) becomes ERASED_NAMED, the way 4B2
 * erases agent messages; a protected phrase or file that names them is dropped, with its signed digests, so a later
 * draft is never failed for words that are gone. Ids, revisions, digests and signatures stay, so what the owner signed
 * is still on record as signed. A run's contract check that quoted such a line loses its words too.
 */
export function eraseContractsNaming(tx: VentureTx, mentionsName: (text: unknown) => boolean): void {
  const clean = (text: string) => (mentionsName(text) ? ERASED_NAMED : text);
  const cleanOrNull = (text: string | null) => (text === null ? null : clean(text));
  for (const record of tx.list('venture-order-contract')) {
    const contract = record.contract;
    const erased: OrderContract = {
      goal: clean(contract.goal), scope: contract.scope.map(clean), constraints: contract.constraints.map(clean),
      protected: contract.protected.filter(item => !mentionsName(item.value)),
      deliverables: contract.deliverables.map(item => ({ ...item, what: clean(item.what), stage: item.stage, doneWhen: clean(item.doneWhen) })),
      checks: contract.checks.map(item => ({ ...item, what: clean(item.what) })),
    };
    const marks = record.marks?.map(mark => ({ ...mark, evidence: cleanOrNull(mark.evidence), reason: cleanOrNull(mark.reason) }));
    const files = record.files?.filter(entry => !mentionsName(entry.name));
    if (same(erased, contract) && same(marks, record.marks) && same(files, record.files)) continue;
    tx.replace<OrderContractRecord>({ ...record, contract: erased, ...(marks ? { marks } : {}), ...(files ? { files } : {}) });
  }
  for (const run of tx.list('venture-delivery-run')) {
    if (!run.playbookChecks?.some(item => item.playbook === 'contract' && mentionsName(item.detail))) continue;
    tx.replace({ ...run, playbookChecks: run.playbookChecks.map(item => (item.playbook === 'contract' && mentionsName(item.detail) ? { ...item, detail: ERASED_NAMED } : item)) });
  }
}

// ---------------------------------------------------------------------------
// Today
// ---------------------------------------------------------------------------

/**
 * Today's notice rows (views/probes.ts): one per open order whose contract waits on the owner, needed and not yet
 * written, or with a newest revision not signed. Open goes to the order; Later is queue.ts's. Gone once signed.
 */
export function contractNoticeRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  const rows: W4RowItem[] = [];
  for (const order of listRecords(state, 'venture-order', venture.id)) {
    if (order.status !== 'open') continue;
    const latest = latestContract(state, venture.id, order.id);
    if (latest ? latest.signedAt !== null : !contractRequired(state, venture, order)) continue;
    const client = findRecord(state, 'venture-client', order.clientId);
    const whose = client && client.ventureId === venture.id ? `${client.name}'s order` : 'This order';
    rows.push({
      kind: 'notice', subject: `contract:${order.id}`, version: latest?.id ?? 'none', createdAt: latest?.at ?? order.at,
      title: !latest ? 'Write the contract for an order' : latest.proposedBy === 'agent' ? 'An agent proposed a change to an order contract' : 'Sign the contract for an order',
      line: `${whose} waits for a contract you sign. No work starts on it until you do.`,
      actions: [{ id: 'later', label: 'Later', primary: false }, { id: 'open', label: 'Open the order', primary: true }],
      navigate: "Open the order on Work to read and sign its contract.",
    });
  }
  return rows;
}
