import type { ScreenState } from '../../app/presentation.ts';
import type { TodayIntents } from './TodayData.ts';

/** Read-only may arrive as the rich screen state or unchanged from the checked boundary. */
export function allowsTodayMutation(state: ScreenState): boolean {
  return state.kind !== 'read-only' && !(state.kind === 'boundary-state' && state.source.kind === 'read-only');
}

/** Keep reading and navigation available when a retained host callback can no longer change data. */
export function todayIntentsForState(state: ScreenState, intents: TodayIntents): TodayIntents {
  if (allowsTodayMutation(state)) return intents;
  return {
    ...intents,
    onPrepare: undefined,
    onResumeSetup: undefined,
    onUpdate: undefined,
    onSaveClosing: undefined,
  };
}
