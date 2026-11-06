export type WorkKind = 'about' | 'ai-tools' | 'rehearse' | 'improve' | 'brief' | 'goal-suggest' | 'drills' | 'restore' | 'move-in' | 'import';

/**
 * One-shot C3 task 9: the steps of long work, in code words, so the app can list them up front (browser safe; the UI
 * imports it). Never model text and never a figure. A kind lists only steps that match a real boundary in its handler;
 * where a handler has none, the kind is one step. `ai-tools` and `rehearse` take their steps from the job itself: one per
 * tool, per practice client.
 */
export const WORK_STEPS: Readonly<Record<WorkKind, readonly { id: string; label: string }[]>> = Object.freeze({
  about: [{ id: 'read', label: 'Reading your message' }, { id: 'field', label: 'Finding your field' }, { id: 'offers', label: 'Drafting what you sell' }],
  'ai-tools': [],
  rehearse: [],
  improve: [{ id: 'read', label: 'Reading reviewed drafts' }, { id: 'write', label: 'Writing new instructions' }, { id: 'test', label: 'Testing them' }, { id: 'compare', label: 'Comparing' }],
  brief: [{ id: 'write', label: 'Writing your brief' }],
  'goal-suggest': [{ id: 'suggest', label: 'Suggesting a goal' }],
  drills: [{ id: 'run', label: 'Running the drills' }],
  restore: [{ id: 'restore', label: 'Restoring your backup' }],
  'move-in': [{ id: 'move', label: 'Moving your business in' }],
  import: [{ id: 'import', label: 'Reading your file' }],
});

/** The kinds that can run long enough for the owner to leave: the page says where the result lands. */
export const LONG_WORK: ReadonlySet<WorkKind> = new Set<WorkKind>(['rehearse', 'improve']);

/** The words for one step of a job. A step named by the job itself (a tool, a practice client) is its own label. */
export function workStepLabel(kind: WorkKind, step: string): string {
  return WORK_STEPS[kind]?.find((item) => item.id === step)?.label ?? step;
}
