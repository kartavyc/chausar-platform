// Fresh episode evidence and owner direction are checked before preview and after model work returns.
import {check,ChausarError,type State} from '../../../contracts.ts';
import type {OrderRecord,VentureRecord} from '../../contracts.ts';
import {listRecords,findRecord} from '../../records.ts';
import {businessPlaybookId} from '../../build/mail-in.ts';
import {requireCurrentArticle} from './sources.ts';import {articleLegalReady} from './legal-core.ts';import {ArticleError} from './core.ts';
export function refuseArticleDraft(state:State,venture:VentureRecord,order:OrderRecord,now:string){if(businessPlaybookId(state,venture)!=='podcast-to-article')return;const record=listRecords(state,'venture-article-ledger',venture.id).find(r=>r.orderId===order.id&&r.clientId===order.clientId);check(record,'ARTICLE_NOT_FOUND','Prepare this order episode evidence first.');try{requireCurrentArticle({now,find:(kind,id)=>listRecords(state,kind,venture.id).find(r=>r.id===id)},record);if((order.chainStage??1)>1)check(record.selection,'ARTICLE_OUTLINE_REQUIRED','Approve the episode direction and sections before drafting.');articleLegalReady(findRecord(state,'venture-record',venture.id)?.launchStage??venture.launchStage);}catch(e){if(e instanceof ArticleError)throw new ChausarError(e.code,e.message);throw e;}}
