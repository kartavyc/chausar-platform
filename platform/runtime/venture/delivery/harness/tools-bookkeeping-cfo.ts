import {wholeCount} from '../../playbooks/kit/count.ts';
// Finance tools after finance-skills, cfo and bankmcp (MIT ideas). Original source-table adapters, code arithmetic only.
import type { ToolName, WorkFigure } from '../../contracts.ts';
import type { Spec, ToolEnv, Field } from './tools.ts';
import { createRequire } from 'node:module';
import { ChausarError,check } from '../../../contracts.ts';
import { digest, findRecord, listRecords, isoDate } from '../../records.ts';
import { clientLedgerPack, type ClientLedgerRow } from '../../playbooks/bookkeeping-cfo/client-ledger.ts';
import { formatMinor } from '../../../currency.ts';

import { cfoRatios, cfoScenarios, type CfoCell } from '../../money/cfo-sums.ts';
import { collectionStage, DEFAULT_LADDER, validateLadder } from '../../playbooks/bookkeeping-cfo/collections.ts';
import { moneyCheckup } from '../../playbooks/bookkeeping-cfo/checkup.ts';
import type { SourceTable } from './files.ts';
import {financeCycle,type FinanceCycle} from '../../playbooks/bookkeeping-cfo/cycles.ts';
import {voucherDraft} from '../../playbooks/bookkeeping-cfo/vouchers.ts';
import {setupDraft} from '../../playbooks/bookkeeping-cfo/setup.ts';
import {setupSource} from '../../playbooks/bookkeeping-cfo/setup-source.ts';
import {sellerBooksSource} from '../../playbooks/bookkeeping-cfo/seller-books-source.ts';
import {sellerBooksReceipt} from '../../playbooks/bookkeeping-cfo/seller-books-receipt.ts';

type BookkeepingCfoToolName = Extract<ToolName, 'cfo.ratios' | 'cfo.scenarios' | 'collections.ladder' | 'money.checkup' | 'books.write' | 'vouchers.draft' | 'seller.books' | 'books.setup'>;
// Load cyclic harness helpers only when a tool runs, whichever module a caller imported first.
const load = createRequire(import.meta.url);
function text(about: string, max = 200, required = true): Field { return { type: 'text', about, max, required }; }
function fail(message: string): never { throw new ChausarError('TOOL_FAILED', message); }
function amountTable(env: ToolEnv, alias: string): SourceTable { return load('../../playbooks/ca-firm/tool-inputs.ts').amountTable(env, alias); }
function cellOf(row: { cells: Record<string, string> }, column: string): string { return (row.cells[column] ?? '').trim(); }
function columnOf(table: SourceTable, alias: string, column: string, role: string): string { return load('../../playbooks/ca-firm/tool-inputs.ts').columnOf(table, alias, column, role); }
function moneyCell(env: ToolEnv, alias: string, row: string, column: string, raw: string): bigint | null { return load('../../playbooks/ca-firm/tool-inputs.ts').moneyCell(env, alias, row, column, raw); }
const tableField = () => text('A client source CSV table, such as f1.', 12);

function required(table: SourceTable, name: string): void { columnOf(table, table.name, name, name); }
function minor(env: ToolEnv, table: SourceTable, row: SourceTable['rows'][number], column = 'amount'): string {
  const value = moneyCell(env, table.name, row.id, column, cellOf(row, column));
  if (value === null) fail('An amount is missing from the source. Ask the client; do not read a blank as zero.');
  return String(value);
}
function quantities(env: ToolEnv, table: SourceTable): Record<string, string> {
  required(table, 'kind'); required(table, 'amount');
  const values: Record<string, string> = {};
  for (const row of table.rows) {
    const key = cellOf(row, 'kind');
    if (Object.hasOwn(values, key)) fail('A finance input appears twice. Reconcile the source before calculating.');
    values[key] = minor(env, table, row);
  }
  return values;
}
function need(values: Record<string, string>, key: string): string { if (!Object.hasOwn(values, key)) fail(`The source needs its ${key} row.`); return values[key]; }
function figure(env: ToolEnv, key: string, value: string, money: boolean): WorkFigure {
  return { key, label: key.replace(/-/g, ' '), minor: value, display: money ? formatMinor(BigInt(value), env.currency) : value, currency: env.currency, unit: money ? 'money' : 'count' };
}
function answer(env: ToolEnv, table: SourceTable, figures: WorkFigure[], steps: { inputs: string[]; result: string; rule: string; op?:'add'|'subtract'|'compare' }[], result: unknown, extraSources: SourceTable[] = []) {
  const draft = {
    operation: 'work.totals' as const, runRef: env.runRef, currency: env.currency,
    inputs: { tables: [table, ...extraSources].map(source => ({ id: source.id, name: source.name, digest: source.digest })), columns: Object.fromEntries(table.columns.map(column => [column, column])), rowIds: [table, ...extraSources].flatMap(source => source.rows.map(row => source.id + ':' + row.id)) },
    steps: steps.map(step => ({ ...step, op: step.op??'compare' as const })), figures, reconciliation: null,
    allowedNumbers: [...new Set(figures.flatMap(row => [row.minor, row.display]))], explanation: figures.map(row => `${row.label}: ${row.display}.`).join(' '), digest: '',
  };
  draft.digest = digest(draft);
  const out = (load('./tools.ts') as typeof import('./tools.ts')).receiptOut(env, draft);
  return { result: { data: result, receipt: out.alias, figures: out.figures }, receipts: [out.record] };
}
function fromCells(env: ToolEnv, table: SourceTable, cells: Record<string, CfoCell | null>, result: unknown, extraSources: SourceTable[] = []) {
  const kept = Object.entries(cells).filter((row): row is [string, CfoCell] => row[1] !== null);
  return answer(env, table, kept.map(([key, value]) => figure(env, key, value.value, value.unit === 'minor')), kept.map(([, value]) => ({ inputs: value.receipt.inputs, result: value.value, rule: value.receipt.formula })), result, extraSources);
}

function financeSource(env:ToolEnv,alias:string,cycleId:string){
 const table=amountTable(env,alias),file=env.files.find(value=>value.id===table.uploadId);check(file?.format==='csv'&&Buffer.byteLength(file.contentBase64,'base64')<=500000,'BOOKS_SETUP_INVALID','Use an actual client source CSV below five hundred kilobytes.');
 const state=env.deps.store.read();let cycle:FinanceCycle;
 if(env.runRef.kind==='rehearsal'){check(cycleId==='rehearsal','BOOKS_CYCLE_INVALID','Use the labelled practice cycle.');const year=env.now().slice(0,4);cycle=financeCycle({businessId:state.workspace.id,clientId:'rehearsal-client',system:'tally',companyId:'Rehearsal only',from:year+'-01-01',to:year+'-12-31'});}
 else{const run=env.runRef.kind==='delivery'?findRecord(state,'venture-delivery-run',env.runRef.runId):null,order=run?findRecord(state,'venture-order',run.orderId):null,record=findRecord(state,'venture-books-posting',cycleId),upload=findRecord(state,'venture-upload',file.id);
  check(run?.ventureId===env.ventureId&&order?.ventureId===env.ventureId&&record?.ventureId===env.ventureId&&record.entry.kind==='cycle'&&record.clientId===order.clientId,'BOOKS_CYCLE_INVALID','Choose this client finance cycle.');
  check(order.status!=='cancelled'&&order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','Use only an active client order with current consent.');
  check(upload?.ventureId===env.ventureId&&upload.scope.kind==='order'&&upload.scope.orderId===order.id&&upload.contentBase64===file.contentBase64,'BOOKS_SOURCE_CHANGED','Use current source bytes from this client order.');cycle=record.entry.cycle;
 }
 return {table,file,cycle,text:Buffer.from(file.contentBase64,'base64').toString('utf8')};
}
/** Source-backed finance calculations; the owner desk alone applies exact accounting approvals. */
export const BOOKKEEPING_CFO_TOOLS: Readonly<Record<BookkeepingCfoToolName, Spec>> = Object.freeze({
  'cfo.ratios': {
    name: 'cfo.ratios', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Calculate days to collect, days to pay, cash cycle and runway from source kind and amount rows. Positive net cash has no finite runway.',
    input: { table: tableField(), days: text('The labelled period length in whole days, from the client brief.', 3), ledger: text('The client ledger source CSV: kind, on, amount; kinds receivable, receipt, payment or balance. Required on a client order.', 12, false), asOf: text('The client ledger date as YYYY-MM-DD.', 10, false) },
    async run(env, input) {
      const table = amountTable(env, String(input.table));
      const values = quantities(env, table);
      if (!/^\d{1,3}$/.test(String(input.days))) fail('Name the whole period length in days.');
      if (env.runRef.kind === 'delivery' && !input.ledger) throw new ChausarError('CLIENT_LEDGER_REQUIRED', 'Add the order client ledger source; the service business books are never a substitute.');
      const ledgerTable = input.ledger ? amountTable(env, String(input.ledger)) : null;
      let sourcePack: ReturnType<typeof clientLedgerPack> | null = null;
      if (ledgerTable) {
        for (const column of ['kind', 'on', 'amount']) required(ledgerTable, column);
        const state = env.deps.store.read();
        const template = listRecords(state, 'venture-record').find(row => row.id === env.ventureId);
        if (!template) fail('The business country is needed to read the client ledger currency.');
        const run = env.runRef.kind === 'delivery' ? findRecord(state, 'venture-delivery-run', env.runRef.runId) : null;
        const order = run ? findRecord(state, 'venture-order', run.orderId) : null;
        if (env.runRef.kind === 'delivery' && (!run || run.ventureId !== env.ventureId || !order || order.ventureId !== env.ventureId)) throw new ChausarError('CLIENT_LEDGER_REQUIRED', 'The ledger must belong to this client order.');
        const clientId = order?.clientId ?? 'rehearsal-client';
        const rows: ClientLedgerRow[] = ledgerTable.rows.map(row => ({ id: row.id, clientId, kind: cellOf(row, 'kind') as ClientLedgerRow['kind'], on: cellOf(row, 'on'), amountMinor: minor(env, ledgerTable, row), dueOn: cellOf(row, 'dueOn') || null, account: cellOf(row, 'account') || 'statement' }));
        sourcePack = clientLedgerPack(template!, { clientId, sourceId: ledgerTable.id, rows }, isoDate(input.asOf ?? env.now().slice(0, 10), 'Client ledger date'));
        if (sourcePack.totals.cashMinor === null) throw new ChausarError('CLIENT_BALANCE_REQUIRED', 'The client source has no closing bank balance; do not treat it as zero.');
      }
      const ratios = cfoRatios({ receivablesMinor: sourcePack?.totals.receivablesMinor ?? need(values, 'receivables'), payablesMinor: need(values, 'payables'), revenueMinor: need(values, 'revenue'), costsMinor: need(values, 'costs'), inventoryMinor: need(values, 'inventory'), cashMinor: sourcePack?.totals.cashMinor ?? need(values, 'cash'), netCashMinor: sourcePack ? String(BigInt(sourcePack.totals.revenueMinor) - BigInt(sourcePack.totals.costsMinor)) : need(values, 'net-cash'), days: wholeCount(input.days) });
      const projected: Record<string, CfoCell> = {};
      for (const [index, week] of (sourcePack?.projection ?? []).entries()) for (const [scenario, point] of [['on-time', week.onTime], ['late-unpaid', week.lateUnpaid]] as const) {
        projected['cash-week-' + (index + 1) + '-' + scenario] = { kind: 'calculated', value: point.value, unit: 'minor', receipt: { formula: point.plan.estimateWords ?? 'Projection from client source rows.', inputs: point.plan.addends.map(row => row.recordId + ':' + row.amount), result: point.value } };
      }
      return fromCells(env, table, { ...ratios, ...projected }, { positiveCashNoRunway: ratios.runway === null, periodDaysAssumption: String(input.days), ...(sourcePack ? { clientLedger: sourcePack } : {}) }, ledgerTable ? [ledgerTable] : []);
    },
  },
  'cfo.scenarios': {
    name: 'cfo.scenarios', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Calculate base, downside and upside with assumptions from a client scenario CSV. Every scenario cell has a receipt.',
    input: { table: tableField() },
    async run(env, input) {
      const table = amountTable(env, String(input.table));
      for (const column of ['scenario', 'revenue', 'costs', 'cash', 'assumption']) required(table, column);
      if (table.rows.length !== 3) fail('The scenario CSV needs exactly base, downside and upside rows.');
      const rows = table.rows.map(row => ({ id: cellOf(row, 'scenario'), revenue: minor(env, table, row, 'revenue'), costs: minor(env, table, row, 'costs'), cash: minor(env, table, row, 'cash'), assumption: cellOf(row, 'assumption') }));
      if (new Set(rows.map(row => row.id)).size !== 3 || rows.some(row => !['base', 'downside', 'upside'].includes(row.id) || !row.assumption)) fail('State the base, downside and upside assumptions once each.');
      const cells: Record<string, CfoCell | null> = {};
      for (const row of rows) {
        // Source scenarios already contain owner-set amounts; scale by unity, never invent growth percentages.
        const worked = cfoScenarios({ revenueMinor: row.revenue, costsMinor: row.costs, cashMinor: row.cash, assumption: row.assumption }, ['base', 'downside', 'upside'].map(id => ({ id, revenueBps: 10000, costBps: 10000, assumption: row.assumption })))[0];
        for (const key of ['revenue', 'profit', 'cash', 'runway'] as const) cells[`${row.id}-${key}`] = worked[key];
      }
      return fromCells(env, table, cells, { assumptions: rows.map(row => ({ scenario: row.id, assumption: row.assumption })) });
    },
  },
  'collections.ladder': {
    name: 'collections.ladder', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Read client, invoice, daysLate, brokenPromises and amount columns; prepare collection stages for the service client to review and send.',
    input: { table: tableField() },
    async run(env, input) {
      const table = amountTable(env, String(input.table));
      for (const column of ['client', 'invoice', 'daysLate', 'brokenPromises', 'amount']) required(table, column);
      const ladder = listRecords(env.deps.store.read(), 'venture-collection-stage', env.ventureId).filter(row => row.clientId === null).at(-1)?.ladder ?? DEFAULT_LADDER;
      validateLadder(ladder);
      const rows = table.rows.map(row => {
        const days = cellOf(row, 'daysLate'), broken = cellOf(row, 'brokenPromises');
        if (!/^\d{1,5}$/.test(days) || !/^\d{1,3}$/.test(broken)) fail('Days late and broken promises must come from whole counts in the source.');
        return { rowId: row.id, client: cellOf(row, 'client'), invoice: cellOf(row, 'invoice'), stage: collectionStage(wholeCount(days), wholeCount(broken), ladder).id, amountMinor: minor(env, table, row) };
      });
      const out = answer(env, table, rows.map((row, i) => figure(env, `balance-${i + 1}`, row.amountMinor, true)), rows.map(row => ({ inputs: [row.rowId, row.amountMinor], result: row.amountMinor, rule: 'Reported invoice balance from the client source row; reminder stays a client draft.' })), { rows, sender: 'client' });
      return { ...out, result: { ...(out.result as object), rows, sender: 'client', needsApproval: true } };
    },
  },
  'money.checkup': {
    name: 'money.checkup', effect: 'compute', tier: 'code', endsTurn: false,
    summary: 'Read id, payee, on, amount and direction columns; check subscriptions and unusual spending, read-only. Threshold is an owner assumption.',
    input: { table: tableField(), month: text('Month in the client brief, as YYYY-MM.', 7), threshold: text('Owner-set large-payment threshold in rupees; used only in rehearsal.', 30, false) },
    async run(env, input) {
      const table = amountTable(env, String(input.table));
      for (const column of ['id', 'payee', 'on', 'amount', 'direction']) required(table, column);
      // kitOrderIntake stores money fields in paise. Only the explicit rehearsal input is rupee text.
      const storedThreshold = env.intake?.fields?.['large-payment-threshold'];
      if (env.runRef.kind !== 'rehearsal' && (typeof storedThreshold !== 'string' || !/^\d{1,15}$/.test(storedThreshold))) fail('The owner must set the large-payment threshold at intake.');
      const thresholdMinor = env.runRef.kind === 'rehearsal' ? moneyCell(env, 'owner assumption', 'threshold', 'threshold', String(input.threshold ?? '')) : BigInt(storedThreshold as string);
      if (thresholdMinor === null || thresholdMinor < 0n) fail('The owner must set the large-payment threshold at intake.');
      const rows = table.rows.map(row => ({ id: cellOf(row, 'id'), payee: cellOf(row, 'payee'), on: cellOf(row, 'on'), amountMinor: minor(env, table, row), direction: cellOf(row, 'direction') as 'in' | 'out' }));
      const checkup = moneyCheckup(rows, String(input.month), String(thresholdMinor));
      return answer(env, table, [figure(env, 'total-out', checkup.totalOutMinor, true), figure(env, 'total-in', checkup.totalInMinor, true), ...checkup.subscriptions.flatMap((row, i) => [figure(env, `subscription-${i + 1}-latest`, row.latestMinor, true), figure(env, `subscription-${i + 1}-yearly`, row.yearlyMinor, true), figure(env, `subscription-${i + 1}-rise`, row.riseMinor, true)])], [{ inputs: rows.map(row => `${row.id}:${row.amountMinor}`), result: checkup.totalOutMinor, rule: 'Add outgoing source rows in the selected month; yearly costs multiply the last recurring debit by its cadence.' }], checkup);
    },
  },
  'books.write': {
    name:'books.write',effect:'handoff',tier:'code',endsTurn:false,
    summary:'Hand the current client accounting dry run to the owner desk. This tool never sends entries. The owner reviews exact provider bytes there and approves draft creation, then issue separately.',
    input:{postingId:text('The saved dry run for this client order, or rehearsal during practice.',200)},
    async run(env,input){
      if(env.runRef.kind==='rehearsal'){check(input.postingId==='rehearsal','BOOKS_WORK_NOT_FOUND','Use the explicitly labelled practice action.');return {result:{rehearsal:true,posted:false,requiresOwnerApproval:true}};}
      const state=env.deps.store.read(),run=env.runRef.kind==='delivery'?findRecord(state,'venture-delivery-run',env.runRef.runId):null,order=run?findRecord(state,'venture-order',run.orderId):null,row=findRecord(state,'venture-books-posting',String(input.postingId));
      check(run?.ventureId===env.ventureId&&order?.ventureId===env.ventureId&&row?.ventureId===env.ventureId&&row.orderId===order.id&&row.clientId===order.clientId&&row.entry.kind==='posting','BOOKS_WORK_NOT_FOUND','Choose the saved accounting dry run for this exact client delivery.');
      check(order.status!=='cancelled'&&order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','The client order needs current consent.');
      const file=findRecord(state,'venture-upload',row.entry.uploadId),cycle=listRecords(state,'venture-books-posting',env.ventureId).find(value=>value.cycleId===row.cycleId&&value.entry.kind==='cycle');
      check(file?.scope.kind==='order'&&file.scope.orderId===order.id&&cycle?.entry.kind==='cycle'&&digest({id:file.id,bytes:file.contentBase64,cycle:cycle.entry.cycle,clientId:order.clientId})===row.entry.sourceDigest,'BOOKS_SOURCE_CHANGED','Read a fresh owner dry run after the source changed.');
      return {result:{postingId:row.id,state:row.entry.state,reviewDigest:row.entry.reviewDigest,receiptId:row.entry.receiptId,posted:false,requiresOwnerApproval:true,desk:{playbook:'bookkeeping-cfo',kind:'posting',id:row.id},note:'This tool sends nothing. Read the exact dry run and its recorded outcomes in the owner accounting desk.'}};
    },
  },
  'seller.books': {
    name:'seller.books',effect:'compute',tier:'code',endsTurn:false,summary:'Reconcile the complete monthly seller source CSV with the settlement engine and separate tax-credit receipts. Nothing is posted or filed; the CA confirms sections.',
    input:{table:tableField(),cycleId:text('The owner-created client finance cycle, or rehearsal during practice.',200),month:text('The source accounting month, YYYY-MM.',7)},
    async run(env,input){const source=financeSource(env,String(input.table),String(input.cycleId)),report=sellerBooksSource(source.text,source.cycle,String(input.month));const proof=sellerBooksReceipt('tool',{id:source.table.id,name:source.table.name,digest:source.table.digest},report);return answer(env,source.table,proof.figures,proof.steps,report);},
  },
  'books.setup': {
    name:'books.setup',effect:'compute',tier:'code',endsTurn:false,summary:'Validate client customers, vendors, categories and balanced opening entries from the setup CSV. Prepare a source-bound draft; never claim the client system was changed.',
    input:{table:tableField(),cycleId:text('The owner-created client finance cycle, or rehearsal during practice.',200)},
    async run(env,input){const source=financeSource(env,String(input.table),String(input.cycleId)),setup=setupDraft({cycle:source.cycle,...setupSource(source.text)});return answer(env,source.table,[figure(env,'opening-debits',setup.debitMinor,true),figure(env,'opening-credits',setup.creditMinor,true)],[{inputs:setup.opening.map(row=>row.debitMinor),result:setup.debitMinor,rule:'Add source opening debits in paise.'},{inputs:setup.opening.map(row=>row.creditMinor),result:setup.creditMinor,rule:'Add source opening credits in paise; they must equal debits.'}],{setup,posted:false});},
  },
  'vouchers.draft': {
    name:'vouchers.draft',effect:'compute',tier:'code',endsTurn:false,
    summary:'Draft balanced vouchers from actual receipt rows. Nothing is approved or posted. Use id, on, description, debitAccount, creditAccount and amount columns.',
    input:{table:tableField(),cycleId:text('The owner-created finance cycle record, or rehearsal during practice.',200)},
    async run(env,input){
      const table=amountTable(env,String(input.table));for(const column of ['id','on','description','debitAccount','creditAccount','amount'])required(table,column);
      check(table.rows.length>0&&table.rows.length<=50,'BOOKS_SETUP_INVALID','Prepare one to fifty receipt rows at a time.');
      const state=env.deps.store.read(),file=env.files.find(row=>row.id===table.uploadId);check(file,'BOOKS_RECEIPT_REQUIRED','Use an actual uploaded receipt table.');
      let cycle:FinanceCycle,orderId:string,clientId:string;
      if(env.runRef.kind==='rehearsal'){
        check(input.cycleId==='rehearsal','BOOKS_CYCLE_INVALID','Use the labelled rehearsal cycle for practice.');const dates=table.rows.map(row=>cellOf(row,'on')).sort();
        cycle=financeCycle({businessId:state.workspace.id,clientId:'rehearsal-client',system:'tally',companyId:'Rehearsal only',from:dates[0]!,to:dates.at(-1)!});orderId='rehearsal-order';clientId='rehearsal-client';
      }else{
        const run=env.runRef.kind==='delivery'?findRecord(state,'venture-delivery-run',env.runRef.runId):null,order=run?findRecord(state,'venture-order',run.orderId):null,record=findRecord(state,'venture-books-posting',String(input.cycleId));
        check(run?.ventureId===env.ventureId&&order?.ventureId===env.ventureId&&record?.ventureId===env.ventureId&&record.entry.kind==='cycle'&&record.clientId===order.clientId,'BOOKS_CYCLE_INVALID','Choose the owner-created finance cycle for this client order.');
        check(order.status!=='cancelled'&&order.intake?.fields?.['data-consent']===true,'BOOKS_CONSENT_REQUIRED','Use only an active client order with current consent.');
        const upload=findRecord(state,'venture-upload',file.id);check(upload?.ventureId===env.ventureId&&upload.scope.kind==='order'&&upload.scope.orderId===order.id&&upload.contentBase64===file.contentBase64,'BOOKS_RECEIPT_REQUIRED','Use the current receipt bytes uploaded to this client order.');
        cycle=record.entry.cycle;orderId=order.id;clientId=order.clientId;
      }
      const ids=new Set<string>();const vouchers=table.rows.map(row=>{const id=cellOf(row,'id');check(id.length>0&&!ids.has(id),'BOOKS_SETUP_INVALID','Every receipt row needs a unique identity.');ids.add(id);const amount=minor(env,table,row);
        return voucherDraft({cycle,date:cellOf(row,'on'),description:cellOf(row,'description'),receipt:{uploadId:file.id,digest:digest({id:file.id,bytes:file.contentBase64}),clientId,orderId},lines:[{accountId:cellOf(row,'debitAccount'),debitMinor:amount,creditMinor:'0'},{accountId:cellOf(row,'creditAccount'),debitMinor:'0',creditMinor:amount}]});});
      return answer(env,table,vouchers.map((voucher,index)=>figure(env,'voucher-'+(index+1),voucher.totalMinor,true)),vouchers.map((voucher,index)=>({inputs:[table.rows[index]!.id,voucher.totalMinor],result:voucher.totalMinor,rule:'Convert source rupee text to paise and balance the same amount on debit and credit.'})),{vouchers,posted:false,requiresBookkeeperApproval:true});
    },
  },
});
