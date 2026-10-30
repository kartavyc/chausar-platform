// Browser copy of the pure support domain for fake parity. Original Chausar code; generated from support-desk modules.
import { EngineError } from "./types";
function check(value: unknown, code: string, words: string): asserts value { if (!value) throw new EngineError(code,words); }
// Support records, independently written from nexusdesk (Apache-2.0) and ResolveHQ ideas (source-available, no copied code).
export type TicketStatus = 'open' | 'in-progress' | 'waiting-customer' | 'resolved' | 'closed';
export type SupportDraft = { original: string; translated: string; language: string; sources: string[]; approved: boolean; policyChange: boolean; sourceFiles?: {id:string;digest:string}[] };
export type SupportTicketBody = {
  replyAddress?:string; customerMatch?:ShopCustomerMatch; customerOrderNumber?:string; customerPhone?:string; serviceOrderId?: string | null; shopClientId?: string | null; policyApproval?: {shareId:string;replyDigest:string} | null; number?: string; rating?: { tokenHash: string; expiresAt: string }; proposal?: { expiresAt: string } | null; thread: string; customerEmail: string; subject: string; language: string; blocked: boolean;
  status: TicketStatus; revision: number; note: string; autoDraftsPaused: boolean;
  dueAt: string | null; resolutionDueAt: string | null; snoozedAt: string | null; snoozeUntil: string | null; snoozeReason: string | null;
  draft: SupportDraft | null; sentAt: string | null; messages: SupportMessageBody[]; policyChangeApproved: boolean;
};
export type SupportMessageBody = { ticketId: string; messageId: string | null; sender: string; text: string; at: string; messageKind: 'customer' | 'owner' | 'system'; references: string[]; untrusted: boolean };
export type SupportRequestBody = { ticketId: string; requestKind: 'refund' | 'replacement'; amountText: string; currency: string; state: 'requested, not done' };
export type SupportRatingBody = { ticketId: string; score: number; at: string };






// Ticket states and owner mail handoff. Ideas: nexusdesk (Apache-2.0), ResolveHQ (source-available, ideas only), RFC 5322. No copied code.

export type TicketInput = { thread: string; customerEmail: string; subject: string; language: string; blocked: boolean };
export type TicketProposal = TicketInput & { dedupKey: string; expiresAt: string };
const NEXT: Record<TicketStatus, readonly TicketStatus[]> = {
  open: ['in-progress', 'closed'], 'in-progress': ['waiting-customer', 'resolved', 'closed'],
  'waiting-customer': ['in-progress', 'closed'], resolved: ['in-progress', 'closed'], closed: [],
};
/** A proposal creates nothing, expires after half an hour, and deduplicates by conversation. */
export function proposeTicket(input: TicketInput, now: string, existing: readonly Pick<SupportTicketBody, 'thread'>[] = []): TicketProposal {
  check(input && typeof input.thread === 'string' && input.thread.length > 0 && input.thread.length <= 120, 'INVALID_VENTURE_REQUEST', 'Choose a mail conversation.');
  check(typeof input.customerEmail === 'string' && /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.customerEmail), 'INVALID_VENTURE_REQUEST', 'The customer needs a valid email address.');
  check(typeof input.subject === 'string' && input.subject.trim().length > 0 && input.subject.length <= 200 && !/[\r\n]/.test(input.subject), 'INVALID_VENTURE_REQUEST', 'Keep the subject to a short line.');
  check(typeof input.language === 'string' && /^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(input.language) && typeof input.blocked === 'boolean', 'INVALID_VENTURE_REQUEST', 'Choose the customer language and blocked state.');
  check(!existing.some(t => t.thread === input.thread), 'TICKET_DUPLICATE', 'This conversation already has a ticket.');
  check(Number.isFinite(Date.parse(now)), 'INVALID_VENTURE_REQUEST', 'The proposal needs a valid time.');
  return { ...input, customerEmail: input.customerEmail.toLowerCase(), subject: input.subject.trim(), dedupKey: input.thread, expiresAt: new Date(Date.parse(now) + 30 * 60000).toISOString() };
}
/** Confirms an unexpired proposal only once the conversation has no active run. */
export function confirmTicket(p: TicketProposal, now: string, active: boolean): SupportTicketBody {
  check(Date.parse(now) < Date.parse(p.expiresAt), 'TICKET_EXPIRED', 'This ticket proposal expired. Review a fresh proposal.');
  check(!active, 'TICKET_RUN_ACTIVE', 'Wait for this conversation run to stop before confirming the ticket.');
  return { thread: p.thread, customerEmail: p.customerEmail, subject: p.subject, language: p.language, blocked: p.blocked, status: 'open', revision: 1, note: '', autoDraftsPaused: p.blocked, dueAt: null, resolutionDueAt: null, snoozedAt: null, snoozeUntil: null, snoozeReason: null, draft: null, sentAt: null, messages: [], policyChangeApproved: false };
}
/** Owner status changes check the revision; closing is final and a resolution needs a note. */
export function moveTicket<T extends SupportTicketBody>(ticket: T, revision: number, status: TicketStatus, note: string): T {
  check(ticket.revision === revision, 'TICKET_STALE', 'This ticket changed. Open it again before deciding.');
  check(ticket.status !== 'closed', 'TICKET_CLOSED', 'A closed ticket stays closed. Start a new conversation.');
  check(NEXT[ticket.status].includes(status), 'TICKET_TRANSITION_REFUSED', 'That ticket move is not allowed.');
  check(typeof note === 'string' && note.length <= 2000, 'INVALID_VENTURE_REQUEST', 'Keep the note short.');
  check(!['resolved', 'closed'].includes(status) || note.trim().length > 0, 'TICKET_NOTE_REQUIRED', 'Add a note before resolving or closing this ticket.');
  return { ...ticket, status, note: note.trim(), revision: revision + 1 };
}
/** Requested money is text from the customer, never an executed refund or a computed figure. */
export function requestMoney(input: { kind: 'refund' | 'replacement'; amountText: string; currency: string }): { kind: 'refund' | 'replacement'; amountText: string; currency: string; state: 'requested, not done' } {
  check(['refund', 'replacement'].includes(input.kind) && typeof input.amountText === 'string' && /^\d{1,12}(?:\.\d{1,2})?$/.test(input.amountText) && /^[A-Z]{3}$/.test(input.currency), 'INVALID_VENTURE_REQUEST', 'A request needs its kind, amount text and currency.');
  return { ...input, state: 'requested, not done' };
}
/** A saved draft cannot imply a money action or delivery that has not happened. */
export function checkSupportDraft(text: string): { pass: boolean; why: string } {
  const honest=text.replace(/\b(?:not|never|haven't|hasn't|wasn't|weren't|isn't|aren't)\s+(?:(?:yet|been|being|already)\s+)*(?:refunded|reimbursed|processed|issued|sent|completed|credited|done|delivered)\b/gi,'pending');
  const done = /\b(?:refunded|reimbursed)\b|\b(?:processed|issued|sent|completed|credited)\b[^.!?\n]{0,40}\b(?:refund|payment|replacement)\b|\b(?:refund|payment|replacement)\b[^.!?\n]{0,55}\b(?:processed|issued|sent|completed|credited|done)\b|\b(?:reply|message|email)\b[^.!?\n]{0,40}\b(?:delivered|sent)\b|(?:रिफंड|भुगतान|वापसी)[^।\n]{0,40}(?:कर दिया|हो गया|भेज दिया)|\b(?:will|shall|guarantee)\b[^.!?\n]{0,35}\b(?:refund|pay|reimburse)\b/i.test(honest);
  return { pass: !done, why: done ? 'A request is not a completed money action, and saving is not sending.' : 'No unperformed money action or send is claimed.' };
}
export type MailDraft = { replyTo?:string; to: string; subject: string; text: string; messageId: string | null; references: readonly string[] };
/** An unsent RFC mail file and mailto link. Nothing here sends mail. */
export function sendHandoff(input: MailDraft): { eml: string; mailto: string; text: string; sent: false } {
  for (const value of [input.to, input.replyTo??'', input.subject, input.messageId ?? '', ...input.references]) check(!/[\r\n]/.test(value), 'SUPPORT_HEADER_REFUSED', 'A mail header cannot contain another line.');
  check(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.to), 'SUPPORT_HEADER_REFUSED', 'Choose the customer email address.');
  for (const id of [...input.references, ...(input.messageId ? [input.messageId] : [])]) check(/^<[^\s<>]+@[^\s<>]+>$/.test(id), 'SUPPORT_HEADER_REFUSED', 'A threading id must be a mail Message-ID.');
  const refs = [...new Set([...input.references, ...(input.messageId ? [input.messageId] : [])])];
  if(input.replyTo)check(/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(input.replyTo),'SUPPORT_HEADER_REFUSED','Choose a valid reply address.');
  const headers = [`To: ${input.to}`, ...(input.replyTo?[`Reply-To: ${input.replyTo}`]:[]), `Subject: ${input.subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'X-Unsent: 1', ...(input.messageId ? [`In-Reply-To: ${input.messageId}`] : []), ...(refs.length ? [`References: ${refs.join(' ')}`] : [])];
  return { eml: `${headers.join('\r\n')}\r\n\r\n${input.text.replace(/\r?\n/g, '\r\n')}`, mailto: `mailto:${encodeURIComponent(input.to)}?subject=${encodeURIComponent(input.subject)}&body=${encodeURIComponent(input.text)}`, text: input.text, sent: false };
}


// Business-hour arithmetic and paused clocks. ResolveHQ (source-available) supplied ideas only; original code.
export type ShopHours = { timeZone: string; hours: readonly { day: number; start: string; end: string }[]; holidays: readonly string[] };
const MINUTE = 60000;
function localParts(instant: number, timeZone: string): { day: string; minute: number } {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(instant);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minute: Number(get('hour')) * 60 + Number(get('minute')) };
}
function wallTime(day: string, minute: number, zone: string): number {
  const target = Date.parse(`${day}T00:00:00.000Z`) + minute * MINUTE;
  let candidate = target;
  for (let i = 0; i < 4; i++) {
    const p = localParts(candidate, zone);
    const observed = Date.parse(`${p.day}T00:00:00.000Z`) + p.minute * MINUTE;
    const delta = target - observed;
    if (delta === 0) return candidate;
    candidate += delta;
  }
  check(false, 'SUPPORT_HOURS_INVALID', 'The shop hours fall in a clock change. Choose another time.');
}
function minuteOf(value: string): number {
  check(/^([01]\d|2[0-3]):[0-5]\d$/.test(value), 'SUPPORT_HOURS_INVALID', 'Shop hours use a valid local time.');
  const [h,m] = value.split(':').map(Number); return h! * 60 + m!;
}
/** Adds real open-window time in the shop timezone, with holidays; unset policy is always open. */
export function dueAt(start: string, hours: number, policy?: ShopHours): string {
  let cursor = Date.parse(start), remaining = hours * 3600000;
  check(Number.isFinite(cursor) && Number.isFinite(hours) && hours > 0 && hours <= 24 * 365, 'SUPPORT_HOURS_INVALID', 'Choose a positive response target within a year.');
  if (!policy) return new Date(cursor + remaining).toISOString();
  check(policy.hours.length > 0 && policy.hours.length <= 21, 'SUPPORT_HOURS_INVALID', 'Choose shop opening hours or leave hours unset for always open.');
  try { localParts(cursor, policy.timeZone); } catch { check(false, 'SUPPORT_HOURS_INVALID', 'Choose a valid shop timezone.'); }
  const windows = policy.hours.map(w => {
    const begin = minuteOf(w.start), end = minuteOf(w.end);
    check(Number.isInteger(w.day) && w.day >= 0 && w.day <= 6 && end > begin, 'SUPPORT_HOURS_INVALID', 'Opening time must precede closing time on the same day.');
    return { ...w, begin, finish: end };
  });
  for (const day of new Set(windows.map(w => w.day))) {
    const ordered = windows.filter(w => w.day === day).sort((a,b) => a.begin-b.begin);
    check(ordered.every((w,i) => !i || ordered[i-1]!.finish <= w.begin), 'SUPPORT_HOURS_INVALID', 'Shop windows cannot overlap.');
  }
  let day = localParts(cursor, policy.timeZone).day;
  for (let scanned = 0; scanned < 366; scanned++) {
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (!policy.holidays.includes(day)) {
      for (const w of windows.filter(w => w.day === weekday).sort((a,b) => a.begin-b.begin)) {
        const begin = Math.max(cursor, wallTime(day, w.begin, policy.timeZone));
        const end = wallTime(day, w.finish, policy.timeZone);
        if (end <= begin) continue;
        if (remaining <= end-begin) return new Date(begin + remaining).toISOString();
        remaining -= end-begin;
      }
    }
    day = new Date(Date.parse(`${day}T00:00:00Z`) + 86400000).toISOString().slice(0,10);
  }
  check(false, 'SUPPORT_HOURS_INVALID', 'No due time fits the shop calendar within a year.');
}
/** Owner snooze pauses both targets, with a reason and future wake time. */
export function snoozeTicket<T extends SupportTicketBody>(ticket: T, now: string, until: string, reason: string): T {
  check(typeof reason === 'string' && reason.trim().length > 0 && reason.length <= 500, 'SUPPORT_SNOOZE_REASON', 'Say why this ticket should wait.');
  check(!ticket.snoozedAt && Number.isFinite(Date.parse(until)) && Date.parse(until) > Date.parse(now) && ticket.status !== 'closed', 'SUPPORT_SNOOZE_INVALID', 'Choose a future time for an open ticket.');
  return { ...ticket, snoozedAt: now, snoozeUntil: until, snoozeReason: reason.trim(), revision: ticket.revision + 1 };
}
/** Wakes on the agreed time or an early customer reply, shifting targets by the actual pause. */
export function wakeTicket<T extends SupportTicketBody>(ticket: T, now: string, customerReply = false): T {
  if (!ticket.snoozedAt || (!customerReply && Date.parse(now) < Date.parse(ticket.snoozeUntil!))) return ticket;
  const resumedAt = Math.min(Date.parse(now), Date.parse(ticket.snoozeUntil!));
  const pause = Math.max(0, resumedAt-Date.parse(ticket.snoozedAt));
  const shift = (at: string | null) => at ? new Date(Date.parse(at)+pause).toISOString() : null;
  return { ...ticket, dueAt: shift(ticket.dueAt), resolutionDueAt: shift(ticket.resolutionDueAt), snoozedAt: null, snoozeUntil: null, snoozeReason: null, revision: ticket.revision+1 };
}
/** No badge is shown for an answered, sleeping or terminal ticket. Figures are computed here. */
export function dueBadge(ticket: Pick<SupportTicketBody,'dueAt'|'resolutionDueAt'|'sentAt'|'snoozedAt'|'status'>, now: string): string {
  const target = ticket.sentAt ? ticket.resolutionDueAt : ticket.dueAt;
  if (!target || ticket.snoozedAt || ['resolved','closed'].includes(ticket.status)) return '';
  const ms = Date.parse(target)-Date.parse(now);
  if (!Number.isFinite(ms)) return '';
  const h = Math.ceil(Math.abs(ms)/3600000);
  return ms < 0 ? `Overdue by ${h}h` : `Due in ${h}h`;
}
/** Overdue, due soon, open, waiting; stable time and id ordering is applied by the desk. */
export function queueRank(ticket: SupportTicketBody, now: string): number {
  if (ticket.snoozedAt || ['resolved','closed'].includes(ticket.status)) return 4;
  const target = ticket.sentAt ? ticket.resolutionDueAt : ticket.dueAt;
  if (target) { const d=Date.parse(target)-Date.parse(now); if(d<0)return 0; if(d<=4*3600000)return 1; }
  return ticket.status === 'waiting-customer' ? 3 : 2;
}

/** Owner intake text, such as Mon-Sat 10:00-19:00; unknown schedules refuse instead of guessing. */
export function supportHours(fields:Readonly<Record<string,unknown>>):ShopHours|undefined {
 const raw=fields.shopHours;
 if(raw===undefined||raw===null||raw==='')return undefined;
 check(typeof raw==='string'&&raw.length<=1000,'SUPPORT_HOURS_INVALID','Give opening days and local times.');
 const names:Record<string,number>={sun:0,mon:1,tue:2,wed:3,thu:4,fri:5,sat:6,'रवि':0,'सोम':1,'मंगल':2,'बुध':3,'गुरु':4,'शुक्र':5,'शनि':6};
 const hours:ShopHours['hours'][number][]=[];
 for(const line of raw.split(';')){
  const match=/^\s*([\p{L}\p{M}, -]+)\s+(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})\s*$/u.exec(line);
  check(match,'SUPPORT_HOURS_INVALID','Use opening days and times, such as Mon-Sat 10:00-19:00.');
  for(const part of match[1]!.trim().toLowerCase().split(/\s*,\s*/)){
   const range=part.split(/\s*-\s*/);const first=names[range[0]!],last=names[range[1]??range[0]!];
   check(first!==undefined&&last!==undefined&&range.length<=2,'SUPPORT_HOURS_INVALID','Use known opening days, such as Mon-Sat.');
   let day=first;for(let i=0;i<7;i++){hours.push({day,start:match[2]!,end:match[3]!});if(day===last)break;day=(day+1)%7;}
  }
 }
 const timeZone=fields.timeZone===undefined||fields.timeZone===''?'Asia/Kolkata':fields.timeZone;
 check(typeof timeZone==='string','SUPPORT_HOURS_INVALID','Choose a valid shop timezone.');
 const holidays=fields.holidays??[];
 check(Array.isArray(holidays)&&holidays.length<=366&&holidays.every(v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&!Number.isNaN(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v),'SUPPORT_HOURS_INVALID','Holidays are valid local dates.');
 return {timeZone,hours,holidays:holidays as string[]};
}

// Support human takeover: nexusdesk (Apache-2.0), agentbehavior (Apache-2.0); original code, no copied text.
export type SupportRun = { id: string; state: 'queued'|'running'|'done'|'cancelled'; stopRequested?: boolean };
/** Recognizes direct requests for a human in English and Hindi, without using tone as severity. */
export function needsPerson(text:string):boolean { return /\b(?:human|person|real agent|manager)\b|(?:इंसान|व्यक्ति|किसी से बात|मैनेजर|मानव)/i.test(text); }
/** Pauses auto drafts and records takeover; queued work cancels and running work gets a stop request. */
export function humanHandoff<T extends SupportTicketBody>(ticket:T,runs:readonly SupportRun[],now:string):{ticket:T;runs:SupportRun[];summary:{subject:string;messages:SupportMessageBody[];openQuestions:string[]}} {
  const messages=ticket.messages.filter(m=>m.messageKind!=='system').slice(-10);
  return {ticket:{...ticket,autoDraftsPaused:true,revision:ticket.revision+1,messages:[...ticket.messages,{ticketId:'',messageId:null,sender:'Chausar',text:'A person will handle this ticket. Automatic drafts are paused.',at:now,messageKind:'system',references:[],untrusted:false}]},runs:runs.map(r=>r.state==='queued'?{...r,state:'cancelled'}:r.state==='running'?{...r,stopRequested:true}:{...r}),summary:{subject:ticket.subject,messages,openQuestions:['What should the owner do next?']}};
}
/** Keeps the untranslated draft beside the customer-language draft, with sources; neither is approved. */
export function replyPair(original:string,translated:string,language:string,sources:readonly string[],policyChange=false):SupportDraft {
  check(typeof original==='string'&&original.trim().length>0&&original.length<=12000&&typeof translated==='string'&&translated.trim().length>0&&translated.length<=12000, 'SUPPORT_REPLY_INVALID','Keep both the original and customer-language draft.');
  check(/^[a-z]{2,3}(?:-[A-Z]{2})?$/.test(language)&&sources.length>0&&sources.length<=20&&sources.every(s=>typeof s==='string'&&s.trim().length>0&&s.length<=200),'SUPPORT_SOURCE_REQUIRED','A reply needs its customer language and source names.');
  return {original,translated,language,sources:[...sources],approved:false,policyChange};
}
/** Severity follows the impact and available evidence, never the customer's tone. */
export function triageSupport(input:{impact:string;evidence:readonly string[];tone?:string}):{priority:'urgent'|'normal'|'needs-facts';summary:string;openQuestions:string[]} {
  if(!input.evidence.length)return {priority:'needs-facts',summary:'The owner needs evidence before deciding.',openQuestions:['Which shop record supports the request?']};
  return {priority:['safety','delivery-blocked','service-down'].includes(input.impact)?'urgent':'normal',summary:`Impact: ${input.impact}. Evidence: ${input.evidence.join(', ')}.`,openQuestions:[]};
}


// Deterministic customer matching. Ideas from recruitops-agent (MIT); original code for the support desk.
export type MatchCandidate={id:string;email?:string;phone?:string;orderNumber?:string};
/** Email, phone and order evidence are scored in code; a weak or tied result waits for owner confirmation. */
export function matchCustomer(input:Omit<MatchCandidate,'id'>,candidates:readonly MatchCandidate[],floor=65,margin=15):{matchedId:string|null;needsConfirmation:boolean;candidates:{id:string;score:number}[]} {
  const norm=(s:string|undefined)=>s?.trim().toLowerCase(); const phone=(s:string|undefined)=>s?.replace(/\D/g,'');
  const scored=candidates.map(c=>({id:c.id,score:(input.email&&norm(input.email)===norm(c.email)?40:0)+(input.phone&&phone(input.phone)===phone(c.phone)?25:0)+(input.orderNumber&&norm(input.orderNumber)===norm(c.orderNumber)?35:0)})).sort((a,b)=>b.score-a.score||a.id.localeCompare(b.id));
  const best=scored[0];const matched=best&&best.score>=floor&&best.score-(scored[1]?.score??0)>=margin;
  return {matchedId:matched?best.id:null,needsConfirmation:!matched,candidates:scored};
}

// Rating count honesty, ResolveHQ (source-available) ideas only, independently implemented.
/** A plain-link response can add one rating per ticket. No pixel is created. */
export function addRating(existing:readonly SupportRatingBody[],ticketId:string,score:number,at:string):SupportRatingBody[] {
  check(Number.isInteger(score)&&score>=1&&score<=5,'SUPPORT_RATING_INVALID','Choose a rating from one to five.');
  check(!existing.some(r=>r.ticketId===ticketId),'SUPPORT_RATING_EXISTS','This ticket already has its rating.');
  return [...existing,{ticketId,score,at}];
}
/** Small samples show count only; every average carries its denominator. */
export function ratingSummary(ratings:readonly SupportRatingBody[]):{count:number;average:string|null;line:string} {
  const count=ratings.length;const average=count<5?null:(ratings.reduce((sum,r)=>sum+r.score,0)/count).toFixed(1);
  return {count,average,line:average?`${average} from ${count} ratings`:`${count} ${count===1?'rating':'ratings'}`};
}

export type ShopCustomerMatch = {matchedId:string|null;needsConfirmation:boolean;candidates:{id:string;score:number;customerId:string;orderNumber:string;file:string;fileId:string;sourceDigest:string}[];confirmedBy?:string|null};
/** Match only customer/order rows supplied for this service order, retaining source identity for owner review. */
export function matchShopRows(input:Omit<MatchCandidate,'id'>,tables:readonly {id:string;name:string;digest:string;rows:readonly {id:string;cells:Record<string,string>}[]}[]):ShopCustomerMatch {
 const candidates=tables.flatMap(table=>table.rows.flatMap(row=>{
  const c=row.cells;return c.customerId?.trim()&&c.orderNumber?.trim()?[{id:`${table.id}:${row.id}`,customerId:c.customerId.trim(),email:c.email?.trim(),phone:c.phone?.trim(),orderNumber:c.orderNumber.trim(),file:table.name,fileId:table.id,sourceDigest:table.digest}]:[];
 }));
 const matched=matchCustomer(input,candidates);return {...matched,candidates:matched.candidates.filter(c=>c.score>0).map(c=>{const source=candidates.find(s=>s.id===c.id)!;return {id:c.id,score:c.score,customerId:source.customerId,orderNumber:source.orderNumber,file:source.file,fileId:source.fileId,sourceDigest:source.sourceDigest};})};
}
