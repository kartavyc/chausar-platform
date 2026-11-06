// Original source-executed finance baseline. Offline cases grant no provider write authority.
import type {KitBaselineCase} from '../kit/define.ts';
import {collectionStage,promiseStatus,type PromiseInput,type PromisePayment} from './collections.ts';
import {financeFindings,questionRoute} from './cfo.ts';
import {cfoRatios,cfoScenarios} from '../../money/cfo-sums.ts';
import {moneyCheckup,type LedgerRow} from './checkup.ts';
import {financeCycle,type CycleInput} from './cycles.ts';
import {setupDraft,type SetupInput} from './setup.ts';
import {voucherDraft,approveVoucher,type VoucherInput} from './vouchers.ts';
import {sellerBooks,type SellerBooksInput} from './seller-books.ts';
import {decidePosting,type BooksOrder,type ExistingBooksRecord} from './posting-core.ts';

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
   case 'opening-balanced': {
    const value=source<{cycle:CycleInput;input:Omit<SetupInput,'cycle'>}>(item),result=setupDraft({...value.input,cycle:financeCycle(value.cycle)});
    pass=result.debitMinor==='1100'&&result.creditMinor==='1100'&&result.state==='draft'&&result.systemOfRecord==='client'&&/balanced.*owner approval/i.test(draft);break;
   }
   case 'receipt-approval': {
    const value=source<{cycle:CycleInput;input:Omit<VoucherInput,'cycle'>;by:string;at:string}>(item),prepared=voucherDraft({...value.input,cycle:financeCycle(value.cycle)});
    const approved=approveVoucher(prepared,{digest:prepared.digest,receiptDigest:value.input.receipt.digest,by:value.by,at:value.at});
    pass=prepared.totalMinor==='1000'&&approved.state==='approved'&&approved.posted===false&&/approved.*not posted/i.test(draft);break;
   }
   case 'seller-credits-separate': {
    const value=source<{cycle:CycleInput;input:Omit<SellerBooksInput,'cycle'>}>(item),result=sellerBooks({...value.input,cycle:financeCycle(value.cycle)});
    pass=result.creditDifferenceMinor==='20'&&result.requiresCaConfirmation&&result.posted===false&&result.credits.map(r=>r.differenceMinor).join(',')==='0,10,10'&&/credits.*CA.*separate/i.test(draft);break;
   }
   case 'posting-date-and-remainder': {
    const value=source<{order:BooksOrder;existing:ExistingBooksRecord[]}>(item),result=decidePosting(value.order,value.existing);
    pass=result.action==='create-draft'&&result.postingDate==='2026-10-29'&&result.lines.map(r=>r.amountMinor).join(',')==='51,50'&&/draft.*issue.*separate/i.test(draft);break;
   }
  }
 }catch{pass=false;}
 return {pass,why:pass?'Source calculations and the required finance boundary agree.':'The finance source, result or required boundary is missing or changed.'};
}
