// Source identity for the B3 screencast handoff. Called only after the existing local output hash verification.
import {check,type State} from '../../../contracts.ts';
import type {OrderRecord,YoutubeEditRecord} from '../../contracts.ts';
import {digest,listRecords} from '../../records.ts';
import {currentYoutubeResearch} from './research-desk.ts';
import {researchApproval} from './research-state.ts';
import {wordsAfterTrim} from './clean.ts';
import {screencastProof} from './screencast-proof.ts';
export function currentScreencastProof(state:State,ventureId:string,order:OrderRecord,edit:YoutubeEditRecord,now:string){
 const offer=listRecords(state,'venture-blueprint',ventureId).at(-1)?.offers.find(row=>row.id===order.offerId);
 if(offer?.playbookOffer!=='screencast-tutorial')return null;
 const scripted=order.intake?.fields?.scripted===true;let script:string|null=null,scriptDigest:string|null=null;
 if(scripted){const {body}=currentYoutubeResearch(state,ventureId,order.id,now);check(body.mode==='script'&&body.approval===researchApproval(body),'OUTPUT_APPROVAL_REQUIRED','Approve the exact speech script in the source desk.');const result=body.result as {lines?:{kind:string;text:string}[]};check(Array.isArray(result.lines),'SCRIPT_FILE_REQUIRED','Choose a current approved speech script.');script=result.lines.filter(line=>line.kind==='speech').map(line=>line.text).join(' ');scriptDigest=digest(body);}
 check(edit.board,'BOARD_REQUIRED','Prepare the measured output board first.');
 return {...screencastProof({board:edit.board,words:wordsAfterTrim(edit.document),script,scripted}),editId:edit.id,editDigest:digest(edit),scriptDigest};
}
