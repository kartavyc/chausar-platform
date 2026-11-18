// Chausar venture launcher: the draft desk, AI state before any vault exists (onboarding v2).
// The engine loads this file by dynamic import on the first draft request (the DRAFT_METHODS).
import { DraftDesk, type DraftDeskOptions } from './desk.ts';

export type { DraftDeskOptions } from './desk.ts';
export { DraftDesk, VENTURE_EXISTS_WORDS } from './desk.ts';
export { aiOptionsView, weakestStatus } from './handlers.ts';

export function createDraftDesk(options: DraftDeskOptions): DraftDesk {
  return new DraftDesk(options);
}
