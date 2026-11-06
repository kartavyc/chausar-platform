import type { Engine, LegacyInternals, AnswerRecoveryRecord } from '../engine.ts';
import { DIGEST_PATTERN } from '../../shared/digest.ts';
import { resolve } from 'node:path';
import { explainAnswerRecovery, prepareAnswerRecovery, type AnswerRecoverySource, type AnswerRecoveryTimeScope } from '../answer-recovery.ts';
import { conversationPurpose } from '../conversation-purpose.ts';
import { buildBusinessContext, assertBusinessContextCurrent, renderBusinessAnswer, type BusinessContextManifest } from '../conversation-context.ts';
import type { ReviewedPhoneConversationRequest } from '../engine-phone-runtime.ts';
import type { SyncWriterReview } from '../sync-writer-admission.ts';
import { digest } from '../actions.ts';
import { readWorkbook } from '../workbook.ts';
import { authorize, audit, check, ChausarError, newId, now } from '../contracts.ts';
import { CUSTODY_WORDS } from '../workspace-custody-contracts.ts';

/** Local server and trusted host routes. Entry authorization remains in Engine.handleRequest. */
export async function legacyRequest(engine: Engine, internals: LegacyInternals, method: string, payload: any): Promise<any> {
  const store = internals.store(), ctx = engine.context, s = engine.services;
  switch (method) {
      case 'trials.create': return s.privateTrials.create(ctx, internals.journalPayload(payload, ['version', 'savedAnswerIds', 'change'], ['version', 'savedAnswerIds', 'change'], 'INVALID_PRIVATE_TRIAL'));
      case 'trials.evaluate': return s.privateTrials.evaluate(ctx, internals.journalPayload(payload, ['trialId'], ['trialId'], 'INVALID_PRIVATE_TRIAL').trialId);
      case 'trials.get': return s.privateTrials.read(ctx, internals.journalPayload(payload, ['trialId'], ['trialId'], 'INVALID_PRIVATE_TRIAL').trialId);
      case 'trials.receiptContext': return internals.privateRestatementContext(ctx, internals.journalPayload(payload, ['receiptId'], ['receiptId'], 'INVALID_PRIVATE_TRIAL').receiptId);
      case 'trials.list': internals.journalPayload(payload, [], [], 'INVALID_PRIVATE_TRIAL'); return s.privateTrials.list(ctx);
      case 'trials.savedQuestions': {
        internals.journalPayload(payload, [], [], 'INVALID_PRIVATE_TRIAL');
        return store.read().answers.flatMap(answer => {
          try { const receipt = s.calculator.receipt(ctx, answer.receiptId);
            return answer.request ? [{ id: answer.id, receiptId: receipt.id, request: structuredClone(answer.request), stale: answer.stale === true || receipt.stale === true }] : [];
          } catch { return []; }
        });
      }
      case 'trials.discard': return s.privateTrials.discard(ctx, internals.journalPayload(payload, ['trialId'], ['trialId'], 'INVALID_PRIVATE_TRIAL').trialId);
      case 'trials.impact': { const input = internals.journalPayload(payload, ['trialId', 'strategy'], ['trialId', 'strategy'], 'INVALID_PRIVATE_TRIAL'); return s.privateTrials.promotionImpact(ctx, input.trialId, input.strategy); }
      case 'trials.promote': {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Review the exact private trial publication in the desktop app.');
        return s.privateTrials.promote(ctx, internals.journalPayload(payload, ['trialId', 'evaluationDigest', 'strategy', 'acknowledgedImpactDigest'], ['trialId', 'evaluationDigest', 'strategy', 'acknowledgedImpactDigest'], 'INVALID_PRIVATE_TRIAL'));
      }
      case 'auth.invite': return s.auth.invite(ctx, payload);
      case 'auth.accept': return s.auth.accept(payload.token);
      case 'auth.session': return s.auth.issueSession(ctx, payload.memberId ?? ctx.memberId, payload.ttlMs);
      case 'auth.revoke': return payload.inviteId ? s.auth.revokeInvite(ctx, payload.inviteId) : s.auth.revokeSession(ctx, payload.sessionId ?? payload.id);
      case 'auth.sessions': return s.auth.sessions(ctx);
      case 'phone.invite': return internals.companionRuntime().sessions.issueInvite(ctx, internals.journalPayload(payload,
        ['memberId', 'deviceId', 'keyId', 'channel', 'devicePublicKey', 'capabilities', 'inviteTtlMs', 'sessionTtlMs'],
        ['memberId', 'deviceId', 'keyId', 'channel', 'devicePublicKey', 'capabilities', 'inviteTtlMs', 'sessionTtlMs'], 'INVALID_PHONE_INVITE') as any);
      case 'phone.sessions': internals.journalPayload(payload, [], [], 'INVALID_PHONE_REQUEST'); return internals.companionRuntime().sessions.list(ctx);
      case 'phone.revoke': {
        const input = internals.journalPayload(payload, ['sessionId'], ['sessionId'], 'INVALID_PHONE_REQUEST');
        await internals.companionRuntime().sessions.revokeByOwner(ctx, input.sessionId as string); return { sessionId: input.sessionId, revoked: true };
      }
      case 'phone.conversation.offer': {
        const input = internals.journalPayload(payload, ['sessionId', 'request'], ['sessionId', 'request'], 'INVALID_PHONE_REQUEST');
        return internals.companionRuntime().runtime.offer(ctx, input as { sessionId: string; request: ReviewedPhoneConversationRequest });
      }
      case 'sync.status': authorize(store, ctx, 'admin'); return { ...s.sync.status(ctx), writerAdmission: await internals.writerStatus() };
      case 'sync.writer.status': authorize(store, ctx, 'admin'); internals.journalPayload(payload, [], [], 'INVALID_SYNC_REQUEST'); return internals.writerStatus();
      case 'sync.writer.review': {
        authorize(store, ctx, 'admin');
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_APPROVAL_REQUIRED', 'Review the exact device writer grant in the untainted app.');
        const input = internals.journalPayload(payload, ['expectedFence', 'expectedStateDigest', 'deviceId', 'memberId', 'epoch', 'expiresAt', 'reason'], ['expectedFence', 'expectedStateDigest', 'deviceId', 'memberId', 'epoch', 'expiresAt', 'reason'], 'INVALID_SYNC_REQUEST');
        const admission = engine.options.sync?.writerAdmission;
        check(admission && admission.deviceId === engine.options.sync?.deviceId, 'SYNC_WRITER_ADMISSION_REQUIRED', 'Configure exact reviewed device writer admission first.');
        return admission.review(ctx, store.read(), store.vaultId, input as SyncWriterReview);
      }
      case 'sync.identity': return s.sync.identity(ctx);
      case 'sync.enable':
        // Another device can't open a vault whose secret only this computer holds.
        check(!payload.enabled || internals.openUnlock !== 'this-computer', 'SYNC_NEEDS_PASSPHRASE', CUSTODY_WORDS.errors.SYNC_NEEDS_PASSPHRASE);
        return internals.writerConfiguration(() => {
        if (payload.enabled) check(engine.options.sync?.signingKey && engine.options.sync?.deviceId && engine.options.sync?.signerId, 'SYNC_DEVICE_CONFIGURATION_REQUIRED', 'Configure a persistent broker-supplied signing key and reviewed device identity before publication.');
        return s.sync.enable(ctx, payload.enabled);
      });
      case 'sync.trust': return internals.writerConfiguration(() => s.sync.trustDevice(ctx, payload));
      case 'sync.preview': return s.sync.preview(ctx);
      case 'sync.approve': return s.sync.approve(ctx, payload.id ?? payload.previewId);
      case 'sync.push': return s.sync.push(ctx, payload);
      case 'sync.reconcile': {
        authorize(store, ctx, 'admin');
        const input = internals.journalPayload(payload, ['previewId'], ['previewId'], 'INVALID_SYNC_REQUEST');
        check(typeof input.previewId === 'string' && input.previewId.length > 0 && input.previewId.length <= 200, 'INVALID_SYNC_REQUEST', 'Choose one existing publication receipt.');
        return s.sync.reconcile(ctx, input.previewId);
      }
      case 'sync.pull': {
        authorize(store, ctx, 'admin'); const folder = payload.folder ?? 'sync-staged';
        const staged = await s.sync.pull(ctx, { directory: internals.workspacePath(folder), passphrase: payload.passphrase, recoveryCode: payload.recoveryCode, newPassphrase: payload.newPassphrase, expectedWorkspaceId: payload.expectedWorkspaceId, storage: await internals.adapter(folder) });
        internals.stageVault(staged.stagedVault); return { directory: staged.directory, receipt: staged.receipt, experimental: true, liveAuthorityChanged: false };
      }
      case 'dashboard.get': {
        const facts = s.memory.query(ctx, {}); const state = store.read();
        const calculations: any[] = [];
        for (const operation of ['billed', 'received', 'earned', 'margin']) {
          try { calculations.push(await s.calculator.calculate(ctx, { operation, ...(payload.period ? { period: payload.period } : {}) })); } catch (error) { calculations.push({ operation, error: (error as Error).message }); }
        }
        return { workspace: state.workspace, calculations, factCount: facts.facts?.length ?? facts.length ?? 0, sources: internals.visibleImports().length, decisions: s.reports.decisions(ctx).filter((d: any) => d.status === 'open'), waitingActions: s.actions.list(ctx).filter((a: any) => !['verified', 'cancelled', 'rejected'].includes(a.status)), jobs: s.jobs.list(ctx), policy: state.policy, dictionary: s.ontology.current(ctx), lastActivity: ['owner', 'cofounder'].includes(ctx.role) ? internals.visibleActivity(ctx).slice(-8).reverse() : [] };
      }
      case 'conversation.ask': {
        check(typeof payload.question === 'string' && payload.question.trim().length > 0 && payload.question.length <= 8000, 'INVALID_QUESTION', 'Ask a short business question.');
        check(payload.continuationId === undefined || payload.purpose === 'conversation' && typeof payload.routeId === 'string' && payload.routeId.length > 0,
          'MODEL_ROUTE_REQUIRED', 'Choose and review a model route to continue this question.');
        if (payload.purpose === 'conversation') {
          check(typeof payload.routeId === 'string' && payload.routeId.length > 0 && payload.questionDisclosure === 'verbatim', 'MODEL_ROUTE_REQUIRED', 'Choose a model route and review the original question before sending it.');
          const result = await s.gateway.execute(ctx, payload);
          check(result.kind === 'conversation', 'PREVIEW_REQUEST_CHANGED', 'Use the unified conversation preview for this request.');
          return internals.executeConversationPlan(ctx, payload, result);
        }
        const purpose = conversationPurpose(payload.question, payload.purpose);
        let result: any;
        let businessManifest: BusinessContextManifest | undefined;
        let modelReceiptId: string | undefined;
        if (payload.routeId) {
          const gatewayResult = await s.gateway.execute(ctx, { ...payload, purpose });
          check(gatewayResult.kind !== 'conversation' && gatewayResult.kind !== 'conversation-synthesis', 'PREVIEW_REQUEST_CHANGED', 'Use the exact conversation mode reviewed in the model preview.');
          if (gatewayResult.kind === 'business-context') { result = gatewayResult.answer; businessManifest = gatewayResult.receipt.businessContext; modelReceiptId = gatewayResult.receipt.id; }
          else { const plan = gatewayResult.plan; if (plan.clarification || !plan.operation) return plan; result = await s.calculator.calculate(ctx, plan); }
        } else if (purpose === 'business-context') {
          check(payload.previewId === undefined && payload.approvalId === undefined && payload.profileSamples === undefined, 'MODEL_ROUTE_REQUIRED', 'A model preview requires its exact selected route. Local context stays on this device.');
          const request = { ...(payload.sourceIds !== undefined ? { sourceIds: payload.sourceIds } : {}), ...(payload.branch !== undefined ? { branch: payload.branch } : {}),
            ...(payload.asOf !== undefined ? { asOf: payload.asOf } : {}), ...(payload.onDate !== undefined ? { onDate: payload.onDate } : {}), ...(payload.period !== undefined ? { period: payload.period } : {}) };
          businessManifest = buildBusinessContext(store, ctx, request, s.businessContextHooks);
          result = renderBusinessAnswer(store, ctx, businessManifest, { claimIds: businessManifest.claims.map(claim => claim.id), unknownCategories: businessManifest.unknownCategories }, s.businessContextHooks);
        } else { const { question, purpose: ignoredPurpose, routeId, previewId, approvalId, ...filters } = payload; result = await s.calculator.ask(ctx, payload.question, filters); }
        return (await internals.retainConversationAnswer(ctx, payload.question, result, businessManifest, modelReceiptId)).answer;
      }
      case 'conversation.synthesis.preview': {
        const input = internals.journalPayload(payload, ['id', 'routeId'], ['id'], 'INVALID_SYNTHESIS');
        check(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 200, 'INVALID_SYNTHESIS', 'Choose one current retained tool turn.');
        s.synthesisHost.codec();
        const authority = s.synthesisHost.resolve(ctx, input.id);
        const planner = s.gateway.assertConversationReceipt(ctx, authority.binding.plannerModelReceiptId);
        check(input.routeId === undefined || input.routeId === planner.routeId, 'SYNTHESIS_ROUTE_CHANGED', 'Use the exact reviewed planning route for this final answer.');
        return s.gateway.preview(ctx, { question: authority.summary.question, purpose: 'conversation-synthesis',
          questionDisclosure: 'verbatim', toolTurnId: authority.binding.toolTurnId, routeId: planner.routeId });
      }
      case 'conversation.synthesis.run': {
        const input = internals.journalPayload(payload, ['id', 'previewId', 'approvalId'], ['id', 'previewId', 'approvalId'], 'INVALID_SYNTHESIS');
        check([input.id, input.previewId, input.approvalId].every(value => typeof value === 'string' && value.length > 0 && value.length <= 200),
          'INVALID_SYNTHESIS', 'Choose the exact tool turn, reviewed preview and one-use approval.');
        const result = await s.gateway.execute(ctx, { purpose: 'conversation-synthesis', toolTurnId: input.id,
          previewId: input.previewId, approvalId: input.approvalId });
        check(result.kind === 'conversation-synthesis', 'PREVIEW_REQUEST_CHANGED', 'Use a separately reviewed final-answer preview.');
        return s.synthesisHost.retain(ctx, result.receipt.id);
      }
      case 'conversation.history': return s.conversationHistory.list(ctx, payload);
      case 'conversation.continuation': {
        const input = internals.journalPayload(payload, ['id'], ['id'], 'INVALID_HISTORY_REFERENCE');
        check(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 200, 'INVALID_HISTORY_REFERENCE', 'Choose one saved clarification.');
        return engine.conversationContinuation(ctx, input.id);
      }
      case 'conversation.get': {
        const input = internals.journalPayload(payload, ['id'], ['id'], 'INVALID_HISTORY_REFERENCE');
        return s.conversationHistory.get(ctx, input.id);
      }
      case 'business.context.receipt': {
        check(typeof payload.id === 'string', 'INVALID_REFERENCE', 'Choose a saved business context receipt.');
        const saved = store.read().conversations.find(item => item.kind === 'business-context-answer' && item.id === payload.id);
        check(saved && saved.memberId === ctx.memberId && saved.epoch === ctx.epoch, 'RECEIPT_NOT_FOUND', 'This business context receipt is unavailable to the current account.');
        assertBusinessContextCurrent(store, ctx, saved.manifest, s.businessContextHooks);
        return s.conversationHistory.get(ctx, payload.id).answer;
      }
      case 'business.profile.record': {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_PROFILE_REQUIRED', 'Record explicit business descriptions inside the app.');
        return s.businessProfile.record(ctx, payload);
      }
      case 'business.profile.history': return s.businessProfile.history(ctx, payload.field);
      case 'business.profile.remove': {
        check(ctx.channel === 'desktop' && !ctx.sourceTainted, 'APP_PROFILE_REQUIRED', 'Remove business descriptions inside the app.');
        const result = await s.businessProfile.remove(ctx, payload.id); const removed = await internals.purgeManagedCopies(); return { ...result, copiesRemoved: removed };
      }
      case 'calculation.run': return s.calculator.calculate(ctx, payload);
      case 'answers.recovery.review': {
        const input = internals.journalPayload(payload, ['answerId'], ['answerId'], 'INVALID_ANSWER_RECOVERY');
        const resolved = internals.answerRecoveryEvidence(ctx, input.answerId, store);
        return { ...explainAnswerRecovery(resolved.evidence), originalRequest: resolved.evidence.answer.request,
          reviewedEvidencePin: resolved.evidencePin, dictionary: resolved.dictionary,
          retrospectivePromotion: 'still-blocked-by-preserved-unpinned-original' };
      }
      case 'answers.recovery.prepare': {
        const input = internals.journalPayload(payload, ['answerId', 'source', 'reviewedEvidencePin', 'timeScope', 'confirmedNewCalculation'],
          ['answerId', 'source', 'reviewedEvidencePin', 'timeScope', 'confirmedNewCalculation'], 'INVALID_ANSWER_RECOVERY');
        check(typeof input.reviewedEvidencePin === 'string' && DIGEST_PATTERN.test(input.reviewedEvidencePin),
          'INVALID_ANSWER_RECOVERY', 'Review the exact current source evidence before preparing a fresh calculation.');
        const id = await store.update(state => {
          const view = internals.answerRecoveryView(state), resolved = internals.answerRecoveryEvidence(ctx, input.answerId, view);
          check(input.reviewedEvidencePin === resolved.evidencePin, 'ANSWER_RECOVERY_EVIDENCE_CHANGED', 'Current evidence or access changed after review. Review again.');
          const newRequestId = newId('answer_recovery');
          const preparation = prepareAnswerRecovery(resolved.evidence, { version: 1, newRequestId,
            source: input.source as AnswerRecoverySource, timeScope: input.timeScope as AnswerRecoveryTimeScope,
            confirmedNewCalculation: input.confirmedNewCalculation as true });
          internals.answerRecoveryCalculator(view).consumerGuard?.(ctx, structuredClone(preparation.request));
          const record: Omit<AnswerRecoveryRecord, 'integrity'> = { id: newRequestId, type: 'answer-recovery-request-v1',
            workspaceId: state.workspace.id, memberId: ctx.memberId, epoch: ctx.epoch, at: now(), preparation,
            evidencePin: resolved.evidencePin, dictionary: resolved.dictionary, status: 'prepared' };
          state.answers.push({ ...record, integrity: internals.recordIntegrity(record) });
          audit(state, 'answer-recovery.prepared', { newRequestId, originalAnswerId: preparation.source.originalAnswerId,
            preparationDigest: preparation.digest });
          return newRequestId;
        });
        return internals.answerRecoveryRead(ctx, id);
      }
      case 'answers.recovery.get': {
        const input = internals.journalPayload(payload, ['newRequestId'], ['newRequestId'], 'INVALID_ANSWER_RECOVERY');
        return internals.answerRecoveryRead(ctx, input.newRequestId);
      }
      case 'answers.recovery.list': {
        const input = internals.journalPayload(payload, ['answerId'], ['answerId'], 'INVALID_ANSWER_RECOVERY');
        internals.answerRecoveryEvidence(ctx, input.answerId, store);
        return { items: store.read().answers.filter(record => record.type === 'answer-recovery-request-v1'
          && record.preparation?.source.originalAnswerId === input.answerId && record.memberId === ctx.memberId && record.epoch === ctx.epoch)
          .map(record => {
            try { return internals.answerRecoveryRead(ctx, record.id); }
            catch (error) {
              if (!(error instanceof ChausarError)) throw error;
              return { newRequestId: record.id, status: 'unavailable', code: error.code, message: error.message,
                historicalReplay: false, grantsAuthority: false };
            }
          }) };
      }
      case 'answers.recovery.execute': {
        const input = internals.journalPayload(payload, ['newRequestId', 'preparationDigest'], ['newRequestId', 'preparationDigest'], 'INVALID_ANSWER_RECOVERY');
        return internals.executeAnswerRecovery(ctx, input.newRequestId, input.preparationDigest);
      }
      case 'forecasts.evaluate': return s.forecasts.evaluate(ctx, payload);
      case 'forecasts.get': {
        const input = internals.journalPayload(payload, ['id'], ['id'], 'INVALID_FORECAST');
        check(typeof input.id === 'string' && input.id.length > 0 && input.id.length <= 200, 'INVALID_FORECAST', 'Choose one saved forecast evaluation.');
        return s.forecasts.get(ctx, input.id);
      }
      case 'alerts.create': return s.alerts.create(ctx, payload);
      case 'alerts.list': internals.journalPayload(payload, [], [], 'INVALID_ALERT'); return s.alerts.list(ctx);
      case 'alerts.get': {
        const input = internals.journalPayload(payload, ['id'], ['id'], 'INVALID_ALERT'); return s.alerts.get(ctx, input.id);
      }
      case 'alerts.publish': {
        const input = internals.journalPayload(payload, ['id', 'expectedRevision'], ['id', 'expectedRevision'], 'INVALID_ALERT');
        const { id, ...update } = input; return s.alerts.publish(ctx, id, update);
      }
      case 'alerts.evaluate': {
        const input = internals.journalPayload(payload, ['id', 'expectedRevision', 'observationId', 'observedAt', 'receiptId', 'missingReason', 'correction'], ['id', 'expectedRevision', 'observationId', 'observedAt'], 'INVALID_ALERT');
        const { id, ...update } = input; return s.alerts.evaluate(ctx, id, update);
      }
      case 'analysis.bridge.publish': return s.bridge.publish(ctx, payload);
      case 'analysis.bridge.profiles': internals.journalPayload(payload, [], [], 'BRIDGE_PROFILE_INVALID'); return s.bridge.profiles(ctx);
      case 'analysis.bridge.run': return s.bridge.run(ctx, payload);
      case 'analysis.bridge.get': {
        const input = internals.journalPayload(payload, ['id'], ['id'], 'BRIDGE_REFERENCE_INVALID'); return s.bridge.get(ctx, input);
      }
      case 'investigations.create': return s.investigations.create(ctx, payload);
      case 'investigations.list': internals.journalPayload(payload, [], [], 'INVALID_INVESTIGATION'); return s.investigations.list(ctx);
      case 'investigations.get':
      case 'investigations.capsule': {
        const input = internals.journalPayload(payload, ['id'], ['id'], 'INVALID_INVESTIGATION');
        return method === 'investigations.get' ? s.investigations.get(ctx, input.id) : s.investigations.capsule(ctx, input.id);
      }
      case 'investigations.advance':
      case 'investigations.resume':
      case 'investigations.cancel':
      case 'investigations.pause':
      case 'investigations.revise': {
        const keys = method === 'investigations.revise' ? ['id', 'expectedRevision', 'reason', 'objective', 'hypotheses', 'budget']
          : method === 'investigations.pause' ? ['id', 'expectedRevision', 'reason'] : ['id', 'expectedRevision'];
        const required = ['id', 'expectedRevision', ...(['investigations.pause', 'investigations.revise'].includes(method) ? ['reason'] : [])];
        const input = internals.journalPayload(payload, keys, required, 'INVALID_INVESTIGATION');
        const { id, ...update } = input; return s.investigations[method.slice('investigations.'.length)](ctx, id, update);
      }
      case 'investigations.drilldown': {
        const input = internals.journalPayload(payload, ['id', 'receiptId', 'offset', 'limit'], ['id', 'receiptId', 'offset', 'limit'], 'INVALID_INVESTIGATION');
        const { id, ...page } = input; return s.investigations.drilldown(ctx, id, page);
      }
      case 'research.search': return s.research.search(ctx, payload);
      case 'receipts.get': return s.calculator.receipt(ctx, payload.id);
      case 'sources.list': return internals.visibleImports();
      case 'sources.delete': { const result = await s.trust.deleteSource(ctx, payload.id); const removed = await internals.purgeManagedCopies(); return { ...result, copiesRemoved: removed, externalCopies: 'Copies made outside this app must be removed by their owner.' }; }
      case 'sources.preview': return s.imports.preview(ctx, payload);
      case 'sources.import': return s.imports.commit(ctx, payload);
      case 'sources.catalogue': return s.connectors.catalogue(ctx);
      case 'sources.groups': return s.connectors.groups(ctx);
      case 'connectors.profiles':
      case 'connectors.read':
      case 'connectors.reviewMapping':
      case 'connectors.capture':
      case 'connectors.publish':
      case 'connectors.ready':
      case 'connectors.captureStatus':
      case 'connectors.releaseRead': return s.connectorRuntime.request(ctx, method, payload);
      case 'sources.fetch': return s.connectors.fetch(ctx, payload);
      case 'sources.recipe': return s.connectors.proposeRecipe(ctx, payload);
      case 'sources.accept': return s.connectors.acceptRecipe(ctx, payload);
      case 'sources.workbook': return readWorkbook(internals.workbookBytes(payload), { sheet: payload.sheet });
      case 'sources.workbookPreview': return s.imports.preview(ctx, internals.workbookInput(payload));
      case 'sources.workbookImport': return s.imports.commit(ctx, internals.workbookInput(payload));
      case 'ontology.packs': return s.ontology.packs();
      case 'ontology.get': return { current: s.ontology.current(ctx), history: s.ontology.history(ctx) };
      case 'ontology.publish': return s.ontology.publish(ctx, payload.draft ?? payload.pack ?? payload);
      case 'memory.list': return s.memory.query(ctx, payload);
      case 'memory.correct': return s.memory.correct(ctx, payload.id, payload.fields);
      case 'memory.merge': return s.memory.merge(ctx, payload.entityIds, payload.targetId);
      case 'memory.undo': return s.memory.undoMerge(ctx, payload.id);
      case 'memory.precedence': return s.memory.setSourcePrecedence(ctx, payload.kind, payload.sourceIds);
      case 'decisions.list': return s.reports.decisions(ctx);
      case 'decisions.create': return s.reports.decision(ctx, payload);
      case 'decisions.review': { const { id, ...review } = payload; return s.reports.reviewDecision(ctx, id, review); }
      case 'decisions.journal.draft': {
        internals.journalWriter(ctx);
        const input = internals.journalPayload(payload, ['content'], ['content'], 'INVALID_DECISION');
        return s.reports.draftDecision(ctx, input.content);
      }
      case 'decisions.journal.confirm': {
        internals.journalWriter(ctx);
        const input = internals.journalPayload(payload, ['draft', 'reviewedDigest'], ['draft', 'reviewedDigest'], 'INVALID_CONFIRMATION');
        check(typeof input.reviewedDigest === 'string' && input.reviewedDigest.trim().length > 0, 'INVALID_CONFIRMATION', 'This draft changed since you looked. Look at it again before confirming.');
        const draft = internals.journalPayload(input.draft, ['kind', 'content', 'receipts', 'digest'], ['kind', 'content', 'receipts', 'digest'], 'INVALID_DRAFT');
        check(draft.kind === 'journal-draft' && Array.isArray(draft.receipts) && typeof draft.digest === 'string', 'INVALID_DRAFT', 'Confirm a prepared journal draft.');
        return s.reports.confirmDecision(ctx, input.draft, { reviewedDigest: input.reviewedDigest });
      }
      case 'decisions.journal.revise': {
        internals.journalWriter(ctx);
        const input = internals.journalPayload(payload, ['id', 'content', 'expectedRevision', 'reason'], ['id', 'content', 'expectedRevision', 'reason'], 'INVALID_REVISION');
        check(typeof input.id === 'string' && input.id.trim().length > 0 && typeof input.reason === 'string' && input.reason.trim().length > 0, 'INVALID_REVISION', 'Identify the journal and explain the revision.');
        internals.journalRevision(input.expectedRevision);
        return s.reports.reviseDecision(ctx, input.id, input.content, { expectedRevision: input.expectedRevision, reason: input.reason });
      }
      case 'decisions.journal.review': {
        internals.journalWriter(ctx);
        const input = internals.journalPayload(payload, ['id', 'review', 'expectedRevision'], ['id', 'review', 'expectedRevision'], 'INVALID_REVIEW');
        check(typeof input.id === 'string' && input.id.trim().length > 0, 'INVALID_REVIEW', 'Identify the journal being reviewed.');
        internals.journalRevision(input.expectedRevision);
        const review = internals.journalPayload(input.review, ['outcome', 'notes', 'observation', 'nextReviewDate'], ['outcome', 'observation'], 'INVALID_REVIEW');
        internals.journalPayload(review.observation, ['state', 'measurements', 'notes', 'uncertainty', 'concurrentInterventions', 'executionReceiptIds'], ['state', 'measurements', 'notes', 'uncertainty', 'concurrentInterventions', 'executionReceiptIds'], 'INVALID_REVIEW');
        return s.reports.reviewJournalDecision(ctx, input.id, input.review, { expectedRevision: input.expectedRevision });
      }
      case 'decisions.journal.due': {
        const input = internals.journalPayload(payload, ['dueOn', 'branch'], [], 'INVALID_FILTER');
        check(input.branch === undefined || (typeof input.branch === 'string' && input.branch.trim().length > 0), 'INVALID_FILTER', 'A branch filter must be nonblank.');
        return s.reports.dueDecisions(ctx, input);
      }
      case 'reports.get': { const { type, ...filters } = payload; return s.reports.report(ctx, type ?? 'investor', filters); }
      case 'reports.brief': return s.reports.brief(ctx, payload);
      case 'reports.forecast': return s.reports.forecast(ctx, { receiptIds: payload.receiptIds });
      case 'actions.list': return s.actions.list(ctx);
      case 'actions.catalogue': return s.actions.catalogue(ctx);
      case 'actions.prepare': return s.actions.prepare(ctx, { ...payload, connector: payload.connector ?? 'local', operation: payload.operation ?? 'reminder-draft', idempotencyKey: payload.idempotencyKey ?? newId('effect') });
      case 'actions.approve': return s.actions.approve(ctx, payload.id, payload.digest);
      case 'actions.revise': return s.actions.revise(ctx, payload.id, payload.payload);
      case 'actions.execute': return s.actions.execute(ctx, payload.id);
      case 'actions.reconcile': return s.actions.reconcile(ctx, payload.id);
      case 'jobs.list': return s.jobs.list(ctx);
      case 'jobs.types': return { types: ['owner-brief', ...(s.jobRunner ? [...s.jobRunner.runners.keys()] : [])], configured: !!s.jobRunner, policy: engine.options.durableJobs ? { maxActiveJobs: engine.options.durableJobs.maxActiveJobs, leaseMs: engine.options.durableJobs.leaseMs } : null, calendar: engine.options.jobCalendar ? { configured: true, rulesRevision: engine.options.jobCalendar.rules.revision, minYear: engine.options.jobCalendar.rules.minYear, maxYear: engine.options.jobCalendar.rules.maxYear, bounds: { ...engine.options.jobCalendar.bounds } } : { configured: false }, localOnly: true, externalEffects: 'prepare-only', lifecycle: { ...internals.jobLifecycle } };
      case 'jobs.create': {
        if (payload.type === 'owner-brief') {
          check(!Object.hasOwn(payload, 'calendar'), 'CALENDAR_RUNNER_REQUIRED', 'Calendar schedules require an installed typed goal runner.');
          return internals.createBriefJob(ctx, payload);
        }
        check(['calculation-set', 'evidence-review', 'action-preparation', 'private-investigation'].includes(payload.type), 'JOB_TYPE_UNSUPPORTED', 'Choose an installed goal type explicitly.');
        return internals.jobRunner().create(ctx, payload);
      }
      case 'jobs.amend': return internals.jobRunner().amend(ctx, payload.id, payload.config);
      case 'jobs.calendar.preview': {
        const job = s.jobs.find(store.read(), payload.id); s.jobs.owner(store.read(), ctx, job);
        check(job.plan, 'CALENDAR_RUNNER_REQUIRED', 'Calendar schedules require an installed typed goal runner.');
        internals.jobRunner().runner(job.type);
        return s.jobs.calendarEvaluation(job);
      }
      case 'jobs.calendar.configure': {
        const job = s.jobs.find(store.read(), payload.id); s.jobs.owner(store.read(), ctx, job);
        check(job.plan, 'CALENDAR_RUNNER_REQUIRED', 'Calendar schedules require an installed typed goal runner.');
        internals.jobRunner().runner(job.type);
        return s.jobs.configureCalendar(ctx, payload.id, payload.definition,
          payload.expectedScheduleRevision, payload.expectedObjectiveRevision, payload.replacement);
      }
      case 'jobs.calendar.pause': return s.jobs.pauseCalendar(ctx, payload.id);
      case 'jobs.calendar.resume': return s.jobs.resumeCalendar(ctx, payload.id);
      case 'jobs.cancel': return internals.typedJob(payload.id) ? internals.jobRunner().cancel(ctx, payload.id) : s.jobs.cancel(ctx, payload.id);
      case 'jobs.reconcile': return internals.jobRunner().reconcile(ctx, payload.id);
      case 'jobs.progress': return internals.jobRunner().progress(ctx, payload.id);
      case 'jobs.pause': return s.jobs.pause(ctx, payload.id);
      case 'jobs.resume': return s.jobs.resume(ctx, payload.id);
      case 'jobs.accept': {
        const job = s.jobs.find(store.read(), payload.id); s.jobs.owner(store.read(), ctx, job);
        if (job.plan) check(internals.jobRunner().canRelease(ctx, job), 'JOB_EVIDENCE_REVOKED', 'Review currently accessible evidence before accepting this result.');
        return s.jobs.accept(ctx, payload.id, payload.repeat === true);
      }
      case 'jobs.approve': return s.jobs.approve(ctx, payload.id, payload.digest);
      case 'jobs.reject': return s.jobs.reject(ctx, payload.id, payload.reason);
      case 'jobs.run': return internals.runJob(payload.id);
      case 'trust.get': return { ...store.read().policy, policy: store.read().policy, members: ['owner', 'cofounder'].includes(ctx.role) ? store.read().members : [] };
      case 'members.list': authorize(store, ctx, 'admin'); return store.read().members;
      case 'members.add': return s.trust.addMember(ctx, payload);
      case 'members.revoke': return s.trust.revokeMember(ctx, payload.id);
      case 'models.list': return s.gateway.listRoutes(ctx);
      case 'models.configure': return s.gateway.configureRoute(ctx, payload.config ?? payload, payload.secret);
      case 'models.preview': return s.gateway.preview(ctx, payload);
      case 'models.approve': return s.gateway.approveOutbound(ctx, payload.id);
      case 'models.test': return s.gateway.execute(ctx, { question: 'What was billed?', ...payload });
      case 'speech.list': return s.speech.providers(ctx);
      case 'speech.configure': return s.speech.configure(ctx, payload.config ?? payload, payload.secret);
      case 'speech.preview': return s.speech.preview(ctx, payload);
      case 'speech.approve': return s.speech.approve(ctx, payload.id);
      case 'speech.transcribe': return s.speech.transcribe(ctx, payload);
      case 'activity.list': authorize(store, ctx, 'admin'); return { items: internals.visibleActivity(ctx).slice(-200).reverse(), modelReceipts: s.gateway.receipts(ctx) };
      case 'learning.list': return s.learning.list(ctx);
      case 'learning.log': return s.learning.recordDecision(ctx, payload);
      case 'learning.preview': return s.learning.preview(ctx, payload.ids ?? store.read().learning.filter(item => item.type === 'decision').map(item => item.id));
      case 'learning.consent': return s.learning.consent(ctx, payload.id ?? payload.previewId, payload.digest);
      case 'learning.sharing': return s.learning.setSharing(ctx, payload.enabled === true);
      case 'learning.share': return s.learning.share(ctx, payload.id);
      case 'plugins.list': return s.plugins.list(ctx);
      case 'plugins.install': return s.plugins.install(ctx, { manifest: payload.manifest, moduleBase64: payload.moduleBase64 ?? payload.code });
      case 'plugins.enable': return s.plugins.enable(ctx, payload.id, payload.digest);
      case 'plugins.disable': return s.plugins.disable(ctx, payload.id);
      case 'plugins.remove': return s.plugins.remove(ctx, payload.id);
      case 'plugins.run': return s.plugins.run(ctx, payload.id);
      case 'plugins.miniapp': return s.plugins.miniappDescriptor(ctx, payload);
      case 'mcp.info': return { name: 'Chausar verified numbers', endpoint: '/mcp', readOnly: true, availableTools: s.ontology.current(ctx)?.operations ?? [] };
      case 'mcp.handle': return s.mcp.handle(ctx, payload);
      case 'helpers.run': {
        authorize(store, ctx, 'admin'); check(!ctx.sourceTainted, 'TAINTED_HELPER', 'Only an explicit app request can run an analytical helper.');
        const result = await s.helper.run(payload.operation, payload.input); authorize(store, ctx, 'admin');
        return { ...result, qualification: 'analytical-preview', financialReceipt: false, requiresHumanReview: true };
      }
    default: throw new Error(`Unknown request: ${method}`);
  }
}
