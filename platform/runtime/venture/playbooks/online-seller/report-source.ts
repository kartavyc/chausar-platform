import { check } from '../../../contracts.ts';
import type { OrderRecord, ToolName } from '../../contracts.ts';
import type { FileLike } from '../../delivery/harness/files.ts';
import { tablesOfFile } from '../../delivery/harness/files.ts';
import { digest } from '../../records.ts';
import { sellerCall } from './economics.ts';
import { sellerSourceOptions } from './operations-input.ts';
import { analyseSellerOperation, type SellerOperationMode } from './operations-analysis.ts';

const MODES: Readonly<Record<string, SellerOperationMode>> = { 'product-research':'research', 'catalogue-upload':'catalogue', 'multi-store-report':'multi-store' };
export const SELLER_REPORT_TOOLS:Readonly<Record<string,ToolName>>={'product-research':'seller.shortlist','catalogue-upload':'seller.catalogueSheet','multi-store-report':'seller.multiStore'};
/** The same pure analysis as the calculator, bound to owner-selected files before AI dispatch. */
export function sellerReportSource(order:OrderRecord,offerKey:string|null,files:FileLike[],today:string) {
  const mode=offerKey?MODES[offerKey]:undefined;if(!mode)return null;
  const rows=(id:unknown)=>{
    const file=files.find(item=>item.id===id);
    check(file&&file.format==='csv','SELLER_INPUT_INVALID','Add the original seller CSV export to this order.');
    check(file.digest===digest(file.contentBase64),'JOB_FILE_CHANGED','The seller export changed. Add it again.');
    return tablesOfFile(file)[0]?.rows.map(row=>row.cells)??[];
  };
  const fields=order.intake?.fields??{};
  const options=sellerCall(()=>sellerSourceOptions(mode,fields,id=>rows(id)));
  const data=sellerCall(()=>analyseSellerOperation(mode,rows(fields.exports),options,today));
  return {mode,sourceId:fields.exports,data};
}
