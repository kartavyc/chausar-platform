/**
 * The first-run journey as a pure state machine: which screen is shown, which of the six
 * steps are done, and what is held in memory before the vault exists.
 *
 * Before the vault exists nothing comes from the engine: the choices are held here, in
 * memory, and leaving stores nothing. Once a vault is open the engine's
 * `todayx.firstRun.status` is the record of what is done; this machine only adds what the
 * person did on this screen since (a skipped model, a step just finished) so the walking
 * square never goes back. When the status method is not built the journey still works from
 * what happened on this screen and says the blocked line cannot be read.
 *
 * No business figure passes through here. The identity card is text held as typed.
 */

import type { StepItem, StepState } from '../../app/presentation.ts';
import type { FirstRunBlocked, FirstRunLeft } from '../../patterns/FirstRunStep';
import { FIRST_RUN_STEPS } from '../../bridge/todayx-contract.ts';
import type { FirstRunStatusReply, FirstRunStep, IdentityCard, IdentityField } from '../../bridge/todayx-contract.ts';

export type JourneyScreen =
  /** FR-01 */ | 'welcome'
  /** FR-02 */ | 'identity'
  /** FR-13 */ | 'recover'
  /** FR-14: join a workspace from another computer. */ | 'join'
  /** FR-03 and FR-04: the host's creation state decides which of the two is drawn. */ | 'vault'
  /** FR-05 */ | 'model'
  /** FR-07 */ | 'file'
  /** FR-06 and FR-08: the existing slice. */ | 'meanings'
  /** FR-09 */ | 'answer'
  /** FR-11 (not built) and FR-12 */ | 'idea'
  /** Every step is done. */ | 'finished';

export type JourneyPath = 'business' | 'idea';
export type GstMode = NonNullable<IdentityCard['gstMode']>;

/** FR-02 as typed. Held in memory until the vault exists. */
export interface HeldIdentity {
  readonly fields: Readonly<Partial<Record<IdentityField, string>>>;
  readonly gstMode: GstMode | null;
}

export type StatusKnowledge =
  | { readonly kind: 'no-vault' }
  | { readonly kind: 'reading' }
  | { readonly kind: 'known'; readonly reply: FirstRunStatusReply }
  | { readonly kind: 'not-built' };

export interface JourneyState {
  readonly screen: JourneyScreen;
  readonly path: JourneyPath | null;
  /** What happened on this screen. Combined with the engine's status, never instead of it. */
  readonly local: Readonly<Record<FirstRunStep, boolean>>;
  readonly status: StatusKnowledge;
  readonly identity: HeldIdentity;
  /** Whether the held card has been written; `held` until the vault exists. */
  readonly identityWritten: 'held' | 'saved' | 'not-built' | 'refused' | 'empty';
  readonly model: 'not-chosen' | 'skipped' | 'connected';
  /** The file waits for the meanings: the engine reads files only against agreed meanings. */
  readonly fileWaiting: boolean;
  /** Milliseconds, from the host clock: the first screen and the first receipt. */
  readonly startedAt: number;
  readonly answeredAt: number | null;
}

export type JourneyEvent =
  | { readonly type: 'begin'; readonly path: JourneyPath }
  | { readonly type: 'open-recover' }
  | { readonly type: 'close-recover' }
  | { readonly type: 'open-join' }
  | { readonly type: 'close-join' }
  | { readonly type: 'identity-held'; readonly identity: HeldIdentity }
  /** The vault exists and its recovery kit was kept: the host is open. */
  | { readonly type: 'vault-open' }
  /** An already open workspace was chosen on the first screen. */
  | { readonly type: 'resume' }
  | { readonly type: 'identity-written'; readonly outcome: 'saved' | 'not-built' | 'refused' }
  | { readonly type: 'status-reading' }
  | { readonly type: 'status'; readonly reply: FirstRunStatusReply }
  | { readonly type: 'status-not-built' }
  | { readonly type: 'model-done'; readonly outcome: 'skipped' | 'connected' }
  | { readonly type: 'file-taken' }
  | { readonly type: 'file-waits' }
  | { readonly type: 'meanings-agreed' }
  | { readonly type: 'answered'; readonly at: number }
  | { readonly type: 'idea-done' }
  | { readonly type: 'back' };

const NONE: Readonly<Record<FirstRunStep, boolean>> = Object.freeze({ you: false, vault: false, model: false, books: false, meanings: false, answer: false });
const EMPTY_IDENTITY: HeldIdentity = Object.freeze({ fields: Object.freeze({}), gstMode: null });

export function initialJourney(startedAt: number): JourneyState {
  return Object.freeze({
    screen: 'welcome', path: null, local: NONE, status: Object.freeze({ kind: 'no-vault' }), identity: EMPTY_IDENTITY,
    identityWritten: 'held', model: 'not-chosen', fileWaiting: false, startedAt, answeredAt: null,
  });
}

/** The step a screen belongs to. */
export function stepOf(screen: JourneyScreen): FirstRunStep {
  switch (screen) {
    case 'welcome': case 'identity': case 'recover': case 'join': return 'you';
    case 'vault': return 'vault';
    case 'model': return 'model';
    case 'file': return 'books';
    case 'meanings': return 'meanings';
    case 'answer': case 'idea': case 'finished': return 'answer';
  }
}

/** A step is done when the engine says so or when it was finished on this screen. */
export function isDone(state: JourneyState, step: FirstRunStep): boolean {
  if (state.local[step]) return true;
  return state.status.kind === 'known' && state.status.reply.steps[step] === 'done';
}

export function vaultOpen(state: JourneyState): boolean {
  return state.status.kind !== 'no-vault';
}

/** The six steps for the shared Steps part: done, the current one waiting for you, the rest not reached. */
export function journeySteps(state: JourneyState): readonly StepItem[] {
  const current = stepOf(state.screen);
  const finished = state.screen === 'finished';
  return FIRST_RUN_STEPS.map(step => {
    const done = isDone(state, step) || (finished && step === 'answer');
    // A held file keeps Your books waiting for you while the meanings are agreed.
    const value: StepState = done ? 'done' : step === current || (step === 'books' && state.fileWaiting) ? 'waiting-for-you' : 'not-reached';
    return { nameKey: step === 'answer' ? 'STEP.first-answer' : `STEP.${step}`, state: value };
  });
}

/** The blocked line: before the vault it is known locally; after it only the engine can say. */
export function blockedOf(state: JourneyState): FirstRunBlocked | null {
  switch (state.status.kind) {
    case 'no-vault': return 'no-vault';
    case 'reading': return null;
    case 'not-built': return 'not-built';
    case 'known': return state.status.reply.blocked;
  }
}

/** Only the engine's answer draws this line. */
export function leftOf(state: JourneyState): FirstRunLeft | null {
  return state.status.kind === 'known' ? state.status.reply.leftThisComputer : null;
}

/** The first step not done, as the screen that does it. Used to resume an open workspace. */
export function resumeScreen(state: JourneyState): JourneyScreen {
  if (state.path === 'idea') return isDone(state, 'model') ? 'idea' : 'model';
  if (!isDone(state, 'model')) return 'model';
  if (!isDone(state, 'books') && !state.fileWaiting) return 'file';
  if (!isDone(state, 'meanings')) return 'meanings';
  if (!isDone(state, 'books')) return 'file';
  if (!isDone(state, 'answer')) return 'answer';
  return 'finished';
}

/** Whether the held card has anything to write. */
export function identityHasContent(identity: HeldIdentity): boolean {
  return identity.gstMode !== null || Object.values(identity.fields).some(value => typeof value === 'string' && value.trim().length > 0);
}

function mark(state: JourneyState, step: FirstRunStep): Readonly<Record<FirstRunStep, boolean>> {
  return Object.freeze({ ...state.local, [step]: true });
}
function next(state: JourneyState, changes: Partial<JourneyState>): JourneyState {
  return Object.freeze({ ...state, ...changes });
}

export function reduceJourney(state: JourneyState, event: JourneyEvent): JourneyState {
  switch (event.type) {
    case 'begin': {
      if (state.screen !== 'welcome') return state;
      if (vaultOpen(state)) {
        const chosen = next(state, { path: event.path, local: mark(state, 'you') });
        return next(chosen, { screen: resumeScreen(chosen) });
      }
      // An idea has no identity card yet; a business fills it before the vault.
      if (event.path === 'idea') return next(state, { path: 'idea', local: mark(state, 'you'), screen: 'vault' });
      return next(state, { path: 'business', screen: 'identity' });
    }
    case 'open-recover':
      return state.screen === 'welcome' && !vaultOpen(state) ? next(state, { screen: 'recover' }) : state;
    case 'close-recover':
      return state.screen === 'recover' ? next(state, { screen: 'welcome' }) : state;
    case 'open-join':
      return state.screen === 'welcome' && !vaultOpen(state) ? next(state, { screen: 'join' }) : state;
    case 'close-join':
      return state.screen === 'join' ? next(state, { screen: 'welcome' }) : state;
    case 'identity-held':
      if (state.screen !== 'identity') return state;
      return next(state, { identity: Object.freeze({ fields: Object.freeze({ ...event.identity.fields }), gstMode: event.identity.gstMode }), local: mark(state, 'you'), screen: 'vault' });
    case 'vault-open': {
      if (vaultOpen(state)) return state;
      const local = Object.freeze({ ...state.local, you: true, vault: true });
      const opened = next(state, { local, status: Object.freeze({ kind: 'reading' }), identityWritten: identityHasContent(state.identity) ? 'held' : 'empty' });
      return next(opened, { screen: state.screen === 'vault' ? 'model' : state.screen });
    }
    case 'resume': {
      if (state.screen !== 'welcome' && state.screen !== 'recover') return state;
      const local = Object.freeze({ ...state.local, you: true, vault: true });
      const opened = next(state, { local, path: state.path ?? 'business', status: vaultOpen(state) ? state.status : Object.freeze({ kind: 'reading' }), identityWritten: 'empty' });
      return next(opened, { screen: resumeScreen(opened) });
    }
    case 'identity-written':
      return state.identityWritten === 'held' && vaultOpen(state) ? next(state, { identityWritten: event.outcome, identity: event.outcome === 'saved' ? EMPTY_IDENTITY : state.identity }) : state;
    case 'status-reading':
      return vaultOpen(state) ? next(state, { status: Object.freeze({ kind: 'reading' }) }) : state;
    case 'status':
      return vaultOpen(state) ? next(state, { status: Object.freeze({ kind: 'known', reply: event.reply }) }) : state;
    case 'status-not-built':
      return vaultOpen(state) ? next(state, { status: Object.freeze({ kind: 'not-built' }) }) : state;
    case 'model-done': {
      if (state.screen !== 'model') return state;
      const done = next(state, { model: event.outcome, local: mark(state, 'model') });
      return next(done, { screen: resumeScreen(done) });
    }
    case 'file-taken': {
      if (state.screen !== 'file') return state;
      const done = next(state, { local: mark(state, 'books'), fileWaiting: false });
      return next(done, { screen: resumeScreen(done) });
    }
    case 'file-waits': {
      if (state.screen !== 'file') return state;
      const waiting = next(state, { fileWaiting: true });
      return next(waiting, { screen: isDone(waiting, 'meanings') ? 'file' : 'meanings' });
    }
    case 'meanings-agreed': {
      if (state.screen !== 'meanings') return state;
      const done = next(state, { local: mark(state, 'meanings') });
      return next(done, { screen: resumeScreen(done) });
    }
    case 'answered':
      if (state.screen !== 'answer' || state.answeredAt !== null) return state;
      return next(state, { local: mark(state, 'answer'), answeredAt: event.at });
    case 'idea-done':
      return state.screen === 'idea' ? next(state, { screen: 'finished' }) : state;
    case 'back':
      if (state.screen === 'identity') return next(state, { screen: 'welcome', path: null });
      if (state.screen === 'vault' && !vaultOpen(state)) return next(state, { screen: state.path === 'idea' ? 'welcome' : 'identity', ...(state.path === 'idea' ? { path: null, local: NONE } : {}) });
      return state;
  }
}

/** Whole seconds from the first screen to the first receipt; null before it. */
export function elapsedSeconds(state: JourneyState): number | null {
  if (state.answeredAt === null) return null;
  return Math.max(0, Math.floor((state.answeredAt - state.startedAt) / 1000));
}

/** A small store over the machine, for React's useSyncExternalStore. */
export interface JourneyStore {
  snapshot(): JourneyState;
  subscribe(listener: () => void): () => void;
  dispatch(event: JourneyEvent): JourneyState;
}

export function createJourneyStore(startedAt: number): JourneyStore {
  let state = initialJourney(startedAt);
  const listeners = new Set<() => void>();
  return Object.freeze({
    snapshot: () => state,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    dispatch(event: JourneyEvent) {
      const after = reduceJourney(state, event);
      if (after !== state) { state = after; for (const listener of [...listeners]) listener(); }
      return state;
    },
  });
}
