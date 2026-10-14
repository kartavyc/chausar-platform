/**
 * Calls into methods other lanes own (writeback.*, jobsx.*, procedures.*, connectorsx.*,
 * learningx.*). Each call goes through the engine's full authorization path as the same
 * caller. A family that is not installed yet answers `{ available: false }`, so a screen can
 * show its "not built yet" state; every other refusal is passed through unchanged.
 */
import type { ModuleHost } from '../modules/types.ts';

const ABSENT = new Set(['UNKNOWN_METHOD', 'METHOD_UNAVAILABLE']);

export type Optional<T> = { available: true; value: T } | { available: false };

export async function optionalCall<T = unknown>(host: ModuleHost, method: string, payload: Record<string, unknown> = {}): Promise<Optional<T>> {
  try { return { available: true, value: await host.call(method, payload) as T }; }
  catch (error) {
    if (ABSENT.has((error as { code?: unknown })?.code as string)) return { available: false };
    throw error;
  }
}
