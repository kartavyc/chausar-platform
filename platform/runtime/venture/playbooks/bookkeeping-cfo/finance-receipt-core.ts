// Original shared code receipt arithmetic, browser-safe.
import {formatMinor} from '../../../currency.ts';
import {formatMoney} from '../../../owner-format.ts';
// B2: amounts on the desk read in the owner form; a file that leaves the app (the setup handoff) asks for the exact form.
export function financeAmounts(rows:readonly {accountId:string;debitMinor:string;creditMinor:string}[],form:'owner'|'exact'='owner'){const show=(minor:string)=>form==='exact'?formatMinor(minor,'INR'):formatMoney(minor,'INR');return rows.map(row=>({accountId:row.accountId,debit:show(row.debitMinor),credit:show(row.creditMinor)}));}
export function financeReceiptData(workId:string,source:{id:string;name:string;digest:string},rows:readonly {accountId:string;debitMinor:string;creditMinor:string}[]){
 const debit=rows.reduce((sum,row)=>sum+BigInt(row.debitMinor),0n),credit=rows.reduce((sum,row)=>sum+BigInt(row.creditMinor),0n);
 const figures=[{key:'debit',label:'Total debits',minor:String(debit),display:formatMoney(debit,'INR'),currency:'INR',unit:'money' as const},{key:'credit',label:'Total credits',minor:String(credit),display:formatMoney(credit,'INR'),currency:'INR',unit:'money' as const}];
 const receipt={operation:'work.totals' as const,runRef:{kind:'delivery' as const,runId:workId},currency:'INR',inputs:{tables:[source],columns:{debitMinor:'debitMinor',creditMinor:'creditMinor'},rowIds:rows.map((_,index)=>String(index+1))},steps:[{op:'add' as const,inputs:rows.map(row=>row.debitMinor),result:String(debit),rule:'Sum source debit entries in paise.'},{op:'add' as const,inputs:rows.map(row=>row.creditMinor),result:String(credit),rule:'Sum source credit entries in paise.'},{op:'compare' as const,inputs:[String(debit),String(credit)],result:debit===credit?'balanced':'unbalanced',rule:'Debits must equal credits before approval.'}],figures,reconciliation:null,allowedNumbers:figures.flatMap(row=>[row.minor,row.display]),explanation:'Source entries balance in integer paise. The bookkeeper must review account choices and receipt evidence. Nothing has been posted.',digest:''};
 return receipt;
}
