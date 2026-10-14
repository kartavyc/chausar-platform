import { audit, check } from '../contracts.ts';
import { current } from '../actions.ts';
import type { MethodSpec } from '../modules/types.ts';
import { logOf, logPage, logSummary, recordDecision } from './log.ts';

/** `learningx.*` decision log views. Other lanes record procedure, action and identity decisions through `learningx.record`. */
export const logMethods: Record<string, MethodSpec> = {
  'learningx.record': { permission: 'prepare', handler: (ctx, payload, host) => host.store.update(state => recordDecision(state, ctx, { event: payload.event, sourceIds: payload.sourceIds, refs: payload.refs })) },
  'learningx.log': { permission: 'read', handler: (ctx, payload, host) => logPage(host.store.read(), ctx, payload) },
  /** The owner clears the local log, all of it or what was decided before a date. Sent batches stay listed on What I shared. */
  'learningx.logClear': { permission: 'admin', handler: (ctx, payload, host) => host.store.update(state => {
    current(state, ctx, 'admin');
    check(ctx.role === 'owner' && ctx.channel !== 'phone' && ctx.channel !== 'mcp' && !ctx.sourceTainted, 'OWNER_REQUIRED', 'The owner clears the learning log inside the app.');
    check(payload.before === undefined || typeof payload.before === 'string' && Number.isFinite(Date.parse(payload.before)), 'INVALID_REQUEST', 'Give a date to clear before, or nothing to clear all.');
    const log = logOf(state), before = log.length, cut = payload.before === undefined ? Infinity : Date.parse(payload.before);
    log.splice(0, log.length, ...log.filter(entry => Date.parse(entry.at) >= cut));
    audit(state, 'learningx.log-cleared', { removed: before - log.length });
    return { removed: before - log.length };
  }) },
  'learningx.summary': { permission: 'read', handler: (ctx, _payload, host) => logSummary(host.store.read(), ctx) },
};
