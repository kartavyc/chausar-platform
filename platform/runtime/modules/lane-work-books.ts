import type { EngineModule } from './types.ts';
import { workMethods, workPurge } from '../work-books/work.ts';
import { booksMethods, booksPurge } from '../work-books/books.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const workBooksModule: EngineModule = {
  id: 'work-books',
  methods: { ...workMethods, ...booksMethods },
  purge: (state, reason) => workPurge(state, reason) + booksPurge(state, reason),
};
