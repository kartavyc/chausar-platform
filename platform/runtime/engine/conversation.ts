

import { join } from 'node:path';

import type { IncomingMessage, ServerResponse } from 'node:http';
import { Vault } from '../vault.ts';

import { assertSourceAccess } from '../trust.ts';
import { ModelGateway } from '../gateway.ts';

import { ConversationHistoryService, createCalculationAnswerRecord, conversationRecordIntegrity } from '../conversation-history.ts';

import { assertBusinessContextCurrent, renderBusinessAnswer, type BusinessContextManifest } from '../conversation-context.ts';

import { PhoneSessionService } from '../engine-phone-sessions.ts';
import { EnginePhoneRuntime } from '../engine-phone-runtime.ts';
import { createPhoneHttpHandler } from '../phone/host.ts';
import { requirePhone } from '../phone/contracts.ts';

import type { Brief, ChatAnswer } from '../phone/contracts.ts';

import { digest } from '../actions.ts';
import { JobService } from '../jobs.ts';

import { authorize, check, ChausarError, hash, newId, now, type Context, type StateStore } from '../contracts.ts';

import { type ConversationContinuation } from './shared.ts';
import type { EngineInternals } from './internals.ts';

export function conversationContinuation(internals: EngineInternals, ctx: Context, id: string, view: StateStore = internals.store(), resolvedByModelReceiptId?: string): ConversationContinuation {
    authorize(view, ctx);
    const state = view.read(), records = state.conversations.filter(record => record?.id === id), record = records[0];
    const unavailable = 'CONVERSATION_CONTINUATION_UNAVAILABLE';
    check(typeof id === 'string' && records.length === 1 && record?.kind === 'conversation-clarification-answer'
      && record.memberId === ctx.memberId && record.epoch === ctx.epoch && record.integrity === conversationRecordIntegrity(record), unavailable, 'This pending clarification is unavailable.');
    check(typeof record.question === 'string' && record.question.trim().length > 0 && record.question.length <= 8000
      && Number.isFinite(Date.parse(record.at)) && Number.isFinite(state.policy.retentionDays) && state.policy.retentionDays >= 0
      && Date.parse(record.at) >= Date.now() - state.policy.retentionDays * 86400000, unavailable, 'This pending clarification is unavailable.');
    const model = internals.services.gateway.assertConversationReceipt(ctx, record.modelReceiptId, view);
    const models = state.modelReceipts.filter(item => item?.id === record.modelReceiptId);
    check(models.length === 1 && hash(models[0]) === hash(model), unavailable, 'This pending clarification is unavailable.');
    check(model.naturalQuestion === record.question && model.plan?.kind === 'clarification' && model.businessContext?.request
      && hash(model.sourceIds) === hash([...(model.reviewedCalculationParameters !== undefined
        ? model.businessContext.request.sourceIds ?? model.businessContext.sourceIds : model.businessContext.sourceIds)].sort())
      && model.businessContext.sourceIds.every((sourceId: string) => model.sourceIds.includes(sourceId)), unavailable, 'This pending clarification is unavailable.');
    const expected = { clarification: model.plan.clarification, modelReceiptId: model.id };
    check(hash(record.answer) === hash(expected), unavailable, 'This pending clarification is unavailable.');
    const rowIds = [...new Set<string>([...(model.factIds ?? []), ...(model.rowIds ?? [])])].sort();
    const sourceIds = [...new Set<string>([...(model.sourceIds ?? []),
      ...rowIds.map(rowId => state.facts.find(fact => fact.id === rowId)?.sourceId).filter((value): value is string => typeof value === 'string')])].sort();
    check(hash(record.rowIds) === hash(rowIds) && hash(record.sourceIds) === hash(sourceIds), unavailable, 'This pending clarification is unavailable.');
    assertSourceAccess(state, ctx, sourceIds);
    const resolutions = state.conversations.filter(item => item?.kind === 'conversation-continuation-resolved' && item.continuationId === id);
    if (resolutions.length) {
      const resolution = resolutions[0], answers = state.conversations.filter(item => item?.id === resolution.answerId), answer = answers[0];
      check(resolutions.length === 1 && resolution.memberId === ctx.memberId && resolution.epoch === ctx.epoch && resolution.integrity === conversationRecordIntegrity(resolution)
        && answers.length === 1 && answer.memberId === ctx.memberId && answer.epoch === ctx.epoch && answer.modelReceiptId === resolution.modelReceiptId
        && answer.integrity === conversationRecordIntegrity(answer), unavailable, 'This clarification has already been continued.');
      check(resolvedByModelReceiptId !== undefined, 'CONVERSATION_CONTINUATION_RESOLVED', 'This clarification has already been answered. Start a new question.');
      check(typeof resolvedByModelReceiptId === 'string' && resolution.modelReceiptId === resolvedByModelReceiptId, unavailable, 'This clarification has already been continued by a different turn.');
    }
    // Preserve selected zero-row sources separately from observed fact lineage.
    const selectedSourceIds = [...(model.businessContext.request.sourceIds ?? model.sourceIds)].sort();
    assertSourceAccess(state, ctx, selectedSourceIds);
    const prior = model.continuation, exchanges = [...(prior?.exchanges ?? (prior ? [{ question: prior.originalQuestion, clarification: prior.clarification }] : [])),
      { question: record.question, clarification: model.plan.clarification }];
    check(exchanges.length <= 8, 'CONVERSATION_CONTINUATION_LIMIT', 'This clarification chain is full. Start a new question.');
    const body = { schemaVersion: 1 as const, turnId: id, originalQuestion: prior?.originalQuestion ?? record.question, clarification: model.plan.clarification,
      exchanges, sourceIds: selectedSourceIds, requestScope: structuredClone(model.businessContext.request),
      ...(model.reviewedCalculationParameters !== undefined ? { reviewedCalculationParameters: structuredClone(model.reviewedCalculationParameters) } : {}) };
    check(Buffer.byteLength(JSON.stringify(body)) <= 65536, 'CONVERSATION_CONTINUATION_LIMIT', 'This clarification context is too long. Start a new question.');
    return { ...body, digest: hash(body) };
  }

export function resolveContinuationTurn(internals: EngineInternals, ctx: Context, model: any, answerId: string, state: ReturnType<StateStore['read']>): void {
    if (model.continuationId === undefined) return;
    const store = internals.store(), view = { read: () => state, update: store.update.bind(store) };
    // The resulting answer and consumption marker commit together. Failure leaves the objective pending.
    const continuation = internals.conversationContinuation(ctx, model.continuationId, view);
    check(continuation.digest === model.continuationDigest && hash(continuation) === hash(model.continuation),
      'CONVERSATION_CONTINUATION_UNAVAILABLE', 'The pending objective changed before this turn could be retained.');
    const answer = state.conversations.find(item => item?.id === answerId);
    check(answer && answer.modelReceiptId === model.id && answer.memberId === ctx.memberId && answer.epoch === ctx.epoch,
      'CONVERSATION_CONTINUATION_UNAVAILABLE', 'Retain the resulting turn before resolving its clarification.');
    const record = { id: newId('conversation_resolution'), kind: 'conversation-continuation-resolved', at: now(), memberId: ctx.memberId, epoch: ctx.epoch,
      continuationId: model.continuationId, answerId, modelReceiptId: model.id,
      sourceIds: [...new Set<string>([...continuation.sourceIds, ...answer.sourceIds])].sort(), rowIds: [...answer.rowIds] };
    state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) });
  }

export async function retainConversationAnswer(internals: EngineInternals, ctx: Context, question: string, answer: any, manifest?: BusinessContextManifest, modelReceiptId?: string): Promise<{ answer: any; record: any; }> {
    const store = internals.store(), s = internals.services;
    let result = answer;
    if (manifest) {
      const id = newId('business_answer');
      result = { ...result, id, receipt: { id, kind: 'business-context-receipt', contextDigest: manifest.digest, financialCalculation: false,
        sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, ...(modelReceiptId ? { modelReceiptId } : {}) } };
    }
    const record = await store.update(state => {
      const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx);
      let saved: any;
      if (manifest) {
        assertBusinessContextCurrent(view, ctx, manifest, s.businessContextHooks);
        const body = { id: result.id, kind: 'business-context-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question,
          manifest, answer: structuredClone(result), sourceIds: manifest.sourceIds, rowIds: manifest.rowIds, profileIds: manifest.profileIds };
        saved = { ...body, integrity: conversationRecordIntegrity(body) };
      } else {
        const receiptId = result.receipt?.id ?? (result.figures ? result.id : undefined);
        saved = receiptId ? createCalculationAnswerRecord(ctx, question, result, s.conversationHistory.currentReceipt(ctx, receiptId, view))
          : { id: newId('message'), at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question, role: 'user' };
      }
      state.conversations.push(saved); return structuredClone(saved);
    });
    return { answer: result, record };
  }

export async function executeConversationPlan(internals: EngineInternals, ctx: Context, request: any, gateway: Extract<Awaited<ReturnType<ModelGateway['execute']>>, { kind: 'conversation' }>): Promise<{ clarification: string; modelReceiptId: any; } | { id: `${string}_${string}-${string}-${string}-${string}-${string}`; kind: string; results: any[]; modelReceiptId: any; receipt: { id: `${string}_${string}-${string}-${string}-${string}-${string}`; kind: string; modelReceiptId: any; resultRefs: { tool: string; answerId: string; }[]; }; }> {
    const s = internals.services, store = internals.store();
    const model = s.gateway.assertConversationReceipt(ctx, gateway.receipt.id);
    if (gateway.plan.kind === 'clarification') {
      const id = newId('conversation_clarification');
      const answer = { clarification: gateway.plan.clarification, modelReceiptId: model.id };
      await store.update(state => {
        const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx);
        const current = s.gateway.assertConversationReceipt(ctx, model.id, view);
        check(current.plan.kind === 'clarification' && current.plan.clarification === answer.clarification, 'PAYLOAD_CHANGED', 'The admitted clarification changed.');
        const rowIds = [...new Set<string>([...(current.factIds ?? []), ...(current.rowIds ?? [])])].sort();
        const sourceIds = [...new Set<string>([...(current.sourceIds ?? []),
          ...rowIds.map(rowId => state.facts.find(fact => fact.id === rowId)?.sourceId).filter((value): value is string => typeof value === 'string')])].sort();
        const record = { id, kind: 'conversation-clarification-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question: request.question,
          answer, modelReceiptId: current.id, sourceIds, rowIds };
        state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) });
        internals.resolveContinuationTurn(ctx, current, id, state);
      });
      return answer;
    }
    const results: any[] = [], children: any[] = [], resultRefs: { tool: string; answerId: string }[] = [];
    for (const call of gateway.plan.calls) {
      s.gateway.assertConversationReceipt(ctx, model.id);
      try {
        let answer: any, manifest: BusinessContextManifest | undefined;
        if (call.tool === 'business.describe') {
          manifest = model.businessContext;
          answer = renderBusinessAnswer(store, ctx, manifest!, call.args, s.businessContextHooks);
        } else {
          // Source admission precedes version/conflict resolution and arithmetic.
          // Empty reviewed scopes stay empty; they never mean "all visible".
          check(model.businessContext?.request
            && hash(model.sourceIds) === hash([...(model.reviewedCalculationParameters !== undefined
              ? model.businessContext.request.sourceIds ?? model.businessContext.sourceIds : model.businessContext.sourceIds)].sort())
            && model.businessContext.sourceIds.every((sourceId: string) => model.sourceIds.includes(sourceId)),
            'TOOL_SCOPE_CHANGED', 'The calculation source scope no longer matches the exact reviewed source admission.');
          const scope = model.businessContext.request, args: any = { ...call.args, sourceIds: [...(model.businessContext.request.sourceIds ?? model.sourceIds)] };
          for (const key of ['period', 'branch'] as const) if (scope[key] !== undefined) {
            check(args[key] === undefined || hash(args[key]) === hash(scope[key]), 'TOOL_SCOPE_CHANGED', 'The calculation must use the exact reviewed scope.'); args[key] = scope[key];
          }
          // Comparison periods and scenario assumptions come only from the admitted
          // planner arguments, already validated against the exact owner review.
          for (const key of ['comparePeriod', 'assumptions'] as const) if (args[key] !== undefined)
            check(model.reviewedCalculationParameters?.[key] !== undefined && hash(args[key]) === hash(model.reviewedCalculationParameters[key]),
              'TOOL_SCOPE_CHANGED', 'The calculation inputs differ from the exact reviewed owner parameters.');
          for (const key of ['asOf', 'onDate'] as const) if (scope[key] !== undefined) args[key] = scope[key];
          answer = await s.calculator.calculate(ctx, args);
          check(answer.sourceIds.every((id: string) => model.sourceIds.includes(id)) && answer.rowIds.every((id: string) => model.factIds.includes(id)),
            'TOOL_SCOPE_CHANGED', 'The calculation used evidence outside the reviewed source scope.');
        }
        s.gateway.assertConversationReceipt(ctx, model.id);
        const saved = await internals.retainConversationAnswer(ctx, request.question, answer, manifest, model.id);
        results.push({ tool: call.tool, answer: saved.answer }); children.push(saved.record); resultRefs.push({ tool: call.tool, answerId: saved.record.id });
      } catch (error) {
        if (!(error instanceof ChausarError)) throw error;
        results.push({ tool: call.tool, error: { code: error.code, message: error.message.slice(0, 512) } });
      }
      // A scope, grant, route or privacy change withholds the whole response, including earlier results.
      s.gateway.assertConversationReceipt(ctx, model.id);
    }
    const id = newId('conversation_tools');
    const answer = { id, kind: 'grounded-conversation', results, modelReceiptId: model.id,
      receipt: { id, kind: 'conversation-tool-receipt', modelReceiptId: model.id, resultRefs } };
    await store.update(state => {
      const view = { read: () => state, update: store.update.bind(store) }; authorize(view, ctx); s.gateway.assertConversationReceipt(ctx, model.id, view);
      // Readback rechecks each retained child; no recalculation or new provider invocation.
      for (const ref of resultRefs) s.conversationHistory.get(ctx, ref.answerId);
      const rowIds = [...new Set<string>([...(model.factIds ?? []), ...(model.rowIds ?? []), ...children.flatMap(child => child.rowIds ?? [])])].sort();
      const sourceIds = [...new Set<string>([...(model.sourceIds ?? []), ...children.flatMap(child => child.sourceIds ?? []),
        ...rowIds.map(rowId => state.facts.find(fact => fact.id === rowId)?.sourceId).filter((value): value is string => typeof value === 'string')])].sort();
      const record = { id, kind: 'conversation-tools-answer', at: now(), memberId: ctx.memberId, epoch: ctx.epoch, question: request.question,
        answer, resultRefs, modelReceiptId: model.id, sourceIds, rowIds };
      state.conversations.push({ ...record, integrity: conversationRecordIntegrity(record) });
      internals.resolveContinuationTurn(ctx, model, id, state);
    });
    return answer;
  }

export function contextForSession(internals: EngineInternals, token: string, channel: Context['channel'] = 'desktop'): Context { internals.store(); return internals.services.auth.authenticate(token, channel); }

export function companionRuntime(internals: EngineInternals): { store: Vault; sessions: PhoneSessionService; runtime: EnginePhoneRuntime; } {
    check(!internals.privateClosing && !internals.privateTransition, 'VAULT_BUSY', 'The current workspace is not available for companion requests.');
    const store = internals.store();
    if (internals.privateCompanion?.store === store) return internals.privateCompanion;
    const sessions = new PhoneSessionService(store);
    const runtime = new EnginePhoneRuntime(store, sessions, {
      review: (ctx, request, view) => {
        const matches = view.read().modelReceipts.filter(item => item.id === request.previewId);
        requirePhone(matches.length === 1, 'PREVIEW_CHANGED');
        const model = ['dispatching', 'failed'].includes(matches[0].status)
          ? internals.services.gateway.assertDispatchedConversationRequest(ctx, request, view)
          : internals.services.gateway.assertReviewedConversationRequest(ctx, request, view);
        return { sourceIds: [...model.sourceIds], operationVersion: hash({ schemaDigest: model.schemaDigest,
          dictionaryHash: model.publishedCalculations.dictionaryHash, dictionaryVersion: model.publishedCalculations.dictionaryVersion }) };
      },
      executeConversation: (ctx, request) => internals.requestAs(ctx, 'conversation.ask', request),
      reconcileConversation: (ctx, previewId, view) => internals.companionConversation(ctx, previewId, view),
      briefs: (ctx, view) => internals.companionBriefs(ctx, view),
      receipt: (ctx, id, view) => {
        // Reuse the current history boundary, including receipt/fact retention
        // and its actual calculator/managed-source readiness guards on this view.
        const receipt = new ConversationHistoryService(view, internals.services.conversationHistory.options).currentReceipt(ctx, id, view);
        return { id: receipt.id, workspaceId: view.read().workspace.id, text: internals.companionAnswerText(receipt) };
      },
    });
    internals.privateCompanion = { store, sessions, runtime }; return internals.privateCompanion;
  }

export async function handleCompanionHttp(internals: EngineInternals, request: IncomingMessage, response: ServerResponse): Promise<void> {
    check(!internals.privateClosing && !internals.privateTransition, 'VAULT_BUSY', 'Wait for the workspace operation to finish.');
    internals.privateActiveRequests++;
    try { await createPhoneHttpHandler(internals.companionRuntime().runtime.host)(request, response); }
    finally { internals.privateActiveRequests--; internals.notifyIdle(); }
  }

export function companionAnswerText(internals: EngineInternals, answer: any): string {
    const parts: string[] = [];
    if (answer?.kind === 'grounded-conversation') {
      for (const result of answer.results) parts.push(result.error
        ? `Unable to complete this part: ${result.error.message}` : internals.companionAnswerText(result.answer));
    } else {
      const explanation = answer?.text ?? answer?.message ?? answer?.explanation ?? answer?.clarification;
      if (typeof explanation === 'string') parts.push(explanation);
      for (const figure of answer?.figures ?? answer?.receipt?.figures ?? []) parts.push(`${figure.label}: ${figure.display}`);
      for (const gap of answer?.coverage?.gaps ?? []) parts.push(`Coverage: ${gap}`);
    }
    const text = parts.filter(Boolean).join('\n');
    requirePhone(text.length > 0 && text.length <= 64000, 'OPEN_DESKTOP'); return text;
  }

export function companionConversation(internals: EngineInternals, ctx: Context, previewId: string, view: StateStore): ChatAnswer | undefined {
    authorize(view, ctx);
    const records = view.read().conversations.filter(item => ['conversation-tools-answer', 'conversation-clarification-answer'].includes(item.kind)
      && item.modelReceiptId === previewId && item.memberId === ctx.memberId && item.epoch === ctx.epoch);
    if (!records.length) return undefined;
    requirePhone(records.length === 1, 'CACHE_INVALID');
    internals.services.gateway.assertConversationReceipt(ctx, previewId, view);
    const history = new ConversationHistoryService(view, internals.services.conversationHistory.options);
    const saved = history.get(ctx, records[0].id), receiptIds: string[] = [];
    for (const ref of records[0].resultRefs ?? []) {
      const child = history.get(ctx, ref.answerId);
      if (child.kind === 'calculation') {
        const receiptId = child.answer.receipt?.id ?? child.answer.id;
        history.currentReceipt(ctx, receiptId, view); receiptIds.push(receiptId);
      }
    }
    return { conversationId: saved.id, text: internals.companionAnswerText(saved.answer), receiptIds: [...new Set(receiptIds)] };
  }

export function companionBriefs(internals: EngineInternals, ctx: Context, view: StateStore): Brief[] {
    const installed = internals.services.jobs as JobService;
    const jobs = new JobService(view, { clock: installed.clock, deliverableGuard: installed.deliverableGuard,
      calendarRules: installed.calendarRules, calendarBounds: installed.calendarBounds });
    const briefs: Brief[] = [];
    for (const job of jobs.list(ctx)) {
      const deliverable = job.deliverable as any, result = deliverable?.result;
      if (job.type !== 'owner-brief' || job.plan || deliverable?.kind !== 'brief' || !result) continue;
      const parts = (result.report?.sections ?? []).map((section: any) => internals.companionAnswerText(section));
      for (const gap of result.report?.gaps ?? []) parts.push(`Coverage: ${gap}`);
      for (const item of result.alerts?.items ?? []) parts.push(`${item.label}. Last recorded observation: ${item.observation
        ? `${item.observation.state} at ${item.observation.observedAt}` : 'not observed'}. Retained episodes: ${item.episodes
        .map((episode: any) => `${episode.status} (${episode.severity}${episode.uncertain ? ', uncertain' : ''})`).join('; ') || 'none'}. Evidence: ${item.evidence.state}${item.evidence.issues.length
        ? ` — ${item.evidence.issues.join('; ')}` : ''}.`);
      const summary = parts.join('\n');
      requirePhone(summary.length <= 16000 && briefs.length < 100, 'OPEN_DESKTOP');
      briefs.push({ id: result.id, workspaceId: view.read().workspace.id, version: digest(deliverable),
        generatedAt: deliverable.at, title: result.headline, summary, receiptIds: [...result.receiptIds] });
    }
    return briefs;
  }
