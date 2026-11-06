// Chausar venture launcher, network (Ink v2 wave 4, package 4E3, catalogue C10, C11, C15): what Chausar does with one
// inbound message, all in code and before any model could read it. Mail is untrusted: its words never steer an agent,
// it passes the untrusted screen, and of it Chausar keeps only what triage needs (who, when, the screened subject, the
// thread's ids, what code decided), never the text. Triage goes in a fixed order: a delivery report; bulk mail
// (dropped); an automatic reply by its header fields; an opt-out in English or Hindi; an automatic reply by its subject
// or words (ignored, and the next follow-up waits a week); "are you a bot" (one fixed honest answer drafted); price, a
// contract, a meeting or buying (the owner replies, with a code-built line); a one-word thanks (nothing to do);
// anything else a reply that may move its card to Talking, which the owner confirms on Today.
//
// An opt-out always blocks the address it came from, for good. Its open cards close as Lost only when the receiving
// server proved the mail (its own Authentication-Results says DKIM or DMARC passed for the sender's domain) and the
// mail was matched by its address; otherwise, and before blocking the person's other addresses when it was matched by
// name or LinkedIn, the owner is asked. A delivery report counts only for an address Chausar wrote to in the last 30
// days (a report about anything else may be forged, and nothing happens): a bounce blocks that address, a 4.x.x delay
// holds it 90 days, and a domain that takes no mail is blocked whole only when the owner says so. Who a message is
// from goes email first, then a LinkedIn address in it, then name and company; it matches a card by a confidence
// worked out in code (the card's address 0.7, the subject of a note sent on it 0.2, within 30 days of a send 0.1),
// attaching at 0.65 or more and 0.15 ahead of the next card, else the owner is asked. A match moves nothing on its own.
// Chausar's processed flag is its own, never the mailbox's read state.
import { check, type Context, type State } from '../../contracts.ts';
import type { InboundRecord, InboundTopic, InboundTriage, InboundView, InboundListView, IsoDate, IsoTime, ScreenNote, VentureDeps, VentureRecord } from '../contracts.ts';
import { exactPayload, formatVentureDate, identifier, listRecords, readVenture, requireAppChannel, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { screenNote, screenUntrusted } from '../policy/untrusted.ts';
import { screenSettingOf } from '../policy/untrusted-methods.ts';
import { isBlocked } from '../customers/leads.ts';
import { blockEntries } from '../customers/lead-methods.ts';
import { addDays, daysBetween } from './followups.ts';
import { cardForWrite, CLOSED_STAGES, cardsOf, closedLine, findCard, moveCard, STAGE_RANK, type Card } from './pipeline.ts';
import { listPeople } from './store.ts';
import { AUTO_REPLY_PUSH_DAYS, bounceScope, suppressUntil, type ReportedRecipient } from './bounces.ts';
import { headerOf, type MailAddress, type MailHeaders } from './mail-text.ts';
import { fold, normalLinkedIn, plural } from './text.ts';

/** Marks the Hindi in this file for a native reviewer. */
export const HINDI_REVIEW = 'machine-drafted, needs a native reviewer';
/** The fixed honest answer to "are you a bot", in English and (for a reply in Hindi) in Hindi (HINDI_REVIEW). */
export const BOT_ANSWER = 'I use an AI assistant to help draft messages, and I read and send every one myself.';
export const BOT_ANSWER_HI = 'संदेश लिखने में एक AI सहायक मेरी मदद करता है, और हर संदेश को खुद पढ़कर खुद भेजना मेरा अपना काम है।';
/** What a subject the screen held reads as. */
export const HELD_SUBJECT = 'Subject held by the screen';
/** The confidence rules (C15), in basis points. */
export const MATCH = Object.freeze({ address: 7000, subject: 2000, recent: 1000, recentDays: 30, floor: 6500, margin: 1500 });
/** A delivery report counts only for an address Chausar wrote to within this many days before it. */
export const REPORT_SEND_DAYS = 30;
/** Free mail services: blocking one blocks everyone on it. */
export const FREE_MAIL: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'rocketmail.com', 'outlook.com', 'outlook.in', 'hotmail.com',
  'hotmail.co.in', 'live.com', 'live.in', 'msn.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'protonmail.com', 'proton.me', 'pm.me', 'zoho.com',
  'zohomail.com', 'zohomail.in', 'gmx.com', 'gmx.net', 'mail.com', 'yandex.com', 'yandex.ru', 'rediffmail.com', 'rediff.com', 'fastmail.com',
  'tutanota.com', 'hey.com',
]);

// ---------------------------------------------------------------------------
// Triage, in code
// ---------------------------------------------------------------------------

const char = (code: number) => String.fromCharCode(code);
/** Marks that hide or split words: zero-width space and joiners, the word joiner, a byte order mark, the soft hyphen. */
const INVISIBLE = new RegExp(`[${[0x200b, 0x200c, 0x200d, 0x2060, 0xfeff, 0xad].map(char).join('')}]`, 'g');
const NUKTA = new RegExp(char(0x093c), 'g');
const DEVANAGARI = new RegExp(`[${char(0x0900)}-${char(0x097f)}]`);

/** Text as the phrase lists read it: one compatibility form, no nukta or invisible marks, lower case, spaces tidied. */
export function plainWords(text: string): string {
  return text.normalize('NFKC').replace(NUKTA, '').replace(INVISIBLE, '').toLowerCase().replace(/[^\S\n]+/g, ' ').trim();
}
const hindi = (words: readonly string[]) => new RegExp(words.map(word => word.normalize('NFKC').replace(NUKTA, '')).join('|'), 'u');

const OPT_OUT: readonly RegExp[] = [
  /\bunsubscrib\w*/, /\bremove me\b/, /\btake me off\b/, /\bopt(?:\s|-)?(?:me\s+)?out\b/,
  /\b(?:please\s+)?stop\s+(?:e-?mail\w*|emails?|messag\w*|contact\w*|send\w*|writ\w*|spamming|calling)\b/,
  /\b(?:do\s*n[o']?t|never)\s+(?:contact|e-?mail|message|write\s+to|call)\s+(?:me|us)\b/,
  /^(?:stop|unsubscribe|remove)[\s.!]*$/,
  /\b(?:mat|mt)\s+bhej\w*/, /\bband\s+kar(?:o|ein|en|iye|do)\b/, /\bmat\s+likh\w*/,
  hindi(['मत भेज', 'बंद करो', 'बंद करें', 'बंद कीजिए', 'बंद करिए', 'बंद कर दो', 'संपर्क मत', 'संपर्क न कर', 'मत लिख', 'अनसब्सक्राइब']),
];
const AUTO_SUBJECT = /^(?:auto(?:matic)?[\s_-]*(?:reply|response|antwort)|autoreply|auto:|out of (?:the )?office|ooo\b|absence|abwesenheit|away from)/i;
const AUTO_BODY: readonly RegExp[] = [
  /\bout of (?:the )?office\b/, /\bautomatic (?:reply|response)\b/, /\bauto-?reply\b/, /\blimited access to (?:my )?e-?mail\b/,
  /\bthis is an auto(?:matic|mated)? (?:reply|response|message)\b/, hindi(['कार्यालय से बाहर', 'स्वचालित उत्तर', 'स्वचालित जवाब']),
];
const BOT: readonly RegExp[] = [
  /\b(?:are|r)\s+(?:you|u)\s+(?:a\s+|an\s+)?(?:bot|robot|ai|a\.i\.|chat\s?bot|human|real\s+person|a\s+real\s+person|real)\b/,
  /\bis\s+this\s+(?:a\s+|an\s+)?(?:bot|robot|automated|ai|a\.i\.|auto-?generated|written\s+by\s+(?:ai|a\s+bot|chatgpt))\b/,
  /\b(?:am\s+i|i\s+am)\s+(?:talking|speaking|chatting|writing)\s+(?:to|with)\s+(?:a\s+|an\s+)?(?:bot|robot|ai|machine|human|real\s+person)\b/,
  /\b(?:kya|kia)\s+(?:aap|ap|tum|ye|yeh)\s+(?:ek\s+)?(?:bot|robot|ai|insaan|insan|machine)\b/,
  hindi(['क्या आप बॉट', 'क्या आप एक बॉट', 'क्या आप रोबोट', 'क्या आप ai', 'क्या आप एआई', 'क्या आप इंसान', 'क्या तुम बॉट', 'क्या यह बॉट', 'क्या ये बॉट']),
];
const TOPICS: readonly [InboundTopic, RegExp[]][] = [
  ['buying', [
    /\b(?:buy|buying|purchase|place (?:an|the) order|order (?:it|them|now|\d+)|sign (?:me )?up|go ahead|proceed|let'?s do (?:it|this)|hire you|onboard|get started|book (?:it|you|a slot))\b/,
    hindi(['खरीद', 'ऑर्डर', 'आगे बढ़', 'शुरू कर']),
  ]],
  ['price', [
    /\b(?:prices?|priced|pricing|costs?|quotes?|quoted|quotation|rates?|fees?|budget|charges?|how much|rate card|kitn[ae]|daam|keemat|kimat)\b|₹|\brs\.?\s?\d|\binr\s?\d/,
    hindi(['कीमत', 'दाम', 'रेट', 'कितना', 'कितने', 'शुल्क', 'फीस', 'खर्च']),
  ]],
  ['contract', [/\b(?:contracts?|agreements?|terms(?: and conditions)?|nda|sow|statement of work|legal|lawyer|retainer)\b/, hindi(['अनुबंध', 'कॉन्ट्रैक्ट', 'एग्रीमेंट', 'करार'])]],
  ['meeting', [
    /\b(?:meet|meeting|call|zoom|google meet|schedule|calendar|available|availability|catch up|demo|slot|milte|milo|baat kar\w*)\b/,
    hindi(['मीटिंग', 'मिलते', 'मिलें', 'मिलिए', 'मिलना', 'कॉल', 'बात कर']),
  ]],
];
/** A thanks and nothing more: the word, a "so much", and at most a name after it. */
const THANKS = /^(?:(?:many|ok|okay|great|perfect|cool)\s+)?(?:thanks?|thank\s+you|thankyou|thx|tnx|ty|cheers|noted|got it|received|dhanyavaa?d|dhanyawad|shukriya|धन्यवाद|शुक्रिया|थैंक्यू|थैंक यू)(?:\s+(?:a lot|so much|very much|again|a ton))?(?:\s+[\p{L}\p{M}]+)?$/u;

/** What code decided about one message's words: its triage (bulk is dropped), the topics a reply asks about, and Hindi. */
export type MailTriage = { triage: Exclude<InboundTriage, 'unmatched'> | 'bulk'; topics: InboundTopic[]; hindi: boolean };

/**
 * Triage in code, in a fixed order (C11): a delivery report; bulk mail; an automatic reply by its header fields; an
 * opt-out (before an automatic reply's subject or words, so "unsubscribe" under an "Automatic reply" subject still
 * counts); an automatic reply by its subject or words; "are you a bot"; a reply about price, a contract, a meeting or
 * buying; a one-word thanks; else a reply. text: the reply's own new words.
 */
export function triageMail(input: { headers: MailHeaders; subject: string; text: string; report: boolean }): MailTriage {
  const words = plainWords(input.text);
  const isHindi = DEVANAGARI.test(input.text);
  const topics = TOPICS.filter(([, patterns]) => patterns.some(pattern => pattern.test(words))).map(([topic]) => topic);
  const result = (triage: MailTriage['triage']): MailTriage => ({ triage, topics, hindi: isHindi });
  if (input.report) return result('bounce');
  const header = (name: string) => headerOf(input.headers, name);
  if (header('list-id') || header('list-unsubscribe') || /^(?:bulk|list|junk)\b/i.test(header('precedence') ?? '')) return result('bulk');
  const submitted = header('auto-submitted');
  if ((submitted && !/^no\b/i.test(submitted.trim())) || header('x-autoreply') || header('x-autorespond') || /auto[_-]?reply/i.test(header('precedence') ?? '')) {
    return result('auto-reply');
  }
  if (OPT_OUT.some(pattern => pattern.test(words))) return result('opt-out');
  if (AUTO_SUBJECT.test(input.subject.trim()) || (words.length <= 800 && AUTO_BODY.some(pattern => pattern.test(words.slice(0, 400))))) return result('auto-reply');
  if (BOT.some(pattern => pattern.test(words))) return result('bot-question');
  if (topics.length) return result('owner-reply');
  const bare = words.replace(/[^\p{L}\p{N}\p{M}\s]/gu, ' ').trim().split(/\s+/).filter(Boolean);
  if (bare.length >= 1 && bare.length <= 5 && THANKS.test(bare.join(' '))) return result('thanks');
  return result('talking');
}

// ---------------------------------------------------------------------------
// Who it is from, and which card it is about
// ---------------------------------------------------------------------------

export type Identity = { personId: string | null; via: 'email' | 'linkedin' | 'name' | null };
const LINKEDIN_IN_TEXT = /\b(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]{2,100}\/?/gi;

/**
 * Who in the network a message is from: by its address first; then by a LinkedIn address written in it; then by the
 * sender's name with their company in the address's domain or in the words. Null when none.
 */
export function identify(state: State, venture: VentureRecord, from: MailAddress, text: string): Identity {
  const people = listPeople(state, venture.id);
  const byEmail = people.find(person => person.handles.emails.includes(from.email));
  if (byEmail) return { personId: byEmail.id, via: 'email' };
  for (const found of text.match(LINKEDIN_IN_TEXT) ?? []) {
    const url = normalLinkedIn(found.startsWith('http') ? found : `https://${found}`);
    const person = url ? people.find(item => item.handles.linkedinUrl === url) : undefined;
    if (person) return { personId: person.id, via: 'linkedin' };
  }
  const name = fold(from.name ?? '');
  if (name) {
    const domain = from.email.split('@')[1] ?? '';
    const words = fold(text);
    const named = people.filter(person => fold(person.name) === name && person.role?.company);
    const person = named.find(item => {
      const company = fold(item.role!.company).split(' ').filter(word => word.length >= 3);
      return company.length > 0 && (company.some(word => domain.includes(word)) || words.includes(company.join(' ')));
    });
    if (person) return { personId: person.id, via: 'name' };
  }
  return { personId: null, via: null };
}

/** A subject without its reply and forward marks, folded, for comparing with what was sent. */
export function subjectCore(subject: string): string {
  let core = subject;
  for (let i = 0; i < 6; i += 1) {
    const next = core.replace(/^\s*(?:re|fw|fwd|aw|wg|sv|antw|jawab|उत्तर|जवाब)\s*(?:\[\d+\])?\s*:\s*/iu, '');
    if (next === core) break;
    core = next;
  }
  return fold(core);
}

/** The subjects of notes sent on a card: 4E2's drafts marked sent, and a lead's email drafts recorded as sent. */
function sentSubjects(state: State, venture: VentureRecord, card: Card): string[] {
  const subjects: string[] = [];
  const ids = new Set([card.stored?.id, card.leadId].filter((id): id is string => !!id));
  for (const draft of listRecords(state, 'venture-outreach', venture.id)) {
    if (draft.sent && draft.subject && draft.opportunityId && ids.has(draft.opportunityId)) subjects.push(subjectCore(draft.subject));
  }
  if (card.lead) {
    const sent = new Set(card.lead.sends.map(send => send.draftId));
    for (const draft of card.lead.drafts) if (sent.has(draft.id)) subjects.push(subjectCore(draft.subject));
  }
  return subjects;
}

export type CardScore = { opportunityId: string; confidenceBp: number };

/**
 * Every open card a message may be about, with code's confidence: the card's own address 0.7, the subject of a note
 * sent on it 0.2, within 30 days after a send on it 0.1. A card counts when its address is the sender's, or its person
 * is who the message is from. Highest first; on a tie the newer card first.
 */
export function scoreCards(state: State, venture: VentureRecord, cards: readonly Card[], input: { email: string; personId: string | null; subject: string; date: IsoTime }): CardScore[] {
  const day = localDayAt(input.date, venture.country);
  const core = subjectCore(input.subject);
  const scored: (CardScore & { at: string })[] = [];
  for (const card of cards) {
    if (CLOSED_STAGES.has(card.stage)) continue;
    const address = card.emails.includes(input.email);
    if (!address && !(input.personId && card.personId === input.personId)) continue;
    let bp = address ? MATCH.address : 0;
    if (core && sentSubjects(state, venture, card).includes(core)) bp += MATCH.subject;
    if (card.touches.some(touch => touch.what === 'sent' && touch.on <= day && daysBetween(touch.on, day) <= MATCH.recentDays)) bp += MATCH.recent;
    scored.push({ opportunityId: card.id, confidenceBp: bp, at: card.createdAt });
  }
  return scored.sort((a, b) => b.confidenceBp - a.confidenceBp || (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).map(({ opportunityId, confidenceBp }) => ({ opportunityId, confidenceBp }));
}

/** The card a message attaches to: the best at 0.65 or more and 0.15 ahead of the next one; else none, and the owner is asked. */
export function pickMatch(scores: readonly CardScore[]): CardScore | null {
  const [best, next] = scores;
  if (!best || best.confidenceBp < MATCH.floor) return null;
  return !next || best.confidenceBp - next.confidenceBp >= MATCH.margin ? best : null;
}

/** Whether Chausar recorded a send to an address in the 30 days before a day (on any card with that address). */
export function sentWithin(cards: readonly Card[], address: string, day: IsoDate): boolean {
  return cards.some(card => card.emails.includes(address)
    && card.touches.some(touch => touch.what === 'sent' && touch.on <= day && daysBetween(touch.on, day) <= REPORT_SEND_DAYS));
}

/**
 * Why to take care before blocking a whole domain, in the owner's words: a free mail service many people use, or how
 * many other people (and clients) in the network use it, other than the address the report was about.
 */
export function domainWarning(state: State, venture: VentureRecord, domain: string, except: string): string {
  if (FREE_MAIL.has(domain)) return `${domain} is a free mail service many people use. Blocking it blocks all of them.`;
  const at = (email: string | null | undefined) => !!email && email.toLowerCase().endsWith(`@${domain}`) && email.toLowerCase() !== except;
  const people = listPeople(state, venture.id).filter(person => person.handles.emails.some(at)).length;
  const clients = listRecords(state, 'venture-client', venture.id).filter(client => at(client.email)).length;
  const parts = [
    people ? `${people === 1 ? '1 other person' : `${people} other people`} in your network ${people === 1 ? 'uses' : 'use'} ${domain}.` : '',
    clients ? `${clients === 1 ? '1 of your clients uses' : `${clients} of your clients use`} it.` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : `No one else in your network uses ${domain}.`;
}

// ---------------------------------------------------------------------------
// One message, written: its record and what it does
// ---------------------------------------------------------------------------

/**
 * One message read from the mailbox, with what code needs from it. text: its new words, for triage; whole: all its
 * readable words, signature included, for the identity check. Both are held in memory only, never stored. report: the
 * addresses a delivery report names. proved: the receiving server says DKIM or DMARC passed for the sender's domain.
 */
export type ReadMail = {
  messageId: string; from: MailAddress; to: string[]; date: IsoTime; subject: string; references: string[]; headers: MailHeaders; text: string; whole: string;
  report: ReportedRecipient[] | null; triage: MailTriage; proved: boolean;
};

/** The word for a person in a line: their first name, else the address. */
export const firstOf = (name: string) => name.trim().split(/\s+/)[0] || name;

/** The person's or the card's name for a message, else its address. */
function nameFor(state: State, venture: VentureRecord, identity: Identity, card: Card | null, email: string): { name: string; company: string | null } {
  const person = identity.personId ? listPeople(state, venture.id).find(item => item.id === identity.personId) : undefined;
  if (person) return { name: person.name, company: person.role?.company ?? card?.company ?? null };
  if (card) return { name: card.name, company: card.company };
  return { name: email, company: null };
}

const TOPIC_PHRASE: Readonly<Record<InboundTopic, string>> = Object.freeze({
  buying: 'wants to buy', price: 'asked about pricing', contract: 'asked about a contract', meeting: 'asked to meet',
});
const TOPIC_WORD: Readonly<Record<InboundTopic, string>> = Object.freeze({ buying: 'buying', price: 'pricing', contract: 'a contract', meeting: 'a meeting' });
/** "Priya asked about pricing. Reply yourself." The first topic by its order (buying, price, contract, meeting). */
export function ownerReplyTitle(name: string, topics: readonly InboundTopic[]): string {
  return `${firstOf(name)} ${TOPIC_PHRASE[topics[0] ?? 'price']}. Reply yourself.`;
}
/** "It also mentions a meeting." for the topics after the first, or ''. */
export function moreTopics(topics: readonly InboundTopic[]): string {
  const rest = topics.slice(1).map(topic => TOPIC_WORD[topic]);
  return rest.length ? ` It also mentions ${rest.join(' and ')}.` : '';
}

/** "their card", "2 of their cards". */
const cardWords = (n: number) => (n === 1 ? 'their card' : `${n} of their cards`);
/** "a and b", "a, b and c". */
const listWords = (items: readonly string[]) => (items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

type Effect = { line: string; processed: boolean; needsYou: boolean; moved: string[]; triage: InboundTriage };

/** A delivery report's sentence about one address. */
function bounceWords(item: { address: string; status: string; scope: 'address' | 'domain' | 'suppress'; until: IsoDate | null }, venture: VentureRecord): string {
  if (item.scope === 'suppress') return `Mail to ${item.address} was delayed (${item.status}). Chausar holds follow-ups to it until ${formatVentureDate(item.until!, venture.country.dateOrder)}.`;
  if (item.scope === 'domain') return `Mail to ${item.address} cannot be delivered: ${item.address.split('@')[1]} takes no mail (${item.status}). ${item.address} is on your blocklist now.`;
  return `Mail to ${item.address} bounced (${item.status}), so it is on your blocklist now.`;
}

/**
 * Writes one message (once: a message id already kept is skipped) and does what its triage says, in the caller's
 * transaction. Answers what it did, or null when it was skipped: a repeat, bulk, from the owner, from no one in the
 * network or the pipeline, or a report about no address Chausar wrote to lately. Nothing here sends anything.
 */
export function writeInbound(tx: VentureTx, mail: ReadMail, screen: { note: ScreenNote | null; subject: string }, owner: string): Effect | null {
  const venture = tx.venture!;
  if (mail.triage.triage === 'bulk' || mail.from.email === owner.toLowerCase()) return null;
  if (tx.list('venture-inbound').some(record => record.messageId === mail.messageId)) return null;
  const today = localDayAt(tx.now, venture.country);
  const day = localDayAt(mail.date, venture.country);
  const order = venture.country.dateOrder;
  const base = {
    messageId: mail.messageId, from: mail.from.email, to: mail.to, date: mail.date, subject: screen.subject.slice(0, 300), references: mail.references.slice(-20),
    screen: screen.note, ...(mail.triage.hindi ? { hindi: true } : {}),
  };
  const people = listPeople(tx.state, venture.id);
  const cards = cardsOf(tx.state, venture, today);
  const known = (email: string) => people.some(person => person.handles.emails.includes(email)) || cards.some(card => card.emails.includes(email));

  if (mail.triage.triage === 'bounce') {
    // Only addresses Chausar wrote to lately: a report about anything else may be forged, and nothing happens.
    const about = (mail.report ?? []).filter(item => (item.action === 'failed' || item.action === 'delayed' || item.action === '') && bounceScope(item.status)
      && known(item.address) && sentWithin(cards, item.address, day));
    const bounces = [...new Map(about.map(item => [item.address, item])).values()].map(item => {
      const scope = bounceScope(item.status)!;
      return { address: item.address, status: item.status, scope, until: scope === 'suppress' ? suppressUntil(day) : null };
    });
    if (!bounces.length) return null;
    blockEntries(tx, bounces.filter(item => item.scope !== 'suppress').map(item => item.address), 'chausar');
    const settings = listRecords(tx.state, 'venture-lead-settings', venture.id)[0];
    const domainAsk = bounces.filter(item => item.scope === 'domain').map(item => item.address.split('@')[1]).find(domain => !(settings?.blockedDomains ?? []).includes(domain)) ?? null;
    const line = bounces.map(item => bounceWords(item, venture)).join(' ') + (domainAsk ? ` Blocking all of ${domainAsk} waits for you.` : '');
    tx.put<InboundRecord>({
      ...tx.base('venture-inbound'), ...base, matched: null, triage: 'bounce', line, processed: !domainAsk,
      personId: people.find(person => person.handles.emails.includes(bounces[0].address))?.id ?? null, bounces, domainAsk,
    });
    if (domainAsk) tx.emit('queue.changed', {});
    return { line, processed: !domainAsk, needsYou: !!domainAsk, moved: [], triage: 'bounce' };
  }

  const identity = identify(tx.state, venture, mail.from, mail.whole);
  if (!identity.via && !known(mail.from.email)) return null;
  const scores = scoreCards(tx.state, venture, cards, { email: mail.from.email, personId: identity.personId, subject: mail.subject, date: mail.date });
  const match = pickMatch(scores);
  const card = match ? findCard(cards, match.opportunityId) ?? null : scores[0] ? findCard(cards, scores[0].opportunityId) ?? null : null;
  const { name } = nameFor(tx.state, venture, identity, card, mail.from.email);
  const first = firstOf(name);
  const triage = mail.triage.triage;
  const moved: string[] = [];
  let line: string, processed: boolean, needsYou: boolean, stored: InboundTriage = triage;
  let optOut: InboundRecord['optOut'];

  if (triage === 'opt-out') {
    // Their own words: the address it came from is blocked at once and for good, whatever the match or the proof.
    const from = mail.from.email;
    blockEntries(tx, [from], 'chausar');
    const byAddress = identity.via === 'email' || (!identity.via && known(from));
    const person = identity.personId ? people.find(item => item.id === identity.personId) : undefined;
    const own = byAddress ? [] : (person?.handles.emails ?? []).filter(email => email !== from);
    const open = cards.filter(item => !CLOSED_STAGES.has(item.stage) && (item.emails.includes(from) || (!byAddress && !!identity.personId && item.personId === identity.personId)));
    if (byAddress && mail.proved) {
      for (const item of open) { moveCard(tx, cardForWrite(tx, item.id), 'lost', { reason: 'opted-out', evidence: null, by: 'chausar' }); moved.push(item.id); }
    }
    const close = byAddress && mail.proved ? [] : open.map(item => item.id);
    optOut = { blocked: [from], close, block: own };
    line = byAddress
      ? `${first} asked not to be contacted. Blocked ${from}${moved.length ? ` and closed ${cardWords(moved.length)} as Lost` : ''}.${close.length ? ` The mail could not be proved to be theirs, so closing ${close.length === 1 ? 'the card' : `their ${close.length} cards`} waits for you.` : ''}`
      : `${first} asked not to be contacted from ${from}. Blocked ${from}.`;
    processed = !close.length && !own.length; needsYou = !processed;
  } else if (triage === 'auto-reply') {
    line = match ? `An automatic reply from ${first}. The next follow-up waits until at least ${formatVentureDate(addDays(day, AUTO_REPLY_PUSH_DAYS), order)}.` : `An automatic reply from ${first}. Nothing to do.`;
    processed = true; needsYou = false;
  } else if (triage === 'thanks') {
    line = `${first} said thanks. Nothing to do.`;
    processed = true; needsYou = false;
  } else if (!scores.length) {
    // From someone they know, about no open card: only a reply the owner should answer waits on them.
    if (triage === 'owner-reply' || triage === 'bot-question') {
      line = triage === 'owner-reply' ? `${ownerReplyTitle(name, mail.triage.topics)}${moreTopics(mail.triage.topics)}` : `${first} asked if you are a bot. A reply is drafted.`;
      processed = false; needsYou = true;
    } else {
      stored = 'unmatched';
      line = `${first} wrote to you. They have no open card in your pipeline.`;
      processed = true; needsYou = false;
    }
  } else if (!match) {
    const company = card?.company ? ` about ${card.company}` : '';
    line = `Mail from ${first}${company}. Chausar asks you before it attaches it to a card.`;
    processed = false; needsYou = true;
  } else if (triage === 'owner-reply') {
    line = `${ownerReplyTitle(name, mail.triage.topics)}${moreTopics(mail.triage.topics)}`;
    processed = false; needsYou = true;
  } else if (triage === 'bot-question') {
    line = `${first} asked if you are a bot. A reply is drafted.`;
    processed = false; needsYou = true;
  } else {
    const before = card ? STAGE_RANK[card.stage] < STAGE_RANK.talking : false;
    line = before ? `${first} wrote back. Move the card to Talking?` : `${first} wrote back.`;
    processed = !before; needsYou = before;
  }
  const record = tx.put<InboundRecord>({
    ...tx.base('venture-inbound'), ...base, matched: match ? { opportunityId: match.opportunityId, confidenceBp: match.confidenceBp } : null,
    triage: stored, line, processed, personId: identity.personId,
    ...(!processed && !match && scores.length && triage !== 'opt-out' ? { candidates: scores.slice(0, 5) } : {}),
    ...(mail.triage.topics.length ? { topics: mail.triage.topics } : {}),
    ...(optOut ? { optOut } : {}),
  });
  if (match) tx.emit('pipeline.changed', { id: match.opportunityId });
  if (needsYou) tx.emit('queue.changed', {});
  return { line: record.line, processed, needsYou, moved, triage: stored };
}

/**
 * The owner's yes to what an opt-out left for them, in their transaction: block the person's own addresses, and close
 * their open cards (still open now) as Lost, opted out. Answers the line saying exactly what was done.
 */
export function applyOptOut(tx: VentureTx, record: InboundRecord, by: string): string {
  const pending = record.optOut ?? { blocked: [], close: [], block: [] };
  const blocked = pending.block.length ? blockEntries(tx, pending.block, by).added : [];
  const venture = tx.venture!;
  let closed = 0;
  for (const id of pending.close) {
    const card = findCard(cardsOf(tx.state, venture, localDayAt(tx.now, venture.country)), id);
    if (!card || CLOSED_STAGES.has(card.stage)) continue;
    moveCard(tx, card, 'lost', { reason: 'opted-out', evidence: null, by });
    closed += 1;
  }
  tx.replace<InboundRecord>({ ...record, processed: true, optOut: { blocked: [...pending.blocked, ...blocked], close: [], block: [] }, handled: { how: 'moved', at: tx.now, by } });
  const parts = [blocked.length ? `blocked ${listWords(blocked)}` : '', closed ? `closed ${closed === 1 ? 'the card' : `${closed} cards`} as Lost` : ''].filter(Boolean);
  if (!parts.length) return 'Nothing more to do: that was done already.';
  const words = parts.join(' and ');
  return `${words[0].toUpperCase()}${words.slice(1)}.`;
}

/** The owner's yes to blocking the whole domain a report says takes no mail. */
export function applyDomainBlock(tx: VentureTx, record: InboundRecord, by: string): string {
  const domain = record.domainAsk;
  check(domain, 'APPROVAL_STALE', 'This was resolved elsewhere.');
  blockEntries(tx, [domain], by);
  tx.replace<InboundRecord>({ ...record, processed: true, domainAsk: null, handled: { how: 'moved', at: tx.now, by } });
  return `Blocked ${domain}.`;
}

/** The sync's summary of what came in, counted by code. */
export function syncWords(effects: readonly Effect[]): string {
  if (!effects.length) return 'No new mail from people in your network or pipeline.';
  const counts = new Map<string, number>();
  const bump = (key: string) => counts.set(key, (counts.get(key) ?? 0) + 1);
  for (const effect of effects) {
    if (effect.triage === 'opt-out') bump('opt');
    if (effect.needsYou) bump('needs');
    else if (effect.triage === 'auto-reply') bump('auto');
    else if (effect.triage === 'bounce') bump('bounce');
    else if (effect.triage === 'thanks') bump('thanks');
    else if (effect.triage !== 'opt-out') bump('other');
  }
  const parts = [
    counts.get('needs') ? `${counts.get('needs')} ${counts.get('needs') === 1 ? 'needs' : 'need'} you on Today` : '',
    counts.get('opt') ? `${plural(counts.get('opt')!, 'asked', 'asked')} not to be contacted` : '',
    counts.get('auto') ? plural(counts.get('auto')!, 'automatic reply', 'automatic replies') : '',
    counts.get('bounce') ? plural(counts.get('bounce')!, 'delivery report', 'delivery reports') : '',
    counts.get('thanks') ? `${plural(counts.get('thanks')!, 'thanks', 'thanks')}` : '',
    counts.get('other') ? plural(counts.get('other')!, 'other reply', 'other replies') : '',
  ].filter(Boolean);
  return `${plural(effects.length, 'new message', 'new messages')} from people you know: ${parts.join(', ')}.`;
}

/** Screens a message before anything of it is kept: the subject cleaned (or held) and the screen's note on subject and words. */
export function screenMail(state: State, venture: VentureRecord, subject: string, text: string): { note: ScreenNote | null; subject: string } {
  const released = screenSettingOf(state, venture.id).released;
  const whole = screenUntrusted({ source: 'mail', text: `${subject}\n${text}` }, { mode: 'enforce', released });
  const title = screenUntrusted({ source: 'mail', text: subject }, { mode: 'enforce', released });
  return { note: screenNote(whole), subject: (title.text ?? HELD_SUBJECT).replace(/\s+/g, ' ').trim() || '(no subject)' };
}

// ---------------------------------------------------------------------------
// The methods: the list, and the owner's own match
// ---------------------------------------------------------------------------

/** One message as the screens show it: who, when, the screened subject, what code decided, and the card it is about. */
export function inboundView(state: State, venture: VentureRecord, record: InboundRecord, today: IsoDate): InboundView {
  const cards = cardsOf(state, venture, today);
  const card = record.matched ? findCard(cards, record.matched.opportunityId) : undefined;
  return {
    id: record.id, from: record.from, date: record.date, subject: record.subject, triage: record.triage,
    matched: record.matched ? { opportunityId: record.matched.opportunityId, name: card?.name ?? 'a card no longer in your pipeline' } : null, line: record.line,
  };
}

/** venture.inbound.list {} (read): the mail Chausar kept, newest first, at most 200. Reading changes nothing. */
export async function inboundList(deps: VentureDeps, ctx: Context, payload: unknown): Promise<InboundListView> {
  exactPayload(payload ?? {}, []);
  const { state, venture } = readVenture(deps, ctx);
  // No mail is read before the business has a country (its days are local ones), so there is nothing to list.
  if (!venture.country) return { items: [] };
  const records = (listRecords(state, 'venture-inbound', venture.id) as InboundRecord[]).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, 200);
  const today = localDayAt(deps.clock(), venture.country);
  return { items: records.map(record => inboundView(state, venture, record, today)) };
}

/**
 * The owner says one message is about one card (in the app): it attaches there, whatever code's confidence was. Its
 * triage then stands: a reply that may move the card to Talking still waits for the owner on Today. A closed card, a
 * card not in the pipeline, a delivery report and an opt-out are refused. Nothing moves and nothing is sent.
 */
export function confirmInbound(tx: VentureTx, id: string, opportunityId: string, by: string): InboundRecord {
  const venture = tx.venture!;
  const record = tx.find('venture-inbound', id) as InboundRecord | undefined;
  check(record, 'INVALID_VENTURE_REQUEST', 'This mail is not in this business.');
  check(record.triage !== 'bounce', 'INVALID_VENTURE_REQUEST', 'A delivery report is about an address, not a card.');
  check(record.triage !== 'opt-out', 'INVALID_VENTURE_REQUEST', 'An opt-out is about the person, not one card.');
  const card = findCard(cardsOf(tx.state, venture, localDayAt(tx.now, venture.country)), opportunityId);
  check(card, 'INVALID_VENTURE_REQUEST', 'This card is not in your pipeline.');
  check(!CLOSED_STAGES.has(card.stage), 'PIPELINE_STAGE_CLOSED', closedLine(card, venture));
  const score = record.candidates?.find(item => item.opportunityId === card.id)?.confidenceBp ?? record.matched?.confidenceBp ?? 0;
  const first = firstOf(card.name);
  const waits = (record.triage === 'talking' || record.triage === 'unmatched') && STAGE_RANK[card.stage] < STAGE_RANK.talking;
  const line = record.triage === 'owner-reply' ? `${ownerReplyTitle(card.name, record.topics ?? [])}${moreTopics(record.topics ?? [])}`
    : record.triage === 'bot-question' ? `${first} asked if you are a bot. A reply is drafted.`
      : waits ? `${first} wrote back. Move the card to Talking?` : `You matched this mail to ${first}'s card.`;
  const { candidates: _candidates, ...rest } = record;
  const updated = tx.replace<InboundRecord>({
    ...rest, triage: record.triage === 'unmatched' ? 'talking' : record.triage, matched: { opportunityId: card.id, confidenceBp: score }, line,
    processed: !(waits || record.triage === 'owner-reply' || record.triage === 'bot-question'), handled: { how: 'confirmed', at: tx.now, by },
  });
  tx.emit('pipeline.changed', { id: card.id });
  tx.emit('queue.changed', {});
  return updated;
}

/** venture.inbound.confirm { id, opportunityId } (approve, inside the app): the owner's own match, as confirmInbound. */
export async function inboundConfirm(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ item: InboundView }> {
  requireAppChannel(ctx, 'venture.inbound.confirm');
  const body = exactPayload(payload, ['id', 'opportunityId'], ['id', 'opportunityId']);
  const id = identifier(body.id, 'id'), opportunityId = identifier(body.opportunityId, 'opportunityId');
  return ventureAction(deps, ctx, 'approve', 'inbound.confirm', tx => {
    const record = confirmInbound(tx, id, opportunityId, ctx.memberId);
    return { item: inboundView(tx.state, tx.venture!, record, localDayAt(tx.now, tx.venture!.country)) };
  });
}

/** Whether an address is on the business's blocklist now (the opt-out list), for the rows and the tests. */
export function addressBlocked(state: State, ventureId: string, address: string): boolean {
  const settings = listRecords(state, 'venture-lead-settings', ventureId)[0];
  return isBlocked({ emails: new Set(settings?.blockedEmails ?? []), domains: new Set(settings?.blockedDomains ?? []), handles: new Set(settings?.blockedHandles ?? []) }, address);
}
