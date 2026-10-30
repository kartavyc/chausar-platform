import {preserveOtherPosts} from '../playbooks/social/ghostwriting.ts';
import { authorize, check, newId, type Context, type State } from '../../contracts.ts';
import type { DeliveryRunRecord, VentureDeps, UploadRecord } from '../contracts.ts';
import { digest, findRecord, listRecords, requireVenture, stateView, ventureAction } from '../records.ts';
import { requireClientAiConsent } from '../clients/ai-consent.ts';
import { blueprintCountry } from '../core/country-history.ts';
import { orderRefs, type AnyReceipt } from '../delivery/deliverable.ts';
import { pdfPages, tablesOfFile } from '../delivery/harness/files.ts';
import { readDocx } from '../playbooks/kit/ooxml/read.ts';
import { createJobMCP, type JobDraft, type JobToolPorts } from './job-tools.ts';
import { JobCapability } from './scope.ts';
import type { AgentJobScope } from './driver-types.ts';
import { jobContext } from './job-context.ts';
import { JOB_CALCULATIONS, calculateSourceRows } from './calculations.ts';
import { calculateTrustedJob, calculatorSources, calculationGrant, registeredJobCalculations } from './trusted-calculators.ts';
import { recordCheckSignal } from '../delivery/check-signals.ts';
import { createExternalMcpTools } from './external-mcp.ts';
import { agentSettingsOf } from './settings.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import {pinnedSend,systemResolver} from '../core/net-guard.ts';
import type {PoliteNet} from '../build/fetch-policy.ts';
import {SEO_SOURCE_CLAIM,sourceClaimOffer,checkedSourceClaim,sourceClaimUnchanged} from './seo-source-claims.ts';
import { writeCapDenial } from '../delivery/harness/write-caps.ts';

/** Trusted delivery composition supplies the existing playbook and policy checks, never model arguments. */
export type NativeJobOptions = {
  signal?: AbortSignal;
  /** Frozen permission from the trusted selected driver route; direct callers are denied by default. */
  networkAllowed?: boolean;
  resumeFrom?: string;
  agentId: string;
  sections: string[];
  check(state: State, run: DeliveryRunRecord): void;
  checkDraft?: (state: State, run: DeliveryRunRecord, draft: JobDraft, sourceNet?: PoliteNet) => Promise<Pick<DeliveryRunRecord, 'checks' | 'playbookChecks'>>;
};
function uploads(state: State, run: DeliveryRunRecord): UploadRecord[] {
  return listRecords(state, 'venture-upload', run.ventureId).filter(file => file.scope.kind === 'order' && file.scope.orderId === run.orderId
    && (run.uploadIds === undefined || run.uploadIds.includes(file.id)));
}
function sources(state: State, run: DeliveryRunRecord) {
  const order = findRecord(state, 'venture-order', run.orderId);
  check(order && order.ventureId === run.ventureId, 'ORDER_NOT_FOUND', 'This order is no longer available.');
  const client = findRecord(state, 'venture-client', order.clientId);
  check(client && client.ventureId === run.ventureId, 'CLIENT_NOT_FOUND', 'This client is no longer available.');
  const receipt = findRecord(state, 'venture-price-receipt', order.priceReceiptId);
  check(receipt && receipt.ventureId === run.ventureId && !receipt.stale && receipt.subject.type === 'order' && receipt.subject.orderId === order.id,
    'UNVERIFIED_NUMBER', 'The price for this order needs checking.');
  const files = uploads(state, run);
  for(const file of files)check(digest(file.contentBase64)===file.digest,'JOB_FILE_CHANGED','The attached file changed. Start a new job.');
  const background = jobContext(state, run, order, receipt);
  const sourceDigest = digest({ order, client: { id: client.id, name: client.name, email: client.email, taxId: client.taxId }, calculatorSources: calculatorSources(state, run.ventureId, client.id, order.id), receipt,
    files: files.map(({ id, digest, format, bytes }) => ({ id, digest, format, bytes })), playbookHash: run.playbookHash, background,
    externalTools: agentSettingsOf(state, run.ventureId).mcpServers, screen: screenSettingOf(state, run.ventureId) });
  return { order, client, receipt, files, sourceDigest, background };
}

/** Keeping a finished draft never reuses the live AI consent, but still requires its exact current business sources. */
export function assertAgentDraftCurrent(state: State, run: DeliveryRunRecord): void {
  if (!run.agentJob) return;
  const source = sources(state, run);
  check(source.order.status !== 'cancelled' && source.sourceDigest === run.agentJob.sourceDigest,
    'JOB_SOURCE_CHANGED', 'The order or its files changed. Prepare a new draft before approving it.');
  check(run.agentJob.proposal?.draftDigest === run.agentJob.draftDigest && run.agentJob.proposal.body === run.renderedText
    && run.agentJob.proposal.to === (source.client.email ?? ''), 'DRAFT_CHANGED', 'Review the current proposed draft.');
}

/** The UI and Resume use the same checkpoint eligibility, including current source bindings. */
export function canResumeAgentJob(state: State, run: DeliveryRunRecord): boolean {
  if (!run.agentJob || run.status !== 'stopped' || run.verdict) return false;
  const savedDraft = run.deliverable && run.renderedText && run.agentJob.draftDigest;
  if (!savedDraft && !run.agentJob.ownerNotes?.length) return false;
  try {
    const source = sources(state, run);
    return source.order.status !== 'cancelled' && source.client.id === run.agentJob.scope.clientId && source.sourceDigest === run.agentJob.sourceDigest;
  } catch { return false; }
}

/** An owner's answer is bound to the original client, consent revision and source snapshot. */
export function assertAgentAnswerCurrent(state: State, run: DeliveryRunRecord): void {
  check(run.agentJob, 'JOB_CLOSED', 'This job is no longer available.');
  const source = sources(state, run);
  requireClientAiConsent(state, run.ventureId, source.client.id, run.agentJob.scope);
  check(source.order.status !== 'cancelled' && source.client.id === run.agentJob.scope.clientId && source.sourceDigest === run.agentJob.sourceDigest,
    'JOB_SOURCE_CHANGED', 'The order or its files changed. Start a new job.');
}

/** A persisted job's authority is checked against current state, including inside every write transaction. */
export async function createNativeJob(deps: VentureDeps, ctx: Context, runId: string, options: NativeJobOptions) {
  options = { ...options, sections: [...options.sections] };
  const scope = await ventureAction(deps, ctx, 'prepare', 'agent.job.open', tx => {
    const run = tx.find('venture-delivery-run', runId);
    check(run && !run.verdict && run.status === 'waiting-for-you', 'JOB_CLOSED', 'Start a new job for this order.');
    const source = sources(tx.state, run);
    const consent = requireClientAiConsent(tx.state, run.ventureId, source.client.id);
    check(tx.state.policy.send !== 'nothing', 'MODEL_SEND_BLOCKED', 'AI sharing is switched off in privacy settings.');
    options.check(tx.state, run);
    const scope: AgentJobScope = { jobId: newId('agentjob'), runId, ventureId: run.ventureId, orderId: run.orderId,
      clientId: source.client.id, agentId: options.agentId, memberId: ctx.memberId, epoch: ctx.epoch,
      consentId: consent.id, consentRevision: consent.revision, generation: (run.agentJob?.scope.generation ?? 0) + 1 };
    const previous = options.resumeFrom ? tx.find('venture-delivery-run', options.resumeFrom) : undefined;
    if (options.resumeFrom) check(previous && previous.id !== run.id && previous.ventureId === run.ventureId && previous.orderId === run.orderId
      && canResumeAgentJob(tx.state, previous) && previous.agentJob?.sourceDigest === source.sourceDigest,
      'RUN_RESTART_REQUIRED', 'The saved work no longer matches this order. Start a new job.');
    tx.replace({ ...run, ...(run.revision ? { revision: { ...run.revision, callId: scope.jobId } } : {}), uploadIds: source.files.map(file => file.id), agentJob: { scope, sourceDigest: source.sourceDigest, draftDigest: null, proposal: null, messages: [], tools: [],
      ...(previous?.agentJob ? { factAnswers: structuredClone(previous.agentJob.factAnswers ?? []),
        ownerNotes: structuredClone(previous.agentJob.ownerNotes ?? []),
        calculations: structuredClone((previous.agentJob.calculations ?? []).filter(call => !call.envelope.ok && call.envelope.error.code === 'NEEDS_FACTS')) } : {}) } });
    return scope;
  });
  function guard(state: State, expected: Readonly<AgentJobScope>) {
    authorize(stateView(state, deps.store), ctx, 'prepare');
    const venture = requireVenture(state);
    check(venture.id === expected.ventureId && !deps.closing?.signal.aborted, 'JOB_CLOSED', 'This workspace is no longer open.');
    requireClientAiConsent(state, expected.ventureId, expected.clientId, expected);
    check(state.policy.send !== 'nothing', 'MODEL_SEND_BLOCKED', 'AI sharing is switched off in privacy settings.');
    const run = findRecord(state, 'venture-delivery-run', expected.runId);
    check(run && run.ventureId === expected.ventureId && !run.verdict && ['waiting-for-you', 'ready-for-review'].includes(run.status)
      && digest(run.agentJob?.scope) === digest(expected), 'JOB_CLOSED', 'This job is no longer running.');
    const source = sources(state, run);
    check(source.order.status !== 'cancelled' && source.sourceDigest === run.agentJob!.sourceDigest, 'JOB_SOURCE_CHANGED', 'The order or its files changed. Start a new job.');
    options.check(state, run);
    return { venture, run, ...source };
  }
  const capability = new JobCapability(scope, ctx, expected => { guard(deps.store.read(), expected); });
  const current = () => guard(deps.store.read(), scope);
  const preset=deps.models.status(ctx).tiers.main.presetId;
  const provider=preset.startsWith('anthropic-')||preset==='claude-code-cli'?'claude':'codex';
  const networkPolicy=agentSettingsOf(deps.store.read(),scope.ventureId)[provider].network;
  const networkRevision=current().venture.aiNetworkRevision?.[provider]??0;
  function sourceNetworkGuard(){
    capability.assert();
    const live=current();
    check(options.networkAllowed===true&&networkPolicy!=='off'&&agentSettingsOf(deps.store.read(),scope.ventureId)[provider].network===networkPolicy
      &&(live.venture.aiNetworkRevision?.[provider]??0)===networkRevision&&deps.models.status(ctx).tiers.main.presetId===preset&&!options.signal?.aborted,
      'AI_SETTING_UNSUPPORTED','This job has no current permission to verify public sources. Enable internet access and start a new job.');
    return live;
  }
  const sourceNet:PoliteNet={resolve:async hostname=>{sourceNetworkGuard();const addresses=await (deps.net?.resolve??systemResolver)(hostname);sourceNetworkGuard();return addresses;},send:async target=>{sourceNetworkGuard();const reply=await (deps.net?.send??pinnedSend)(target);sourceNetworkGuard();return reply;}};
  const supportsSourceClaims=()=>{const live=current();return sourceClaimOffer(deps.store.read(),live.run)&&calculationGrant(deps.store.read(),live.run).includes('seo.corroborate');};
  const ports: JobToolPorts = {
    prepareDraft: (_scope,draft)=>preserveOtherPosts(current().run,draft),
    recordScreen: async (_scope, tool, note, context) => {
      await ventureAction(deps, context, 'prepare', 'agent.job.screen', tx => {
        const { run } = guard(tx.state, scope);
        const screens = (run.agentJob!.screens ?? []).filter(row => row.tool !== tool || row.note.digest !== note.digest);
        tx.replace({ ...run, agentJob: { ...run.agentJob!, screens: [...screens, { tool, note }] } });
        tx.emit('run.step', { runId });
      });
    },
    recordContextRead: async (_scope, snapshot, context) => {
      await ventureAction(deps, context, 'prepare', 'agent.job.contextRead', tx => {
        const { run } = guard(tx.state, scope);
        tx.replace({ ...run, agentJob: { ...run.agentJob!, recalled: snapshot.business.notes?.items.map(item => item.id) ?? [],
          sourcesRead: snapshot.business.knowledge?.items.map(({ id, version }) => ({ id, version })) ?? [] } });
      });
    },
    readSnapshot: () => {
      const { venture, run, order, client, receipt, files, background } = current();
      const blueprint = listRecords(deps.store.read(), 'venture-blueprint', venture.id).find(row => row.digest === receipt.inputs.blueprintDigest);
      check(blueprint, 'JOB_SOURCE_CHANGED', 'The plan used to price this order is no longer available.');
      const country = blueprintCountry(venture, blueprint);
      return { business: { id: venture.id, name: venture.workingName, serviceType: blueprint.serviceType, dateOrder: country.dateOrder, ...background,
        revision: run.revision ? { words: run.revision.words, previousDraft: run.revision.previous ?? run.revision.base } : null },
        client: { id: client.id, ventureId: venture.id, name: client.name, email: client.email ?? '', ...(calculationGrant(deps.store.read(), run).some(name => name.startsWith('tax.')) ? { taxId: client.taxId ?? null } : {}) },
        order: { id: order.id, ventureId: venture.id, clientId: client.id, request: order.request, status: order.status, intake: order.intake ?? null, chainStage: order.chainStage ?? null },
        files: files.map(file => ({ id: file.id, ventureId: venture.id, orderId: order.id, name: file.name, mediaType: file.format, bytes: file.bytes, digest: file.digest })),
        sections: [...options.sections], dates: [...orderRefs(blueprint, order, receipt, deps.clock().toISOString().slice(0, 10)).dates,
          ...(background.approvedBrief ? [{ref:'room.deadline',label:'The deadline in the approved client brief',iso:background.approvedBrief.deadline}] : [])] };
    },
    readFile: async (_scope, file, page) => {
      const upload = current().files.find(item => item.id === file.id && item.digest === file.digest);
      check(upload && digest(upload.contentBase64) === upload.digest, 'JOB_FILE_CHANGED', 'The attached file changed. Read it again.');
      const bytes = Buffer.from(upload.contentBase64, 'base64');
      const text = upload.format === 'pdf' ? (await pdfPages(deps, upload)).pages.map(page => page.text).join('\n\n')
        : upload.format === 'docx' ? JSON.stringify(readDocx(bytes))
        : upload.format === 'xlsx' ? JSON.stringify(tablesOfFile(upload))
        : new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      current();
      return { text: text.slice(page.offset, page.offset + page.limit), nextOffset: page.offset + page.limit < text.length ? page.offset + page.limit : null };
    },
    calculations: [...JOB_CALCULATIONS, ...registeredJobCalculations(calculationGrant(deps.store.read(), current().run)), ...(supportsSourceClaims()?[SEO_SOURCE_CLAIM]:[])],
    calculate: async (_scope, input, context) => {
      if(input.operation==='seo_source_claim'){
        check(supportsSourceClaims(),'UNKNOWN_CALCULATION','This source check is not available for this job.');
        const live=sourceNetworkGuard(),file=live.files.find(row=>row.id===input.arguments.fileId);
        check(file,'JOB_FILE_FORBIDDEN','This file is not attached to this order.');
        const body=await checkedSourceClaim(file,input.arguments.claimId as string,runId,live.receipt.currency,sourceNet).finally(()=>{sourceNetworkGuard();});
        sourceNetworkGuard();
        return ventureAction(deps,context,'prepare','agent.job.sourceClaim',tx=>{
          guard(tx.state,scope);sourceNetworkGuard();
          const receipt=tx.put({...tx.base('venture-work-receipt'),...body});
          return {result:{ok:true,result:{marker:`[claim:${input.arguments.claimId}]`,claimId:input.arguments.claimId,
            sources:body.inputs.tables.slice(1).map(source=>({url:source.id,domain:source.name,digest:source.digest})),limitation:body.explanation}},receipts:[receipt]};
        });
      }
      if (input.operation === 'order_price') return { result: null, receipts: [current().receipt] };
      if (!['sum_rows','totals_by'].includes(input.operation)) return calculateTrustedJob(deps, context, runId, input.operation, input.arguments, state => guard(state, scope));
      return ventureAction(deps, context, 'prepare', 'agent.job.calculate', tx => {
        const { venture, run, order, receipt, files } = guard(tx.state, scope);
        const blueprint = tx.list('venture-blueprint').find(item => item.digest === receipt.inputs.blueprintDigest)!;
        for (const file of files) check(digest(file.contentBase64) === file.digest, 'JOB_FILE_CHANGED', 'The attached file changed.');
        const country = blueprintCountry(venture, blueprint);
        const calculated = calculateSourceRows(input.operation, input.arguments, files, {
          currency: receipt.currency, dateOrder: country.dateOrder, runRef: { kind: 'delivery', runId: run.id },
        });
        return { result: null, receipts: [tx.put({ ...tx.base('venture-work-receipt'), ...calculated })] };
      });
    },
    readReceipt: async (_scope, id): Promise<AnyReceipt | null> => {
      const { receipt, run } = current();
      if (id === receipt.id) return receipt;
      const work = findRecord(deps.store.read(), 'venture-work-receipt', id);
      if(!(work?.ventureId===scope.ventureId&&work.runRef.kind==='delivery'&&work.runRef.runId===run.id))return null;
      if(work.operation==='seo.claim'){
        const live=sourceNetworkGuard(),file=live.files.find(row=>row.id===work.inputs.columns.manifestId);
        check(file,'JOB_FILE_FORBIDDEN','The claim manifest is no longer attached to this order.');
        const checked=await checkedSourceClaim(file,work.inputs.columns.claimId,runId,live.receipt.currency,sourceNet).finally(()=>{sourceNetworkGuard();});
        sourceNetworkGuard();check(sourceClaimUnchanged(work,checked),'JOB_SOURCE_CHANGED','The claim source pages changed. Check the sources in a new job.');
      }
      return work;
    },
    saveDraft: async (_scope, draft, context) => {
      const before = current();
      const checked = options.checkDraft ? await options.checkDraft(deps.store.read(), before.run, draft, sourceNet) : { checks: [] };
      return ventureAction(deps, context, 'prepare', 'agent.job.draft', tx => {
        const { run, venture } = guard(tx.state, scope);
        // An edit of this job is still one draft; concurrent jobs count inside this transaction.
        const withoutThisRun={...tx.state,conversations:tx.state.conversations.filter(row=>row.id!==run.id)};
        const denied=writeCapDenial(withoutThisRun,venture,'drafts',tx.now);
        check(!denied,denied?.code??'WRITE_CAP_REACHED',denied?.reason??'The daily draft limit was reached.');
        // A verdict belongs to the draft it read. Keep it through pending Undo, then replace it only with this draft.
        tx.replace({ ...run, status: 'waiting-for-you', readyAt:run.readyAt??tx.now, deliverable: draft.deliverable, renderedText: draft.renderedText, ...checked, judge: undefined, judgePending: null,
          agentJob: { ...run.agentJob!, draftDigest: draft.digest, proposal: null, proposalAt:undefined } });
        recordCheckSignal(tx, run.id, checked.checks);
        return { draftId: run.id, digest: draft.digest, checks: checked.checks,
          ...(checked.playbookChecks ? { playbookChecks: checked.playbookChecks } : {}) };
      });
    },
    propose: async (_scope, proposal, context) => ventureAction(deps, context, 'prepare', 'agent.job.propose', tx => {
      const { run, client, venture } = guard(tx.state, scope);
      check(proposal.draftId === run.id && proposal.draftDigest === run.agentJob?.draftDigest && proposal.body === run.renderedText
        && proposal.to === (client.email ?? '') && proposal.transport === (client.email ? 'email-handoff' : 'copy'),
        'DRAFT_CHANGED', 'Review the current draft before proposing it.');
      if(!run.practice){
        const withoutThisRun={...tx.state,conversations:tx.state.conversations.filter(row=>row.id!==run.id)};
        const denied=writeCapDenial(withoutThisRun,venture,'messages',tx.now);
        check(!denied,denied?.code??'WRITE_CAP_REACHED',denied?.reason??'The daily message limit was reached.');
      }
      const next = tx.replace({ ...run, status: 'ready-for-review', readyAt: run.readyAt??tx.now, agentJob: { ...run.agentJob!, proposal, proposalAt:run.agentJob!.proposalAt??tx.now } });
      tx.emit('delivery-ready', { runId: run.id, orderId: run.orderId, servedBy: 'model' });
      tx.emit('run.waiting', { runId: run.id });
      return { cardId: `run:${run.id}:review`, digest: digest(next.agentJob!.proposal) };
    }),
  };
  const external = createExternalMcpTools(deps, ctx, capability, { guard: state => { guard(state, scope); },
    signal: options.signal ?? deps.closing?.signal ?? new AbortController().signal });
  return { capability, service: createJobMCP(deps.store, capability, ports, external.tools), assertState: (state: State) => guard(state, scope),
    async close() { capability.close(); await external.close(); } };
}
