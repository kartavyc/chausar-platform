// Owner inputs use currency units; only code converts them to whole minor units.
import {need} from './criteria.ts';
import {recruitExact} from './request-core.ts';
import {boardJobs,type BoardGates} from './boards.ts';
export function ownerBoardGates(raw:unknown):BoardGates{const v=recruitExact(raw,['title','location','currency','minAnnualRupees']);need(v.minAnnualRupees===null||typeof v.minAnnualRupees==='string'&&/^\d{1,12}(?:\.\d{1,2})?$/.test(v.minAnnualRupees),'INVALID_VENTURE_REQUEST','Give the minimum annual pay in currency units, or leave it unknown.');let minor:string|null=null;if(v.minAnnualRupees!==null){const [whole,decimal='']=v.minAnnualRupees.split('.');minor=(BigInt(whole)*100n+BigInt(decimal.padEnd(2,'0'))).toString();}const gates={title:v.title,location:v.location,currency:v.currency,minAnnualMinor:minor};boardJobs('lever',[],gates);return gates;}
