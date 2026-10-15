/**
 * The ca-enterprise lane's private namespace inside workspace state (vault-encrypted).
 * One workspace plays one part: a client's own books (desktop shell, optionally linked to a
 * CA firm), a CA firm's console (ca-firm shell), or a company install (enterprise shell).
 * The firm part holds status only: dates, counts and states. Never a figure, a name of a
 * client's customer, or a document.
 */
import type { State } from '../contracts.ts';
import { moduleState, peekModuleState } from '../modules/types.ts';

export const LANE = 'ca-enterprise';
export type ShellKind = 'desktop' | 'enterprise' | 'ca-firm';

export interface CaEnterpriseState {
  /** Which shell this workspace opens in. Absent means desktop. */
  shell?: { kind: ShellKind; by: string; at: string };
  /** Firm side (ca-firm shell). Owned by firm.ts. */
  firm?: Record<string, any>;
  /** Client side (any desktop workspace linked to a firm). Owned by client.ts. */
  link?: Record<string, any>;
  /** Enterprise side. Owned by enterprise.ts. */
  enterprise?: Record<string, any>;
}

export function laneState(state: State): CaEnterpriseState { return moduleState<CaEnterpriseState>(state, LANE, () => ({})); }
export function peekLane(state: State): CaEnterpriseState | undefined { return peekModuleState<CaEnterpriseState>(state, LANE); }
export function shellKind(state: State): ShellKind { return peekLane(state)?.shell?.kind ?? 'desktop'; }
