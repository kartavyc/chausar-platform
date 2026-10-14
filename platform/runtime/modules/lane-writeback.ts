import type { EngineModule } from './types.ts';

/** Lane-owned engine methods. Only the owning lane edits this file. */
export const writebackModule: EngineModule = {
  id: 'writeback',
  methods: {},
};
