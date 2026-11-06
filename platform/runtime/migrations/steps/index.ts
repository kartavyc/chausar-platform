// D12: the ladder's steps, one file per step beside this one (0001-to-0002.ts, ...), listed here in order. A step
// file exports one LadderStep and imports nothing but types: no file, network or clock.
import type { LadderStep } from '../ladder.ts';
import { STEP_0001_TO_0002 } from './0001-to-0002.ts';

export const BUILT_STEPS: readonly LadderStep[] = Object.freeze([STEP_0001_TO_0002]);
