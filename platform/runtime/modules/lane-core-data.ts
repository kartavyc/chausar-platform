import type { EngineModule } from './types.ts';

/** The core-data lane: data and calculation gaps in the core (receipts, FX, quantities, definitions, deletion, trust rules). New RPC methods for core work live here, so core lanes never
 *  edit the engine's request switch at the same time. Only the owning lane edits this file. */
export const coreDataModule: EngineModule = { id: 'core-data', methods: {} };
