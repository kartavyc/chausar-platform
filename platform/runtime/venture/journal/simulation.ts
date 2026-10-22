// Chausar venture launcher: shadow mode for the action journal (package P2-journal).
// In shadow an agent's outside effects are journalled as shadow entries and never approved or applied. The agent goes
// on against a simulated result: its waiting shadow entries replayed, in order, over a base view. An effect Chausar
// cannot simulate honestly (a model's answer, what a platform does with a post) is not guessed: it is left out of the
// value and listed with the reason, and the result says incomplete. Unlike a replay that stops at the first such
// effect, this one goes on and lists every one, so the agent sees all of what it could not know.
// The pure replay with an 'unsupported' step follows cloudflare/cloudflare-os (Apache-2.0,
// packages/gatekeeper-kit/src/simulation.ts); this is a rewrite in TypeScript, not a copy.
import type { Context } from '../../contracts.ts';
import type { JournalActionId, JournalRecord, VentureDeps } from '../contracts.ts';
import { ventureAction } from '../records.ts';
import { JOURNAL_ACTIONS, normalizeProposal, proposeIn, type ProposeInput } from './journal.ts';

export type SimulationStep<S> = { kind: 'applied'; value: S } | { kind: 'no-effect' } | { kind: 'unsupported'; reason: string };
export type Simulator<S> = (state: S, entry: JournalRecord) => SimulationStep<S>;
export type Unsimulated = { entryId: string; action: JournalActionId; target: string; reason: string };
export type SimulationResult<S> = { kind: 'complete' | 'incomplete'; value: S; simulated: number; unsimulated: Unsimulated[] };

/** Replays entries over base. Simulators return the next value and never change the one they are given. */
export function simulateJournal<S>(base: S, entries: readonly JournalRecord[], simulators: Partial<Record<JournalActionId, Simulator<S>>>): SimulationResult<S> {
  let value = base;
  let simulated = 0;
  const unsimulated: Unsimulated[] = [];
  for (const entry of entries) {
    const simulator = simulators[entry.action];
    const step: SimulationStep<S> = simulator ? simulator(value, entry) : { kind: 'unsupported', reason: `Chausar has no way to simulate this: ${JOURNAL_ACTIONS[entry.action].label}.` };
    if (step.kind === 'unsupported') {
      unsimulated.push({ entryId: entry.id, action: entry.action, target: entry.target, reason: step.reason });
      continue;
    }
    if (step.kind === 'applied') {
      value = step.value;
      simulated += 1;
    }
  }
  return { kind: unsimulated.length ? 'incomplete' : 'complete', value, simulated, unsimulated };
}

/** The base view of the default simulators: the effects that would have happened, in plain words. */
export type ShadowView = { effects: string[] };
const written: Simulator<ShadowView> = (state, entry) => ({ kind: 'applied', value: { effects: [...state.effects, entry.describe] } });

/**
 * What Chausar can simulate without reaching outside. Its own books (an issued invoice), a website edit whose new
 * content is known, and an alert to the owner's own address can be written down as they would happen. A model's
 * answer and what another service does with a post or a write cannot.
 */
const SIMULATORS: Record<JournalActionId, Simulator<ShadowView>> = {
  'invoice.issue': written,
  'site.apply': written,
  'bank.alert': written,
  'delivery.send': () => ({ kind: 'unsupported', reason: "Your AI's answer cannot be known without sending it." }),
  'connector.post': (_state, entry) => ({ kind: 'unsupported', reason: `How ${entry.target} shows or limits the post cannot be known without posting it.` }),
  'connector.write': (_state, entry) => ({ kind: 'unsupported', reason: `What ${entry.target} does with it cannot be known without sending it.` }),
};
export const DEFAULT_SIMULATORS: Readonly<Record<JournalActionId, Simulator<ShadowView>>> = Object.freeze(SIMULATORS);

/**
 * Shadow: journals the action as a shadow entry and returns the simulated result of this agent's waiting shadow
 * entries, this one included. Nothing is approved, applied or sent.
 */
export async function shadowAction<S = ShadowView>(
  deps: VentureDeps, ctx: Context, input: ProposeInput,
  options: { base?: S; simulators?: Partial<Record<JournalActionId, Simulator<S>>> } = {},
): Promise<{ entry: JournalRecord; simulation: SimulationResult<S> }> {
  const normalized = normalizeProposal({ ...input, shadow: true });
  return ventureAction(deps, ctx, 'prepare', 'journal.shadow', tx => {
    const entry = proposeIn(tx, normalized);
    const nowMs = Date.parse(tx.now);
    const waiting = tx.list('venture-journal-entry').filter(item => item.shadow && item.state === 'described' && item.agent === normalized.agent && Date.parse(item.expiresAt) > nowMs);
    const base = (options.base ?? { effects: [] }) as S;
    const simulators = (options.simulators ?? DEFAULT_SIMULATORS) as Partial<Record<JournalActionId, Simulator<S>>>;
    return { entry, simulation: simulateJournal(base, waiting, simulators) };
  });
}
