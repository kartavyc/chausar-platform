import { authorize } from '../contracts.ts';
import type { Vault } from '../vault.ts';
import type { Context } from '../contracts.ts';
import type { EngineInternals } from './internals.ts';
export type Handler = (internals: EngineInternals, payload: any) => Promise<unknown>;
export function withVault(handler: (internals: EngineInternals, payload: any, store: Vault, ctx: Context, services: EngineInternals['services']) => Promise<unknown>): Handler {
 return async (internals, payload) => { const store = internals.store(), ctx = internals.context; authorize(store, ctx); const services = internals.services; return internals.withContext(ctx, () => handler(internals, payload, store, ctx, services)); };
}
export const openVenture = (internals: EngineInternals, method: string, payload: any) => withVault(async (inside, data, _store, ctx) => (await inside.privateVentureHost()).request(ctx, method, data))(internals, payload);
export const unknownRequest = (method: string): Handler => withVault(async () => { throw new Error(`Unknown request: ${method}`); });
