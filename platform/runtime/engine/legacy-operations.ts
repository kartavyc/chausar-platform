

import { DIGEST_PATTERN } from '../../shared/digest.ts';
import { join } from 'node:path';

import { OntologyService } from '../ontology.ts';
import { ImportService, importPublicRecord } from '../ingest.ts';

import { canSeeFact } from '../memory.ts';
import { CalculatorService, type CalculationReceipt } from '../calculator.ts';
import { explainAnswerRecovery, assertPreparedAnswerRecoveryCurrent, completeAnswerRecovery, type AnswerRecoveryEvidence, type PreparedAnswerRecovery, type CompletedAnswerRecovery } from '../answer-recovery.ts';

import { sourceAllowed, assertSourceAccess } from '../trust.ts';

import { digest } from '../actions.ts';

import { EngineConnectorService } from '../engine-connectors.ts';

import type { PrivateTrialAtomicPublication } from '../private-trial-host.ts';
import type { PrivateTrialRecipeEvidence } from '../private-trial-contracts.ts';
import { producerReplacementPins, producerReplacementOutputDigest, publishProducerReplacement } from '../producer-replacement.ts';

import { WorkspaceBackupV2Host } from '../workspace-backup-v2.ts';

import { EngineWorkspaceActivation } from '../workspace-activation-engine.ts';
import { readWorkbook, workbookSheetToCSV } from '../workbook.ts';
import { DatabaseCalculator } from '../analytics.ts';

import { authorize, audit, check, ChausarError, hash, internalCheck, newId, now, type Context, type State, type StateStore } from '../contracts.ts';

import { type AnswerRecoveryRecord, answerRecoveryRecordIntegrity } from './shared.ts';
import type { EngineInternals } from './internals.ts';

export async function runJob(internals: EngineInternals, id: string): Promise<any> {
    const configured = internals.store().read().jobs.find((item: any) => item.id === id);
    check(configured, 'NOT_FOUND', 'Job not found.');
    if (configured.plan) return internals.jobRunner().run(internals.context, id);
    check(configured.type === 'owner-brief', 'JOB_TYPE_UNSUPPORTED', 'This job has no installed runner.');
    check(internals.context.memberId === configured.ownerId || internals.context.role === 'owner', 'JOB_OWNER_REQUIRED', 'Only the job owner or workspace owner can run this job.');
    const owner = internals.store().read().members.find(member => member.id === configured.ownerId);
    check(owner?.active && owner.epoch === configured.ownerEpoch && owner.role === configured.ownerRole, 'JOB_OWNER_REVOKED', 'The job owner changed or was revoked.');
    const jobContext: Context = { memberId: owner.id, role: owner.role, epoch: owner.epoch, channel: 'desktop' };
    const job = await internals.services.jobs.acquire(jobContext, id, 'desktop-engine');
    if (job.status !== 'running' || !job.lease) return job;
    const result = await internals.services.reports.brief(jobContext, { sourceIds: [...job.sourceIds] });
    const completed = await internals.services.jobs.complete(jobContext, id, job.lease, { kind: 'brief', result, at: now() }, '0');
    // The scheduler may administer another member's run, but does not disclose
    // that member's cached report to a different requesting identity.
    if (internals.context.memberId !== owner.id) return { id: completed.id, status: completed.status };
    return completed;
  }

export function answerRecoveryOwner(internals: EngineInternals, ctx: Context, view: StateStore): void {
    const member = authorize(view, ctx, 'admin');
    check(member.role === 'owner' && ctx.channel === 'desktop' && !ctx.sourceTainted,
      'ANSWER_RECOVERY_OWNER_REQUIRED', 'Only the current owner in the untainted app can review and create this fresh calculation.');
  }

export function answerRecoveryView(internals: EngineInternals, state: State): StateStore {
    // Calculator writes affect only this candidate. The caller performs ONE Vault.update commit;
    // this store never re-enters the non-reentrant Vault guard or commits a partial receipt.
    return { read: () => structuredClone(state), update: async change => await change(state) };
  }

export function answerRecoveryCalculator(internals: EngineInternals, view: StateStore): CalculatorService {
    const configured = internals.services.calculator as CalculatorService;
    const connectors = new EngineConnectorService(view, internals.options.connectorRuntime);
    return new CalculatorService(view, {
      ...(configured.verifier ? { verifier: configured.verifier } : {}),
      consumerGuard: (ctx, request) => connectors.assertCalculationReady(ctx, request),
      receiptGuard: (ctx, receipt) => connectors.assertReceiptReady(ctx, receipt),
    });
  }

export function answerRecoveryEvidence(internals: EngineInternals, ctx: Context, answerId: unknown, view: StateStore): { evidence: AnswerRecoveryEvidence; evidencePin: string; dictionary: { hash: string; version: number; }; } {
    internals.answerRecoveryOwner(ctx, view);
    check(typeof answerId === 'string' && /^[A-Za-z0-9_.:-]{1,200}$/.test(answerId), 'INVALID_ANSWER_RECOVERY', 'Choose one saved answer.');
    const state = view.read(), matches = state.answers.filter(answer => answer.id === answerId), answer = matches[0];
    check(matches.length === 1 && answer.request && typeof answer.receiptId === 'string'
      && state.receipts.filter(receipt => receipt.id === answer.receiptId).length === 1,
      'ANSWER_RECOVERY_SOURCE_CHANGED', 'The exact original answer and private receipt are unavailable.');
    const calculator = internals.answerRecoveryCalculator(view), receipt = calculator.receipt(ctx, answer.receiptId);
    const evidence: AnswerRecoveryEvidence = { workspaceId: state.workspace.id,
      answer: { id: answer.id, receiptId: answer.receiptId, request: structuredClone(answer.request) }, receipt };
    explainAnswerRecovery(evidence);
    calculator.consumerGuard?.(ctx, structuredClone(answer.request));
    const current = new OntologyService(view).current(ctx);
    check(current, 'DICTIONARY_REQUIRED', 'Publish current business definitions before preparing a fresh calculation.');
    // Exclude unrelated output/audit appends and the issuing record itself. Every input,
    // meaning, retained connector binding and current authority dependency stays pinned.
    const evidencePin = hash({ vaultId: internals.store().vaultId, workspaceId: state.workspace.id,
      memberId: ctx.memberId, epoch: ctx.epoch, originalAnswer: answer, originalReceipt: receipt,
      ontology: state.ontology, facts: state.facts, imports: state.imports, sourceRules: state.sourceRules,
      merges: state.merges, tombstones: state.tombstones, members: state.members, policy: state.policy });
    return { evidence, evidencePin, dictionary: { hash: current.hash, version: current.version } };
  }

export function answerRecoveryRecord(internals: EngineInternals, ctx: Context, newRequestId: unknown, view: StateStore): { record: AnswerRecoveryRecord; resolved: { evidence: AnswerRecoveryEvidence; evidencePin: string; dictionary: { hash: string; version: number; }; }; } {
    internals.answerRecoveryOwner(ctx, view);
    check(typeof newRequestId === 'string' && /^answer_recovery_[A-Za-z0-9_-]{1,160}$/.test(newRequestId),
      'INVALID_ANSWER_RECOVERY', 'Use a host-issued fresh calculation request.');
    const state = view.read(), records = state.answers.filter(answer => answer.id === newRequestId), record = records[0] as AnswerRecoveryRecord;
    check(records.length === 1 && record?.type === 'answer-recovery-request-v1' && record.workspaceId === state.workspace.id
      && record.memberId === ctx.memberId && record.epoch === ctx.epoch && record.preparation?.newRequestId === newRequestId
      && ['prepared', 'completed'].includes(record.status) && record.integrity === answerRecoveryRecordIntegrity(record),
      'ANSWER_RECOVERY_REQUEST_UNAVAILABLE', 'This exact issued request is unavailable under your current private ownership.');
    const resolved = internals.answerRecoveryEvidence(ctx, record.preparation.source.originalAnswerId, view);
    assertPreparedAnswerRecoveryCurrent(resolved.evidence, record.preparation);
    return { record, resolved };
  }

export function answerRecoveryRead(internals: EngineInternals, ctx: Context, newRequestId: unknown): { status: string; requiresReopen: boolean; message: string; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; preparation: PreparedAnswerRecovery; dictionary: { hash: string; version: number; }; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; lineage: CompletedAnswerRecovery; answer: { id: any; receiptId: any; request: any; }; receipt: CalculationReceipt; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } {
    const view = internals.store(), { record, resolved } = internals.answerRecoveryRecord(ctx, newRequestId, view);
    const base = { newRequestId: record.id, preparationDigest: record.preparation.digest,
      interpretation: 'new-calculation-with-declared-time-scope', historicalReplay: false, grantsAuthority: false,
      preservesOriginalRecords: true, retrospectivePromotion: 'still-blocked-by-preserved-unpinned-original' };
    if (record.status === 'prepared') {
      if (internals.privateUnknownAnswerRecoveries.has(record.id)) return { ...base, status: 'outcome-unknown', requiresReopen: true,
        message: 'The commit acknowledgement is unknown. Lock and reopen this workspace, then inspect this issued request before explicitly retrying.' };
      check(record.evidencePin === resolved.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Evidence or access changed. Review and prepare a separate fresh request.');
      internals.answerRecoveryCalculator(view).consumerGuard?.(ctx, structuredClone(record.preparation.request));
      return { ...base, status: 'prepared', preparation: structuredClone(record.preparation), dictionary: record.dictionary };
    }
    check(record.lineage, 'ANSWER_RECOVERY_RESULT_CHANGED', 'The completed request lacks its retained lineage.');
    const state = view.read(), answers = state.answers.filter(answer => answer.id === record.lineage!.newAnswerId), answer = answers[0];
    check(answers.length === 1 && answer?.newRequestId === record.id && answer.interpretation === base.interpretation
      && state.receipts.filter(receipt => receipt.id === record.lineage!.newReceiptId).length === 1,
      'ANSWER_RECOVERY_RESULT_CHANGED', 'The separate fresh answer and receipt are unavailable.');
    const receipt = internals.answerRecoveryCalculator(view).receipt(ctx, record.lineage.newReceiptId);
    const result = { answer: { id: answer.id, receiptId: answer.receiptId, request: structuredClone(answer.request) }, receipt };
    const lineage = completeAnswerRecovery(resolved.evidence, record.preparation, result);
    check(hash(lineage) === hash(record.lineage), 'ANSWER_RECOVERY_RESULT_CHANGED', 'The retained completed lineage does not match its exact issued result.');
    return { ...base, status: 'completed', lineage: structuredClone(lineage), answer: result.answer, receipt };
  }

export async function executeAnswerRecovery(internals: EngineInternals, ctx: Context, newRequestId: unknown, preparationDigest: unknown): Promise<{ status: string; requiresReopen: boolean; message: string; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; preparation: PreparedAnswerRecovery; dictionary: { hash: string; version: number; }; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; } | { status: string; lineage: CompletedAnswerRecovery; answer: { id: any; receiptId: any; request: any; }; receipt: CalculationReceipt; newRequestId: string; preparationDigest: string; interpretation: string; historicalReplay: boolean; grantsAuthority: boolean; preservesOriginalRecords: boolean; retrospectivePromotion: string; }> {
    check(typeof preparationDigest === 'string' && DIGEST_PATTERN.test(preparationDigest), 'INVALID_ANSWER_RECOVERY', 'This answer changed since you looked. Look at it again before confirming.');
    const vault = internals.store(), issued = internals.answerRecoveryRecord(ctx, newRequestId, vault);
    check(issued.record.preparation.digest === preparationDigest, 'ANSWER_RECOVERY_PREPARATION_CHANGED', 'Review this exact issued preparation before execution.');
    if (issued.record.status === 'completed') return internals.answerRecoveryRead(ctx, newRequestId);
    check(!internals.privateUnknownAnswerRecoveries.has(issued.record.id), 'ANSWER_RECOVERY_OUTCOME_UNKNOWN', 'Lock and reopen, then inspect this issued request. Do not repeat an ambiguous calculation.');
    const pending = internals.privateAnswerRecoveryExecutions.get(issued.record.id);
    if (pending) { await pending; return internals.answerRecoveryRead(ctx, newRequestId); }
    let completed!: () => void, failed!: (error: unknown) => void;
    const completion = new Promise<void>((resolveCompletion, rejectCompletion) => { completed = resolveCompletion; failed = rejectCompletion; });
    void completion.catch(() => {}); // The issuing request still reports its own failure.
    internals.privateAnswerRecoveryExecutions.set(issued.record.id, completion);
    let calculated = false;
    try {
      await vault.update(async state => {
        const view = internals.answerRecoveryView(state), { record, resolved } = internals.answerRecoveryRecord(ctx, newRequestId, view);
        check(record.preparation.digest === preparationDigest, 'ANSWER_RECOVERY_PREPARATION_CHANGED', 'The issued preparation changed before commit.');
        if (record.status === 'completed') return; // A concurrent exact retry observes the same result.
        check(record.evidencePin === resolved.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Current evidence or access changed before execution. Review again.');
        const calculator = internals.answerRecoveryCalculator(view);
        const receipt = await calculator.calculate(ctx, structuredClone(record.preparation.request)); calculated = true;
        const fresh = state.answers.filter(answer => answer.receiptId === receipt.id);
        check(fresh.length === 1, 'ANSWER_RECOVERY_RESULT_CHANGED', 'The fresh calculation must retain one separate answer.');
        // Re-resolve the original after verification and calculator candidate writes.
        const after = internals.answerRecoveryEvidence(ctx, record.preparation.source.originalAnswerId, view);
        check(after.evidencePin === record.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Original evidence or current authority changed during execution.');
        const result = { answer: { id: fresh[0].id, receiptId: receipt.id, request: structuredClone(fresh[0].request) },
          receipt: calculator.receipt(ctx, receipt.id) };
        const lineage = completeAnswerRecovery(after.evidence, record.preparation, result);
        fresh[0].newRequestId = record.id; fresh[0].interpretation = lineage.interpretation;
        const persisted = state.answers.find(answer => answer.id === record.id) as AnswerRecoveryRecord;
        persisted.status = 'completed'; persisted.lineage = structuredClone(lineage); persisted.integrity = answerRecoveryRecordIntegrity(persisted);
        audit(state, 'answer-recovery.completed', { newRequestId: record.id, originalAnswerId: lineage.source.originalAnswerId,
          newAnswerId: lineage.newAnswerId, newReceiptId: lineage.newReceiptId, historicalReplay: false });
      });
      completed();
    } catch (error) {
      // Once a candidate result exists, an error may be an adapter's lost commit acknowledgement.
      // This handle refuses another computation until reopen resolves durable authority.
      if (calculated) {
        internals.privateUnknownAnswerRecoveries.add(issued.record.id);
        const unknown = new ChausarError('ANSWER_RECOVERY_OUTCOME_UNKNOWN', 'The fresh calculation commit acknowledgement is unknown. Lock and reopen, then inspect this issued request; do not automatically retry.');
        failed(unknown); throw unknown;
      }
      failed(error); throw error;
    } finally {
      internals.privateAnswerRecoveryExecutions.delete(issued.record.id);
    }
    return internals.answerRecoveryRead(ctx, newRequestId);
  }

export function journalPayload(internals: EngineInternals, value: unknown, allowed: readonly string[], required: readonly string[], code: string): Record<string, unknown> {
    check(value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value)), code, 'Use a journal object payload.');
    check(Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)), code, 'Supply the required journal fields without unknown properties.');
    return value as Record<string, unknown>;
  }

export function journalWriter(internals: EngineInternals, ctx: Context): void {
    authorize(internals.store(), ctx, 'prepare');
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_DECISION_REQUIRED', 'Prepare and review an internal decision explicitly inside the app.');
  }

export function journalRevision(internals: EngineInternals, value: unknown): asserts value is number {
    check(typeof value === 'number' && Number.isSafeInteger(value) && value >= 1, 'REVISION_CONFLICT', 'Supply the loaded journal revision before changing it.');
  }

export function workbookBytes(internals: EngineInternals, payload: any): Uint8Array {
    const value = payload.bytesBase64 ?? payload.moduleBase64;
    check(typeof value === 'string' && value.length > 0 && value.length <= 2_800_000 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value), 'INVALID_WORKBOOK', 'Choose a bounded XLSX workbook.');
    return Buffer.from(value, 'base64');
  }

export function workbookInput(internals: EngineInternals, payload: any): { expectedTotals?: any; recipe?: any; sourceId: any; format: "csv"; content: string; } {
    const workbook = readWorkbook(internals.workbookBytes(payload), { sheet: payload.sheet });
    check(workbook.sheets.length === 1 || typeof payload.sheet === 'string', 'SHEET_REQUIRED', 'Choose the exact worksheet to import.');
    const sheet = payload.sheet ? workbook.sheets.find(item => item.name === payload.sheet) : workbook.sheets[0];
    check(sheet, 'SHEET_REQUIRED', 'The selected worksheet is missing.');
    return { sourceId: payload.sourceId, format: 'csv' as const, content: workbookSheetToCSV(sheet), ...(payload.recipe ? { recipe: payload.recipe } : {}), ...(payload.expectedTotals ? { expectedTotals: payload.expectedTotals } : {}) };
  }

export function visibleImports(internals: EngineInternals): any[] {
    const store = internals.store(); const state = store.read(); const ctx = internals.context;
    const legacy = state.imports.filter(item => !item.type && Array.isArray(item.rowIds) && sourceAllowed(state, ctx, item.sourceId)
      && item.rowIds.every((id: string) => { const fact = state.facts.find(f => f.id === id); return !!fact && canSeeFact(store, ctx, fact); }));
    return [...legacy.map(importPublicRecord), ...internals.services.connectorRuntime.sourceSummaries(ctx)];
  }

export function privateRecipeEvidence(internals: EngineInternals, ctx: Context, sourceId: string): PrivateTrialRecipeEvidence {
    const state = internals.store().read(); assertSourceAccess(state, ctx, [sourceId]);
    check(state.facts.filter(fact => fact.sourceId === sourceId).every(fact => canSeeFact(internals.store(), ctx, fact)), 'FORBIDDEN_BRANCH', 'A recipe trial requires access to the complete retained producer history.');
    const imports = state.imports.filter(item => item.sourceId === sourceId && item.format);
    check(imports.length > 0 && imports.every(item => item.retainedInput?.version === 1 && item.retainedInput.digest === hash(item.retainedInput.input)
      && item.contentHash === hash(item.retainedInput.input.content) && item.recipeHash === hash(item.retainedInput.input.recipe)
      && item.coverage?.reconciled === true && Array.isArray(item.rowIds) && Number.isSafeInteger(item.retainedInput.input.expectedTotals?.rowCount)
      && /^-?\d+$/.test(item.retainedInput.input.expectedTotals?.amountMinor)), 'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Every source generation needs its exact retained original input, recipe, explicit independent controls and reconciled lineage. Older hash-only imports cannot be inferred.');
    check(!state.imports.some(item => item.sourceId === sourceId && item.type?.startsWith('connector-')), 'TRIAL_RECIPE_CUSTODY_REQUIRED', 'Managed capture remapping requires its full qualified source custody resolver.');
    return { sourceId, recipe: structuredClone(imports.at(-1)!.retainedInput.input.recipe), captures: imports.map(item => ({ importId: item.id,
      generation: item.retainedInput.generation, complete: true, input: structuredClone(item.retainedInput.input), factIds: [...item.rowIds] })) };
  }

export function interchangeOwner(internals: EngineInternals, ctx: Context, historical: State): void {
    internals.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete workspace copying requires the untainted desktop owner.');
    check(internals.options.sync === undefined, 'INTERCHANGE_EXTERNAL_CUSTODY_REQUIRED', 'Configured device sync needs its independently enumerated external custody before a complete local transfer can be admitted.');
    const current = internals.store().read();
    const sourceIds = [...new Set<string>([...historical.facts.map(fact => fact.sourceId), ...historical.imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string')])];
    assertSourceAccess(current, ctx, sourceIds);
    check(historical.facts.every(fact => canSeeFact(internals.store(), ctx, fact)), 'INTERCHANGE_READ_SCOPE_REQUIRED', 'Workspace copying requires current access to every retained historical row.');
    const managedSourceIds = [...new Set<string>(current.imports.filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type)).map(item => item.sourceId).filter((id): id is string => typeof id === 'string'))];
    internals.services.connectorRuntime.assertBusinessEvidenceReady(ctx, { sourceIds, managedSourceIds, factIds: [], profileIds: [], request: {} });
  }

export function backupHost(internals: EngineInternals): WorkspaceBackupV2Host {
    check(internals.services.backupV2 instanceof WorkspaceBackupV2Host, 'BACKUP_STORAGE_PROFILE_REQUIRED',
      'This storage profile requires its separately reviewed complete encrypted-custody implementation.');
    return internals.services.backupV2;
  }

export function activationHost(internals: EngineInternals): EngineWorkspaceActivation {
    internalCheck(internals.services.workspaceActivation instanceof EngineWorkspaceActivation, 'ACTIVATION_ROOT_REQUIRED',
      'Install the reviewed synthetic local activation, actual encrypted journal and fresh credential capability in the trusted host.');
    return internals.services.workspaceActivation;
  }

export function backupCompleteOwner(internals: EngineInternals, ctx: Context, historical: State): void {
    internals.requireWorkspaceOwner(ctx);
    check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Complete encrypted archive custody requires the untainted desktop owner.');
    const current = internals.store().read();
    const sourceIds = [...new Set<string>([...historical.facts.map(fact => fact.sourceId),
      ...historical.imports.map(item => item.sourceId).filter((id): id is string => typeof id === 'string')])];
    assertSourceAccess(current, ctx, sourceIds);
    check(historical.facts.every(fact => canSeeFact(internals.store(), ctx, fact)), 'BACKUP_READ_SCOPE_REQUIRED', 'Current access must cover every retained historical row.');
    const managedSourceIds = [...new Set<string>([...current.imports, ...historical.imports]
      .filter(item => ['connector-capture-v1', 'connector-consumer-binding-v1'].includes(item.type))
      .map(item => item.sourceId).filter((id): id is string => typeof id === 'string'))];
    check((internals.options.sync === undefined && managedSourceIds.length === 0) || typeof internals.options.backupCustody?.withCompleteOwner === 'function',
      'BACKUP_HELD_READINESS_REQUIRED', 'Configured sync and managed sources require installed held owner/source/readiness admission through archive publication.');
    internals.services.connectorRuntime.assertBusinessEvidenceReady(ctx, { sourceIds, managedSourceIds, factIds: [], profileIds: [], request: {} });
  }

export function privatePromotionImpact(internals: EngineInternals, ctx: Context, state = this.store().read(), strategy?: 'prospective' | 'retrospective'): { complete: true; affectedArtifactIds: string[]; rebuildArtifactIds: string[]; activeWorkIds: string[]; } {
    const view: StateStore = { read: () => structuredClone(state), update: async () => { throw new Error('Impact inspection is read-only.'); } };
    const member = authorize(view, ctx, 'admin');
    check(member.branches.includes('*'), 'TRIAL_IMPACT_SCOPE_REQUIRED', 'Complete publication impact requires every workspace branch.');
    assertSourceAccess(state, ctx, [...new Set(state.facts.map(fact => fact.sourceId))]);
    // Conservatively include every persisted output: meaning changes can affect even equal totals.
    const outputs = [state.receipts, state.answers, state.decisions, state.jobs, state.actions, state.conversations, state.modelReceipts, state.learning, state.schedules, state.plugins];
    const affectedArtifactIds = [...new Set<string>(outputs.flatMap(records => records.map(record => record.id).filter((id): id is string => typeof id === 'string' && id.length > 0)))].sort();
    const rebuildArtifactIds = [...new Set<string>(state.answers.filter(record => record.request && record.receiptId).map(record => record.id))].sort();
    if (strategy === 'retrospective') {
      const ineligible = state.answers.filter(answer => rebuildArtifactIds.includes(answer.id)).filter(answer => {
        const receipt = state.receipts.find(receipt => receipt.id === answer.receiptId);
        return !answer.request?.asOf || receipt?.memberId !== ctx.memberId || receipt?.epoch !== ctx.epoch;
      }).map(answer => answer.id);
      check(ineligible.length === 0, 'TRIAL_REBUILD_REQUIRED', `Retrospective publication needs current private ownership and explicitly pinned requests for these outputs: ${ineligible.join(', ')}.`);
    }
    const activeWorkIds = [...new Set<string>([
      ...state.jobs.filter(job => !['accepted', 'cancelled', 'revoked', 'stopped'].includes(job.status) || job.lease
        || [job.execution, ...(job.archivedExecutions ?? [])].some(execution => execution?.attempts?.some((attempt: any) => ['dispatched', 'unknown'].includes(attempt.status)))),
      ...state.actions.filter(action => !['verified', 'cancelled', 'rejected'].includes(action.status)
        || action.attempts?.some((attempt: any) => ['executing', 'unknown'].includes(attempt.outcome))),
      ...state.schedules.filter(schedule => schedule.enabled !== false && schedule.status !== 'cancelled'),
    ].map(record => record.id).filter((id): id is string => typeof id === 'string'))].sort();
    return { complete: true as const, affectedArtifactIds, rebuildArtifactIds, activeWorkIds };
  }

export async function promotePrivateTrial(internals: EngineInternals, ctx: Context, publication: PrivateTrialAtomicPublication): Promise<{ publicationId: string }> {
    const vault = internals.store();
    return vault.update(async state => {
      const view: StateStore = { read: () => structuredClone(state), update: async () => { throw new ChausarError('REENTRANT_TRANSACTION', 'Use the current publication transaction.'); } };
      publication.assertCurrent(view);
      check(hash(internals.privatePromotionImpact(ctx, state, publication.proposal.impact.strategy)) === hash({ complete: publication.proposal.impact.complete,
        affectedArtifactIds: publication.proposal.impact.affectedArtifactIds, rebuildArtifactIds: publication.proposal.impact.rebuildArtifactIds,
        activeWorkIds: publication.proposal.impact.activeWorkIds }), 'TRIAL_IMPACT_CHANGED', 'Complete publication dependencies changed inside the commit.');
      const { fork, proposal } = publication; const at = now(), publicationId = newId('trialpublication');
      if (fork.change.type === 'definition') {
        // Preserve the exact reviewed compilation metadata/hash. Operational activation time is separate.
        state.ontology = structuredClone(fork.candidate.ontology);
      } else if (fork.change.type === 'source-precedence') {
        state.sourceRules.push({ id: newId('rule'), kind: fork.change.kind, sourceIds: [...fork.change.sourceIds], at, by: ctx.memberId, trialPublicationId: publicationId });
      } else {
        const change = fork.change;
        const live = new Map(state.facts.filter(fact => fact.sourceId === change.sourceId && !fact.supersededAt && !fact.deletedAt).map(fact => [JSON.stringify([fact.kind, fact.entityId]), fact]));
        const capture = fork.recipeEvidence[0]?.captures.toSorted((left, right) => left.generation - right.generation).at(-1);
        check(capture && [...live.values()].every(fact => capture.factIds.includes(fact.id)), 'TRIAL_PRODUCER_GENERATION_REQUIRED', 'Publication needs one retained complete latest producer generation; incremental fragments cannot be silently treated as a full replacement.');
        const preview = new ImportService(view).preview(ctx, { ...capture.input, recipe: change.replacement });
        check(preview.accepted && preview.facts.length === live.size, 'TRIAL_RECIPE_CUSTODY_CHANGED', 'The reviewed latest complete source generation must still reconcile at publication.');
        const outputs = capture.factIds.map(id => fork.candidate.facts.find(fact => fact.id === id)!).map(fact => ({ entityId: fact.entityId, sourceId: fact.sourceId,
          sourceRow: fact.sourceRow, kind: fact.kind, validFrom: fact.validFrom, validTo: fact.validTo, fields: structuredClone(fact.fields), ...(fact.branch ? { branch: fact.branch } : {}) }));
        const source = new EngineConnectorService(view, internals.options.connectorRuntime);
        const request = { version: 1 as const, complete: true as const, sourceId: change.sourceId, expected: producerReplacementPins(state, change.sourceId), publishedAt: at,
          outputs, custody: { inputDigest: hash(fork.recipeEvidence), recipeDigest: hash(change.replacement), outputDigest: producerReplacementOutputDigest(outputs) },
          controls: { rowCount: outputs.length, sums: [{ field: 'amountMinor', minor: String(outputs.reduce((sum, output) => sum + BigInt(String(output.fields.amountMinor)), 0n)) }] } };
        publishProducerReplacement(state, request, { assertCustody: (_state, input) => {
          check(input.custody.inputDigest === hash(fork.recipeEvidence) && input.custody.recipeDigest === hash(change.replacement), 'TRIAL_RECIPE_CUSTODY_CHANGED', 'Publication must use the exact reviewed issued custody.');
        }, assertCurrentAdmission: () => { for (const saved of fork.savedRequests) source.assertCalculationReady(ctx, saved.request); } });
        const next = new Map(state.facts.filter(fact => fact.sourceId === change.sourceId && !fact.supersededAt && !fact.deletedAt).map(fact => [JSON.stringify([fact.kind, fact.entityId]), fact]));
        const retained = JSON.parse(JSON.stringify({ ...capture.input, recipe: change.replacement }));
        const rowIds = preview.facts.map(fact => next.get(JSON.stringify([fact.kind, fact.entityId]))?.id);
        check(rowIds.every(id => typeof id === 'string'), 'TRIAL_RECIPE_CUSTODY_CHANGED', 'Every published producer row needs its actual live assertion lineage.');
        state.imports.push({ id: newId('import'), at, sourceId: change.sourceId, format: capture.input.format,
          contentHash: preview.contentHash, recipeHash: preview.recipeHash, rowIds, coverage: preview.coverage, totalsMinor: preview.totalsMinor,
          expectedTotals: capture.input.expectedTotals, unmappedFields: preview.unmappedFields, qualification: 'experimental', trialPublicationId: publicationId,
          retainedInput: { version: 1, generation: state.imports.filter(item => item.sourceId === change.sourceId && item.format).length + 1,
            input: retained, digest: hash(retained) } });
        state.learning.push({ id: publicationId, type: 'private-trial-recipe-publication-v1', sourceId: change.sourceId,
          sourceIds: [change.sourceId], recipe: structuredClone(change.replacement), recipeHash: hash(change.replacement), at, shared: false });
      }
      // Original receipts are immutable historical evidence; current answers carry explicit staleness.
      for (const answer of state.answers) { answer.stale = true; answer.staleReason = 'A reviewed private trial changed the published meaning.'; }
      if (proposal.impact.strategy === 'retrospective') {
        // Restatement is new evidence. It never overwrites historical receipts or their IDs.
        let replay = structuredClone(fork.candidate);
        const local: StateStore = { read: () => structuredClone(replay), update: async change => {
          const draft = structuredClone(replay); const result = await change(draft); replay = draft; return result;
        } };
        const connectors = new EngineConnectorService(local, internals.options.connectorRuntime);
        const database = internals.options.demo ? null : new DatabaseCalculator(internals.options.analytics);
        const rebuilds = proposal.impact.rebuildArtifactIds.map(id => state.answers.find(answer => answer.id === id));
        for (const saved of rebuilds) {
          const original = state.receipts.find(receipt => receipt.id === saved?.receiptId);
          check(saved?.request?.asOf && original?.memberId === ctx.memberId && original?.epoch === ctx.epoch, 'TRIAL_REBUILD_REQUIRED', 'Every acknowledged rebuild needs its current private owner and explicitly pinned original request.');
          const calculator = new CalculatorService(local, { ...(database ? { verifier: receipt => database.verify(receipt) } : {}), consumerGuard: (context, request) => connectors.assertCalculationReady(context, request),
            receiptGuard: (context, receipt) => connectors.assertReceiptReady(context, receipt),
            restatement: { version: 1, interpretation: 'restated-private-diagnostic', trialId: fork.id, forkDigest: fork.digest,
              candidateStateDigest: fork.candidatePin.stateDigest, publicationId, originalAnswerId: saved.id, originalReceiptId: original.id } });
          const receipt = await calculator.calculate(ctx, structuredClone(saved.request));
          state.receipts.push(structuredClone(receipt));
          state.answers.push({ id: newId('answer'), request: structuredClone(saved.request), receiptId: receipt.id, memberId: ctx.memberId,
            epoch: ctx.epoch, at, interpretation: 'restated-private-diagnostic', restatement: 'reviewed-private-trial', publicationId, originalAnswerId: saved.id });
        }
      }
      audit(state, 'private-trial.published', { publicationId, trialId: fork.id, strategy: proposal.impact.strategy,
        candidatePin: fork.candidatePin.stateDigest, activatedAt: at });
      return { publicationId };
    });
  }

export async function privateRestatementContext(internals: EngineInternals, ctx: Context, receiptId: unknown): Promise<{ receiptId: string; interpretation: any; originalReceipt: any; forkDigest: string; candidatePin: import("../private-trial-contracts.ts").PrivateTrialVersionPin; change: import("../private-trial-contracts.ts").PrivateTrialChange; rows: any; }> {
    check(typeof receiptId === 'string', 'RESTATEMENT_CONTEXT_REQUIRED', 'Choose one retained restated calculation receipt.');
    const receipt = internals.services.calculator.receipt(ctx, receiptId), anchor = receipt.restatement;
    check(anchor?.version === 1 && anchor.interpretation === 'restated-private-diagnostic', 'RESTATEMENT_CONTEXT_REQUIRED', 'This receipt has no issued private restatement context.');
    internals.assertRestatementCustodyRetained(receiptId);
    let retained, binding;
    try {
      retained = await internals.store().readArtifact({ id: `${anchor.trialId}-fork`, purpose: 'private-trial' });
      binding = await internals.store().readArtifact({ id: `${anchor.trialId}-binding`, purpose: 'private-trial' });
    } catch (error: any) {
      internals.assertRestatementCustodyRetained(receiptId);
      if (error.code === 'ARTIFACT_NOT_FOUND') throw new ChausarError('RESTATEMENT_CUSTODY_UNAVAILABLE', 'The issued restatement payload is absent; the historical receipt remains labelled but its paired interpretation cannot be released.');
      throw error;
    }
    const fork = retained.value as PrivateTrialAtomicPublication['fork'], issued = binding.value as any;
    const { digest: ignored, ...body } = fork;
    check(fork.digest === anchor.forkDigest && hash(body) === fork.digest && fork.candidatePin.stateDigest === anchor.candidateStateDigest
      && fork.memberId === ctx.memberId && fork.epoch === ctx.epoch && fork.workspaceId === internals.store().read().workspace.id
      && issued.status === 'promoted' && issued.publicationId === anchor.publicationId && issued.fork.issuedDigest === fork.digest
      && issued.fork.ref.valueDigest === retained.valueDigest, 'RESTATEMENT_CONTEXT_CHANGED', 'The retained restatement differs from its independently issued fork and publication context.');
    const originalReceipt = internals.services.calculator.receipt(ctx, anchor.originalReceiptId);
    const view: StateStore = { read: () => structuredClone(fork.candidate), update: async () => { throw new Error('Restatement context is inert.'); } };
    new EngineConnectorService(view, internals.options.connectorRuntime).assertReceiptReady(ctx, receipt);
    // Recheck live access after custody I/O, including every retained exclusion.
    internals.services.calculator.receipt(ctx, receiptId);
    internals.assertRestatementCustodyRetained(receiptId);
    return { receiptId, interpretation: anchor.interpretation, originalReceipt, forkDigest: fork.digest, candidatePin: fork.candidatePin,
      change: structuredClone(fork.change), rows: receipt.rowIds.map((id: string) => ({ factId: id,
        original: structuredClone(fork.baseline.facts.find(fact => fact.id === id)), restated: structuredClone(fork.candidate.facts.find(fact => fact.id === id)) })) };
  }

export function assertRestatementCustodyRetained(internals: EngineInternals, receiptId: string): void {
    check(!internals.store().read().tombstones.some(item => item.kind === 'private-restatement-custody' && item.receiptIds?.includes(receiptId)),
      'RESTATEMENT_CUSTODY_REVOKED', 'Managed retention or source deletion released the complete fork containing this receipt. Its immutable restatement anchor remains, but paired interpretation is explicitly unavailable.');
  }

export function visibleActivity(internals: EngineInternals, ctx: Context): any[] {
    const store = internals.store(); const member = authorize(store, ctx); const state = store.read();
    return state.activity.filter(item => {
      const details = item.details ?? {};
      const sourceIds = details.sourceId ? [details.sourceId] : details.sourceIds;
      if (Array.isArray(sourceIds) && !sourceIds.every((id: string) => sourceAllowed(state, ctx, id) && state.facts.filter(f => f.sourceId === id).every(f => canSeeFact(store, ctx, f)))) return false;
      return (member.role === 'owner' && member.branches.includes('*')) || details.memberId === ctx.memberId;
    });
  }
