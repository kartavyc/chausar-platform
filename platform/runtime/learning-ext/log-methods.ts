import type { MethodSpec } from '../modules/types.ts';
import { logPage, logSummary, recordDecision } from './log.ts';

/** `learningx.*` decision log views. Other lanes record procedure, action and identity decisions through `learningx.record`. */
export const logMethods: Record<string, MethodSpec> = {
  'learningx.record': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => recordDecision(state, ctx, { event: payload.event, sourceIds: payload.sourceIds, refs: payload.refs })) },
  'learningx.log': { permission: 'read', handler: (ctx, payload, host) => logPage(host.store.read(), ctx, payload) },
  'learningx.summary': { permission: 'read', handler: (ctx, _payload, host) => logSummary(host.store.read(), ctx) },
};
