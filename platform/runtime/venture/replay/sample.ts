/** Fixed public fixture material, available only for newly-created developer sample vaults. */
import type { StateStore } from '../../contracts.ts';
const samples = new WeakSet<StateStore>();
export function markNewCaptureSample(store: StateStore): void { samples.add(store); }
export function isCaptureSample(store: StateStore): boolean { return samples.has(store) && store.read().workspace.demo === true; }
export function captureSampleKey(store: StateStore, purpose: string): Buffer | null {
  if (!isCaptureSample(store)) return null;
  if (purpose === 'receipt-signing') return Buffer.alloc(32, 17);
  if (purpose === 'journal-head') return Buffer.alloc(32, 29);
  return null;
}
