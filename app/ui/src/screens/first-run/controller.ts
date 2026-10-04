/**
 * The first-run dictionary controller: starter packs in, one reviewed dictionary out.
 *
 * Authority. Every operation first reads the host's live guard (surface, read-only and
 * lock state belong to the parent; with no guard supplied there is no authority and
 * every operation refuses). Reads are fenced by `ui.context` before and after; the two
 * must name the same workspace, member, role, epoch and contextKey. The context read at
 * load is the reviewed context. After its own publish the contextKey changes on purpose
 * (the key covers the ontology), so the fresh context is adopted only when the same seat
 * is still present and the returned dictionary, its hash and the `ontology.get` readback
 * all agree.
 *
 * Mutation. `ontology.publish` is issued only from `publishDictionary`, only for the
 * exact rendered review (revision and digest), only when every row and the settings are
 * accepted with current pins. The order before dispatch is fixed: the frozen draft is
 * rehashed and must still equal the review digest; then one fresh `ui.context` is read
 * and must equal the reviewed context, key included; then, with nothing awaited and no
 * observer called in between, the guard, the state, the review identity and the role are
 * checked again, the attempt is pinned and the raw call is made. Only then does the
 * `issued` event fire, so an observer that locks or cancels inside it changes what
 * happens after the effect, never whether the effect exists. The call carries the exact
 * reviewed current hash (or null) and a fresh private attempt identifier. The Engine
 * compares that baseline atomically with publication and retains the attempt's receipt.
 *
 * Attempts. The moment the raw call is issued a private attempt is pinned: the reviewed
 * bytes and digest, the reviewed context, the dictionary that was current before (hash
 * and version), the private identifier, the version and author this publication would produce. When the raw
 * reply arrives and is itself a verified publication of exactly the reviewed bytes as the
 * expected next revision by this seat, its hash is pinned privately as the returned
 * publication, even if the surface was left meanwhile. The attempt is never discarded by
 * a cancel, a lock, a settle, a navigation, a load or a dispose. While the raw call is
 * unsettled every other operation is `IN_FLIGHT`; once it settles without a verified
 * outcome every other operation is `PUBLISH_UNRESOLVED` until `reconcile` reads the
 * dictionary back and reaches a verdict. A cancel, a lock, or any authority or surface
 * loss the controller detects itself hides the held decisions: the public state becomes
 * a neutral `unknown` with no workspace, member, draft, pack, label or digest in it; the
 * private pin stays for the readback. Nothing is ever retried by this code.
 *
 * Verdicts. Reconciliation reads `ontology.get({ attemptId })`. A null attempt remains
 * unknown: an issued call may still commit, even while the baseline is unchanged. A
 * receipt must match every private input and exactly one verified historical dictionary.
 * Only that publication still current permits a handoff. Its receipt in history proves
 * commitment after supersession, releases the attempt, and reports `REVIEW_NOT_CURRENT`.
 * Only a declared Engine refusal from the raw publish call proves noncommit. Generic
 * failures never release the attempt, and reconciliation never retries publication.
 *
 * Guard at every exit. The live guard is read not only before an operation and after each
 * awaited reply, but at every release of public state: a success, a rejection, a refusal
 * and a failure alike. A guard found dead at any of those points hides the held decisions
 * exactly as a parent lock does: a pinned attempt keeps its private pin and shows a neutral
 * `unknown`; without an effect the state is a neutral `idle` or `unavailable`. No exit publishes a review,
 * a summary or a context after the guard has died.
 *
 * Observers. Every public state is published before the lifecycle event that describes
 * it, and nothing is published after an event has fired. An observer that cancels, locks
 * or disposes inside a callback therefore has the last word. Disposal seals the
 * controller before any observer is told; it is refused while an attempt is pinned,
 * because the pin would be lost with the controller.
 *
 * Departures. Continue after a verified publication and the parent-owned settings change
 * are controller-checked intents: the control names the exact rendered publication or
 * review revision, the live guard is read, Continue reads one fresh `ui.context` that
 * must still equal the published one, and the controller cancels itself (`left`) before
 * anything is admitted. The result is not the secret itself but a one-shot admission:
 * `admit()` re-reads the guard, the disposal flag and the exact `left` state of this very
 * departure synchronously and returns the handoff or draft once, or null. The screen calls
 * the parent callback directly on a non-null return with nothing awaited in between, so an
 * observer of `left` that cancels, locks, disposes or kills the guard, synchronously or in
 * a queued microtask, ends the departure before the parent runs. A retained old control
 * after a cancel, a lock, a guard loss, a pack change or a context replacement hands the
 * parent nothing.
 *
 * Workspace creation and activation remain parent-owned. Nothing here calls those methods.
 */

import { validateUiContext } from '../../host/contracts.ts';
import type { UiContext } from '../../host/contracts.ts';
import {
  ATTEMPT_ID, canPublish, draftOf, firstRunFailure, frozenClone, sameAuthority, sameContext,
  validateOntologyAttemptReadback, validateOntologyReadback, validatePacks, validatePublished,
} from './contracts.ts';
import type { DictionaryDraft, EngineDictionaryRefusal, FirstRunCode, FirstRunPort, OntologyAttemptReadback, PublishedDictionary } from './contracts.ts';
import { draftJson, publishedVerified, webCryptoDigest } from './digest.ts';
import type { TextDigest } from './digest.ts';
import { acceptRow, acceptSettings, allReviewed, changeMeaning, pinMatches, startReview, withDigest } from './review.ts';
import type { Review, ReviewPin } from './review.ts';

/** The parent's live guard: the first-run surface is current, the seat is not read only and the vault is not locked. */
export interface FirstRunGuard { live(): boolean }

export interface FirstRunControllerOptions {
  /** Required for any authority. Absent means no authority: every operation refuses. */
  readonly guard?: FirstRunGuard | undefined;
  /** SHA-256 over text. Defaults to WebCrypto; tests may inject one. */
  readonly digest?: TextDigest | undefined;
  /** One fresh opaque identifier per dispatch. Defaults to the browser's cryptographic UUID generator. */
  readonly createAttemptId?: (() => string) | undefined;
}

export interface PublishedSummary {
  readonly version: number;
  readonly hash: string;
  readonly pack: string;
  readonly label: string;
  readonly publishedAt: string;
  readonly publishedBy: string;
}

export interface ReviewNotice { readonly code: FirstRunCode; readonly engineCode?: EngineDictionaryRefusal }

/** What Continue hands the parent after a verified publication. Pending choices are explicit, not defaulted. */
export interface FirstRunHandoff {
  readonly workspaceId: string;
  readonly memberId: string;
  readonly contextKey: string;
  readonly dictionary: PublishedSummary;
  readonly reviewDigest: string;
  readonly pending: {
    readonly calendar: 'not-configured';
    readonly timeZone: 'not-configured';
    readonly ordering: 'not-configured';
    readonly todayDefaults: 'not-configured';
  };
}

/** What a rendered Continue names: the exact verified publication and context it was drawn for. */
export interface HandoffPin {
  readonly hash: string;
  readonly contextKey: string;
  readonly reviewDigest: string;
}

/** The nonsecret part of an unresolved attempt, shown only while the surface that issued it is still present. */
export interface AttemptSummary {
  readonly pack: string;
  readonly label: string;
  readonly reviewDigest: string;
}

export type FirstRunState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'loading' }
  /** This seat may read but not publish; no mutation control is offered and no pack is read. */
  | { readonly kind: 'read-only'; readonly context: UiContext }
  | { readonly kind: 'unavailable'; readonly code: FirstRunCode }
  | { readonly kind: 'choose'; readonly context: UiContext; readonly packs: readonly DictionaryDraft[]; readonly current: PublishedSummary | null }
  | { readonly kind: 'review'; readonly context: UiContext; readonly packs: readonly DictionaryDraft[]; readonly current: PublishedSummary | null; readonly review: Review; readonly publishing: boolean; readonly notice: ReviewNotice | null }
  /** A publish was issued and its result is not verified. `attempt` is null once the surface was left or authority was lost: nothing private remains public. */
  | { readonly kind: 'unknown'; readonly code: FirstRunCode; readonly reconciling: boolean; readonly attempt: AttemptSummary | null }
  /** Verified. `review` is the reviewed rows when they are still held, null after a readback that followed a departure. */
  | { readonly kind: 'published'; readonly context: UiContext; readonly published: PublishedSummary; readonly review: Review | null; readonly reviewDigest: string; readonly handoff: FirstRunHandoff }
  /** The person left through a controller-checked departure (Continue, the settings change). Nothing private remains; the parent is navigating. */
  | { readonly kind: 'left' };

export interface FirstRunRefusal { readonly ok: false; readonly code: FirstRunCode }
export type FirstRunResult = { readonly ok: true } | FirstRunRefusal;

/**
 * A one-shot admission to a parent callback after a controller-checked departure. The departure already
 * cancelled the controller into `left`; `admit()` re-reads the live guard, the disposal flag and the exact
 * `left` state of this departure synchronously and returns the admitted value once. It returns null after a
 * cancel, a lock, a dispose, a dead guard, any later operation, or a second call. The caller must invoke the
 * parent callback directly on a non-null return, with nothing awaited and no observer called in between.
 */
export interface Admission<T> {
  readonly ok: true;
  admit(): T | null;
}
export type LeaveResult = Admission<FirstRunHandoff> | FirstRunRefusal;
export type SettingsLeaveResult = Admission<DictionaryDraft> | FirstRunRefusal;

/** Whether an effect may be in flight or unverified. Nonsecret; the parent uses it for its remount fence. */
export type IssuanceStatus = 'none' | 'issued' | 'unresolved';

/**
 * Nonsecret lifecycle events of the one mutation. `issued` fires synchronously after the
 * raw call has been made and before anything is awaited: the parent should treat Today
 * and Saved as possibly stale from then on, including across a departure. `settled`
 * fires when the raw call settles; `resolved` fires when the attempt reaches a verdict.
 * Every event follows the public state it describes. No event carries names, bytes or hashes.
 */
export type IssuanceEvent =
  | { readonly kind: 'issued' }
  | { readonly kind: 'settled'; readonly outcome: 'verified' | 'not-committed' | 'unresolved' }
  | { readonly kind: 'resolved'; readonly outcome: 'published' | 'not-committed' | 'already-current' | 'not-current' };

export interface FirstRunController {
  snapshot(): FirstRunState;
  subscribe(listener: () => void): () => void;
  /** The attempt lifecycle. Listeners outlive cancels; they are dropped by dispose. */
  onIssuance(listener: (event: IssuanceEvent) => void): () => void;
  issuance(): IssuanceStatus;
  /** Reads context, packs and the current dictionary. Refused while anything is in flight or an attempt is unresolved. */
  load(): Promise<FirstRunResult>;
  /** Starts a new review of one of the loaded packs, with a new generation. Every earlier decision is gone. */
  choosePack(pack: string): FirstRunResult;
  /** Back to the pack list. Every decision is gone. */
  backToPacks(): FirstRunResult;
  /** One Accept click, for the exact review revision and digest the control was rendered with. */
  acceptRow(name: string, pin: ReviewPin): FirstRunResult;
  acceptSettings(pin: ReviewPin): FirstRunResult;
  /** One plain-language change to one meaning, from an editor rendered for `revision`. */
  changeMeaning(name: string, meaning: string, revision: string): FirstRunResult;
  /** The one mutation, for the exact rendered review. See the file comment. */
  publishDictionary(pin: ReviewPin): Promise<FirstRunResult>;
  /** Read this private attempt's receipt and exact dictionary back; null remains unresolved. */
  reconcile(): Promise<FirstRunResult>;
  /**
   * Continue, for the exact rendered publication. Reads one fresh `ui.context` that must equal the published
   * one, then cancels this controller (`left`) and returns a one-shot admission to the handoff for the parent's
   * own journey. Anything older, a dead guard, a changed context, a second press, or an observer of `left`
   * that ends the departure returns nothing.
   */
  leave(pin: HandoffPin): Promise<LeaveResult>;
  /** The parent-owned settings change, for the exact rendered review revision. Cancels this controller first and returns a one-shot admission to the reviewed draft. */
  leaveToSettings(revision: string): SettingsLeaveResult;
  /** A lifecycle boundary (departure, unmount): private data is hidden. An issued attempt stays pinned privately. */
  cancel(): void;
  /** Authority lost (lock, read only, revocation): private data is hidden with a code. An issued attempt stays pinned privately. */
  invalidate(code?: FirstRunCode): void;
  /**
   * End of the host's lifetime. Seals the controller before any observer is told. Refused (`IN_FLIGHT` or
   * `PUBLISH_UNRESOLVED`) while an attempt is pinned: the controller stays alive so the pin is not lost.
   */
  dispose(): FirstRunResult;
}

interface Attempt {
  phase: 'issued' | 'unresolved';
  readonly attemptId: string;
  readonly expectedCurrentHash: string | null;
  readonly pack: string;
  readonly label: string;
  readonly reviewDigest: string;
  readonly draftJson: string;
  /** Private: the context the review was read and dispatched against. Never published after a cancel. */
  readonly reviewed: UiContext;
  /** The dictionary that was current when the review was read, as verified at load. */
  readonly baseline: { readonly hash: string; readonly version: number } | null;
  readonly expectedVersion: number;
  readonly expectedActor: string;
  /** The hash of the raw reply once it verified as this attempt's own publication; null while no such reply is known. */
  returned: string | null;
  /** The reviewed decisions, held only while the surface that issued them is still present. */
  held: { readonly review: Review; readonly packs: readonly DictionaryDraft[]; readonly current: PublishedSummary | null } | null;
}

const ok: FirstRunResult = Object.freeze({ ok: true });
const refused = (code: FirstRunCode): FirstRunRefusal => Object.freeze({ ok: false, code });
const IDLE: FirstRunState = Object.freeze({ kind: 'idle' });
const LEFT: FirstRunState = Object.freeze({ kind: 'left' });
const AUTHORITY_CODES: readonly FirstRunCode[] = ['ACCESS_DENIED', 'VAULT_LOCKED', 'UNAUTHENTICATED'];

export function summaryOf(dictionary: PublishedDictionary): PublishedSummary {
  return Object.freeze({ version: dictionary.version, hash: dictionary.hash, pack: dictionary.pack, label: dictionary.label, publishedAt: dictionary.publishedAt, publishedBy: dictionary.publishedBy });
}

function handoffOf(context: UiContext, published: PublishedSummary, reviewDigest: string): FirstRunHandoff {
  return Object.freeze({
    workspaceId: context.workspace.id, memberId: context.member.id, contextKey: context.contextKey,
    dictionary: published, reviewDigest,
    pending: Object.freeze({ calendar: 'not-configured', timeZone: 'not-configured', ordering: 'not-configured', todayDefaults: 'not-configured' } as const),
  });
}

/** The pin a Continue rendered for a published state must carry. */
export function handoffPinOf(state: Extract<FirstRunState, { kind: 'published' }>): HandoffPin {
  return Object.freeze({ hash: state.published.hash, contextKey: state.context.contextKey, reviewDigest: state.reviewDigest });
}

/** Controllers are numbered so a review generation is unique across every controller of this realm. */
let controllers = 0;

export function createFirstRunController(port: FirstRunPort, options: FirstRunControllerOptions = {}): FirstRunController {
  const digestOf = options.digest ?? webCryptoDigest();
  const createAttemptId = options.createAttemptId ?? (() => globalThis.crypto.randomUUID());
  controllers += 1;
  const instance = controllers;
  let selections = 0;
  let state: FirstRunState = IDLE;
  let generation = Symbol();
  let digestGeneration = Symbol();
  let disposed = false;
  /** Synchronous latches. `publishing` covers the whole press; `attempt` is pinned the moment the raw call is made. */
  let publishing = false;
  let reconciling = false;
  let leaving = false;
  let attempt: Attempt | null = null;
  const listeners = new Set<() => void>();
  const issuanceListeners = new Set<(event: IssuanceEvent) => void>();

  function publish(next: FirstRunState): void {
    if (disposed) return;
    state = Object.freeze(next);
    for (const listener of listeners) { try { listener(); } catch { /* observers own their errors */ } }
  }
  function notify(event: IssuanceEvent): void {
    const frozen = Object.freeze(event);
    for (const listener of issuanceListeners) { try { listener(frozen); } catch { /* observers own their errors */ } }
  }
  const current = (token: symbol) => !disposed && generation === token;
  function live(): boolean {
    if (disposed) return false;
    try { return options.guard?.live() === true; } catch { return false; }
  }
  /** The guard is parent code: it may synchronously end or replace the operation while answering. */
  function unchanged(token: symbol, shown: FirstRunState): boolean {
    return current(token) && state === shown;
  }
  const context = () => port.request('ui.context', {}).then(validateUiContext);
  const summaryOfAttempt = (pending: Attempt): AttemptSummary | null =>
    pending.held === null ? null : Object.freeze({ pack: pending.pack, label: pending.label, reviewDigest: pending.reviewDigest });

  /** The lookup is evidence only after every receipt input and its unique historical dictionary agree. */
  async function publicationOf(pending: Attempt, readback: OntologyAttemptReadback): Promise<
    { readonly kind: 'unknown' } | { readonly kind: 'mismatch' } | { readonly kind: 'verified'; readonly dictionary: PublishedDictionary }
  > {
    const receipt = readback.attempt;
    if (receipt === null) return { kind: 'unknown' };
    if (receipt.attemptId !== pending.attemptId || receipt.workspaceId !== pending.reviewed.workspace.id
      || receipt.memberId !== pending.reviewed.member.id || receipt.epoch !== pending.reviewed.member.epoch
      || receipt.draftDigest !== pending.reviewDigest || receipt.expectedCurrentHash !== pending.expectedCurrentHash
      || receipt.version !== pending.expectedVersion || (pending.returned !== null && receipt.dictionaryHash !== pending.returned)) return { kind: 'mismatch' };
    const matches = readback.history.filter(dictionary => dictionary.hash === receipt.dictionaryHash && dictionary.version === receipt.version);
    if (matches.length !== 1 || readback.current === null
      || JSON.stringify(readback.current) !== JSON.stringify(readback.history.at(-1))) return { kind: 'mismatch' };
    const dictionary = matches[0]!;
    if (dictionary.publishedBy !== pending.expectedActor || draftJson(draftOf(dictionary)) !== pending.draftJson
      || (await digestOf(draftJson(draftOf(dictionary)))) !== receipt.draftDigest
      || !(await publishedVerified(dictionary, digestOf))) return { kind: 'mismatch' };
    if (readback.current.hash === dictionary.hash) {
      if (JSON.stringify(readback.current) !== JSON.stringify(dictionary)) return { kind: 'mismatch' };
    } else if (!(await publishedVerified(readback.current, digestOf))) return { kind: 'mismatch' };
    return { kind: 'verified', dictionary };
  }

  /** The latch every other operation reads first. */
  function fence(): FirstRunRefusal | null {
    if (publishing || reconciling || leaving || attempt?.phase === 'issued') return refused('IN_FLIGHT');
    if (attempt !== null) return refused('PUBLISH_UNRESOLVED');
    return null;
  }

  /** The surface was left mid-operation: private data is hidden; nothing was or will be sent by this operation. */
  function departed(): FirstRunRefusal {
    generation = Symbol(); digestGeneration = Symbol();
    publish(IDLE);
    return refused('READ_INVALIDATED');
  }
  function lost(code: FirstRunCode): FirstRunRefusal {
    generation = Symbol(); digestGeneration = Symbol();
    publish({ kind: 'unavailable', code });
    return refused(code);
  }
  /** Hides private data. A pinned attempt stays private and keeps the public state a neutral unknown. */
  function clear(code: FirstRunCode | null): void {
    generation = Symbol(); digestGeneration = Symbol();
    if (attempt !== null) {
      attempt.held = null;
      publish({ kind: 'unknown', code: code ?? 'READ_INVALIDATED', reconciling: false, attempt: null });
      return;
    }
    publish(code === null ? IDLE : { kind: 'unavailable', code });
  }

  async function load(): Promise<FirstRunResult> {
    const blocked = fence();
    if (blocked !== null) return blocked;
    if (state.kind === 'loading') return refused('IN_FLIGHT');
    const entered = generation, shown = state, authorized = live();
    if (!unchanged(entered, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    generation = Symbol(); digestGeneration = Symbol();
    const token = generation;
    publish({ kind: 'loading' });
    try {
      if (!current(token)) return refused('READ_INVALIDATED');
      const before = await context();
      if (!current(token)) return refused('READ_INVALIDATED');
      const beforeAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!beforeAuthorized) return departed();
      if (!canPublish(before)) { publish({ kind: 'read-only', context: before }); return refused('ROLE_FORBIDDEN'); }
      const packs = validatePacks(await port.request('ontology.packs', {}));
      if (!current(token)) return refused('READ_INVALIDATED');
      const packsAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!packsAuthorized) return departed();
      const readback = validateOntologyReadback(await port.request('ontology.get', {}));
      if (!current(token)) return refused('READ_INVALIDATED');
      const readbackAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!readbackAuthorized) return departed();
      // The current dictionary becomes the baseline of a later attempt, so its Engine proof is checked before it is kept.
      const verified = readback.current === null ? true : await publishedVerified(readback.current, digestOf);
      if (!current(token)) return refused('READ_INVALIDATED');
      const verifiedAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!verifiedAuthorized) return departed();
      if (!verified) return lost('READBACK_MISMATCH');
      const after = await context();
      if (!current(token)) return refused('READ_INVALIDATED');
      const afterAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!afterAuthorized) return departed();
      if (!sameAuthority(before, after)) return lost('ACCESS_DENIED');
      if (!sameContext(before, after)) return lost('CONTEXT_CHANGED');
      publish({ kind: 'choose', context: after, packs, current: readback.current === null ? null : summaryOf(readback.current) });
      return ok;
    } catch (error) {
      if (!current(token)) return refused('READ_INVALIDATED');
      return lost(firstRunFailure(error).code);
    }
  }

  /**
   * Hashes the exact draft of a review in the background. A result for any other review, or after any later
   * change, is dropped; a result that arrives after the guard went dead hides the review instead of releasing it.
   */
  function hashReview(review: Review): void {
    if (disposed || state.kind !== 'review' || state.review !== review) return;
    const token = generation, operation = Symbol();
    digestGeneration = operation;
    void digestOf(review.draftJson).then(digest => {
      if (!current(token) || digestGeneration !== operation) return;
      const authorized = live();
      if (!current(token) || digestGeneration !== operation) return;
      if (!authorized) { clear('NO_AUTHORITY'); return; }
      const shown = state;
      if (shown.kind !== 'review' || shown.review.revision !== review.revision || shown.review.draftJson !== review.draftJson || shown.review.digest !== null) return;
      publish({ ...shown, review: withDigest(shown.review, digest) });
    }, () => {
      if (!current(token) || digestGeneration !== operation) return;
      const authorized = live();
      if (!current(token) || digestGeneration !== operation) return;
      if (!authorized) { clear('NO_AUTHORITY'); return; }
      lost('DIGEST_UNAVAILABLE');
    });
  }

  function choosePack(pack: string): FirstRunResult {
    const blocked = fence();
    if (blocked !== null) return blocked;
    const token = generation, shown = state, authorized = live();
    if (!unchanged(token, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    if (shown.kind !== 'choose' && shown.kind !== 'review') return refused('SELECTION_INVALID');
    const draft = shown.packs.find(item => item.pack === pack);
    if (draft === undefined) return refused('PACK_UNKNOWN');
    selections += 1;
    const review = startReview(frozenClone(draft), `c${instance}s${selections}`);
    publish({ kind: 'review', context: shown.context, packs: shown.packs, current: shown.current, review, publishing: false, notice: null });
    hashReview(review);
    return ok;
  }

  function backToPacks(): FirstRunResult {
    const blocked = fence();
    if (blocked !== null) return blocked;
    const token = generation, shown = state, authorized = live();
    if (!unchanged(token, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    if (shown.kind !== 'review') return refused('SELECTION_INVALID');
    digestGeneration = Symbol();
    publish({ kind: 'choose', context: shown.context, packs: shown.packs, current: shown.current });
    return ok;
  }

  function withReview(change: (review: Review) => Review | null, failure: FirstRunCode): FirstRunResult {
    const blocked = fence();
    if (blocked !== null) return blocked;
    const token = generation, shown = state, authorized = live();
    if (!unchanged(token, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    if (shown.kind !== 'review') return refused('SELECTION_INVALID');
    const review = change(shown.review);
    if (review === null) return refused(failure);
    publish({ ...shown, review, notice: null });
    if (review.digest === null) hashReview(review);
    return ok;
  }

  async function publishDictionary(pin: ReviewPin): Promise<FirstRunResult> {
    const blocked = fence();
    if (blocked !== null) return blocked;
    const shown = state;
    if (shown.kind !== 'review') return refused('SELECTION_INVALID');
    if (!pinMatches(shown.review, pin)) return refused('DIGEST_STALE');
    if (!allReviewed(shown.review)) return refused('NOT_REVIEWED');
    const token = generation, authorized = live();
    if (!unchanged(token, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    if (!canPublish(shown.context)) return lost('ROLE_FORBIDDEN');
    // The synchronous latch: a second press, a load or a pack change sees it before anything is awaited.
    publishing = true;
    const review = shown.review, reviewed = shown.context, reviewDigest = pin.digest;
    publish({ ...shown, publishing: true, notice: null });
    let pending: Attempt | null = null;
    let stage: 'before' | 'raw' | 'after' = 'before';
    const atRest = (notice: ReviewNotice | null): FirstRunResult => {
      const authorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!authorized) {
        clear('NO_AUTHORITY');
        return notice === null ? refused('READ_INVALIDATED') : refused(notice.code);
      }
      const now = state;
      if (now.kind === 'review') publish({ ...now, publishing: false, notice });
      return notice === null ? ok : refused(notice.code);
    };
    /**
     * The raw call settled without a verified outcome while this surface is still present. `neutral` is an
     * authority or surface loss the controller detected itself: the held decisions are hidden as on a lock.
     */
    const unresolved = (code: FirstRunCode, neutral = false): FirstRunResult => {
      const authorized = live();
      if (pending !== null) { pending.phase = 'unresolved'; if (neutral || !authorized) pending.held = null; }
      if (!current(token)) return settledHidden();
      publish({ kind: 'unknown', code, reconciling: false, attempt: pending === null ? null : summaryOfAttempt(pending) });
      notify({ kind: 'settled', outcome: 'unresolved' });
      return refused(code);
    };
    /** The raw call settled after the surface was left: the public state stays neutral; the attempt waits for a readback. */
    const settledHidden = (): FirstRunResult => {
      if (pending !== null) pending.phase = 'unresolved';
      notify({ kind: 'settled', outcome: 'unresolved' });
      return refused('READ_INVALIDATED');
    };
    try {
      // Hash first: the exact reviewed bytes must still produce the reviewed digest.
      if (!current(token)) return refused('READ_INVALIDATED');
      const fresh = await digestOf(review.draftJson);
      if (!current(token)) return refused('READ_INVALIDATED');
      const digestAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!digestAuthorized) return departed();
      if (fresh !== reviewDigest || draftJson(review.draft) !== review.draftJson) return atRest({ code: 'DIGEST_STALE' });
      // Then the final fresh context: the reviewed authority must be the one still present, contextKey included.
      // A changed key means the Engine state the review was read against moved on, and no publish is issued.
      const before = await context();
      if (!current(token)) return refused('READ_INVALIDATED');
      const beforeAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!beforeAuthorized) return departed();
      if (!sameAuthority(before, reviewed)) return lost('ACCESS_DENIED');
      if (!sameContext(before, reviewed)) return lost('CONTEXT_CHANGED');
      if (!canPublish(before)) return lost('ROLE_FORBIDDEN');
      const attemptId = createAttemptId();
      if (typeof attemptId !== 'string' || !ATTEMPT_ID.test(attemptId)) throw Object.assign(new Error('The publication attempt identity is unavailable.'), { code: 'INVALID_DICTIONARY_OPTIONS' });
      const authorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!authorized) return departed();
      const now = state;
      if (now.kind !== 'review' || now.review !== review || !allReviewed(review)) return atRest({ code: 'DIGEST_STALE' });
      if (!canPublish(now.context)) return lost('ROLE_FORBIDDEN');
      // Nothing is awaited and no observer is called between here and the raw call. The attempt is pinned
      // before the effect can exist; the `issued` event follows the dispatch, so a reentrant lock or cancel
      // inside it cannot be told "issued" about a call that was then withheld.
      pending = {
        phase: 'issued', attemptId, expectedCurrentHash: now.current?.hash ?? null,
        pack: review.pack, label: review.draft.label, reviewDigest, draftJson: review.draftJson, reviewed,
        baseline: now.current === null ? null : { hash: now.current.hash, version: now.current.version },
        expectedVersion: (now.current === null ? 0 : now.current.version) + 1,
        expectedActor: reviewed.member.id,
        returned: null,
        held: { review, packs: now.packs, current: now.current },
      };
      attempt = pending;
      stage = 'raw';
      const raw = port.request('ontology.publish', { draft: structuredClone(review.draft), expectedCurrentHash: pending.expectedCurrentHash, attemptId });
      notify({ kind: 'issued' });
      const reply = await raw;
      stage = 'after';
      // The reply is this attempt's own, whatever happened to the surface meanwhile. If it is a verified
      // publication of exactly the reviewed bytes as the expected next revision by this seat, its hash is
      // retained as an additional pin to compare with the Engine's scoped receipt.
      const published = validatePublished(reply);
      const verified = await publishedVerified(published, digestOf);
      const attributable = verified && draftJson(draftOf(published)) === review.draftJson
        && published.version === pending.expectedVersion && published.publishedBy === pending.expectedActor
        && (pending.baseline === null || published.hash !== pending.baseline.hash);
      if (attributable) pending.returned = published.hash;
      if (!current(token)) return settledHidden();
      if (!attributable) return unresolved('PUBLISH_MISMATCH');
      const after = await context();
      if (!current(token)) return settledHidden();
      const afterAuthorized = live();
      if (!current(token)) return settledHidden();
      if (!afterAuthorized) return unresolved('READ_INVALIDATED', true);
      if (!sameAuthority(after, reviewed)) return unresolved('ACCESS_DENIED', true);
      const readback = validateOntologyAttemptReadback(await port.request('ontology.get', { attemptId: pending.attemptId }));
      if (!current(token)) return settledHidden();
      const lookupAuthorized = live();
      if (!current(token)) return settledHidden();
      if (!lookupAuthorized) return unresolved('READ_INVALIDATED', true);
      const publication = await publicationOf(pending, readback);
      if (!current(token)) return settledHidden();
      const verifiedAuthorized = live();
      if (!current(token)) return settledHidden();
      if (!verifiedAuthorized) return unresolved('READ_INVALIDATED', true);
      const settled = await context();
      if (!current(token)) return settledHidden();
      const settledAuthorized = live();
      if (!current(token)) return settledHidden();
      if (!settledAuthorized) return unresolved('READ_INVALIDATED', true);
      if (!sameAuthority(settled, reviewed) || settled.contextKey !== after.contextKey) return unresolved('ACCESS_DENIED', true);
      if (publication.kind === 'unknown') return unresolved('PUBLISH_UNKNOWN');
      if (publication.kind === 'mismatch' || settled.contextKey === reviewed.contextKey
        || JSON.stringify(publication.dictionary) !== JSON.stringify(published)) return unresolved('READBACK_MISMATCH');
      attempt = null;
      if (readback.current?.hash !== published.hash) {
        const result = lost('REVIEW_NOT_CURRENT');
        notify({ kind: 'settled', outcome: 'verified' });
        notify({ kind: 'resolved', outcome: 'not-current' });
        return result;
      }
      const summary = summaryOf(published);
      publish({ kind: 'published', context: settled, published: summary, review, reviewDigest, handoff: handoffOf(settled, summary, reviewDigest) });
      notify({ kind: 'settled', outcome: 'verified' });
      notify({ kind: 'resolved', outcome: 'published' });
      return ok;
    } catch (error) {
      const failure = firstRunFailure(error);
      if (pending === null) {
        if (!current(token)) return refused('READ_INVALIDATED');
        return AUTHORITY_CODES.includes(failure.code) ? lost(failure.code) : atRest(failure);
      }
      if (!current(token)) return settledHidden();
      // Only the Engine's own dictionary refusal, thrown by the raw call itself, is known not to have committed.
      if (stage === 'raw' && failure.code === 'PUBLISH_REFUSED') {
        attempt = null;
        const result = atRest(failure);
        notify({ kind: 'settled', outcome: 'not-committed' });
        return result;
      }
      if (AUTHORITY_CODES.includes(failure.code) || failure.engineCode === 'DICTIONARY_ATTEMPT_AUTHORITY') return unresolved(failure.code, true);
      return unresolved(failure.code === 'REQUEST_FAILED' ? 'PUBLISH_UNKNOWN' : failure.code);
    } finally {
      publishing = false;
    }
  }

  async function reconcile(): Promise<FirstRunResult> {
    if (publishing || reconciling || leaving) return refused('IN_FLIGHT');
    const pending = attempt;
    if (pending === null) return refused('SELECTION_INVALID');
    if (pending.phase === 'issued') return refused('IN_FLIGHT');
    const shown = state;
    if (shown.kind !== 'unknown') return refused('SELECTION_INVALID');
    const token = generation, authorized = live();
    if (!unchanged(token, shown) || attempt !== pending) return refused('READ_INVALIDATED');
    if (!authorized) {
      // No authority: nothing is read, and the held decisions go private as on any other authority loss.
      pending.held = null;
      publish({ kind: 'unknown', code: shown.code, reconciling: false, attempt: null });
      return refused('NO_AUTHORITY');
    }
    reconciling = true;
    publish({ ...shown, reconciling: true });
    const still = (code: FirstRunCode, neutral = false): FirstRunResult => {
      const authorized = live();
      if (neutral || !authorized) pending.held = null;
      if (!current(token)) return refused('READ_INVALIDATED');
      publish({ kind: 'unknown', code, reconciling: false, attempt: summaryOfAttempt(pending) });
      return refused(code);
    };
    // Leaving during a readback keeps the attempt pinned and hides the held decisions: the question is still open.
    const left = (): FirstRunResult => { clear('READ_INVALIDATED'); return refused('READ_INVALIDATED'); };
    /** A verdict: the attempt is released, the public state is published, and only then are observers told. */
    const resolve = (outcome: Extract<IssuanceEvent, { kind: 'resolved' }>['outcome'], release: () => FirstRunResult): FirstRunResult => {
      const authorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!authorized) return left();
      attempt = null;
      const result = release();
      notify({ kind: 'resolved', outcome });
      return result;
    };
    try {
      if (!current(token)) return refused('READ_INVALIDATED');
      const before = await context();
      if (!current(token)) return refused('READ_INVALIDATED');
      const beforeAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!beforeAuthorized) return left();
      if (!sameAuthority(before, pending.reviewed)) return still('ACCESS_DENIED', true);
      const readback = validateOntologyAttemptReadback(await port.request('ontology.get', { attemptId: pending.attemptId }));
      if (!current(token)) return refused('READ_INVALIDATED');
      const lookupAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!lookupAuthorized) return left();
      const publication = await publicationOf(pending, readback);
      if (!current(token)) return refused('READ_INVALIDATED');
      const verifiedAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!verifiedAuthorized) return left();
      // The final context is read after every digest await. Its key equal to the first read's key proves the
      // ontology did not move while the readback was taken, so the retained readback is still current.
      const after = await context();
      if (!current(token)) return refused('READ_INVALIDATED');
      const afterAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!afterAuthorized) return left();
      if (!sameAuthority(after, pending.reviewed)) return still('ACCESS_DENIED', true);
      if (!sameContext(before, after)) return still('CONTEXT_CHANGED');
      if (publication.kind === 'unknown') return still('PUBLISH_UNKNOWN');
      if (publication.kind === 'mismatch' || after.contextKey === pending.reviewed.contextKey) return still('READBACK_MISMATCH');
      const dictionary = publication.dictionary;
      if (readback.current?.hash !== dictionary.hash) return resolve('not-current', () => lost('REVIEW_NOT_CURRENT'));
      const summary = summaryOf(dictionary);
      const held = pending.held;
      return resolve('published', () => {
        publish({ kind: 'published', context: after, published: summary, review: held === null ? null : held.review, reviewDigest: pending.reviewDigest, handoff: handoffOf(after, summary, pending.reviewDigest) });
        return ok;
      });
    } catch (error) {
      if (!current(token)) return refused('READ_INVALIDATED');
      const failure = firstRunFailure(error);
      return still(failure.code, AUTHORITY_CODES.includes(failure.code) || failure.engineCode === 'DICTIONARY_ATTEMPT_AUTHORITY');
    } finally { reconciling = false; }
  }

  /** Cancels before granting a one-shot admission, and fences both LEFT observers and later promise continuations. */
  function departure<T>(value: T): Admission<T> | FirstRunRefusal {
    generation = Symbol(); digestGeneration = Symbol();
    const token = generation;
    publish(LEFT);
    const allowed = (): boolean => {
      if (!current(token) || state !== LEFT) return false;
      const authorized = live();
      // The guard itself is parent code; it may have ended this departure while answering.
      if (!current(token) || state !== LEFT) return false;
      if (!authorized) { clear('NO_AUTHORITY'); return false; }
      return true;
    };
    if (!allowed()) return refused('READ_INVALIDATED');
    let consumed = false;
    return Object.freeze({
      ok: true as const,
      admit(): T | null {
        if (consumed) return null;
        consumed = true;
        return allowed() ? value : null;
      },
    });
  }

  async function leave(pin: HandoffPin): Promise<LeaveResult> {
    const blocked = fence();
    if (blocked !== null) return blocked;
    const shown = state;
    if (shown.kind !== 'published') return refused('SELECTION_INVALID');
    if (shown.published.hash !== pin.hash || shown.context.contextKey !== pin.contextKey || shown.reviewDigest !== pin.reviewDigest) return refused('DIGEST_STALE');
    const token = generation, authorized = live();
    if (!unchanged(token, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    const reentered = fence();
    if (reentered !== null) return reentered;
    // The synchronous latch: a second press sees it before anything is awaited.
    leaving = true;
    try {
      // The published context must still be the one present: same seat, same key, so the same ontology.
      const fresh = await context();
      if (!current(token)) return refused('READ_INVALIDATED');
      const freshAuthorized = live();
      if (!current(token)) return refused('READ_INVALIDATED');
      if (!freshAuthorized) return departed();
      if (!sameAuthority(fresh, shown.context)) return lost('ACCESS_DENIED');
      if (!sameContext(fresh, shown.context)) return lost('CONTEXT_CHANGED');
      if (state !== shown) return refused('SELECTION_INVALID');
      // Cancelled before the parent is given anything: a retained control finds nothing afterwards.
      return departure(shown.handoff);
    } catch (error) {
      if (!current(token)) return refused('READ_INVALIDATED');
      return lost(firstRunFailure(error).code);
    } finally { leaving = false; }
  }

  function leaveToSettings(revision: string): SettingsLeaveResult {
    const blocked = fence();
    if (blocked !== null) return blocked;
    const shown = state;
    if (shown.kind !== 'review' || shown.publishing) return refused('SELECTION_INVALID');
    if (shown.review.revision !== revision) return refused('DIGEST_STALE');
    const token = generation, authorized = live();
    if (!unchanged(token, shown)) return refused('READ_INVALIDATED');
    if (!authorized) return lost('NO_AUTHORITY');
    return departure(shown.review.draft);
  }

  function dispose(): FirstRunResult {
    if (disposed) return ok;
    if (attempt !== null) return refused(attempt.phase === 'issued' ? 'IN_FLIGHT' : 'PUBLISH_UNRESOLVED');
    // Sealed first: a reentrant operation from an observer finds a disposed controller and refuses.
    disposed = true;
    generation = Symbol(); digestGeneration = Symbol();
    state = IDLE;
    const observers = [...listeners];
    listeners.clear();
    issuanceListeners.clear();
    for (const listener of observers) { try { listener(); } catch { /* observers own their errors */ } }
    return ok;
  }

  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { if (disposed) return () => {}; listeners.add(listener); return () => { listeners.delete(listener); }; },
    onIssuance(listener: (event: IssuanceEvent) => void) { if (disposed) return () => {}; issuanceListeners.add(listener); return () => { issuanceListeners.delete(listener); }; },
    issuance: (): IssuanceStatus => (attempt === null ? 'none' : attempt.phase),
    load, choosePack, backToPacks,
    acceptRow: (name: string, pin: ReviewPin) => withReview(review => acceptRow(review, name, pin), 'DIGEST_STALE'),
    acceptSettings: (pin: ReviewPin) => withReview(review => acceptSettings(review, pin), 'DIGEST_STALE'),
    changeMeaning: (name: string, meaning: string, revision: string) =>
      withReview(review => changeMeaning(review, name, meaning, revision), state.kind === 'review' && state.review.revision !== revision ? 'DIGEST_STALE' : 'MEANING_INVALID'),
    publishDictionary, reconcile, leave, leaveToSettings,
    cancel: () => clear(null),
    invalidate: (code: FirstRunCode = 'READ_INVALIDATED') => clear(code),
    dispose,
  });
}
