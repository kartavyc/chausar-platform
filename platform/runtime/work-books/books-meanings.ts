/**
 * Meanings (BK-07, BK-08, BK-10, BK-19): the dictionary's words, owner drafts with a
 * deterministic plain-words change, co-signing by a second person and one atomic release.
 * Drafts live at `books.drafts` exactly as the contract's Draft; the Work lane shows them in
 * the approvals queue as `release:<draftId>` and publishes through `books.publish`.
 */
import { authorize, check, hash, newId, now, type Context, type State } from '../contracts.ts';
import { compileDictionary, OntologyService, starterPacks, type Definition, type Dictionary, type DictionaryDraft } from '../ontology.ts';
import type { MethodSpec, ModuleHost } from '../modules/types.ts';
import { canonical, input, member, peekBooks, text, writeBooks, type BooksState, type Draft, type DraftMeta } from './books-common.ts';

const NAME = /^[a-z][a-z0-9_]{0,63}$/;
const open = (draft: Draft) => draft.state === 'draft' || draft.state === 'cosigned';
const same = (a: Definition | null | undefined, b: Definition | null | undefined) => canonical(a ?? null) === canonical(b ?? null);

export function originOf(definition: Definition, pack: string | null): 'core' | 'pack' | 'you' {
  if (starterPacks.every(p => p.definitions.some(d => same(d, definition)))) return 'core';
  if (starterPacks.find(p => p.pack === pack)?.definitions.some(d => same(d, definition))) return 'pack';
  return 'you';
}
function ontology(host: ModuleHost): OntologyService { return host.services.ontology as OntologyService; }
function current(host: ModuleHost, ctx: Context): Dictionary | null { return ontology(host).current(ctx); }
function draftOf(dictionary: Dictionary, name: string, after: Definition | null): DictionaryDraft {
  const index = dictionary.definitions.findIndex(d => d.name === name);
  const definitions = dictionary.definitions.filter(d => d.name !== name).map(d => structuredClone(d));
  if (after) definitions.splice(index < 0 ? definitions.length : index, 0, structuredClone(after));
  return { pack: dictionary.pack, label: dictionary.label, currency: dictionary.currency, gstMode: dictionary.gstMode, fields: structuredClone(dictionary.fields), definitions };
}
/** The change in plain words, built only from the field differences. */
export function describeChange(before: Definition | null, after: Definition | null): string {
  if (!before && after) return `Adds the word ${after.name}. It counts ${after.kind} records using the ${after.field} amount.`;
  if (before && !after) return `Removes the word ${before.name}. Calculations that use it stop working until it is defined again.`;
  if (!before || !after) return 'No change.';
  const parts: string[] = [];
  if (before.label !== after.label) parts.push('The label changes.');
  if (before.kind !== after.kind) parts.push(`It counts ${after.kind} records instead of ${before.kind} records.`);
  if (before.field !== after.field) parts.push(`It reads the ${after.field} amount instead of ${before.field}.`);
  if (before.nulls !== after.nulls) parts.push(after.nulls === 'exclude' ? 'A missing amount is left out and reported, instead of stopping the calculation.' : 'A missing amount now stops the calculation, instead of being left out.');
  if ((before.sign ?? 1) !== (after.sign ?? 1)) parts.push(after.sign === -1 ? 'The amount is now subtracted.' : 'The amount is now added.');
  if (before.meaning !== after.meaning) parts.push('The written meaning changes.');
  return parts.join(' ') || 'No change.';
}
function checksOf(dictionary: Dictionary, name: string, after: Definition | null, by: string): { ok: boolean; code: string | null; compiled: Dictionary | null } {
  try { const compiled = compileDictionary(draftOf(dictionary, name, after), dictionary.version + 1, by); return { ok: true, code: null, compiled }; }
  catch (error) { return { ok: false, code: typeof (error as { code?: unknown })?.code === 'string' ? (error as { code: string }).code : 'INVALID_DICTIONARY', compiled: null }; }
}
function savedAnswersUsing(state: State, name: string): number {
  const receipts = new Map(state.receipts.map(r => [r.id, r] as const));
  return state.answers.filter(a => typeof a?.receiptId === 'string' && (receipts.get(a.receiptId)?.definitions ?? []).some((d: Definition) => d?.name === name)).length;
}
const draftDigest = (draft: Pick<Draft, 'id' | 'name' | 'before' | 'after'>, baseHash: string) => hash(canonical({ id: draft.id, name: draft.name, before: draft.before, after: draft.after, baseHash }));
export function metaOf(books: BooksState, draftId: string): DraftMeta { const meta = books.draftMeta.find(m => m.draftId === draftId); check(meta, 'DRAFT_NOT_FOUND', 'This draft was not found.'); return meta; }
function findDraft(books: BooksState, draftId: unknown): Draft {
  const draft = typeof draftId === 'string' ? books.drafts.find(d => d.id === draftId) : undefined; check(draft, 'DRAFT_NOT_FOUND', 'This draft was not found.'); return draft;
}
function definitionInput(value: unknown, name: string, currency: string): Definition {
  const d = input(value, ['label', 'meaning', 'kind', 'field', 'nulls', 'sign'], ['label', 'meaning', 'kind', 'field', 'nulls']);
  check(text(d.label, 80) && text(d.meaning, 1000) && typeof d.kind === 'string' && NAME.test(d.kind) && typeof d.field === 'string' && /^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(d.field)
    && ['exclude', 'reject'].includes(d.nulls) && (d.sign === undefined || d.sign === 1 || d.sign === -1), 'INVALID_DEFINITION', 'Give the word a label, a meaning, a record kind, an amount field, null handling and an optional sign.');
  return { name, label: d.label, meaning: d.meaning, kind: d.kind, field: d.field, currency, nulls: d.nulls, ...(d.sign !== undefined ? { sign: d.sign } : {}) };
}
const APPROVER_ROLES = ['owner', 'cofounder', 'accountant'];
function activeApprovers(state: State): number { return state.members.filter(m => m.active && APPROVER_ROLES.includes(m.role)).length; }
/** A co-sign counts only while its signer is still an active member who may co-sign. */
function activeCosigners(state: State, meta: DraftMeta): number { return meta.cosignerIds.filter(id => state.members.some(m => m.id === id && m.active && APPROVER_ROLES.includes(m.role))).length; }
/**
 * Every check a release needs, run against one state. Called before publishing and again
 * inside the transaction that claims the draft, so a discard, a changed draft or a co-signer
 * who lost access between the read and the release refuses the release.
 */
export function assertPublishable(state: State, draft: Draft, meta: DraftMeta, digest: unknown) {
  check(open(draft), 'DRAFT_CLOSED', 'This draft is already published or discarded.');
  check(digest === draft.digest, 'PREVIEW_CHANGED', 'The draft changed since you read it. Read it again.');
  check(activeApprovers(state) <= 1 || activeCosigners(state, meta) > 0, 'COSIGN_REQUIRED', 'A second person must co-sign this change before it is published.');
  check(draft.checks.ok, draft.checks.code ?? 'INVALID_DICTIONARY', 'This draft did not pass its checks.');
}
/**
 * Who may close an open draft without publishing it: an owner or cofounder any draft; anyone
 * else only a draft they wrote that nobody has co-signed yet. A draft being released cannot be closed.
 */
function assertClosable(state: State, ctx: Context, draft: Draft, meta: DraftMeta) {
  check(open(draft), 'DRAFT_CLOSED', 'This draft is already published or discarded.');
  check(!meta.publishing, 'DRAFT_CLOSED', 'This draft is being published.');
  const who = member(state, ctx);
  check(['owner', 'cofounder'].includes(who.role) || (draft.state === 'draft' && meta.authorId === ctx.memberId), 'FORBIDDEN', 'Only an owner can discard a co-signed draft or a draft written by someone else.');
}

export const meaningMethods: Record<string, MethodSpec> = {
  'books.meanings': { permission: 'read', handler(ctx, payload, host) {
    input(payload, []); const dictionary = current(host, ctx); const books = peekBooks(host.store.read());
    const drafts = books.drafts; const openByName = new Map(drafts.filter(open).map(d => [d.name, d] as const));
    // A clash: a newer release landed after the draft was made, so publishing it would be refused.
    const stateOf = (draft: Draft | undefined) => !draft ? 'published' as const : books.draftMeta.find(m => m.draftId === draft.id)?.baseHash === dictionary?.hash ? 'draft' as const : 'clash' as const;
    const words = (dictionary?.definitions ?? []).map(d => ({ name: d.name, label: d.label, meaning: d.meaning, origin: originOf(d, dictionary!.pack), state: stateOf(openByName.get(d.name)) }));
    for (const draft of openByName.values()) if (draft.after && !words.some(w => w.name === draft.name))
      words.push({ name: draft.name, label: draft.after.label, meaning: draft.after.meaning, origin: 'you', state: stateOf(draft) });
    return { dictionary: dictionary ? { version: dictionary.version, hash: dictionary.hash, pack: dictionary.pack, publishedAt: dictionary.publishedAt, publishedBy: dictionary.publishedBy, gstMode: dictionary.gstMode } : null,
      words, drafts: structuredClone(drafts) };
  } },
  'books.meaning': { permission: 'read', handler(ctx, payload, host) {
    const { name } = input(payload, ['name'], ['name']); check(typeof name === 'string' && NAME.test(name), 'INVALID_BOOKS_REQUEST', 'Name the word.');
    const dictionary = current(host, ctx); const word = dictionary?.definitions.find(d => d.name === name) ?? null;
    const draft = [...peekBooks(host.store.read()).drafts].reverse().find(d => d.name === name && open(d)) ?? null;
    check(word || draft, 'WORD_NOT_FOUND', 'This word is not in the dictionary.');
    const history: { version: number; publishedAt: string; publishedBy: string; meaning: string }[] = []; let previous: Definition | null = null;
    for (const version of ontology(host).history(ctx)) {
      const definition = version.definitions.find(d => d.name === name) ?? null;
      if (definition && !same(definition, previous)) history.push({ version: version.version, publishedAt: version.publishedAt, publishedBy: version.publishedBy, meaning: definition.meaning });
      previous = definition;
    }
    return { word: structuredClone(word), origin: word ? originOf(word, dictionary!.pack) : 'you', draft: structuredClone(draft), history };
  } },
  'books.draft': { permission: 'prepare', async handler(ctx, payload, host) {
    const request = input(payload, ['name', 'definition', 'replaces'], ['name']); check(typeof request.name === 'string' && NAME.test(request.name), 'INVALID_BOOKS_REQUEST', 'Name the word in lower case letters, digits and underscores.');
    check(request.replaces === undefined || typeof request.replaces === 'string' && request.replaces.length > 0 && request.replaces.length <= 200, 'INVALID_BOOKS_REQUEST', 'Name the open draft this one replaces.');
    check(Object.hasOwn(request, 'definition'), 'INVALID_BOOKS_REQUEST', 'Give the new definition, or null to remove the word.');
    const dictionary = current(host, ctx); check(dictionary, 'DICTIONARY_REQUIRED', 'Publish business meanings before changing one.');
    const name: string = request.name; const before = dictionary.definitions.find(d => d.name === name) ?? null;
    const after = request.definition === null ? null : definitionInput(request.definition, name, dictionary.currency);
    check(before || after, 'WORD_NOT_FOUND', 'This word is not in the dictionary, so there is nothing to remove.');
    check(!same(before, after), 'NO_CHANGE', 'The new definition is the same as the published one.');
    const author = member(host.store.read(), ctx);
    const checks = checksOf(dictionary, name, after, ctx.memberId);
    const calculations = [...new Set([...dictionary.operations, ...(checks.compiled?.operations ?? [])].filter(o => o.definitions.includes(name)).map(o => o.id))].sort();
    return writeBooks(host.store, ctx, 'prepare', (books, state) => {
      // A redraft replaces the open draft in the same transaction: the one named in `replaces`, or the caller's own.
      const prior = books.drafts.find(d => d.name === name && open(d));
      if (request.replaces !== undefined) {
        const replaced = findDraft(books, request.replaces);
        check(replaced.name === name, 'INVALID_BOOKS_REQUEST', 'The draft to replace is for another word.');
        assertClosable(state, ctx, replaced, metaOf(books, replaced.id)); replaced.state = 'discarded';
      } else if (prior) {
        const meta = metaOf(books, prior.id);
        check(meta.authorId === ctx.memberId, 'DRAFT_OPEN', 'This word already has an open draft. Publish or discard it first.');
        assertClosable(state, ctx, prior, meta); prior.state = 'discarded';
      }
      check(!books.drafts.some(d => d.name === name && open(d)), 'DRAFT_OPEN', 'This word already has an open draft. Publish or discard it first.');
      const id = newId('draft');
      const draft: Draft = { id, name, author: author.name, createdAt: now(), state: 'draft', before: structuredClone(before), after: structuredClone(after), change: describeChange(before, after),
        affects: { calculations, savedAnswers: savedAnswersUsing(state, name) }, reviews: [], checks: { ok: checks.ok, code: checks.code }, digest: draftDigest({ id, name, before, after }, dictionary.hash) };
      books.drafts.push(draft); books.draftMeta.push({ draftId: id, authorId: ctx.memberId, baseHash: dictionary.hash, cosignerIds: [], publishedVersion: null });
      return structuredClone(draft);
    });
  } },
  'books.discard': { permission: 'prepare', handler(ctx, payload, host) {
    const { draftId } = input(payload, ['draftId'], ['draftId']);
    return writeBooks(host.store, ctx, 'prepare', (books, state) => {
      const draft = findDraft(books, draftId); assertClosable(state, ctx, draft, metaOf(books, draft.id));
      draft.state = 'discarded'; return { draftId: draft.id, state: 'discarded' as const };
    });
  } },
  'books.cosign': { permission: 'prepare', handler(ctx, payload, host) {
    const { draftId, digest } = input(payload, ['draftId', 'digest'], ['draftId', 'digest']);
    return writeBooks(host.store, ctx, 'prepare', (books, state) => {
      const draft = findDraft(books, draftId); const meta = metaOf(books, draft.id); const signer = member(state, ctx);
      check(open(draft) && !meta.publishing, 'DRAFT_CLOSED', 'This draft is already published or discarded.');
      check(digest === draft.digest, 'PREVIEW_CHANGED', 'The draft changed since you read it. Read it again.');
      check(meta.authorId !== ctx.memberId, 'COSIGN_SELF', 'A co-sign must come from a different person than the author.');
      check(!meta.cosignerIds.includes(ctx.memberId), 'ALREADY_COSIGNED', 'You have already co-signed this draft.');
      meta.cosignerIds.push(ctx.memberId); draft.reviews.push({ kind: 'cosign', by: signer.name, role: signer.role, at: now() }); draft.state = 'cosigned';
      return structuredClone(draft);
    });
  } },
  'books.publish': { permission: 'approve', async handler(ctx, payload, host) {
    const { draftId, digest } = input(payload, ['draftId', 'digest'], ['draftId', 'digest']);
    const state = host.store.read(); const books = peekBooks(state); const draft = findDraft(books, draftId); const meta = metaOf(books, draft.id);
    assertPublishable(state, draft, meta, digest);
    // The change applies to the dictionary that was reviewed; a newer release refuses as DICTIONARY_CONFLICT.
    const base = ontology(host).history(ctx).find(d => d.hash === meta.baseHash); check(base, 'DICTIONARY_CONFLICT', 'The reviewed dictionary is no longer available. Draft the change again.');
    const freshBefore = new Set(state.answers.filter(a => !a.stale).map(a => a.id));
    // Claim the draft inside one transaction after checking it again, so a discard, a redraft or a lost co-signer
    // between the read above and the release refuses the release instead of publishing a closed draft.
    await writeBooks(host.store, ctx, 'approve', (fresh, latest) => {
      const stored = findDraft(fresh, draft.id), storedMeta = metaOf(fresh, draft.id);
      assertPublishable(latest, stored, storedMeta, digest);
      check(storedMeta.baseHash === meta.baseHash, 'PREVIEW_CHANGED', 'The draft changed since you read it. Read it again.');
      storedMeta.publishing = { by: ctx.memberId, at: now() };
    });
    let published: Dictionary;
    try { published = await ontology(host).publish(ctx, draftOf(base, draft.name, draft.after), { expectedCurrentHash: meta.baseHash, attemptId: `books-${draft.id}`.slice(0, 128) }); }
    catch (error) { await writeBooks(host.store, ctx, 'approve', fresh => { metaOf(fresh, draft.id).publishing = null; }).catch(() => undefined); throw error; }
    await writeBooks(host.store, ctx, 'approve', fresh => { const stored = findDraft(fresh, draft.id); stored.state = 'published'; const m = metaOf(fresh, draft.id); m.publishedVersion = published.version; m.publishing = null; });
    return { version: published.version, hash: published.hash, staleAnswers: host.store.read().answers.filter(a => a.stale && freshBefore.has(a.id)).length };
  } },
  'books.packs': { permission: 'read', handler(ctx, payload, host) {
    input(payload, []); const dictionary = current(host, ctx);
    return { packs: starterPacks.map(p => p.pack === dictionary?.pack
      ? { pack: p.pack, label: p.label, state: 'in-use' as const, meanings: dictionary.definitions.filter(d => p.definitions.some(x => same(x, d))).length }
      : { pack: p.pack, label: p.label, state: 'available' as const, meanings: p.definitions.length }) };
  } },
  'books.gst': { permission: 'read', handler(ctx, payload, host) { input(payload, []); authorize(host.store, ctx); return { gstMode: current(host, ctx)?.gstMode ?? null, rates: { available: true as const } }; } },
};
