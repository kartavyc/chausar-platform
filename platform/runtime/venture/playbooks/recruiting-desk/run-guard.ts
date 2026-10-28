// Check live saved recruiting records before preview, approval and returned model work.
import {check,ChausarError,type State} from '../../../contracts.ts';
import type {VentureRecord,OrderRecord} from '../../contracts.ts';
import {listRecords,findRecord,digest} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import {businessPlaybookId} from '../../build/mail-in.ts';
import {recruitPrivacyReady} from './source-core.ts';
import {recruitCompletion} from './completion-core.ts';
export function refuseRecruitDraft(state:State,venture:VentureRecord,order:OrderRecord){if(businessPlaybookId(state,venture)!=='recruiting-desk')return;const role=listRecords(state,'venture-recruit-role',venture.id).find(r=>r.serviceOrderId===order.id&&r.clientId===order.clientId);check(role,'RECRUIT_ROLE_REQUIRED','Finish this service order role interview first.');try{const key=acceptedBlueprintOrNull(state,venture)?.offers.find(o=>o.id===order.offerId)?.playbookOffer??null;recruitCompletion(role,listRecords(state,'venture-recruit-candidate',venture.id),listRecords(state,'venture-recruit-touch',venture.id),key,listRecords(state,'venture-recruit-interview',venture.id),digest);if(key!=='role-intake')recruitPrivacyReady(findRecord(state,'venture-record',venture.id)?.launchStage??venture.launchStage);}catch(e){if(e instanceof Error&&'code'in e)throw new ChausarError(String(e.code),e.message);throw e;}}
