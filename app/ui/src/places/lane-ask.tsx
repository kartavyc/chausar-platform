import type { PlaceModule } from './types.ts';
import { AskPlace, handlesAsk } from '../screens/ask/lane/AskPlace';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const askPlaces: readonly PlaceModule[] = [
  { id: 'ask', handles: handlesAsk, render: props => <AskPlace {...props} /> },
];
