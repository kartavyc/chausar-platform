import { audit, check, newId, now } from '../contracts.ts';
import type { Context, State } from '../contracts.ts';
import { digest } from '../actions.ts';
import type { MethodSpec } from '../modules/types.ts';
import { inApp } from '../jobs-ext/state.ts';
import { template as readyMade } from '../jobs-ext/templates.ts';
import { deriveProcedure, routeCase } from './derive.ts';
import { approvedProcedure, peekProcedures, procedureState, procedureStats, summarize, validFields, validId } from './service.ts';
import type { Procedure, ProcedureRun } from './types.ts';

export const REJECT_REASONS = ['wrong-steps', 'wrong-rule', 'not-needed', 'superseded', 'other'] as const;

const procedureDigest = (item: Pick<Procedure, 'template' | 'version' | 'steps' | 'match'>) => digest({ template: item.template, version: item.version, steps: item.steps, match: item.match });
const templateId = (value: unknown) => readyMade(value).id;
/** What a screen may see of a run: the feature values stay in the namespace. */
const runView = ({ features: _features, ...run }: ProcedureRun) => run;
const newestFirst = <T extends { at?: string; createdAt?: string }>(a: T, b: T) => (b.at ?? b.createdAt ?? '').localeCompare(a.at ?? a.createdAt ?? '');

function owned(state: State, ctx: Context, id: unknown): Procedure {
  const item = procedureState(state).procedures.find(entry => entry.id === validId(id));
  check(item, 'NOT_FOUND', 'Procedure not found.');
  check(item.ownerId === ctx.memberId, 'FORBIDDEN', 'Only the procedure’s owner can change it.');
  return item;
}

/** procedures.*: AgentRun-style procedures. */
export const procedureMethods: Record<string, MethodSpec> = {
  'procedures.list': { permission: 'read', handler(ctx, _payload, host) {
    const state = host.store.read();
    return { procedures: peekProcedures(state).procedures.filter(item => item.ownerId === ctx.memberId).sort(newestFirst).map(item => ({ ...item, stats: procedureStats(state, item.id) })) };
  } },
  'procedures.get': { permission: 'read', handler(ctx, payload, host) {
    const state = host.store.read(), { procedures, runs } = peekProcedures(state), id = validId(payload.id);
    const item = procedures.find(entry => entry.id === id);
    check(item, 'NOT_FOUND', 'Procedure not found.'); check(item.ownerId === ctx.memberId, 'FORBIDDEN', 'Only the procedure’s owner can see it.');
    return { procedure: item, stats: procedureStats(state, id),
      runs: runs.filter(run => run.procedureId === id || item.derivedFrom.includes(run.id)).sort(newestFirst).slice(0, 50).map(runView) };
  } },
  'procedures.propose': { permission: 'prepare', handler(ctx, payload, host) {
    const template = templateId(payload.template);
    return host.store.update(state => {
      const ns = procedureState(state), result = deriveProcedure(ns.runs.filter(run => run.ownerId === ctx.memberId), template);
      if (!result.ok) check(false, result.code, result.reason);
      const mine = ns.procedures.filter(item => item.template === template && item.ownerId === ctx.memberId), at = now();
      const version = Math.max(0, ...mine.map(item => item.version)) + 1;
      for (const item of mine) if (item.status === 'proposed') Object.assign(item, { status: 'rejected', reason: 'superseded', decidedAt: at });
      const procedure: Procedure = { id: newId('procedure'), template, version, createdAt: at, ownerId: ctx.memberId, status: 'proposed', steps: result.steps, match: result.match,
        derivedFrom: result.derivedFrom, digest: procedureDigest({ template, version, steps: result.steps, match: result.match }), sourceIds: result.sourceIds };
      ns.procedures.push(procedure);
      audit(state, 'procedures.proposed', { procedureId: procedure.id, template, version, digest: procedure.digest });
      return structuredClone(procedure);
    });
  } },
  'procedures.approve': { permission: 'approve', handler(ctx, payload, host) {
    inApp(ctx);
    check(typeof payload.digest === 'string' && /^[a-f0-9]{64}$/.test(payload.digest), 'PREVIEW_CHANGED', 'Approve the exact procedure you reviewed.');
    return host.store.update(state => {
      const item = owned(state, ctx, payload.id), at = now();
      check(item.status === 'proposed', 'PROCEDURE_NOT_PROPOSED', 'Only a proposed procedure can be approved.');
      check(payload.digest === item.digest && item.digest === procedureDigest(item), 'PREVIEW_CHANGED', 'The procedure changed after you reviewed it.');
      for (const other of procedureState(state).procedures) if (other.id !== item.id && other.status === 'approved' && other.template === item.template && other.ownerId === item.ownerId)
        Object.assign(other, { status: 'retired', reason: 'superseded', decidedAt: at });
      Object.assign(item, { status: 'approved', decidedAt: at, approval: { memberId: ctx.memberId, epoch: ctx.epoch, at, digest: item.digest } });
      audit(state, 'procedures.approved', { procedureId: item.id, template: item.template, version: item.version, digest: item.digest });
      return structuredClone(item);
    });
  } },
  'procedures.reject': { permission: 'approve', handler(ctx, payload, host) {
    const reason = payload.reason ?? 'other';
    check(REJECT_REASONS.includes(reason), 'INVALID_REASON', 'Choose one of the listed reasons.');
    return host.store.update(state => {
      const item = owned(state, ctx, payload.id);
      check(item.status === 'proposed', 'PROCEDURE_NOT_PROPOSED', 'Only a proposed procedure can be rejected.');
      Object.assign(item, { status: 'rejected', reason, decidedAt: now() });
      audit(state, 'procedures.rejected', { procedureId: item.id, template: item.template, reason });
      return structuredClone(item);
    });
  } },
  'procedures.retire': { permission: 'approve', handler(ctx, payload, host) {
    return host.store.update(state => {
      const item = owned(state, ctx, payload.id);
      check(item.status === 'approved', 'PROCEDURE_NOT_APPROVED', 'Only an approved procedure can be retired.');
      Object.assign(item, { status: 'retired', reason: 'retired', decidedAt: now() });
      audit(state, 'procedures.retired', { procedureId: item.id, template: item.template });
      return structuredClone(item);
    });
  } },
  'procedures.route': { permission: 'prepare', handler(ctx, payload, host) {
    const template = templateId(payload.template), item = payload.case;
    check(item && typeof item === 'object' && !Array.isArray(item), 'INVALID_CASE', 'Give a case with its details.');
    validId(item.id, 'INVALID_CASE'); const fields = validFields(item.fields);
    const procedure = approvedProcedure(host.store.read(), template, ctx.memberId);
    if (!procedure) return { matched: false, reason: 'no-procedure' };
    return { ...routeCase(procedure, { fields, tainted: !!ctx.sourceTainted }), procedureId: procedure.id, version: procedure.version, dryRun: true };
  } },
  'procedures.runs': { permission: 'read', handler(ctx, payload, host) {
    const template = payload.template === undefined ? undefined : templateId(payload.template), jobId = payload.jobId === undefined ? undefined : validId(payload.jobId);
    const runs = peekProcedures(host.store.read()).runs.filter(run => run.ownerId === ctx.memberId && (!template || run.template === template) && (!jobId || run.jobId === jobId));
    const { routedShare, routedCostMinor, fallbackCostMinor, agentCostMinor } = summarize(runs);
    return { runs: runs.sort(newestFirst).slice(0, 200).map(runView), stats: { routedShare, routedCostMinor, fallbackCostMinor, agentCostMinor } };
  } },
};
