// One model preset budget, including body-free session calls. Linked ordinary spend rows are never counted twice.
import type {ModelCallRecord,SpendRecord} from '../contracts.ts';
import {countedMicros} from '../money/spend.ts';
export function modelBudgetUsed(calls:readonly ModelCallRecord[],spends:readonly SpendRecord[],presetId:string,month:string):bigint{
 let total=0n;const linked=new Set(calls.map(c=>c.id));
 for(const call of calls){if(call.presetId!==presetId)continue;if(call.status==='dispatching')total+=BigInt(call.estimatedMaxCostMicros);else if(call.costMicros!==null&&call.at.slice(0,7)===month)total+=BigInt(call.costMicros);}
 for(const row of spends){if(row.item!=='model:'+presetId||row.ref&&linked.has(row.ref))continue;if(row.phase==='reserved'||row.phase==='unknown'||row.at.slice(0,7)===month)total+=BigInt(countedMicros(row));}
 return total;
}
