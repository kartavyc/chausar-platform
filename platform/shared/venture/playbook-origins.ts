// Who made a playbook version (review of A1): the plan, an improvement run, or the owner's own changes. One list, read
// by the engine's types (contracts.ts) and by the Ink app (app/ui/src/engine/types.ts), so the words for each stay whole.
export const PLAYBOOK_ORIGINS = Object.freeze(['plan', 'improvement', 'owner'] as const);
export type PlaybookOrigin = (typeof PLAYBOOK_ORIGINS)[number];
