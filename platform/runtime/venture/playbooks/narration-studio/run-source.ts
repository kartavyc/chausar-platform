// Original native authority for agent evidence. A model cannot substitute text for measured audio.
import {createHash} from 'node:crypto';
import {check} from '../../../contracts.ts';
import type {VentureDeps} from '../../contracts.ts';
import {digest,listRecords,type VentureTx} from '../../records.ts';
import {currentNarrationSource} from './runtime.ts';
import {narrationReportRows,narrationReportReady} from './checks.ts';
import {requireNarrationClientRule} from './rules.ts';
export async function narrationRunSource(deps:VentureDeps,ventureId:string,orderId:string,requireApproved=false){const rows=listRecords(deps.store.read(),'venture-narration-segment',ventureId).filter(row=>row.orderId===orderId).sort((a,b)=>a.sequence-b.sequence);check(rows.length,'NARRATION_NOT_FOUND','Import this order manuscript in the narration desk first.');const read={find:(kind:any,id:string)=>listRecords(deps.store.read(),kind,ventureId).find(row=>row.id===id)} as Pick<VentureTx,'find'>;
 for(const row of rows){const source=await currentNarrationSource(read,row,deps.clock().toISOString());check(source.order.intake?.fields?.private===false,'PRIVATE_NEEDS_LOCAL','Private narration stays in the owner desk until a qualified local model is available.');if(row.masterFileId){const file=read.find('venture-upload',row.masterFileId);check(file&&file.scope.kind==='order'&&file.scope.orderId===orderId&&file.format==='audio'&&createHash('sha256').update(Buffer.from(file.contentBase64,'base64')).digest('hex')===row.masterDigest,'DERIVED_STALE','The mastered audio changed. Verify the current bytes again.');}}
 check(digest(rows)===digest(listRecords(deps.store.read(),'venture-narration-segment',ventureId).filter(row=>row.orderId===orderId).sort((a,b)=>a.sequence-b.sequence)),'DERIVED_STALE','The narration changed while reading. Review it again.');const report=narrationReportRows(rows),ready=narrationReportReady(report);if(requireApproved){requireNarrationClientRule();check(ready,'NARRATION_APPROVAL_REQUIRED','Master and listen to every current segment in the narration desk.');}return {rows:report,ready};}
