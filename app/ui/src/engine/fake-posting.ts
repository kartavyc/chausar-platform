import openCards from './fixtures-open-posting.json';
import {OPEN_NAMES,openIdentity,openFakeAccount,openFakePosts,openFakeDraft} from './fake-open-publish';
import {historyRisk} from '../../../../platform/runtime/venture/playbooks/social/risk-history';
import {d3Object} from '../../../../platform/runtime/venture/playbooks/social/d3-core';
import type {FakeForgottenPerson} from './fake-playbooks';
/**
 * The fake engine's answers for posting (Ink v2 wave 2, packages 2B1 and 2B2): a post proposed from a checked draft
 * (venture.posting.propose), signing in to a platform (venture.posting.signIn), checking the browser steps
 * (venture.posting.checkSteps, 2B2) and the client's answer the owner records (venture.share.recordAnswer). It keeps
 * the engine's rules the screens rely on (build/posting.ts, build/share-links.ts): a post is named by its id
 * '<draft id>.post-<n>' and never by its text, it waits for the client's recorded approval and then on Today as a
 * connector row whose line starts with the consent line; an answer is recorded once, only on a shared draft; sign-in
 * works only on the desktop, only for text platforms. The fake holds no draft texts, so it knows a draft's posts only
 * from what the share list says; with none, every id names no post, as the engine says of an id it cannot find.
 */

import {
  EngineError, type DraftPostLite, type OwnerPostingLimits, type PostingLimitsView, type PostingProposal, type QueueRow, type ShareAnswer, type ShareLink,
  type PostingStepsView, type VentureRunEvent, type QueueItemView, type QueueDecision, type ConnectorCardLite,
} from './types';

import type { ScheduledPostSnapshot, ScheduledPostBinding } from '../../../../platform/runtime/venture/playbooks/social/scheduled-core';
export interface PostingHost {
  eraseInfluencerCopies?(orderIds:readonly string[]):void;
  draftText?(id:string):string|null;
  sharedDraftDigest?(id:string):string|null;
  uploadFingerprint?(id:string):string|null;
  current(): string;
  now(): string;
  emit(event: VentureRunEvent): void;
  /** Whether this answers as the hosted web server, where posting through the owner's own browser is not offered. */
  hosted(): boolean;
  /** Today's rows, to add the row a post waits on, and the fake's digest for a new row. */
  rows(): QueueRow[];
  setRows(rows: QueueRow[]): void;
  digest(value: unknown): string;
  /** Another desk's answer, for the records this desk reads (orders, delivery runs, share links, connectors). */
  ask(method: string, params: Record<string, unknown>): unknown;
}

const POSTING_METHODS = new Set<string>([
  'venture.posting.propose', 'venture.posting.signIn', 'venture.share.recordAnswer', 'venture.posting.limits.get', 'venture.posting.limits.set',
  'venture.posting.checkSteps',
]);
/** Chausar's own posting limits (playbooks/social/post-limits.ts) in the owner's units, and which way is stricter. */
const HOUSE_LIMITS: OwnerPostingLimits = { capPer24h: 3, minGapMinutes: 60, warmUpDays: 7, duplicatePercent: 85, linkStreak: 3 };
const LOWER_IS_STRICTER = new Set<keyof OwnerPostingLimits>(['capPer24h', 'duplicatePercent', 'linkStreak']);
const LIMIT_WORDS: Readonly<Record<keyof OwnerPostingLimits, string>> = {
  capPer24h: 'posts in 24 hours', minGapMinutes: 'minutes between posts', warmUpDays: 'warm-up days', duplicatePercent: 'near-duplicate percent', linkStreak: 'posts in a row linking one site',
};
const LIMITS_LINE = "Chausar's own posting limits are the loosest it posts at. You can only make them stricter, per channel, for this business; posts from every business on this computer count toward them.";

/** The engine's words (build/posting.ts, build/share-links.ts). */
export const POSTING_WORDS = Object.freeze({
  linkedin: 'LinkedIn is copy-and-open only.',
  consent: "Chausar will post in a browser window on this computer. Please don't type in that window until the post is done.",
  risk: 'The platform may restrict this account.',
  proposed: 'Waiting on Today for your approval.',
  opened: 'A browser window opened. Sign in there, then close it.',
  hosted: 'Posting through your own browser works only in the desktop app.',
  media: 'Posting a picture or video through the browser is not built yet.',
  noShare: 'Share the draft first, so Chausar knows which text your client saw.',
  notAPost: 'This names no post. A post is one line of a draft, named like "<draft id>.post-1".',
});
const POST_ID = /^([A-Za-z0-9_-]{1,120})\.post-([1-9][0-9]{0,2})$/;
const TEXT_PLATFORMS: Readonly<Record<string, string>> = Object.freeze({ linkedin: 'LinkedIn', x: 'X' });
const MEDIA_PLATFORMS = new Set(['instagram', 'youtube']);

export class FakePostingDesk {
  private readonly host: PostingHost;
  private readonly fresh: boolean;
  /** The client's answers the owner recorded, by business and draft. */
  private answers: Record<string, Record<string, ShareAnswer>> = {};
  private answerPacks:Record<string,Record<string,string>>={};
  forgetPeople(people:readonly FakeForgottenPerson[]):void {
    const tokens=people.flatMap(person=>[...person.names.flatMap(name=>[name,...name.split(/[\s,.]+/).filter(word=>[...word].length>=3)]),...person.emails,...person.phones]).filter(Boolean).map(value=>value.toLowerCase());
    const deliveries=this.host.ask('venture.delivery.list',{}) as {id:string;orderId:string}[],orders=this.host.ask('venture.order.list',{}) as {id:string;clientId:string}[],affected=[...this.scheduledPosts.entries()].filter(([key,e])=>key.startsWith(this.host.current()+':')&&e.open&&(tokens.some(token=>JSON.stringify(e.post).toLowerCase().includes(token))||people.some(p=>p.clientId&&orders.some(o=>o.clientId===p.clientId&&deliveries.some(r=>r.id===e.runId&&r.orderId===o.id))))).map(([,e])=>e.runId);const orderIds=[...new Set(deliveries.filter(r=>affected.includes(r.id)).map(r=>r.orderId))];this.host.eraseInfluencerCopies?.(orderIds);this.eraseRunCopies(affected);
    for(const answer of Object.values(this.answers[this.host.current()]??{}))if(tokens.some(token=>(answer.comment??'').toLowerCase().includes(token)))answer.comment=null;
  }
  eraseRunCopies(ids:readonly string[]):void{const biz=this.host.current();for(const id of ids){delete this.answers[biz]?.[id];delete this.answerPacks[biz]?.[id];}const removed:string[]=[];for(const [key,entry]of this.scheduledPosts)if(key.startsWith(biz+':')&&ids.includes(entry.runId)){removed.push(entry.post.id);this.scheduledPosts.delete(key);}this.host.setRows(this.host.rows().filter(row=>!removed.includes(row.id)));}
  socialClientAnswer(runId:string):{answer:ShareAnswer;packDigest:string}|null {const biz=this.host.current(),answer=this.answers[biz]?.[runId],packDigest=this.answerPacks[biz]?.[runId];return answer&&packDigest?{answer:{...answer},packDigest}:null;}
  private seq = 0;
  private scheduledPosts=new Map<string,{post:ScheduledPostSnapshot;runId:string;sourcePostId:string;binding?:ScheduledPostBinding;open?:{accountDigest:string;sourceDigest:string;filesDigest:string;at:string}}> ();
  private fileDigest(runId:string):string{
    const runs=this.host.ask('venture.delivery.list',{}) as {id:string;orderId:string}[];
    const orderId=Array.isArray(runs)?runs.find(run=>run.id===runId)?.orderId:undefined;
    if(!orderId)return this.host.digest({files:[]});
    const listed=this.host.ask('venture.files.list',{orderId}) as {id:string}[];const files=Array.isArray(listed)?listed.map(file=>({id:file.id,digest:this.host.uploadFingerprint?.(file.id)??null})):[];
    const assets=this.host.ask('venture.assets.list',{orderId});
    return this.host.digest({files,assets});
  }
  scheduledSnapshot(id:string):ScheduledPostSnapshot|null{
    const entry=this.scheduledPosts.get(this.host.current()+':'+id);if(!entry)return null;
    const shared=this.shareList(entry.runId);const answer=this.answers[this.host.current()]?.[entry.runId]??shared.links.find(link=>link.answer)?.answer;
    let blocked=answer?.decision==='approved'?null:{code:'POST_CLIENT_NOT_APPROVED',line:'Your client has not approved this draft.'};
    const live=shared.posts.find(post=>post.draftId===entry.sourcePostId);
    const filesDigest=this.fileDigest(entry.runId);let liveAccount=entry.post.account;
    if(entry.open){try{if(!live||this.host.digest(this.host.draftText?.(entry.runId)??'')!==entry.open.sourceDigest||filesDigest!==entry.open.filesDigest)throw new EngineError('POST_DRAFT_CHANGED','The draft changed after your client approved it. It needs their approval again.');const {account}=openFakeDraft(this.host,entry.runId,live);if(account.digest!==entry.open.accountDigest)throw new EngineError('ACCOUNT_FENCE','The connected account changed. Review this post again.');liveAccount=openIdentity(account.account!);if(this.answerPacks[this.host.current()]?.[entry.runId]!==entry.open.sourceDigest)throw new EngineError('POST_CLIENT_NOT_APPROVED','Your client has not approved this draft.');}catch(error){const e=error as Error&{code?:string};blocked={code:e.code??'INVALID_VENTURE_REQUEST',line:e.message};liveAccount=null;}}
    const state=!entry.post.scheduled&&!this.host.rows().some(row=>row.id===id)?'rejected':entry.post.state;
    return {...entry.post,state,blocked,liveAccount,text:live?.text??'',filesDigest,digest:this.host.digest({id,connectorId:entry.post.connectorId,text:live?.text??'',draftId:entry.post.draftId,...(entry.binding?{scheduled:entry.binding}:{})})};
  }
  moveScheduled(id:string,binding:ScheduledPostBinding):ScheduledPostSnapshot{
    const key=this.host.current()+':'+id;const entry=this.scheduledPosts.get(key);const live=this.scheduledSnapshot(id);
    if(!entry||!live||live.state!=='described'||live.scheduled)throw new EngineError('POST_NOT_FOUND','Choose a waiting post in this business and channel.');
    const nextId='post-fake-'+(++this.seq);entry.post.state='rejected';this.host.setRows(this.host.rows().filter(row=>row.id!==id));
    this.scheduledPosts.set(this.host.current()+':'+nextId,{...entry,binding,post:{...live,id:nextId,state:'described',scheduled:true}});
    return this.scheduledSnapshot(nextId)!;
  }
  decideScheduled(id:string,state:'approved'|'rejected'|'applied'):void{const entry=this.scheduledPosts.get(this.host.current()+':'+id),live=this.scheduledSnapshot(id);if(!entry||!live)throw new EngineError('POST_NOT_FOUND','That post is no longer available.');if(live.claimedAt)throw new EngineError('SLOT_FROZEN','This post has already started.');if(state!=='rejected'){if(live.blocked)throw new EngineError(live.blocked.code,live.blocked.line);if(!live.account)throw new EngineError('ACCOUNT_FENCE','This slot needs a known account before approval.');if(entry.open){this.openRisk(entry.post.connectorId,live.text,id);if(state==='applied')entry.open.at=this.host.now();}}entry.post.state=state;}
  scheduledBusy(exceptId:string):boolean{return [...this.scheduledPosts.entries()].some(([key,entry])=>key.startsWith(this.host.current()+':')&&entry.post.id!==exceptId&&entry.post.state==='approved'&&!!entry.post.claimedAt);}
  eraseScheduled(id:string):void{this.scheduledPosts.delete(this.host.current()+':'+id);}


  constructor(host: PostingHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return POSTING_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.share.recordAnswer': return this.recordAnswer(biz, p);
      case 'venture.posting.propose': return this.propose(biz, p);
      case 'venture.posting.signIn': return this.signIn(p);
      case 'venture.posting.checkSteps': return this.checkSteps(p);
      case 'venture.posting.limits.get': return this.limitsView(biz);
      case 'venture.posting.limits.set': return this.setLimits(biz, p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** The owner's stricter limits, by business and channel. */
  private limits: Record<string, Record<string, Partial<OwnerPostingLimits>>> = {};

  private limitsView(biz: string): PostingLimitsView {
    return {
      channels: Object.entries({...TEXT_PLATFORMS,...OPEN_NAMES}).map(([connectorId, name]) => {
        const owner = { ...(this.limits[biz]?.[connectorId] ?? {}) };
        return { connectorId, name, house: { ...HOUSE_LIMITS }, owner, inUse: { ...HOUSE_LIMITS, ...owner } };
      }),
      line: LIMITS_LINE,
    };
  }

  private setLimits(biz: string, p: Record<string, unknown>): PostingLimitsView {
    const connectorId = typeof p.connectorId === 'string' && ({...TEXT_PLATFORMS,...OPEN_NAMES})[p.connectorId] ? p.connectorId : null;
    if (!connectorId) throw new EngineError('INVALID_VENTURE_REQUEST', 'Posting limits are set for LinkedIn and X.');
    const given = (p.limits && typeof p.limits === 'object' ? p.limits : null) as Record<string, unknown> | null;
    if (!given) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the limits as numbers.');
    const chosen: Partial<OwnerPostingLimits> = {};
    for (const [key, value] of Object.entries(given)) {
      if (!(key in HOUSE_LIMITS)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the limits as numbers.');
      const name = key as keyof OwnerPostingLimits;
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) throw new EngineError('INVALID_VENTURE_REQUEST', `The ${LIMIT_WORDS[name]} must be a whole number from 1.`);
      chosen[name] = value;
    }
    const looser = (Object.keys(chosen) as (keyof OwnerPostingLimits)[])
      .filter((key) => (LOWER_IS_STRICTER.has(key) ? chosen[key]! > HOUSE_LIMITS[key] : chosen[key]! < HOUSE_LIMITS[key]));
    if (looser.length) throw new EngineError('POSTING_LIMIT_LOOSER', `These are looser than Chausar's own limits: ${looser.map((key) => LIMIT_WORDS[key]).join(', ')}. ${LIMITS_LINE}`);
    (this.limits[biz] ??= {})[connectorId] = chosen;
    return this.limitsView(biz);
  }

  connectorCards(cards:ConnectorCardLite[]):ConnectorCardLite[]{const next=cards.filter(c=>!OPEN_NAMES[c.id]);for(const raw of openCards){const card=structuredClone(raw) as ConnectorCardLite,account=openFakeAccount(this.host,card.id),api=card.postingOptions.find(p=>p.mode==='api')!;if(account.connected){api.status='available';api.qualification='fixture-tested';api.reason=null;}card.posting=api;next.push(card);}return next;}
  openPosts(id:string){return openFakePosts(this.host,id);}
  queueView(kind:unknown,id:unknown):QueueItemView|null{const entry=this.scheduledPosts.get(this.host.current()+':'+id);if(kind!=='draft'||!entry?.open)return null;const account=openFakeAccount(this.host,entry.post.connectorId);return{kind:'draft',id:entry.post.id,businessName:this.host.current(),title:'Post to '+OPEN_NAMES[entry.post.connectorId],sections:[{heading:'Account',lines:[account.account?.label??entry.post.account??'']},{heading:'Exact post',lines:[entry.post.text]},{heading:'Approval',lines:['This posts through the official API after your approval.']}]};}
  private openRisk(connectorId:string,text:string,except?:string){const owner=this.limits[this.host.current()]?.[connectorId]??{},limits={capPer24h:owner.capPer24h??3,minGapMinutes:owner.minGapMinutes??60,warmUpDays:owner.warmUpDays??7,duplicateBlockPermille:(owner.duplicatePercent??85)*10,duplicateWarnPermille:600,duplicateWindow:5,linkStreak:owner.linkStreak??3},history=[...this.scheduledPosts.values()].filter(e=>e.open&&e.post.connectorId===connectorId&&e.post.id!==except&&['applied','outcome_unknown'].includes(e.post.state)).map(e=>({id:e.post.id,at:e.open!.at,text:e.post.text})),risk=historyRisk({name:OPEN_NAMES[connectorId]!,text,now:this.host.now(),history,limits});if(risk.blocked)throw new EngineError('POST_RISK_BLOCKED',risk.blocks.join(' '));return risk;}
  decideOpen(id:string,action:string):QueueDecision|null{const entry=this.scheduledPosts.get(this.host.current()+':'+id);if(!entry?.open)return null;try{if(entry.post.state!=='described')throw new EngineError('POST_ALREADY_DECIDED','This post was already decided. Chausar never sends a post twice.');if(action==='deny'){entry.post.state='rejected';return{outcome:'done',line:'You chose not to post this.'};}const shared=this.shareList(entry.runId),post=shared.posts.find(p=>p.draftId===entry.sourcePostId);if(!post||this.host.digest(this.host.draftText?.(entry.runId)??'')!==entry.open.sourceDigest||this.fileDigest(entry.runId)!==entry.open.filesDigest)throw new EngineError('POST_DRAFT_CHANGED','The draft changed after your client approved it. It needs their approval again.');const {account}=openFakeDraft(this.host,entry.runId,post);if(account.digest!==entry.open.accountDigest)throw new EngineError('ACCOUNT_FENCE','The connected account changed. Review this post again.');const answer=this.answers[this.host.current()]?.[entry.runId]??shared.links.find(l=>l.answer)?.answer;if(answer?.decision!=='approved'||this.answerPacks[this.host.current()]?.[entry.runId]!==entry.open.sourceDigest)throw new EngineError('POST_CLIENT_NOT_APPROVED','Your client has not approved this draft.');this.openRisk(entry.post.connectorId,post.text,id);entry.open.at=this.host.now();entry.post.state='applied';this.host.emit({type:'queue.changed',businessId:this.host.current(),at:this.host.now()});return{outcome:'done',line:'Posted to '+OPEN_NAMES[entry.post.connectorId]+'. The network confirmed this post.'};}catch(error){const e=error as Error&{code?:string};return{outcome:'refused',reason:e.code??'INVALID_VENTURE_REQUEST',line:e.message};}}
  private proposeOpen(biz:string,p:Record<string,unknown>,runId:string,post:DraftPostLite,links:ShareLink[],posts:DraftPostLite[]):PostingProposal{d3Object(p,['draftId','account'],['draftId']);const published=[...this.scheduledPosts.values()].find(e=>e.runId===runId&&e.sourcePostId===post.draftId&&e.post.state==='applied'&&e.post.text===post.text);if(published)return{postId:published.post.id,connectorId:post.connectorId!,draftId:post.draftId,part:posts.filter(p=>p.connectorId===post.connectorId).findIndex(p=>p.draftId===post.draftId)+1,state:'applied',line:'Already published, skipped.',warnings:[]};if(p.account!==undefined&&(typeof p.account!=='string'||!p.account.trim()||p.account.length>80))throw new EngineError('INVALID_VENTURE_REQUEST','Name the exact account.');if(p.account!==undefined)throw new EngineError('CONNECTOR_FIELD_UNSUPPORTED','This connector does not take "account" for this. Nothing was sent; take it out and try again.');const {account}=openFakeDraft(this.host,runId,post),name=OPEN_NAMES[post.connectorId!]!,sourceDigest=this.host.digest(this.host.draftText?.(runId)??'');const answer=this.answers[biz]?.[runId]??links.find(l=>l.answer)?.answer;if(answer?.decision!=='approved')throw new EngineError('POST_CLIENT_NOT_APPROVED',answer?.decision==='changes'?'Your client asked for changes.':'Your client has not approved this draft.');if(this.answerPacks[biz]?.[runId]!==sourceDigest)throw new EngineError('POST_DRAFT_CHANGED','The draft changed after your client approved it. It needs their approval again.');const same=[...this.scheduledPosts.values()].filter(e=>e.runId===runId&&e.sourcePostId===post.draftId);if(same.some(e=>e.post.state==='outcome_unknown'))throw new EngineError('JOURNAL_OUTCOME_UNKNOWN','Check '+name+' before posting again: the post may have gone out.');if(same.some(e=>['approved','applied'].includes(e.post.state)))throw new EngineError('POST_ALREADY_DECIDED',`This post already went out on ${name}, or is going out now. Chausar never sends a post twice.`);const risk=this.openRisk(post.connectorId!,post.text),postId='post-fake-'+(++this.seq),identity=openIdentity(account.account!),line=`Post to ${name} as ${identity} through the ${name} API.`,seed:Omit<QueueRow,'digest'>={id:postId,businessId:biz,businessName:this.host.rows().find(r=>r.businessId===biz)?.businessName??biz,kind:'connector',createdAt:this.host.now(),title:'Post to '+name,line,viewRef:{kind:'draft',id:postId},actions:[{id:'deny',label:'Do not post',primary:false},{id:'approve',label:'Approve and post',primary:true,secondAsk:true,requiresView:true}],descriptionComplete:true,preview:{kind:'post',connectorId:post.connectorId!,platform:name,account:account.account!.label,mode:'api',text:post.text,textEstimate:true,counts:[{label:'characters',count:[...post.text].length,limit:account.account!.maxChars}]}};this.host.setRows([...this.host.rows(),{...seed,digest:this.host.digest(seed)}]);this.scheduledPosts.set(biz+':'+postId,{runId,sourcePostId:post.draftId,open:{accountDigest:account.digest,sourceDigest,filesDigest:this.fileDigest(runId),at:this.host.now()},post:{id:postId,connectorId:post.connectorId!,draftId:runId,text:post.text,account:identity,mode:'api',digest:'',filesDigest:this.fileDigest(runId),state:'described',scheduled:false}});this.host.emit({type:'queue.changed',businessId:biz,at:this.host.now()});return{postId,connectorId:post.connectorId!,draftId:post.draftId,part:posts.filter(p=>p.connectorId===post.connectorId).findIndex(p=>p.draftId===post.draftId)+1,state:'described',line:POSTING_WORDS.proposed,warnings:risk.warnings};}
  private shareList(draftId: string): { links: ShareLink[]; posts: DraftPostLite[] } {
    const listed = this.host.ask('venture.share.list', { deliveryId: draftId }) as { links?: ShareLink[]; shares?: ShareLink[]; posts?: DraftPostLite[] };
    return { links: listed.links ?? listed.shares ?? [], posts: listed.posts ?? [] };
  }

  private recordAnswer(biz: string, p: Record<string, unknown>): { answer: ShareAnswer } {
    const draftId = typeof p.draftId === 'string' ? p.draftId : '';
    if (!draftId) throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose the draft.');
    if (p.answer !== 'approved' && p.answer !== 'changes') throw new EngineError('INVALID_VENTURE_REQUEST', 'Choose approved or asked for changes.');
    if (p.comment !== undefined && (typeof p.comment !== 'string' || p.comment.length > 1000)) throw new EngineError('INVALID_VENTURE_REQUEST', 'A comment is text of at most a thousand characters.');
    if (this.shareList(draftId).links.length === 0) throw new EngineError('SHARE_NOT_FOUND', POSTING_WORDS.noShare);
    const mine = (this.answers[biz] ??= {});
    const pack=this.host.draftText?this.host.digest(this.host.draftText(draftId)??''):null;
    if(pack&&this.host.sharedDraftDigest?.(draftId)!==pack)throw new EngineError('APPROVAL_STALE','This draft changed since it was shared. Share the current text first.');
    if (mine[draftId]&&(!pack||this.answerPacks[biz]?.[draftId]===pack)) throw new EngineError('ALREADY_DECIDED', 'Your client already answered on this draft.');
    const comment = typeof p.comment === 'string' && p.comment.trim() ? p.comment.trim() : null;
    mine[draftId] = { draftId, decision: p.answer, comment, at: this.host.now(), via: 'owner-recorded' };
    if(pack)(this.answerPacks[biz]??={})[draftId]=pack;
    return { answer: { ...mine[draftId]! } };
  }

  private propose(biz: string, p: Record<string, unknown>): PostingProposal {
    const match = typeof p.draftId === 'string' ? POST_ID.exec(p.draftId) : null;
    if (!match) throw new EngineError('POST_NOT_A_POST', POSTING_WORDS.notAPost);
    const runId = match[1]!;
    const { links, posts } = this.shareList(runId);
    const post = posts.find((item) => item.draftId === p.draftId);
    if (!post) throw new EngineError('POST_NOT_A_POST', POSTING_WORDS.notAPost);
    if(post.connectorId&&OPEN_NAMES[post.connectorId])return this.proposeOpen(biz,p,runId,post,links,posts);
    if (post.connectorId === 'linkedin') throw new EngineError('NOT_BUILT_YET', POSTING_WORDS.linkedin);
    const name = post.connectorId ? TEXT_PLATFORMS[post.connectorId] : undefined;
    if (!post.connectorId || !name) throw new EngineError('NOT_BUILT_YET', post.connectorId && MEDIA_PLATFORMS.has(post.connectorId) ? POSTING_WORDS.media : `Chausar has no posting connector for ${post.name} in this build. Post it yourself from the calendar file.`);
    if (this.host.hosted()) throw new EngineError('NOT_BUILT_YET', POSTING_WORDS.hosted);
    const answer = this.answers[biz]?.[runId] ?? links.find((link) => link.answer)?.answer ?? null;
    if (answer?.decision !== 'approved') {
      throw new EngineError('POST_CLIENT_NOT_APPROVED', answer?.decision === 'changes' ? 'Your client asked for changes.' : 'Your client has not approved this draft.');
    }
    const postId = `post-fake-${++this.seq}`;
    const businessName = this.host.rows().find((row) => row.businessId === biz)?.businessName ?? biz;
    const seed = {
      id: postId, businessId: biz, businessName, kind: 'connector' as const, createdAt: this.host.now(),
      title: `Post to ${name}`, line: `${POSTING_WORDS.consent} ${POSTING_WORDS.risk}`, viewRef: { kind: 'draft' as const, id: postId },
      actions: [
        { id: 'deny' as const, label: 'Do not post', primary: false },
        { id: 'approve' as const, label: 'Approve and post', primary: true, secondAsk: true, requiresView: true },
      ],
      descriptionComplete: true,
    };
    this.host.setRows([...this.host.rows(), { ...seed, digest: this.host.digest(seed) }]);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    const part = posts.filter((item) => item.connectorId === post.connectorId).findIndex((item) => item.draftId === post.draftId) + 1;
    this.scheduledPosts.set(biz+':'+postId,{runId,sourcePostId:post.draftId,post:{id:postId,connectorId:post.connectorId,draftId:runId,text:post.text,account:'@sample-owner',mode:'owner-browser-session',digest:'',filesDigest:this.fileDigest(runId),state:'described',scheduled:false}});
    return { postId, connectorId: post.connectorId, draftId: post.draftId, part, state: 'described', line: POSTING_WORDS.proposed, warnings: [] };
  }

  private signIn(p: Record<string, unknown>): { opened: true; line: string } {
    const connectorId = typeof p.connectorId === 'string' ? p.connectorId : '';
    if (!TEXT_PLATFORMS[connectorId] && !MEDIA_PLATFORMS.has(connectorId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', POSTING_WORDS.hosted);
    if (MEDIA_PLATFORMS.has(connectorId)) throw new EngineError('NOT_BUILT_YET', POSTING_WORDS.media);
    return { opened: true, line: POSTING_WORDS.opened };
  }

  /**
   * venture.posting.checkSteps (2B2), as build/posting-steps.ts answers after a dry run: the text box and the post
   * button are found today; the confirmation shows only after a post, so it carries the day a post last went out
   * (LinkedIn's sample has one, X's has none). Desktop only, text platforms only.
   */
  private checkSteps(p: Record<string, unknown>): PostingStepsView {
    const connectorId = typeof p.connectorId === 'string' ? p.connectorId : '';
    if (!TEXT_PLATFORMS[connectorId] && !MEDIA_PLATFORMS.has(connectorId)) throw new EngineError('INVALID_VENTURE_REQUEST', 'Posting works only on LinkedIn, X, Instagram and YouTube.');
    if (this.host.hosted()) throw new EngineError('TIER_UNAVAILABLE', POSTING_WORDS.hosted);
    if (MEDIA_PLATFORMS.has(connectorId)) throw new EngineError('NOT_BUILT_YET', POSTING_WORDS.media);
    const today = this.host.now().slice(0, 10);
    const posted = STEPS_LAST_POSTED[connectorId] ?? null;
    const candidates = STEP_CANDIDATES[connectorId]!;
    const steps = (['textbox', 'submit', 'confirm'] as const).map((step) => ({
      step, candidates: [{ ...candidates[step], checkedOn: step === 'confirm' ? posted : today, addedBy: 'chausar' as const }],
      // The confirm step also carries the platform's response rule, dated only by a post the response confirmed.
      ...(step === 'confirm' ? { response: { ...RESPONSE_RULES[connectorId]!, checkedOn: null } } : {}),
    }));
    const stepsCheckedOn = posted === null ? null : posted < today ? posted : today;
    return { connectorId, steps, stepsCheckedOn, boxAndButtonCheckedOn: today, line: posted === null ? STEPS_WORDS.confirmWaits : STEPS_WORDS.found };
  }
}

/** The engine's words after a check of the posting steps (build/posting-steps.ts). */
const STEPS_WORDS = Object.freeze({
  found: 'Every step was found the way Chausar knows it.',
  confirmWaits: 'The post confirmation shows only after a post, so the first post that goes out checks it.',
});
/** The day a post last went out and dated the confirmation, in the sample business. */
const STEPS_LAST_POSTED: Readonly<Record<string, string>> = Object.freeze({ linkedin: '2026-10-21' });
/** Each platform's response rule as build/browser.ts ships it, keyed 'response:<method> <path>'. */
const RESPONSE_RULES: Readonly<Record<string, { key: string; method: string; path: string }>> = Object.freeze({
  x: { key: 'response:POST ^/i/api/graphql/[^/]+/CreateTweet$', method: 'POST', path: '^/i/api/graphql/[^/]+/CreateTweet$' },
  linkedin: { key: 'response:POST ^/voyager/api/contentcreation/normShares', method: 'POST', path: '^/voyager/api/contentcreation/normShares' },
});
const LINKEDIN_BUTTON = '//button[contains(concat(" ", normalize-space(@class), " "), " share-actions__primary-action ")]';
/** Each step's first candidate, as build/browser.ts ships them. */
const STEP_CANDIDATES: Readonly<Record<string, Record<'textbox' | 'submit' | 'confirm', { key: string; kind: 'test-id' | 'role' | 'aria-label' | 'xpath'; value: string }>>> = Object.freeze({
  x: {
    textbox: { key: 'test-id:tweetTextarea_0', kind: 'test-id', value: 'tweetTextarea_0' },
    submit: { key: 'test-id:tweetButton', kind: 'test-id', value: 'tweetButton' },
    confirm: { key: 'test-id:toast', kind: 'test-id', value: 'toast' },
  },
  linkedin: {
    textbox: { key: 'xpath://div[@role="textbox"][@contenteditable="true"]', kind: 'xpath', value: '//div[@role="textbox"][@contenteditable="true"]' },
    submit: { key: `xpath:${LINKEDIN_BUTTON}`, kind: 'xpath', value: LINKEDIN_BUTTON },
    confirm: { key: 'role:alert', kind: 'role', value: 'alert' },
  },
});
