import type { CalculationReceipt, Figure } from './calculator.ts';
import type { Period } from './memory.ts';
import type { Definition, Operation } from './ontology.ts';

/** Explicit inclusive business-date boundaries; the service generates no calendar or presets. */
export type TodayTileBucket = { id: string; label: string; period: Period };
export type TodayTileComparison = { operation: string; figureKey: string; period: Period };
export type TodayTileConfiguration = {
  id: string; label: string; operation: string; figureKey: string; period: Period;
  buckets: TodayTileBucket[]; comparison?: TodayTileComparison;
};
export type TodayTilesScope = { sourceIds: string[]; branch: string | null };
export type TodayTilesRequest = {
  dictionaryHash: string;
  /** One canonical ISO knowledge timestamp for every receipt, including comparisons. */
  asOf: string;
  scope: TodayTilesScope;
  tiles: TodayTileConfiguration[];
};
export type TodayTileDefinition = {
  dictionaryHash: string; ontologyVersion: number; definitionHash: string;
  definitions: Definition[]; operationId: string; operationType: Operation['type'];
};
export type TodayTileGap = { code: string; message: string; definitionName?: string; period?: Period };
export type TodayTileValue = {
  status: 'available' | 'partial' | 'unavailable';
  /** Copied from a currently authorized receipt. Empty evidence never supplies a figure. */
  figure: Figure | null; receiptId: string | null;
  definition: TodayTileDefinition | null;
  coverage: CalculationReceipt['coverage'] | null;
  gaps: TodayTileGap[];
};
export type TodayTile = {
  id: string; label: string; operation: string; figureKey: string; period: Period;
  value: TodayTileValue;
  points: (TodayTileBucket & { value: TodayTileValue })[];
  comparison?: TodayTileComparison & { value: TodayTileValue };
};
export type TodayTilesResult = {
  version: 1; asOf: string; dictionary: { hash: string; version: number }; scope: TodayTilesScope;
  /** Receipts are saved sequentially. A failed assembly can leave earlier private receipts. */
  atomic: false;
  /** Presence of the installed verifier, never a native database qualification claim. */
  verification: 'configured' | 'not-configured';
  tiles: TodayTile[];
};
