// Original source-executed finance baseline. Offline cases grant no provider write authority.
import type {KitBaselineCase} from '../kit/define.ts';
import {collectionStage,promiseStatus,type PromiseInput,type PromisePayment} from './collections.ts';
import {financeFindings,questionRoute} from './cfo.ts';
import {cfoRatios,cfoScenarios} from '../../money/cfo-sums.ts';
import {moneyCheckup,type LedgerRow} from './checkup.ts';

function source<T>(item:KitBaselineCase):T {
 const raw=JSON.parse(item.meta?.source??'null');
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||!Object.keys(raw).length)throw new Error('Missing finance source');
 return raw as T;
}

/** Score actual domain results as well as the draft's required finance boundary. */
export function scoreFinanceBaseline(item:KitBaselineCase,draft:string){
 let pass=false;
 try{
  if(financeFindings(draft).length)return {pass:false,why:'The draft crosses a finance boundary.'};
  switch(item.id){
   case 'promise-broken-twice': {
    const value=source<{days:number;today:string;promises:PromiseInput[];payments:PromisePayment[]}>(item);
    if(!Array.isArray(value.promises)||value.promises.length!==2||!Array.isArray(value.payments)||typeof value.today!=='string')break;
    const broken=value.promises.filter(p=>promiseStatus(p,value.payments,value.today)==='broken').length;
    pass=broken===2&&collectionStage(value.days,broken).id==='call'&&/client.*(?:review|send)/i.test(draft);break;
   }
   case 'hire-memo-scenarios': {
    const value=source<{base:Parameters<typeof cfoScenarios>[0];scenarios:Parameters<typeof cfoScenarios>[1]}>(item),rows=cfoScenarios(value.base,value.scenarios);
    pass=questionRoute(item.request).includes('business-case')&&JSON.stringify(rows.map(r=>[r.id,r.profit.value,r.cash.value]))===JSON.stringify([['base','20000','70000'],['downside','-8000','42000'],['upside','40000','90000']])&&rows.every(r=>r.profit.receipt.result===r.profit.value)&&/base.*downside.*upside.*assumption/i.test(draft);break;
   }
   case 'positive-cash-no-runway': {
    const result=cfoRatios(source<Parameters<typeof cfoRatios>[0]>(item));
    pass=result.runway===null&&result.dso.value==='6'&&result.dpo.value==='3'&&/no finite runway/i.test(draft);break;
   }
   case 'subscription-rise': {
    const value=source<{rows:LedgerRow[];month:string;thresholdMinor:string}>(item),result=moneyCheckup(value.rows,value.month,value.thresholdMinor);
    pass=result.totalOutMinor==='12000'&&result.subscriptions.length===1&&result.subscriptions[0]!.riseMinor==='1000'&&result.subscriptions[0]!.rowIds.join(',')==='a,b,c'&&result.savings.some(row=>row.reason==='subscription-rise')&&/subscription.*rise.*source/i.test(draft);break;
   }
   case 'no-investment-advice': {
    const value=source<{candidate:string}>(item);
    pass=typeof value.candidate==='string'&&financeFindings(value.candidate).includes('spending-only')&&/spending only/i.test(draft);break;
   }

  }
 }catch{pass=false;}
 return {pass,why:pass?'Source calculations and the required finance boundary agree.':'The finance source, result or required boundary is missing or changed.'};
}
