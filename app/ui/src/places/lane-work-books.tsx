import type { PlaceModule } from './types.ts';
import { workPlace } from '../screens/work/index.tsx';
import { booksPlace } from '../screens/books/index.tsx';

/** Lane-owned screens. Only the owning lane edits this file and its own folders. */
export const workBooksPlaces: readonly PlaceModule[] = [workPlace, booksPlace];
