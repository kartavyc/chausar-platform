/**
 * EvoOntology: the dictionary over MCP, the builder agent and the self-evolution loop.
 *
 * - `dictionary.mcp.*` serve the published dictionary in three read-only layers.
 * - `learningx.dictionaryBuild` profiles files and proposes a first dictionary; adoption runs the answer key first.
 * - `learningx.editsPropose` proposes small typed edits; an edit reaches the owner only after it passes the
 *   hand-worked answer key in a before-and-after run. The owner approves every edit; nothing publishes on its own.
 */
import { check, ChausarError, hash, newId, now, type Context, type State } from '../contracts.ts';
import { canonical, current, digest } from '../actions.ts';
import { OntologyService, type Dictionary, type DictionaryDraft } from '../ontology.ts';
import { assertSourceAccess } from '../trust.ts';
import type { MethodSpec, ModuleHost, SchedulerHost } from '../modules/types.ts';
import { area, canSee, ids, limitOf, oneOf, peekArea } from './state.ts';
import { recordDecision } from './log.ts';
import { infoLayer, operationsLayer, samplesLayer, schemaLayer } from './dictionary-layers.ts';
import { assertAnswerKey, defaultAnswerKey, regressions, runAnswerKey, type AnswerKey, type CaseResult, type KeyRun } from './dictionary-answer-key.ts';
import { buildDraft, candidateDraft, type FieldEvidence, type PackChoice } from './dictionary-builder.ts';
import { applyEdit, assertEdit, draftOf, evidenceEdits, type EditEvidence, type TypedEdit } from './dictionary-edits.ts';

type ProposalStatus = 'proposed' | 'adopted' | 'failed-answer-key';
export type Proposal = {
  id: string; at: string; memberId: string; origin: 'profile' | 'model'; pack: PackChoice; draft: DictionaryDraft; draftDigest: string;
  evidence: FieldEvidence[]; skipped: { header: string; reason: string }[]; sourceIds: string[]; contentHashes: string[];
  status: ProposalStatus; cases: CaseResult[]; failing: string[]; publishedHash: string | null; digest: string;
  /** The dictionary the proposal was built against; adoption publishes against exactly this baseline. */
  baseHash: string | null;
};
const EDIT_STATUSES = ['awaiting-review', 'failed-answer-key', 'accepted', 'rejected'] as const;
type EditStatus = typeof EDIT_STATUSES[number];
export type EditRecord = {
  id: string; at: string; memberId: string; edit: TypedEdit; evidence: EditEvidence; baseHash: string; baseVersion: number; draftDigest: string;
  keyDigest: string; status: EditStatus; before: CaseResult[]; after: CaseResult[]; failing: string[]; regressions: string[]; digest: string;
  decidedAt: string | null; decidedBy: string | null; publishedHash: string | null;
};
type DictionaryArea = { proposals: Proposal[]; edits: EditRecord[]; key: AnswerKey | null; lastTickDay: string | null };

const AREA = 'dictionary';
const init = (): DictionaryArea => ({ proposals: [], edits: [], key: null, lastTickDay: null });
const areaOf = (state: State) => area<DictionaryArea>(state, AREA, init);
const peek = (state: State) => peekArea<DictionaryArea>(state, AREA);
const PROPOSAL_LIMIT = 50, EDIT_LIMIT = 500, EDITS_PER_CALL = 20;

const plain = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
function payloadKeys(payload: Record<string, unknown>, allowed: string[]) {
  check(Object.keys(payload).every(key => allowed.includes(key)), 'INVALID_REQUEST', 'Use only the declared request fields.');
}
/** Dictionary changes are approved by the owner inside the app, never from a phone, an agent or a tainted context. */
function appOwner(ctx: Context) {
  check(ctx.channel !== 'phone' && ctx.channel !== 'mcp' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Approve dictionary changes inside the app.');
  check(ctx.role === 'owner', 'OWNER_REQUIRED', 'The owner approves every dictionary change.');
}
const currentDictionary = (host: ModuleHost, ctx: Context): Dictionary | null => new OntologyService(host.store).current(ctx);
const activeKey = (state: State): AnswerKey => peek(state)?.key ?? defaultAnswerKey;
const visibleTo = (state: State, ctx: Context, memberId: string, sourceIds: readonly string[]) => (memberId === ctx.memberId || ctx.role === 'owner') && canSee(state, ctx, sourceIds);
const codeOf = (error: unknown) => error instanceof ChausarError ? error.code : 'EDIT_FAILED';
const attemptOf = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 128);

function logEdit(state: State, ctx: Context, choice: 'proposed' | 'accepted' | 'rejected', reason: 'answer-key-passed' | 'answer-key-failed' | 'owner-override',
  edit: TypedEdit['edit'], sourceIds: readonly string[], refs: readonly string[], fields?: [string, string][], model = false) {
  recordDecision(state, ctx, { event: { kind: 'dictionary-edit', choice, reason, edit, ...(fields ? { fields } : {}), ...(model ? { evidence: ['model'] } : {}) },
    sourceIds: [...sourceIds].filter(id => canSee(state, ctx, [id])), refs: [...new Set(refs)].slice(0, 64) });
}

// ---------- builder ----------
function proposalView(proposal: Proposal) { return structuredClone(proposal); }

async function dictionaryBuild(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['files', 'label', 'candidate']);
  check(Array.isArray(payload.files) && payload.files.length >= 1 && payload.files.length <= 10, 'INVALID_REQUEST', 'Give one to ten files to profile.');
  const files = payload.files.map(file => {
    check(plain(file) && Object.keys(file).every(key => ['content', 'sourceId'].includes(key)) && typeof file.content === 'string', 'INVALID_REQUEST', 'Each file has CSV content and an optional source identifier.');
    return { content: file.content as string, sourceId: file.sourceId };
  });
  check(payload.label === undefined || typeof payload.label === 'string' && payload.label.trim().length > 0 && payload.label.length <= 80, 'INVALID_REQUEST', 'A dictionary label is short text.');
  const sourceIds = ids(files.filter(file => file.sourceId !== undefined).map(file => file.sourceId), 'source identifiers', 10);
  assertSourceAccess(host.store.read(), ctx, sourceIds);
  const built = buildDraft(files, payload.label as string | undefined);
  const origin = payload.candidate === undefined ? 'profile' as const : 'model' as const;
  const draft = origin === 'model' ? candidateDraft(payload.candidate) : built.draft;
  return host.store.update(state => {
    current(state, ctx, 'prepare'); assertSourceAccess(state, ctx, sourceIds);
    const dictionary = areaOf(state), id = newId('dictproposal'), draftDigest = digest(draft), baseHash = currentDictionary(host, ctx)?.hash ?? null;
    const proposal: Proposal = { id, at: now(), memberId: ctx.memberId, origin, pack: built.pack, draft, draftDigest, evidence: built.evidence, skipped: built.skipped,
      sourceIds, contentHashes: files.map(file => hash(file.content)), status: 'proposed', cases: [], failing: [], publishedHash: null, baseHash, digest: digest({ id, draftDigest, sourceIds, baseHash }) };
    dictionary.proposals.push(proposal);
    if (dictionary.proposals.length > PROPOSAL_LIMIT) dictionary.proposals.splice(0, dictionary.proposals.length - PROPOSAL_LIMIT);
    return proposalView(proposal);
  });
}

function dictionaryProposals(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['limit']);
  const state = host.store.read(); current(state, ctx);
  const items = (peek(state)?.proposals ?? []).filter(item => visibleTo(state, ctx, item.memberId, item.sourceIds)).reverse();
  return { items: items.slice(0, limitOf(payload.limit, 20, 50)).map(proposalView), total: items.length };
}

async function dictionaryAdopt(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['id', 'digest']); appOwner(ctx);
  const state = host.store.read();
  const proposal = peek(state)?.proposals.find(item => item.id === payload.id);
  check(proposal && visibleTo(state, ctx, proposal.memberId, proposal.sourceIds), 'NOT_FOUND', 'This dictionary proposal is no longer available.');
  check(proposal.status === 'proposed', 'PROPOSAL_DECIDED', 'This dictionary proposal was already decided.');
  check(payload.digest === proposal.digest && digest(proposal.draft) === proposal.draftDigest, 'PROPOSAL_CHANGED', 'The proposal changed. Review it again before adopting it.');
  const run = await runAnswerKey(activeKey(state), proposal.draft);
  // Publishing against the proposal's own baseline never reverts a later edit, and a retried adoption replays the retained attempt.
  if (run.passed) {
    try { await host.call('ontology.publish', { draft: structuredClone(proposal.draft), expectedCurrentHash: proposal.baseHash, attemptId: attemptOf(proposal.id) }); }
    catch (error) { check(!(error instanceof ChausarError && error.code === 'DICTIONARY_CONFLICT'), 'PROPOSAL_STALE', 'The dictionary changed after this proposal was made. Build a new proposal.'); throw error; }
  }
  const published = run.passed ? currentDictionary(host, ctx) : null;
  return host.store.update(state => {
    const record = areaOf(state).proposals.find(item => item.id === proposal.id);
    check(!record || record.status === 'proposed', 'PROPOSAL_DECIDED', 'This dictionary proposal was already decided.');
    check(record, 'NOT_FOUND', 'This dictionary proposal is no longer available.');
    record.status = run.passed ? 'adopted' : 'failed-answer-key'; record.cases = run.cases; record.failing = run.failing; record.publishedHash = published?.hash ?? null;
    logEdit(state, ctx, run.passed ? 'accepted' : 'rejected', run.passed ? 'answer-key-passed' : 'answer-key-failed', 'add-definition', record.sourceIds, [record.id], undefined, record.origin === 'model');
    return { published: run.passed, status: record.status, cases: run.cases, failing: run.failing, dictionary: published ? { version: published.version, hash: published.hash, pack: published.pack } : null };
  });
}

// ---------- answer key ----------
async function answerKeyView(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['run']);
  check(payload.run === undefined || typeof payload.run === 'boolean', 'INVALID_REQUEST', 'Choose whether to run the key.');
  const state = host.store.read(); current(state, ctx, payload.run ? 'admin' : 'read');
  const key = activeKey(state), dictionary = currentDictionary(host, ctx);
  const run = payload.run ? dictionary ? await runAnswerKey(key, draftOf(dictionary)) : { state: 'absent', reason: 'No dictionary is published yet.' } : undefined;
  // The hand-worked rows can be real business rows: only the owner sees them; others see the cases and the digest.
  const shown = ctx.role === 'owner' ? structuredClone(key) : { ...structuredClone(key), rows: { state: 'withheld' } };
  return { key: shown, default: !peek(state)?.key, keyDigest: digest(key), ...(run ? { run, dictionaryHash: dictionary?.hash ?? null } : {}) };
}

async function answerKeySet(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['key', 'reset']); appOwner(ctx);
  check((payload.reset === true) !== (payload.key !== undefined), 'INVALID_REQUEST', 'Give a hand-worked key, or reset to the default key.');
  const key = payload.reset === true ? null : assertAnswerKey(payload.key);
  await host.store.update(state => { current(state, ctx, 'admin'); areaOf(state).key = key; });
  return answerKeyView(ctx, { run: true }, host);
}

// ---------- self-evolution ----------
function editView(record: EditRecord, currentHash: string | null) {
  return { ...structuredClone(record), stale: record.status === 'awaiting-review' && record.baseHash !== currentHash };
}
const editFields = (edit: TypedEdit): [string, string][] | undefined => edit.edit === 'add-field' ? [[edit.name, edit.type]] : undefined;

export async function proposeEdits(ctx: Context, host: ModuleHost, options: { edits?: unknown; fromEvidence?: boolean }) {
  const state = host.store.read(); current(state, ctx, 'prepare');
  const dictionary = currentDictionary(host, ctx);
  check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business meanings before proposing dictionary edits.');
  check(options.edits === undefined || Array.isArray(options.edits) && options.edits.length <= EDITS_PER_CALL, 'INVALID_REQUEST', `Propose at most ${EDITS_PER_CALL} edits at once.`);
  const refused: { index: number; code: string }[] = [];
  const candidates: { edit: TypedEdit; evidence: EditEvidence; index?: number }[] = options.fromEvidence === false ? [] : evidenceEdits(state, ctx, dictionary);
  (options.edits as unknown[] | undefined ?? []).forEach((value, index) => {
    try { candidates.push({ edit: assertEdit(value), evidence: { origin: 'model', count: 1, importIds: [], sourceIds: [], decisionIds: [] }, index }); }
    catch (error) { refused.push({ index, code: codeOf(error) }); }
  });
  check((peek(state)?.edits ?? []).filter(item => item.status === 'awaiting-review').length < 200, 'EDITS_PENDING', 'Review the waiting dictionary edits before proposing more.');
  const base = draftOf(dictionary), key = activeKey(state), keyDigest = digest(key);
  const known = new Set((peek(state)?.edits ?? []).filter(item => item.baseHash === dictionary.hash && item.keyDigest === keyDigest).map(item => canonical(item.edit)));
  const evaluated: EditRecord[] = [];
  let before: KeyRun | undefined;
  for (const { edit, evidence, index } of candidates.slice(0, EDITS_PER_CALL * 2)) {
    if (evaluated.length >= EDITS_PER_CALL) break;
    if (known.has(canonical(edit))) continue;
    known.add(canonical(edit));
    let candidate: DictionaryDraft;
    try { candidate = applyEdit(base, edit); } catch (error) { if (index !== undefined) refused.push({ index, code: codeOf(error) }); continue; }
    before ??= await runAnswerKey(key, base);
    const after = await runAnswerKey(key, candidate), lost = regressions(before, after);
    const status: EditStatus = after.passed && lost.length === 0 ? 'awaiting-review' : 'failed-answer-key';
    const id = newId('dictedit'), draftDigest = digest(candidate);
    evaluated.push({ id, at: now(), memberId: ctx.memberId, edit, evidence, baseHash: dictionary.hash, baseVersion: dictionary.version, draftDigest, keyDigest, status,
      before: before.cases, after: after.cases, failing: after.failing, regressions: lost,
      digest: digest({ id, edit, baseHash: dictionary.hash, draftDigest, keyDigest, after: after.cases }), decidedAt: null, decidedBy: null, publishedHash: null });
  }
  return host.store.update(state => {
    current(state, ctx, 'prepare');
    const edits = areaOf(state).edits;
    for (const record of evaluated) {
      edits.push(record);
      logEdit(state, ctx, record.status === 'awaiting-review' ? 'proposed' : 'rejected', record.status === 'awaiting-review' ? 'answer-key-passed' : 'answer-key-failed',
        record.edit.edit, record.evidence.sourceIds, [record.id, ...record.evidence.importIds, ...record.evidence.decisionIds], editFields(record.edit), record.evidence.origin === 'model');
    }
    if (edits.length > EDIT_LIMIT) {
      const removable = edits.filter(item => item.status !== 'awaiting-review').slice(0, edits.length - EDIT_LIMIT);
      for (const item of removable) edits.splice(edits.indexOf(item), 1);
    }
    return { items: evaluated.map(record => editView(record, dictionary.hash)), refused, dictionaryHash: dictionary.hash };
  });
}

function editsList(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['status', 'limit']);
  const status = payload.status === undefined ? undefined : oneOf(payload.status, EDIT_STATUSES);
  const state = host.store.read(); current(state, ctx);
  const currentHash = currentDictionary(host, ctx)?.hash ?? null;
  const items = (peek(state)?.edits ?? []).filter(item => (!status || item.status === status) && visibleTo(state, ctx, item.memberId, item.evidence.sourceIds)).reverse();
  return { items: items.slice(0, limitOf(payload.limit, 50, 500)).map(item => editView(item, currentHash)), total: items.length, dictionaryHash: currentHash };
}

function findEdit(state: State, ctx: Context, id: unknown): EditRecord {
  const record = peek(state)?.edits.find(item => item.id === id);
  check(record && visibleTo(state, ctx, record.memberId, record.evidence.sourceIds), 'NOT_FOUND', 'This dictionary edit is no longer available.');
  return record;
}

async function editApprove(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['id', 'digest']); appOwner(ctx);
  const state = host.store.read(), record = findEdit(state, ctx, payload.id);
  check(record.status === 'awaiting-review', 'EDIT_NOT_REVIEWABLE', 'Only an edit that passed the answer key and awaits review can be approved.');
  check(payload.digest === record.digest, 'EDIT_CHANGED', 'The edit changed. Review it again before approving it.');
  const dictionary = currentDictionary(host, ctx), attemptId = attemptOf(record.id);
  if (dictionary?.hash !== record.baseHash) {
    // An earlier approval may have published and then been interrupted before it was recorded.
    const retained = dictionary ? await host.call('ontology.get', { attemptId }).catch(() => null) as { attempt?: { dictionaryHash: string } | null } | null : null;
    check(retained?.attempt && retained.attempt.dictionaryHash === dictionary!.hash, 'EDIT_STALE', 'The dictionary changed after this edit was checked. Propose it again.');
    return settleEdit(ctx, host, record.id, { passed: true, cases: record.after, failing: [] }, dictionary!.hash);
  }
  const candidate = applyEdit(draftOf(dictionary), record.edit);
  check(digest(candidate) === record.draftDigest, 'EDIT_CHANGED', 'The edit no longer gives the reviewed dictionary.');
  const run = await runAnswerKey(activeKey(state), candidate);
  if (!run.passed) return settleEdit(ctx, host, record.id, run, null);
  try { await host.call('ontology.publish', { draft: candidate, expectedCurrentHash: record.baseHash, attemptId }); }
  catch (error) { check(!(error instanceof ChausarError && error.code === 'DICTIONARY_CONFLICT'), 'EDIT_STALE', 'The dictionary changed after this edit was checked. Propose it again.'); throw error; }
  return settleEdit(ctx, host, record.id, run, currentDictionary(host, ctx)?.hash ?? null);
}

function settleEdit(ctx: Context, host: ModuleHost, id: string, run: Pick<KeyRun, 'passed' | 'cases' | 'failing'>, publishedHash: string | null) {
  return host.store.update(state => {
    const record = findEdit(state, ctx, id);
    record.status = run.passed ? 'accepted' : 'failed-answer-key'; record.after = run.cases; record.failing = run.failing;
    record.decidedAt = now(); record.decidedBy = ctx.memberId; record.publishedHash = publishedHash;
    logEdit(state, ctx, run.passed ? 'accepted' : 'rejected', run.passed ? 'answer-key-passed' : 'answer-key-failed', record.edit.edit, record.evidence.sourceIds,
      [record.id, ...record.evidence.importIds, ...record.evidence.decisionIds], editFields(record.edit), record.evidence.origin === 'model');
    return { published: run.passed, status: record.status, failing: record.failing, dictionaryHash: publishedHash };
  });
}

async function editReject(ctx: Context, payload: Record<string, unknown>, host: ModuleHost) {
  payloadKeys(payload, ['id', 'digest']); appOwner(ctx);
  const record = findEdit(host.store.read(), ctx, payload.id);
  check(record.status === 'awaiting-review', 'EDIT_NOT_REVIEWABLE', 'Only an edit awaiting review can be rejected.');
  check(payload.digest === undefined || payload.digest === record.digest, 'EDIT_CHANGED', 'The edit changed. Review it again.');
  return host.store.update(state => {
    const stored = findEdit(state, ctx, record.id);
    check(stored.status === 'awaiting-review', 'EDIT_NOT_REVIEWABLE', 'Only an edit awaiting review can be rejected.');
    stored.status = 'rejected'; stored.decidedAt = now(); stored.decidedBy = ctx.memberId;
    logEdit(state, ctx, 'rejected', 'owner-override', stored.edit.edit, stored.evidence.sourceIds, [stored.id], editFields(stored.edit), stored.evidence.origin === 'model');
    return { status: stored.status };
  });
}

export const dictionaryMethods: Record<string, MethodSpec> = {
  'dictionary.mcp.info': { permission: 'read', handler: (ctx, _payload, host) => infoLayer(host.store, ctx) },
  'dictionary.mcp.schema': { permission: 'read', handler: (ctx, _payload, host) => schemaLayer(host.store, ctx) },
  'dictionary.mcp.samples': { permission: 'read', handler: (ctx, payload, host) => { payloadKeys(payload, ['fields']); return samplesLayer(host.store, ctx, payload); } },
  'dictionary.mcp.operations': { permission: 'read', handler: (ctx, _payload, host) => operationsLayer(host.store, ctx) },
  'learningx.dictionaryBuild': { permission: 'prepare', handler: dictionaryBuild },
  'learningx.dictionaryProposals': { permission: 'read', handler: dictionaryProposals },
  'learningx.dictionaryAdopt': { permission: 'admin', handler: dictionaryAdopt },
  'learningx.answerKey': { permission: 'read', handler: answerKeyView },
  'learningx.answerKeySet': { permission: 'admin', handler: answerKeySet },
  'learningx.editsPropose': { permission: 'prepare', handler: (ctx, payload, host) => {
    payloadKeys(payload, ['edits', 'fromEvidence']);
    check(payload.fromEvidence === undefined || typeof payload.fromEvidence === 'boolean', 'INVALID_REQUEST', 'Choose whether to use local evidence.');
    return proposeEdits(ctx, host, { edits: payload.edits, fromEvidence: payload.fromEvidence });
  } },
  'learningx.edits': { permission: 'read', handler: editsList },
  'learningx.editApprove': { permission: 'admin', handler: editApprove },
  'learningx.editReject': { permission: 'admin', handler: editReject },
};

/** Remove proposals and edits whose evidence came from deleted or revoked sources, imports or decisions. */
export function purgeDictionary(state: State, reason: { sourceIds: readonly string[]; removedIds: ReadonlySet<string>; collect?: Set<string> }): number {
  const dictionary = peek(state);
  if (!dictionary) return 0;
  const gone = (id: string) => reason.sourceIds.includes(id) || reason.removedIds.has(id);
  const before = dictionary.proposals.length + dictionary.edits.length;
  const proposalGone = (item: Proposal) => gone(item.id) || item.sourceIds.some(gone);
  const editGone = (item: EditRecord) => gone(item.id) || item.evidence.sourceIds.some(gone) || item.evidence.importIds.some(gone) || item.evidence.decisionIds.some(gone);
  for (const item of [...dictionary.proposals.filter(proposalGone), ...dictionary.edits.filter(editGone)]) reason.collect?.add(item.id);
  dictionary.proposals = dictionary.proposals.filter(item => !proposalGone(item));
  dictionary.edits = dictionary.edits.filter(item => !editGone(item));
  return before - dictionary.proposals.length - dictionary.edits.length;
}

/** Scheduled proposal of small dictionary edits from local evidence; at most once a day, never a model, never a publish. */
export async function dictionaryTick(ctx: Context, host: ModuleHost, scheduler: SchedulerHost): Promise<unknown[]> {
  const state = host.store.read(), day = now().slice(0, 10);
  if (!state.policy.autonomy || !scheduler.awake || peek(state)?.lastTickDay === day || !currentDictionary(host, ctx)) return [];
  const claimed = await host.store.update(state => {
    current(state, ctx, 'prepare');
    const dictionary = areaOf(state);
    if (dictionary.lastTickDay === day) return false;
    dictionary.lastTickDay = day; return true;
  });
  if (!claimed) return [];
  await proposeEdits(ctx, host, { fromEvidence: true });
  // New edits wait in `learningx.edits` (and the approvals queue); the scheduler's results stay the jobs' own.
  return [];
}
