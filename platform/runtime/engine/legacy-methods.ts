import { LEGACY_METHODS } from '../method-registry.ts';
import { withVault, type Handler } from './admission.ts';
export const METHODS: Record<string, Handler> = Object.fromEntries(LEGACY_METHODS.map(method => [method, withVault(async (internals, payload, store, _ctx, services) => {
 const captured = internals.legacyInternals(store, internals.context, services);
 return (await import('../legacy/dispatch.ts')).legacyRequest(internals.engine, captured, method, payload);
})]));
