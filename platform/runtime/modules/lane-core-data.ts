import type { EngineModule } from './types.ts';
import { calcMethods } from '../core-data/calc.ts';
import { provenanceMethods } from '../core-data/provenance.ts';
import { dataMethods } from '../core-data/data.ts';
import { trustRuleMethods } from '../core-data/trust-rules.ts';
import { workbookMethods } from '../core-data/workbook-password.ts';

/** The core-data lane: data and calculation gaps in the core (receipts, FX, quantities, definitions, deletion, trust rules). New RPC methods for core work live here, so core lanes never
 *  edit the engine's request switch at the same time. Only the owning lane edits this file. Each part keeps its methods in its own file under `platform/runtime/core-data/`. */
export const coreDataModule: EngineModule = { id: 'core-data', methods: { ...calcMethods, ...provenanceMethods, ...dataMethods, ...trustRuleMethods, ...workbookMethods } };
