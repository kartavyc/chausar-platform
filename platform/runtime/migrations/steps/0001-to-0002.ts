// D12 task 5, step 1 to 2: from the published beta (0.1.0-preview.1, commit 579e3a3a) to what PR A to PR D store. The table of
// what changed is in one-shot/D12-notes.md, task 1: new record kinds and optional fields (C4, C5, C6, C7 and the first
// one-shot batches), and wider unions, among them the monthly and event routine schedules and 'no-day-job'. Nothing became
// required on a stored shape, and nothing was removed or renamed, so old data is already valid. No field needs a default and no
// record moves to unsupported. The number moves so that an older Chausar refuses this data instead of misreading it.
import type { LadderStep } from '../ladder.ts';

export const STEP_0001_TO_0002: LadderStep = Object.freeze({
  from: 1, to: 2, name: '0001-to-0002',
  run: (state: any) => ({ ...state, schemaVersion: 2 }),
});
