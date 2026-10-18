// Chausar venture launcher: the draft desk, AI and plan state before any vault exists (onboarding v2).
// The engine loads this file by dynamic import on the first draft request. Contract commit: a placeholder whose
// requests answer NOT_BUILT_YET until the desk lands.
import { ChausarError, type Context } from '../../contracts.ts';
import type { VentureHostOptions } from '../contracts.ts';
import type { DraftHandoverPort } from '../onboarding-contracts.ts';

export type DraftDeskOptions = VentureHostOptions & {
  demo: boolean;
  /** True when the open vault already holds a venture: every draft method then refuses VENTURE_EXISTS. */
  ventureExists: () => boolean;
  /** True while any vault is open: the idle timer stays paused. */
  vaultOpen: () => boolean;
};

export type DraftDesk = {
  request(ctx: Context, method: string, payload: unknown): Promise<unknown>;
  hold(): void;
  clear(): void;
  handover: DraftHandoverPort;
};

export function createDraftDesk(_options: DraftDeskOptions): DraftDesk {
  const notBuilt = () => new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
  return Object.freeze({
    async request(): Promise<unknown> { throw notBuilt(); },
    hold() {},
    clear() {},
    handover: Object.freeze({ ai: () => null, compose: () => null, moveKeys() {}, settle() {} }),
  });
}
