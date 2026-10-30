// CA9. Original comparison harness; idea from opentax-engine (AGPL, no code copied).
// Test fixtures are synthetic unless a CA explicitly captures departmental output through the app.
import {ChausarError,check,type Context} from '../../../contracts.ts';
import type {VentureDeps,CaDifferentialRecord} from '../../contracts.ts';
import {exactPayload,requireAppChannel,singleLine,ventureAction} from '../../records.ts';
import {computeIncomeTax,type IncomeTaxInput} from './income-tax.ts';
import {caOfRecord} from './signoff.ts';
import type {DifferentialAddView} from './records.ts';
export {runDifferential} from './differential-core.ts';
export type {DifferentialCase,KnownDifference} from './differential-core.ts';
import {checkedCase} from './differential-core.ts';
/** Owner records the named CA's captured calculator case in the encrypted workspace. No portal is automated. */
export async function caDifferentialAdd(deps:VentureDeps,ctx:Context,payload:unknown):Promise<DifferentialAddView>{
 requireAppChannel(ctx,'venture.ca.differential.add');const p=exactPayload(payload,['name','inputs','outputs','capturedBy'],['name','inputs','outputs','capturedBy']);
 return ventureAction(deps,ctx,'approve','venture.ca.differential.add',tx=>{
  const ca=caOfRecord(tx.state,tx.venture!.id);check(ca,'CA_OF_RECORD_REQUIRED','Name the CA of record before recording a department-calculator capture.');
  const capturedBy=singleLine(p.capturedBy,'Captured by',{min:1,max:120});check(capturedBy===ca.name,'CA_NOT_OF_RECORD','The capture must name the CA of record.');
  const item={name:singleLine(p.name,'Case name',{min:1,max:120}),inputs:p.inputs as IncomeTaxInput,outputs:p.outputs as Record<string,string>,capturedBy};checkedCase(item);
  const saved=tx.put<CaDifferentialRecord>({...tx.base('venture-ca-differential'),...structuredClone(item),membershipNumber:ca.membershipNumber,capturedAt:tx.now});
  return {id:saved.id,name:saved.name,inputs:saved.inputs,outputs:saved.outputs,capturedBy:saved.capturedBy,membershipNumber:saved.membershipNumber,capturedAt:saved.capturedAt};
 });
}
