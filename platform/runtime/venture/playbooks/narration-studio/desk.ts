// Chausar playbook: Narration and audiobooks (Ink v2 wave 5, packages 5Q). Its desk: the handlers venture.desk.list,
// .get and .act reach for its own record kinds (playbooks/desks.ts), and their types (playbooks/desk-types.ts). Package
// 5-0 left it empty, so every desk method for this playbook answers NOT_BUILT_YET. Written for Chausar; nothing here is
// learned from an outside source.
import type { DeskHandlers } from '../desk-types.ts';

/** This desk's record kinds, each a DeskKindTypes (desk-types.ts) by kind; none until the package lands. */
export type NarrationStudioDeskTypes = Record<never, never>;
/** This desk's handlers by record kind; none until the package lands. */
export const NARRATION_STUDIO_DESK: DeskHandlers = Object.freeze({});
