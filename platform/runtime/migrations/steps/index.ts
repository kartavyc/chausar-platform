// D12: the ladder's steps, one file per step beside this one (0001-to-0002.ts, ...), listed here in order. A step
// file exports one LadderStep and imports nothing but types: no file, network or clock. Step 1 to 2 comes with D12
// task 5, built from the table of what changed since the published beta (task 1).
import type { LadderStep } from '../ladder.ts';

export const BUILT_STEPS: readonly LadderStep[] = Object.freeze([]);
