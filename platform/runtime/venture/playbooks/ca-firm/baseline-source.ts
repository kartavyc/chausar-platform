// Original C2 baseline scorer. Source JSON drives the real calculator on every held-back run.
import {whatIf} from './what-if.ts';import {booksHealthCheck} from './health-check.ts';import {documentEntries} from './doc-entry.ts';import {REHEARSAL} from './rates.ts';
type Case={id:string;sources:{id:string;text:string}[]};
export function caSourceCasePasses(item:Case):boolean{
 if(!['regime-compare','health-duplicate-payment','statement-ties'].includes(item.id))return true;
 try{const input=JSON.parse(item.sources.find(row=>row.id==='typed-input')!.text);
  if(item.id==='regime-compare'){const receipt=whatIf(input,REHEARSAL);return receipt.figures.find(f=>f.key==='old-tax')?.minor==='16380000'&&receipt.figures.find(f=>f.key==='new-tax')?.minor==='0'&&receipt.figures.find(f=>f.key==='difference')?.minor==='16380000'&&receipt.assumptions.every(line=>line.startsWith('Assumed:'));}
  if(item.id==='health-duplicate-payment'){const receipt=booksHealthCheck(input,REHEARSAL);return receipt.working.coverage.read===3&&receipt.working.coverage.total===3&&receipt.working.coverage.passes===2&&receipt.working.findings.filter(f=>f.kind==='duplicate-payment').length===1&&receipt.working.findings.find(f=>f.kind==='duplicate-payment')?.evidence.join(',')==='bank-a,ledger-a,ledger-b';}
  const receipt=documentEntries(input);return receipt.working.pages.length===1&&receipt.working.pages[0]?.ties===true&&receipt.working.account==='XXXX1234'&&receipt.working.vouchers.length===1;
 }catch{return false;}
}
