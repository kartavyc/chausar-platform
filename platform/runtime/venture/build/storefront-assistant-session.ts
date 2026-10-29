// Buyer bodies live only in this bounded process memory. No record, disk, telemetry or model-call log is written.
import {randomBytes,randomUUID} from 'node:crypto';
import {check,digest} from '../../portable.ts';
export type StorefrontQuote={connectionId:string;model:string;route:'openai-responses'|'anthropic-messages';maxMicros:string;rateDigest:string;keyDigest:string;binding:string};
type Pending={id:string;question:string;quote:StorefrontQuote;digest:string;createdAt:number;expiresAt:number;phase:'waiting'|'sending'|'answered'|'failed';answer:unknown};
type Session={token:string;businessId:string;orderId:string;configDigest:string;expiresAt:number;pending:Pending|null};
const TTL=10*60*1000;
/** The hosting process owns this object and closes it on shutdown. Inactivity and hard expiry remove all text. */
export class StorefrontSessions{
 private readonly sessions=new Map<string,Session>();
 private readonly timer:ReturnType<typeof setInterval>;
 private readonly clock:()=>number;
 constructor(clock:()=>number=Date.now){this.clock=clock;this.timer=setInterval(()=>this.sweep(),30000);this.timer.unref();}
 private sweep(){const now=this.clock();for(const [token,session]of this.sessions)if(session.expiresAt<=now)this.sessions.delete(token);}
 private current(token:string){this.sweep();const session=this.sessions.get(token);check(session,'STOREFRONT_SESSION_EXPIRED','This chat session ended. Start a new one or open the shop.');return session;}
 open(businessId:string,orderId:string,configDigest:string){this.sweep();check(this.sessions.size<256&&[...this.sessions.values()].filter(s=>s.businessId===businessId&&s.orderId===orderId).length<20,'STOREFRONT_BUSY','The shop assistant is busy. Open the shop or try later.');const session:Session={token:randomBytes(32).toString('base64url'),businessId,orderId,configDigest,expiresAt:this.clock()+TTL,pending:null};this.sessions.set(session.token,session);return {token:session.token,expiresAt:session.expiresAt};}
 scope(token:string){const s=this.current(token);return {businessId:s.businessId,orderId:s.orderId,configDigest:s.configDigest};}
 ask(token:string,question:unknown,quote:StorefrontQuote){const session=this.current(token);check(typeof question==='string'&&question.trim().length>0&&question.length<=2000,'STOREFRONT_QUESTION_INVALID','Ask a product question of at most 2000 characters. Do not add personal or payment details.');check(!session.pending||!['waiting','sending'].includes(session.pending.phase),'STOREFRONT_REQUEST_PENDING','Wait for the current question or end this chat.');check(/^\d{1,20}$/.test(quote.maxMicros),'INVALID_AMOUNT','The AI request needs an exact code quote.');const id=randomUUID(),createdAt=this.clock(),expiresAt=Math.min(session.expiresAt,createdAt+TTL),base={id,question,quote:structuredClone(quote),createdAt,expiresAt};session.pending={...base,digest:digest(base),phase:'waiting',answer:null};return structuredClone(session.pending);}
 ownerPending(businessId:string,orderId:string){this.sweep();return [...this.sessions.values()].filter(s=>s.businessId===businessId&&s.orderId===orderId&&s.pending?.phase==='waiting').map(s=>({token:s.token,configDigest:s.configDigest,...structuredClone(s.pending!)}));}
 claim(token:string,id:string,approvedDigest:string,currentQuote:StorefrontQuote){const session=this.current(token),p=session.pending;check(p&&p.phase==='waiting'&&p.id===id&&p.digest===approvedDigest&&p.expiresAt>this.clock()&&digest(p.quote)===digest(currentQuote),'APPROVAL_STALE','Approve this exact current buyer question, model and cost.');p.phase='sending';return structuredClone(p);}
 /** Called synchronously at transport dispatch, after all awaited authority/source/key checks. */
 assertSending(token:string,id:string,approvedDigest:string,currentQuote:StorefrontQuote){const p=this.current(token).pending;check(p&&p.phase==='sending'&&p.id===id&&p.digest===approvedDigest&&p.expiresAt>this.clock()&&digest(p.quote)===digest(currentQuote),'APPROVAL_STALE','The buyer session or exact approval changed before sending.');}
 finish(token:string,id:string,answer:unknown){const p=this.current(token).pending;check(p&&p.id===id&&p.phase==='sending','APPROVAL_STALE','The buyer session ended before the answer returned.');check(JSON.stringify(answer).length<=100000,'STOREFRONT_OUTPUT_REJECTED','The answer is too large. Open the shop.');p.answer=structuredClone(answer);p.question='';p.phase='answered';}
 fail(token:string,id:string){const session=this.sessions.get(token),p=session?.pending;if(p?.id===id){p.question='';p.answer=null;p.phase='failed';}}
 poll(token:string){const p=this.current(token).pending;return {phase:p?.phase??'ready',answer:structuredClone(p?.answer??null)};}
 end(token:string){this.sessions.delete(token);}
 forget(businessId:string,orderId?:string){for(const [token,s]of this.sessions)if(s.businessId===businessId&&(orderId===undefined||s.orderId===orderId))this.sessions.delete(token);}
 close(){clearInterval(this.timer);this.sessions.clear();}
}
