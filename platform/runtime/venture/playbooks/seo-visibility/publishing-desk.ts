// Original SEO10 integration. WordPress handbook and loamwright Apache-2.0 ideas, no copied source.
import {authorize,check,type State} from '../../../contracts.ts';
import type {SecretName,VentureDeps,VentureRecord} from '../../contracts.ts';
import {digest,findRecord,listRecords,readVenture,requireAppChannel,ventureAction} from '../../records.ts';
import {acceptedBlueprintOrNull} from '../../delivery/shared.ts';
import {countedAnswer} from '../../build/share-links.ts';
import {clientDraft} from '../../build/draft-text.ts';
import {sendWordpressDraft,verifyWordpressLive,wordpressUrl,type WordpressConnection,type WordpressResult} from '../../build/wordpress.ts';
import {resolvePublic,pinnedSend} from '../../core/net-guard.ts';
import {journalled} from '../../journal/journal.ts';
import {seoExact} from './work-core.ts';
import type {DeskHandlers} from '../desk-types.ts';
import type {SeoPublication} from './records.ts';
import {articleHtml} from './article-html.ts';
export type SeoPublishingDeskTypes={publishing:{filter:null;row:any;item:any;actions:Record<string,{payload:any;result:any}>}};
const secret=(ventureId:string):SecretName=>`seo:${ventureId}:wordpress`;
function connection(deps:VentureDeps,id:string):WordpressConnection|null{const raw=deps.secrets.get(secret(id));return raw?JSON.parse(raw):null;}
/** Derive exact publishable bytes only from the current owner-accepted, client-approved SEO article. */
export function approvedSeoDraft(state:State,venture:VentureRecord,runId:string,purpose:'article'|'edge'='article'){
 const run=findRecord(state,'venture-delivery-run',runId),order=run?findRecord(state,'venture-order',run.orderId):null;
 check(run&&order&&run.ventureId===venture.id&&order.ventureId===venture.id&&!run.practice,'DELIVERY_NOT_FOUND','Choose a real client article.');
 const playbook=findRecord(state,'venture-playbook',run.playbookId),offer=acceptedBlueprintOrNull(state,venture)?.offers.find(o=>o.id===order.offerId);check(playbook?.flagship==='seo-visibility'&&(purpose==='edge'?['content-retainer','local-seo','fix-and-measure']:['content-retainer','local-seo']).includes(offer?.playbookOffer??''),'SEO_DRAFT_REQUIRED','Choose a search visibility article.');
 check(['accepted','edited'].includes(run.status),'OWNER_APPROVAL_FIRST','Approve this exact draft before sending it to WordPress.');
 check(!run.checks?.some(c=>!c.passed&&!c.notChecked)&&!run.playbookChecks?.some(c=>c.outcome==='fail'),'SEO_CHECK_FAILED','Resolve this draft checks before sending it.');
 const shown=clientDraft(run);check(shown.text&&shown.digest,'SEO_DRAFT_REQUIRED','This draft has no current client text.');
 check(countedAnswer(state,run)?.decision==='approved','SEO_CLIENT_APPROVAL_REQUIRED','The client must approve this exact draft before it leaves Chausar.');
 return {run,order,shown};
}
function preview(deps:VentureDeps,state:State,venture:VentureRecord,runId:string){
 const config=connection(deps,venture.id);check(config,'WORDPRESS_CREDENTIALS_REQUIRED','Connect the client WordPress site in Connections.');
 const {run,order,shown}=approvedSeoDraft(state,venture,runId);
 const site=order.intake?.fields?.wordpressUrl??order.intake?.fields?.siteUrl;
 check(typeof site==='string'&&wordpressUrl(site).origin===wordpressUrl(config.url).origin,'WORDPRESS_SITE_MISMATCH','The connection must be on this client order website.');
 const item={runId:run.id,orderId:order.id,title:shown.title,text:shown.text!,content:articleHtml(shown.text!),status:'draft' as const,site:config.url,draftDigest:shown.digest!,connectionDigest:digest(config)};
 return {item,digest:digest(item)};
}
export const SEO_PUBLISHING_DESK:DeskHandlers={publishing:{
 async list(deps,ctx,p){seoExact(p,['playbook','kind','filter'],['playbook','kind']);check(p.filter===undefined||p.filter===null,'INVALID_VENTURE_REQUEST','This list has no filters.');const {state,venture}=readVenture(deps,ctx);return {playbook:'seo-visibility',kind:'publishing',rows:listRecords(state,'venture-seo-finding',venture.id).filter(r=>r.publication).map(r=>({id:r.id,...r.publication})),line:'WordPress drafts and public-page verification. Publishing remains your own step.'};},
 async get(deps,ctx,p){seoExact(p,['playbook','kind','id']);const {state,venture}=readVenture(deps,ctx);if(p.id==='connection'){const config=connection(deps,venture.id),item={connected:!!config,url:config?.url??null,username:config?.username??null};return {playbook:'seo-visibility',kind:'publishing',item,digest:digest(item)};}const saved=listRecords(state,'venture-seo-finding',venture.id).find(r=>r.id===p.id&&r.publication);if(saved)return {playbook:'seo-visibility',kind:'publishing',item:saved.publication,digest:digest(saved.publication)};return {playbook:'seo-visibility',kind:'publishing',...preview(deps,state,venture,p.id)};},
 async act(deps,ctx,p){requireAppChannel(ctx,'venture.desk.act');seoExact(p,['playbook','kind','id','action','payload','digest'],['playbook','kind','id','action','payload']);authorize(deps.store,ctx,'approve');const {state,venture}=readVenture(deps,ctx);
  if(p.action==='configure'){
   check(p.id==='connection','INVALID_VENTURE_REQUEST','Configure the site connection.');const b=seoExact(p.payload,['url','username','password']);check(typeof b.url==='string'&&typeof b.username==='string'&&b.username.trim().length>0&&b.username.length<=100&&!/[:\r\n]/.test(b.username)&&typeof b.password==='string'&&b.password.length>0&&b.password.length<=300,'WORDPRESS_CREDENTIALS_REQUIRED','Enter the site, username and application password.');const url=wordpressUrl(b.url);await resolvePublic(url.hostname,deps.net?.resolve);check(readVenture(deps,ctx).venture.id===venture.id,'APPROVAL_STALE','The business changed. Connect it again.');deps.secrets.set(secret(venture.id),JSON.stringify({url:url.href,username:b.username,password:b.password}));return {playbook:'seo-visibility',kind:'publishing',id:'connection',result:{connected:true,url:url.href,username:b.username},line:'Connected for this open session. Each exact draft still asks.'};
  }
  if(p.action==='disconnect'){seoExact(p.payload,[]);check(p.id==='connection','INVALID_VENTURE_REQUEST','Choose the connection.');deps.secrets.delete(secret(venture.id));return {playbook:'seo-visibility',kind:'publishing',id:'connection',result:{connected:false,url:null,username:null},line:'WordPress connection removed.'};}
  if(p.action==='send'){
   seoExact(p.payload,[]);const seen=preview(deps,state,venture,p.id);check(p.digest===seen.digest,'APPROVAL_STALE','This draft or connection changed. Review it again.');
   const done=await journalled<WordpressResult>(deps,ctx,{action:'connector.write',operation:'wordpress-draft',subject:'wordpress:'+p.id+':'+seen.item.draftDigest,target:'WordPress at '+new URL(seen.item.site).hostname,actionDigest:seen.digest,line:'Create this exact client-approved WordPress draft: '+seen.item.title},async()=>{
    const live=readVenture(deps,ctx);check(live.venture.id===venture.id&&preview(deps,live.state,live.venture,p.id).digest===seen.digest,'APPROVAL_STALE','The draft or connection changed. Nothing was sent.');
    const result=await sendWordpressDraft(connection(deps,venture.id)!,seen.item,{...deps.net,send:target=>{const current=readVenture(deps,ctx);check(current.venture.id===venture.id&&preview(deps,current.state,current.venture,p.id).digest===seen.digest,'APPROVAL_STALE','The draft or connection changed. Nothing was sent.');return (deps.net?.send??pinnedSend)(target);}});
    await ventureAction(deps,ctx,'approve','seo.wordpress.result',tx=>{const publication:SeoPublication={runId:p.id,orderId:seen.item.orderId,draftDigest:seen.item.draftDigest,connectionDigest:seen.item.connectionDigest,outcome:result.outcome,postId:result.id,link:result.link,at:tx.now,acceptance:null};tx.put({...tx.base('venture-seo-finding'),sourceUrl:seen.item.site,ruleId:'wordpress-draft',evidenceDigest:seen.digest,state:'open',publication});});
    return {outcome:result.outcome,line:result.line,value:result};
   });
   const saved=listRecords(deps.store.read(),'venture-seo-finding',venture.id).find(r=>r.publication?.runId===p.id&&r.publication.draftDigest===seen.item.draftDigest);
   return {playbook:'seo-visibility',kind:'publishing',id:saved?.id??p.id,result:done.value??{outcome:saved?.publication?.outcome??'unknown',id:saved?.publication?.postId??null,link:saved?.publication?.link??null,line:'This exact draft already has a recorded send outcome.'},line:done.entry.journal.at(-1)?.line??'Read the recorded outcome.'};
  }
  check(p.action==='verify','INVALID_VENTURE_REQUEST','Choose a publishing action.');const b=seoExact(p.payload,['url']);check(typeof b.url==='string','WORDPRESS_DRAFT_INVALID','Name the published page.');const record=listRecords(state,'venture-seo-finding',venture.id).find(r=>r.id===p.id&&r.publication?.outcome==='applied');check(record?.publication,'SEO_PUBLICATION_REQUIRED','Choose a confirmed WordPress draft.');check(p.digest===digest(record.publication),'APPROVAL_STALE','The publication evidence changed. Read it again.');check(new URL(b.url).origin===new URL(record.sourceUrl).origin,'WORDPRESS_SITE_MISMATCH','Verify the client site only.');const source=approvedSeoDraft(state,venture,record.publication.runId);check(source.shown.digest===record.publication.draftDigest,'SEO_CLIENT_APPROVAL_REQUIRED','The article changed after this draft was sent.');const result=await verifyWordpressLive({url:b.url,siteUrl:record.sourceUrl,title:source.shown.title,heading:source.shown.title,text:source.shown.text!},deps.net);await ventureAction(deps,ctx,'approve','seo.wordpress.verify',tx=>{const current=tx.find('venture-seo-finding',record.id)!;check(digest(current.publication)===p.digest&&approvedSeoDraft(tx.state,tx.venture!,record.publication!.runId).shown.digest===record.publication!.draftDigest,'APPROVAL_STALE','The publication or client draft changed.');tx.replace({...current,publication:{...current.publication!,acceptance:{url:b.url,checkedOn:tx.now.slice(0,10),receipt:result.receipt,articleDigest:result.articleDigest,pass:result.pass}}});});return {playbook:'seo-visibility',kind:'publishing',id:record.id,result,line:result.line};
 }
}};
