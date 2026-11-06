import { sha256Hex } from '../../hash.ts';
import { ChausarError, check, type Context, type State } from '../../contracts.ts';

import { validateMCPArguments } from '../../mcp.ts';
import type { DeliveryRunRecord, ToolCallRecord, ToolName, UploadRecord, VentureDeps, WorkReceiptRecord, WorkTableRecord } from '../contracts.ts';
import { digest, findRecord, listRecords, ventureAction } from '../records.ts';
import { redactPayload } from '../core/secrets.ts';
import { blueprintCountry } from '../core/country-history.ts';
import { playbookForRun } from '../delivery/workflow.ts';
import { rateUseFor } from '../playbooks/ca-firm/signoff.ts';
import { toolSpec, type Field, type ToolEnv, type ToolResult } from '../delivery/harness/tools.ts';
import { tablesOfFile } from '../delivery/harness/files.ts';
import { missingOf, needsFactsHandoff } from '../playbooks/ca-firm/needs-facts.ts';
import type { JobCalculation, JobCalculationResult } from './job-tools.ts';
import { SELLER_REPORT_TOOLS } from '../playbooks/online-seller/report-source.ts';

/** Reviewed host calculations only. No model programs, delegates, network or outside writes enter this list. */
const PURE = new Set(['calc.sum','calc.totals','tax.gst','tax.income','tax.interest','tax.tds','tax.statements','tax.portal','tax.citations','tax.formChooser','tax.advance','tax.whatIf',
  'books.reconcile','books.healthCheck','bills.pick','docs.entry','cfo.ratios','cfo.scenarios','collections.ladder','money.checkup',
  'social.report','youtube.afterPublish','youtube.hooks','youtube.editList','youtube.chapters','youtube.retention',
  'seller.shortlist','seller.catalogueSheet','seller.multiStore','tender.ground']);
const operationOf = (name: string) => name.replaceAll('.', '_').replace(/[A-Z]/g, c => '_'+c.toLowerCase());
function schemaFields(fields: Record<string, Field>): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, schemaField(field)])),
    required: Object.entries(fields).filter(([, field]) => field.required).map(([key]) => key) };
}
function schemaField(field: Field): Record<string, unknown> {
  const about = { description: field.about };
  if (field.type === 'object') return { ...schemaFields(field.fields), ...about };
  if (field.type === 'list') return { type: 'array', minItems: 1, maxItems: field.max, items: schemaField(field.item), ...about };
  if (field.type === 'enum') return { type: 'string', enum: [...field.values], ...about };
  return { type: 'string', minLength: 1, maxLength: field.max, ...about };
}
export function registeredJobCalculations(grant: readonly string[]): JobCalculation[] {
  return [...new Set(grant)].filter(name => PURE.has(name)).flatMap(name => {
    const spec = toolSpec(name);
    check(spec && spec.tier === 'code' && (spec.effect === 'compute' || spec.effect === 'read') && !spec.endsTurn, 'INVALID_MCP_TOOL', 'This calculator is not a reviewed pure host operation.');
    return [{ name: operationOf(name), description: spec.summary, inputSchema: schemaFields(spec.input) }];
  });
}
export function calculationGrant(state: State, run: DeliveryRunRecord): ToolName[] {
  const playbook = playbookForRun(state, run);
  const order=findRecord(state,'venture-order',run.orderId),price=order&&findRecord(state,'venture-price-receipt',order.priceReceiptId);
  const blueprint=price&&listRecords(state,'venture-blueprint',run.ventureId).find(row=>row.digest===price.inputs.blueprintDigest);
  const offer=blueprint?.offers.find(item=>item.id===order?.offerId),seller=playbook?.flagship==='online-seller'&&offer?.playbookOffer?SELLER_REPORT_TOOLS[offer.playbookOffer]:undefined;
  return [...new Set([...(playbook?.steps.flatMap(step => step.tools ?? []) ?? []),...(seller?[seller]:[])])];
}
type Scope = { run: DeliveryRunRecord; files: UploadRecord[] };
/** Business-level calculator approvals and this client's finance cycles are source data, never tool authority. */
export function calculatorSources(state: State, ventureId: string, clientId: string, orderId?:string) {
  const order=orderId?findRecord(state,'venture-order',orderId):undefined;
  const researchReceipt=order?.ventureId===ventureId&&order.clientId===clientId?order.youtubeResearch?.receiptId:undefined;
  return state.conversations.filter(row => row.ventureId === ventureId && (
    row.kind === 'venture-ca-citations' || (row.kind === 'venture-ca-firm' && row.entry === 'rate-confirmation')
    || (row.kind === 'venture-tender-question' && order?.ventureId === ventureId && order.clientId === clientId && row.orderId === order.id && row.clientId === clientId)
    || (row.kind === 'venture-books-posting' && row.clientId === clientId && row.entry?.kind === 'cycle')
    || (row.kind === 'venture-collection-stage' && row.clientId === null)
    || (row.kind === 'venture-work-receipt' && row.id===researchReceipt && row.runRef.kind==='delivery' && row.runRef.runId===orderId)));
}
/** Invoke a pure host function outside a transaction, then recheck and persist its complete evidence before returning. */
export async function calculateTrustedJob(deps: VentureDeps, ctx: Context, runId: string, operation: string, args: Record<string, unknown>, guard: (state: State) => Scope): Promise<JobCalculationResult> {
  const state = deps.store.read(), { run, files } = guard(state);
  check(run.id === runId, 'JOB_SCOPE_CHANGED', 'The calculator belongs to another job.');
  const grant = calculationGrant(state, run), calculation = registeredJobCalculations(grant).find(item => item.name === operation);
  check(calculation, 'UNKNOWN_CALCULATION', 'This calculator is not granted to the current workflow.');
  const name = grant.find(tool => operationOf(tool) === operation)!;
  const spec = toolSpec(name)!;
  const input = validateMCPArguments(calculation.inputSchema, args);
  for (const file of files) check(digest(file.contentBase64) === file.digest, 'JOB_FILE_CHANGED', 'The attached file changed.');
  const order = findRecord(state, 'venture-order', run.orderId)!, venture = findRecord(state, 'venture-record', run.ventureId)!;
  const price = findRecord(state, 'venture-price-receipt', order.priceReceiptId)!;
  const blueprint = listRecords(state, 'venture-blueprint', venture.id).find(row => row.digest === price.inputs.blueprintDigest)!;
  const country = blueprintCountry(venture, blueprint);
  const own = (row: WorkTableRecord | WorkReceiptRecord) => row.runRef.kind === 'delivery' && row.runRef.runId === run.id;
  const tables = listRecords(state, 'venture-work-table', run.ventureId).filter(own), receipts = listRecords(state, 'venture-work-receipt', run.ventureId).filter(own);
  const contextRows = calculatorSources(state, run.ventureId, order.clientId, order.id);
  const snapshot = digest({ files, tables, receipts, contextRows, calculations: run.agentJob?.calculations ?? [] });
  // These trusted adapters may inspect their current order/client. Their store view excludes every other client/order.
  const visibleIds = new Set([run.id, run.orderId, order.clientId, venture.id, blueprint.id, price.id, ...contextRows.map(row => row.id), ...files.map(row => row.id), ...tables.map(row => row.id), ...receipts.map(row => row.id)]);
  const scopedState = structuredClone({ ...state, ...Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key]) => [key, []])),
    members: state.members.filter(row => row.id === ctx.memberId), conversations: state.conversations.filter(row => visibleIds.has(String(row.id))) }) as State;
  const scopedDeps = { ...deps, store: { read: () => scopedState, update: async () => { throw new ChausarError('TOOL_DENIED', 'A calculator cannot write the workspace directly.'); } } } as VentureDeps;
  const env: ToolEnv = { deps: scopedDeps, ventureId: run.ventureId, memberId: ctx.memberId, epoch: ctx.epoch, currency: country.currency, dateOrder: country.dateOrder,
    runRef: { kind: 'delivery', runId }, files: structuredClone(files), tables: structuredClone(tables), receipts: structuredClone(receipts), dictionary: [], sandbox: undefined,
    now: () => deps.clock().toISOString(), allowed: [], intake: order.intake, rateUse: rateUseFor(state, run.ventureId, 'client'), calls: run.agentJob?.calculations ?? [],
    handoffs: (run.agentJob?.factAnswers ?? []).map(row => ({ to: 'client', question: row.question, answer: row.answer, turn: row.turn, answeredBy: 'owner' })) };
  const startedAt = deps.clock().toISOString(); let outcome: ToolResult | undefined, error: { code: string; name: string; message: string; details?: any } | undefined;
  try {
    outcome = await spec.run(env, input);
    check(!outcome.handoff && !outcome.mock && !outcome.delegate && !outcome.evidence?.length, 'TOOL_DENIED', 'A calculator cannot perform another kind of work.');
  } catch (caught) {
    if (!(caught instanceof ChausarError)) throw caught;
    error = { code: caught.code, name: caught.name, message: caught.message, ...((caught as any).details === undefined ? {} : { details: (caught as any).details }) };
  }
  return ventureAction(deps, ctx, 'prepare', 'agent.job.calculate', tx => {
    const current = guard(tx.state), currentTables = tx.list('venture-work-table').filter(own), currentReceipts = tx.list('venture-work-receipt').filter(own);
    check(digest({ files: current.files, tables: currentTables, receipts: currentReceipts, contextRows: calculatorSources(tx.state, run.ventureId, order.clientId, order.id), calculations: current.run.agentJob?.calculations ?? [] }) === snapshot, 'JOB_SOURCE_CHANGED', 'The calculator sources changed. Read them again.');
    const madeTables = outcome?.tables ?? [], madeReceipts = outcome?.receipts ?? [];
    const socialSources = name === 'social.report' ? files.filter(file => file.format === 'csv').map(file => ({ id: file.id,
      digest: sha256Hex(Buffer.from(file.contentBase64, 'base64').toString('utf8')) })) : [];
    const youtubeSources = name.startsWith('youtube.') ? files.map(file=>({id:file.id,digest:digest(file)})) : [];
    const sources = [...files, ...socialSources, ...youtubeSources, ...files.filter(file => ['csv','xlsx'].includes(file.format)).flatMap(file => tablesOfFile(file)), ...tables, ...receipts, ...madeTables];
    for (const row of [...madeTables, ...madeReceipts]) {
      check(row.ventureId === run.ventureId && row.memberId === ctx.memberId && row.epoch === ctx.epoch && own(row)
        && !tx.state.conversations.some(old => old.id === row.id), 'RECEIPT_FORBIDDEN', 'The calculator returned evidence from another job.');
      if (row.kind === 'venture-work-table') check(row.source.kind !== 'transform' && row.source.uploadIds.every(id => files.some(file => file.id === id)), 'JOB_FILE_FORBIDDEN', 'The table cites a file outside this order.');
      else check(row.inputs.tables.every(source => sources.some(known => known.id === source.id && known.digest === source.digest)), 'RECEIPT_FORBIDDEN', 'The receipt cites evidence outside this job.');
      tx.put(row);
    }
    const sequence = Math.max(0, ...(run.agentJob?.calculations ?? []).map(call => call.turn))+1;
    const trace: ToolCallRecord = redactPayload({ id: 'calculation-'+sequence, turn: sequence, tool: name, input, inputDigest: digest(JSON.stringify(input)),
      envelope: error ? { ok: false, error } : { ok: true, result: outcome!.result }, outcome: error ? 'failed' : 'succeeded', effect: spec.effect, tier: spec.tier,
      receiptIds: madeReceipts.map(row => row.id), tableIds: madeTables.map(row => row.id), startedAt, finishedAt: tx.now } as ToolCallRecord);
    const facts = error && needsFactsHandoff(error);
    const pendingFacts = facts ? { digest: digest({ job: current.run.agentJob!.scope.jobId, call: trace.id, source: current.run.agentJob!.sourceDigest, missing: missingOf(error!.details) }),
      missing: missingOf(error!.details), question: facts.question, callId: trace.id, at: tx.now } : undefined;
    tx.replace({ ...current.run, ...(pendingFacts ? { status: 'needs-answer' as const } : {}), agentJob: { ...current.run.agentJob!,
      calculations: [...(current.run.agentJob?.calculations ?? []), trace], ...(pendingFacts ? { pendingFacts } : {}) } });
    if (pendingFacts) { tx.emit('delivery-needs-answer', { runId, question: pendingFacts.question }); tx.emit('queue.changed', {}); }
    return { result: trace.envelope, receipts: madeReceipts };
  });
}
