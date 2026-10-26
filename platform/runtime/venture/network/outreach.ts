// Chausar venture launcher, network (Ink v2 wave 4, package 4E2): drafts the owner sends, and the handoff (catalogue
// C8, C9, C11, C14, C20, C21; spec 5.5 "Drafts and handoffs"; M12's handoff part). Find, draft, the owner sends:
// - venture.outreach.draft (inside the app) drafts one message on a pipeline card: an intro request to the strongest
//   confirmed connector (with a blurb they can forward), a double opt-in, a LinkedIn connection note (200 or 300
//   characters), a follow-up, a reply or a cold email. The owner's AI writes it under the chat consent, from the card's
//   facts and the owner's own words only; with no AI, or when the AI's words fail a check, Chausar's own template does.
// - The footer rule (C20): a cold email carries the unsubscribe line and the postal address, keeps its source page and
//   needs a verified email and a lawful basis; a warm note to a tie of Know or better carries none, on any channel.
//   The blocklist applies to every kind (OUTREACH_BLOCKED); a service the owner does not sell is refused
//   (OUTREACH_EXCLUDED_SERVICE); card, bank account, Aadhaar and one-time code numbers never reach a draft or the AI,
//   and words others wrote (names, titles and companies in the owner's files) pass the untrusted screen first.
// - venture.outreach.open hands off one link or text and never sends: mailto, the LinkedIn profile with the text to
//   copy, or wa.me. WhatsApp is for people the owner knows or who wrote first. The send governor (governor.ts) decides
//   whether Chausar opens the app for one more message today.
// - venture.outreach.sent records the owner's own "I sent it": the card moves from Found to Asked, its follow-up
//   sequence starts (4E1's recordCardSend), and the send counts toward the governor. A reminder (4J5) goes the same way.
// - venture.outreach.restricted pauses a channel for 72 hours when the owner says the platform restricted the account.
// No LinkedIn page is read and nothing is automated there; Chausar never sends a message of any kind.
import { ChausarError, check, type Context, type State } from '../../contracts.ts';
import { OUTREACH_KINDS } from '../contracts.ts';
import type {
  IsoDate, IsoTime, Json, LawfulBasis, LeadRecord, LeadSettingsRecord, ModelTask, OpportunityRecord, OutreachChannel, OutreachHandoff, OutreachKind,
  OutreachLanguage, OutreachRecord, OutreachRestriction, OutreachSentChannel, OutreachSentResult, OutreachView, PersonRecord, TieBand, VentureDeps,
  VentureRecord,
} from '../contracts.ts';
import { digest, exactPayload, formatVentureDate, identifier, listRecords, requireAppChannel, singleLine, tidyWords, ventureAction, type VentureTx } from '../records.ts';
import { localDayAt } from '../local-day.ts';
import { acceptedBlueprintOrNull, readAs } from '../delivery/shared.ts';
import { secretFindings } from '../core/secrets.ts';
import { screenUntrusted } from '../policy/untrusted.ts';
import { excludedServicesOf } from '../core/owner.ts';
import { chatCall, holdsIdNumber } from '../agents/answer.ts';
import { requireChatConsent } from '../agents/consent.ts';
import {
  checkEmail, coldOutreach, isBlocked, leadWhere, outreachFooter, personOnBlocklist, recordSend, WARM_BANDS, withFooter, type Lead, type OutreachFooter,
} from '../customers/leads.ts';
import type { W4Decision, W4Outcome } from '../views/queue-w4.ts';
import { acceptedLine } from './accepted.ts';
import { shortDay } from './followups.ts';
import { draftLane, isConnection, openRefusal, peopleById, restrictChannel, sentLimitLine } from './governor.ts';
import { handoffFor, mailHandoff, sendLine } from './handoff.ts';
import { aiDraftProblem, characters, draftLints, NOTE_LIMITS, refuseExcluded, refuseNeverContact, type NoteLimit } from './outreach-checks.ts';
import { HINDI_UNSUBSCRIBE_LINE, templateDraft, type DraftWords, type Named } from './outreach-templates.ts';
import { pathIndex, warmPaths } from './paths.ts';
import { announce, BLOCKED_LINE, blocklistOf, cardsOf, CLOSED_STAGES, closedLine, ensureLeadCard, findCard, planOf, recordCardSend, storeCard, type Card } from './pipeline.ts';
import { personCardView } from './pipeline-methods.ts';

const DRAFT_KINDS: readonly OutreachKind[] = OUTREACH_KINDS.filter(kind => kind !== 'reminder');
const CHANNELS: readonly OutreachChannel[] = Object.freeze(['email', 'linkedin', 'whatsapp']);
const SENT_CHANNELS: readonly OutreachSentChannel[] = Object.freeze(['own-mailbox', 'linkedin', 'whatsapp', 'phone']);
const BASES: readonly LawfulBasis[] = Object.freeze(['they-wrote-first', 'existing-contact', 'public-business-contact']);
const SENT_OF: Readonly<Record<OutreachChannel, OutreachSentChannel>> = Object.freeze({ email: 'own-mailbox', linkedin: 'linkedin', whatsapp: 'whatsapp' });
const SENT_WORDS: Readonly<Record<OutreachChannel, string>> = Object.freeze({
  email: 'This draft goes from your own mailbox.', linkedin: 'This draft goes on LinkedIn.', whatsapp: 'This draft goes on WhatsApp.',
});
const KEY_REFUSED = 'That looks like a key. Keys go in Connections, never in a draft.';
const ID_REFUSED = 'That looks like a card, bank account, Aadhaar or one-time code number. Drafts never carry those, so nothing was drafted.';
const TEMPLATE_LINE = 'Drafted by Chausar. Read it, then send it yourself.';
const MODEL_LINE = 'Drafted by your AI and checked by Chausar. Read it, then send it yourself.';
const BAND_WORDS: Readonly<Record<TieBand, string>> = Object.freeze({
  close: 'the owner knows them closely', 'know-well': 'the owner knows them well', know: 'the owner knows them', 'met-once': 'the owner has met them once',
  cold: 'the owner does not know them yet',
});

// ---------------------------------------------------------------------------
// The request
// ---------------------------------------------------------------------------

type DraftRequest = {
  opportunityId: string; kind: Exclude<OutreachKind, 'reminder'>; channel: OutreachChannel; basis: LawfulBasis | null; limit: NoteLimit;
  introduce: string | null; about: string | null; language: OutreachLanguage; postalAddress: string | null;
};

/** The owner's words for a draft: one line, never a key or an id number (CHAT_KEY_REFUSED). */
function ownerWords(value: unknown): string | null {
  if (value === undefined) return null;
  const words = singleLine(value, 'Your words', { min: 1, max: 300 });
  check(secretFindings(words).length === 0, 'CHAT_KEY_REFUSED', KEY_REFUSED);
  check(!holdsIdNumber(words), 'CHAT_KEY_REFUSED', ID_REFUSED);
  return words;
}

function draftRequest(payload: unknown): DraftRequest {
  const body = exactPayload(payload, ['opportunityId', 'kind', 'channel', 'basis', 'limit', 'introduce', 'about', 'language', 'postalAddress'], ['opportunityId', 'kind', 'channel']);
  const opportunityId = identifier(body.opportunityId, 'opportunityId');
  check(body.kind !== 'reminder', 'INVALID_VENTURE_REQUEST', 'A reminder is drafted from its invoice.');
  check(typeof body.kind === 'string' && (DRAFT_KINDS as readonly string[]).includes(body.kind), 'INVALID_VENTURE_REQUEST',
    'Choose what to draft: an intro request, a double opt-in intro, a connection note, a follow-up, a reply or a cold email.');
  const kind = body.kind as DraftRequest['kind'];
  check(typeof body.channel === 'string' && (CHANNELS as readonly string[]).includes(body.channel), 'INVALID_VENTURE_REQUEST', 'Choose mail, LinkedIn or WhatsApp.');
  const channel = body.channel as OutreachChannel;
  check(kind !== 'connection-note' || channel === 'linkedin', 'INVALID_VENTURE_REQUEST', 'A connection note goes on LinkedIn.');
  check(kind !== 'cold-email' || channel === 'email', 'INVALID_VENTURE_REQUEST', 'A cold email goes by email.');
  check(body.basis === undefined || (typeof body.basis === 'string' && (BASES as readonly string[]).includes(body.basis)), 'INVALID_VENTURE_REQUEST',
    'Choose the lawful basis: they wrote first, an existing contact, or a public business contact.');
  check(body.limit === undefined || (kind === 'connection-note' && (NOTE_LIMITS as readonly unknown[]).includes(body.limit)), 'INVALID_VENTURE_REQUEST',
    "A connection note's limit is 200 characters, or 300 with LinkedIn Premium.");
  check((body.introduce === undefined) === (kind !== 'double-opt-in'), 'INVALID_VENTURE_REQUEST',
    kind === 'double-opt-in' ? 'Choose who you are introducing.' : 'Only a double opt-in introduces someone.');
  check(body.language === undefined || body.language === 'en' || body.language === 'hi', 'INVALID_VENTURE_REQUEST', 'Chausar drafts in English or Hindi.');
  return {
    opportunityId, kind, channel, basis: (body.basis as LawfulBasis | undefined) ?? null, limit: (body.limit as NoteLimit | undefined) ?? 200,
    introduce: body.introduce === undefined ? null : identifier(body.introduce, 'introduce'), about: ownerWords(body.about),
    language: (body.language as OutreachLanguage | undefined) ?? 'en',
    postalAddress: body.postalAddress === undefined ? null : singleLine(body.postalAddress, 'The postal address', { min: 5, max: 300 }),
  };
}

// ---------------------------------------------------------------------------
// Who it goes to, and what the rules say about it
// ---------------------------------------------------------------------------

type Plan = {
  card: Card; today: IsoDate; recipient: PersonRecord | null; lead: LeadRecord | null; to: Named & { title: string | null }; address: string;
  other: (Named & { title: string | null }) | null; band: TieBand | null; cold: boolean; basis: LawfulBasis | null;
  mx: 'verified' | 'check' | null; sourceUrl: string | null; where: string | null; path: string | null;
  /** Who else the draft names, so Forget of them removes it: the person a double opt-in introduces, an intro's target. */
  aboutPersonId: string | null;
};

/** Whether the blocklist covers a person: any of their emails, phones or their LinkedIn page. */
const blockedPerson = (state: State, venture: VentureRecord, person: PersonRecord) => personOnBlocklist(blocklistOf(state, venture.id), person.handles);
const blockedLine = (name: string) => `${name} asked not to be contacted, or is on your blocklist.`;
/** A person's addresses for the never-contact check (4J6): their emails, phones and LinkedIn page. */
const handlesOf = (person: PersonRecord | null | undefined): string[] =>
  person ? [...person.handles.emails, ...person.handles.phones, ...(person.handles.linkedinUrl ? [person.handles.linkedinUrl] : [])] : [];
const tieOf = (state: State, venture: VentureRecord, personId: string | null | undefined): TieBand | null =>
  (personId ? listRecords(state, 'venture-tie', venture.id).find(tie => tie.personId === personId)?.band : undefined) ?? null;

/** Whether they wrote to the owner first: the owner's word (the lawful basis), a reply on the card, or mail or messages from them. */
function wroteFirst(person: PersonRecord | null, card: Card | null, basis: LawfulBasis | null): boolean {
  if (basis === 'they-wrote-first') return true;
  if (card && card.touches.some(touch => touch.what === 'reply')) return true;
  return !!person && person.facts.some(fact => (fact.kind === 'mail' || fact.kind === 'message') && Number((fact.detail as { received?: unknown } | null)?.received ?? 0) > 0);
}

const WHATSAPP_COLD = 'WhatsApp is for people you know. Write cold messages by email.';
const isWarm = (band: TieBand | null) => band !== null && WARM_BANDS.has(band);

/**
 * Who a draft goes to and what the rules say, from the records as they are (no writes): the card is open and not
 * blocked; an intro request goes to the strongest confirmed connector who is not blocked; the address for the channel;
 * WhatsApp only to a tie of Know or better or someone who wrote first; and for a cold email, its lawful basis and
 * whether its address needs a mail server check. The postal address is checked later (the footer), after the email.
 */
function planDraft(state: State, venture: VentureRecord, request: DraftRequest, now: IsoTime): Plan {
  check(venture.country, 'INVALID_VENTURE_REQUEST', 'Finish setting up your business first, then draft from its pipeline.');
  const today = localDayAt(now, venture.country);
  const card = findCard(cardsOf(state, venture, today), request.opportunityId);
  check(card, 'INVALID_VENTURE_REQUEST', 'This card is not in your pipeline.');
  check(!CLOSED_STAGES.has(card.stage), 'PIPELINE_STAGE_CLOSED', closedLine(card, venture));
  check(!card.blocked, 'OUTREACH_BLOCKED', BLOCKED_LINE);
  const people = new Map(listRecords(state, 'venture-person', venture.id).map(person => [person.id, person]));
  let recipient: PersonRecord | null = card.person;
  let other: PersonRecord | null = null;
  let path: string | null = null;
  if (request.kind === 'intro-request') {
    const paths = card.person ? warmPaths(pathIndex(state, venture.id), card.person.id, 50) : [];
    const confirmed = paths.filter(item => item.confirmed && item.via && people.has(item.via.id));
    const usable = confirmed.find(item => !blockedPerson(state, venture, people.get(item.via!.id)!));
    if (!usable) {
      check(confirmed.length === 0, 'OUTREACH_BLOCKED', blockedLine(confirmed[0]?.via?.name ?? card.name));
      const possible = paths.find(item => !item.confirmed && item.via);
      throw new ChausarError('OUTREACH_NO_CONFIRMED_PATH',
        `No confirmed path to ${card.name}. Write to them yourself${possible ? `, or first ask ${possible.via!.name} whether they know each other` : ''}.`);
    }
    recipient = people.get(usable.via!.id)!;
    other = card.person;
    path = usable.line;
  } else if (request.kind === 'double-opt-in') {
    const introduced = people.get(request.introduce!);
    check(introduced && introduced.id !== card.personId, 'INVALID_VENTURE_REQUEST', 'Choose someone else in your network to introduce.');
    check(!blockedPerson(state, venture, introduced), 'OUTREACH_BLOCKED', blockedLine(introduced.name));
    other = introduced;
  }
  const cardPerson = request.kind !== 'intro-request';
  const lead = cardPerson ? card.lead : null;
  const name = recipient?.name ?? card.name;
  let address: string | null;
  if (request.channel === 'email') {
    address = lead?.email?.toLowerCase() ?? recipient?.handles.emails[0] ?? null;
    check(address, 'INVALID_VENTURE_REQUEST', `Chausar has no email address for ${name}. Choose WhatsApp or LinkedIn, or add their email.`);
  } else if (request.channel === 'linkedin') {
    address = recipient?.handles.linkedinUrl ?? null;
    check(address, 'OUTREACH_NO_PROFILE', `Chausar has no LinkedIn page for ${name}. Import your LinkedIn connections, or write by email.`);
  } else {
    address = recipient?.handles.phones[0] ?? null;
    check(address, 'OUTREACH_NO_PHONE', `Chausar has no phone number for ${name}. Import your phone's contacts, or write by email.`);
  }
  const blocklist = blocklistOf(state, venture.id);
  check(!isBlocked(blocklist, address) && !(recipient && blockedPerson(state, venture, recipient)), 'OUTREACH_BLOCKED', blockedLine(name));
  // Only a connection note reaches someone on LinkedIn who is not one of the owner's connections.
  check(request.channel !== 'linkedin' || request.kind === 'connection-note' || isConnection(recipient), 'INVALID_VENTURE_REQUEST',
    `You aren't connected with ${name} on LinkedIn yet. Send a connection note first.`);
  const band = tieOf(state, venture, recipient?.id);
  // The card's lawful basis speaks for the card's own person: an intro to a connector takes only the one given with it.
  const basis = cardPerson ? request.basis ?? card.stored?.basis ?? null : request.basis;
  check(request.kind !== 'reply' || wroteFirst(recipient, card, basis), 'INVALID_VENTURE_REQUEST',
    `A reply answers someone who wrote to you, and Chausar sees nothing from ${name} yet. Draft a follow-up, or say they wrote first.`);
  check(request.channel !== 'whatsapp' || isWarm(band) || wroteFirst(recipient, cardPerson ? card : null, basis), 'OUTREACH_WHATSAPP_COLD', WHATSAPP_COLD);
  const cold = coldOutreach({ kind: request.kind, channel: request.channel, band });
  let mx: Plan['mx'] = null;
  if (cold) {
    check(basis, 'OUTREACH_BASIS_REQUIRED', 'A cold email needs its lawful basis: they wrote first, an existing contact, or a public business contact.');
    const leadEmail = lead?.email?.toLowerCase() ?? null;
    if (leadEmail === address) {
      check(lead!.emailCheck.status === 'verified', 'LEADS_EMAIL_UNVERIFIED', 'Check the email first. Only an email with a working mail server gets a cold email.');
      mx = 'verified';
    } else mx = 'check';
  }
  const role = (person: PersonRecord | null) => ({ company: person?.role?.company ?? null, title: person?.role?.title ?? null });
  return {
    card, today, recipient, lead, address, band, cold, basis, mx, path,
    to: { name, ...(recipient ? role(recipient) : { company: card.company, title: null }) },
    other: other ? { name: other.name, ...role(other) } : null,
    sourceUrl: lead?.sourceUrl ?? null, where: lead ? leadWhere(lead.sourceUrl) : null, aboutPersonId: other?.id ?? null,
  };
}

/** The newest send to one person, on any of their cards (or on this card for someone who is only a lead). */
function lastTouch(state: State, venture: VentureRecord, plan: Plan): { on: IsoDate; name: string } | null {
  const cards = plan.recipient ? cardsOf(state, venture, plan.today).filter(card => card.personId === plan.recipient!.id) : [plan.card];
  const on = cards.flatMap(card => card.touches.filter(touch => touch.what === 'sent').map(touch => touch.on)).sort().at(-1);
  return on ? { on, name: plan.to.name } : null;
}

// ---------------------------------------------------------------------------
// The words: the owner's AI under the chat consent, or Chausar's own
// ---------------------------------------------------------------------------

type AiDraft = { subject: string; text: string; blurb: string };
const HIDDEN = /[\p{Cf}\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/u;
const DRAFT_SCHEMA: Json = {
  type: 'object', additionalProperties: false, required: ['subject', 'text', 'blurb'],
  properties: { subject: { type: 'string' }, text: { type: 'string' }, blurb: { type: 'string' } },
};
const rejected = (message: string): never => { throw new ChausarError('MODEL_OUTPUT_REJECTED', message); };
const LIMITS: Readonly<Record<keyof AiDraft, number>> = Object.freeze({ subject: 160, text: 1500, blurb: 1200 });

/** The AI's draft as Chausar keeps it: exactly a subject, a text and a blurb, short, with no hidden characters. */
export function validateAiDraft(raw: unknown): AiDraft {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return rejected('The draft was not an object.');
  const item = raw as Record<string, unknown>;
  if (Object.keys(item).sort().join(',') !== 'blurb,subject,text') return rejected('The draft had the wrong fields.');
  for (const field of ['subject', 'text', 'blurb'] as const) {
    if (typeof item[field] !== 'string' || (item[field] as string).length > LIMITS[field] || HIDDEN.test(item[field] as string)) return rejected('A part of the draft was not plain short text.');
  }
  const text = tidyWords(item.text as string, true);
  if (!text) return rejected('The draft was empty.');
  return { subject: tidyWords(item.subject as string), text, blurb: tidyWords(item.blurb as string, true) };
}

const KIND_GUIDE: Readonly<Record<DraftRequest['kind'], string>> = Object.freeze({
  'intro-request': 'An intro request to the connector in "to": ask them to introduce the owner to "target", say why in the owner\'s words, and make saying no easy. In blurb, a note the connector can forward to the target: four or five sentences about the owner\'s business in the third person, no pitch, at most one link, saying nothing is being sold.',
  'double-opt-in': 'The owner is introducing "introduce" to the person in "to": first ask the person in "to" whether they are open to it, and make saying no easy. In blurb, the two-sided introduction the owner sends once they agree.',
  'connection-note': 'A LinkedIn connection note of at most "limit" characters, with no link. Leave blurb empty.',
  'follow-up': 'A short, friendly follow-up. When "lastSent" is given it follows the owner\'s note of that day; otherwise it is a first note to someone the owner knows. Leave blurb empty.',
  reply: 'A short reply to someone who wrote to the owner. Leave blurb empty.',
  'cold-email': 'A short first email to someone the owner has not met: who the owner is, why this person, and that no reply is needed if it is not useful. Chausar adds the unsubscribe line and the postal address itself. Leave blurb empty.',
});

/** Words others wrote, as the AI may read them: through the untrusted screen in enforce mode, null when it holds them. */
function outside(text: string): string | null {
  const screened = screenUntrusted({ source: 'client-file', text }, { mode: 'enforce' }).text;
  return screened === null ? null : tidyWords(screened);
}

/** A web address with its percent escapes undone where they can be, so the untrusted screen reads its words. */
function readableAddress(address: string): string {
  try { return decodeURIComponent(address); } catch { return address; }
}

/** A person's name, company and title as the AI may read them; null when the name itself is held. */
function outsidePerson(who: Named & { title: string | null }): (Named & { title: string | null }) | null {
  const name = outside(who.name);
  if (!name) return null;
  return { name, company: who.company === null ? null : outside(who.company), title: who.title === null ? null : outside(who.title) };
}

function instructionsFor(request: DraftRequest): string {
  return [
    'You draft one message that the owner of a small business sends themselves from their own app. Chausar never sends it.',
    'Use only the facts given: who it is to, how the owner knows them, the business and its offers, and the owner\'s own words.',
    'Never invent a figure, a date, a result or a shared history; write no number the facts do not hold, and no amount of money.',
    'Never offer anything listed in neverOffer. No pitch, no pressure and no hard call to action; make it easy to say no.',
    'Never write a card, bank account, Aadhaar or one-time code number. Do not sign it with a name.',
    request.language === 'hi' ? 'Write in Hindi, in Devanagari, in plain everyday words.' : 'Write in plain English.',
    request.channel === 'email' ? 'Give it a short subject.' : 'Leave subject empty.',
    KIND_GUIDE[request.kind],
  ].join(' ');
}

/**
 * The words of one draft: the owner's AI when one serves the chat tier (under the chat consent, CHAT_CONSENT_REQUIRED
 * before the first), checked in code; else, or when the AI's words fail a check, Chausar's own template, with a line
 * saying which and why.
 */
async function draftWords(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, request: DraftRequest, plan: Plan, excluded: string[]): Promise<{ words: DraftWords; callId: string | null; line: string }> {
  const offers = acceptedBlueprintOrNull(state, venture)?.offers.map(offer => offer.name.value) ?? [];
  const lastSent = plan.card.touches.filter(touch => touch.what === 'sent').map(touch => touch.on).sort().at(-1) ?? null;
  const lastSentWords = request.kind === 'follow-up' && lastSent ? shortDay(lastSent, venture.country.dateOrder) : null;
  const template = templateDraft({
    kind: request.kind, channel: request.channel, language: request.language, to: plan.to, other: plan.other, business: { name: venture.workingName, offers },
    about: request.about, where: request.kind === 'cold-email' ? plan.where : null, lastSent: lastSentWords,
  });
  const route = requireChatConsent(deps, ctx, state, venture);
  if (!route) return { words: template, callId: null, line: TEMPLATE_LINE };
  // Names, titles and companies come from the owner's files but were written by others: they pass the untrusted screen
  // first, and a field it holds is left out. A held name, or a held path line, keeps the AI out of this draft.
  const to = outsidePerson(plan.to), other = plan.other ? outsidePerson(plan.other) : null;
  const path = plan.path === null ? null : outside(plan.path);
  // The page a lead was found on was written by others too: read with its escapes undone, so words hidden in them show.
  const page = request.kind === 'cold-email' && plan.where ? plan.where : null;
  const foundOn = page === null ? '' : outside(readableAddress(page));
  if (!to || (plan.other && !other) || (plan.path !== null && path === null) || foundOn === null) {
    return { words: template, callId: null, line: `Chausar wrote this draft itself: a name or a page from your records held words aimed at the AI. ${TEMPLATE_LINE}` };
  }
  const otherKey = request.kind === 'intro-request' ? 'target' : 'introduce';
  const facts: Json = {
    kind: request.kind, channel: request.channel, language: request.language, to, ...(other ? { [otherKey]: other } : {}),
    howTheOwnerKnowsThem: path ?? (plan.band ? BAND_WORDS[plan.band] : BAND_WORDS.cold), business: { name: venture.workingName, offers }, neverOffer: excluded,
    ownerWords: request.about ?? '', limit: request.kind === 'connection-note' ? request.limit : null, lastSent: lastSentWords ?? '', foundOn,
  };
  const task: ModelTask<AiDraft> = {
    purpose: 'outreach-draft', instructions: instructionsFor(request), input: facts, schemaName: 'venture-outreach-draft', schema: DRAFT_SCHEMA,
    validate: validateAiDraft, containsClientData: true, maxOutputTokens: 1024,
  };
  const answered = await chatCall(deps, ctx, route, task);
  const fallback = (problem: string) => ({ words: template, callId: null, line: `Your AI's draft did not pass Chausar's checks: ${problem}. This is Chausar's own draft. Read it, then send it yourself.` });
  if (!answered) return fallback('it came back in a shape Chausar refuses');
  const problem = aiDraftProblem(answered.value, { kind: request.kind, facts: `${JSON.stringify(facts)}\n${request.about ?? ''}`, limit: request.kind === 'connection-note' ? request.limit : null });
  if (problem) return fallback(problem);
  const value = answered.value;
  return {
    words: {
      subject: request.channel === 'email' ? value.subject || template.subject : null,
      text: value.text,
      blurb: request.kind === 'intro-request' ? value.blurb : request.kind === 'double-opt-in' ? value.blurb || template.blurb : null,
    },
    callId: answered.callId, line: MODEL_LINE,
  };
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** The name of who a draft goes to: its person, or the lead of its card. */
function recipientName(state: State, venture: VentureRecord, record: OutreachRecord): string | null {
  const person = record.personId ? listRecords(state, 'venture-person', venture.id).find(item => item.id === record.personId) : undefined;
  if (person) return person.name;
  const card = record.opportunityId ? listRecords(state, 'venture-opportunity', venture.id).find(item => item.id === record.opportunityId) : undefined;
  const leadId = card?.leadId ?? null;
  return (leadId ? listRecords(state, 'venture-lead', venture.id).find(lead => lead.id === leadId)?.name : undefined) ?? null;
}

/** One draft as the screens show it. */
export function outreachView(state: State, venture: VentureRecord, record: OutreachRecord): OutreachView {
  const name = recipientName(state, venture, record);
  return {
    id: record.id, opportunityId: record.opportunityId, kind: record.outreachKind, channel: record.channel,
    to: record.to ? (name ? `${name}, ${record.to}` : record.to) : name, subject: record.subject, text: record.text, blurb: record.blurb, footer: record.footer,
    lints: record.lints.map(lint => ({ ...lint })), counter: record.outreachKind === 'connection-note' ? { used: characters(record.text), limit: record.noteLimit ?? 200 } : null,
    sent: record.sent ? { at: record.sent.at, channel: record.sent.channel } : null, digest: record.digest,
    author: record.callId ? 'model' : 'template', language: record.language ?? 'en',
    accepted: record.acceptedOn ? { on: record.acceptedOn, line: acceptedLine(name ?? 'They', record.acceptedOn, venture.country?.dateOrder ?? 'year-month-day') } : null,
    line: sendLine(record.channel),
    // 4E4: the forwardable note's sentences, counted by code.
    blurbSentences: record.blurb ? record.blurb.trim().split(/(?<=[.!?\u0964])\s+/u).filter(part => part.trim().length > 0).length : null,
  };
}

// ---------------------------------------------------------------------------
// venture.outreach.draft
// ---------------------------------------------------------------------------

/** The business's stored postal address, or the one the owner gave with this request. */
function postalAddressOf(state: State, venture: VentureRecord, given: string | null): string {
  return given ?? listRecords(state, 'venture-lead-settings', venture.id)[0]?.postalAddress ?? '';
}

/**
 * venture.outreach.draft { opportunityId, kind, channel, basis?, limit?, introduce?, about?, language?, postalAddress? }
 * (prepare, inside the app): one draft on a card for the owner to send themselves. Refusals, in order: the card (open,
 * not blocked), the kind and its channel, who it goes to (a confirmed connector, an address for the channel), the
 * blocklist, a cold WhatsApp, a cold email's lawful basis, its mail server and its postal address, a service the owner
 * does not sell, a connection note over its limit. The card is stored if it was a lead's; the lawful basis is kept on
 * it; nothing is sent. Answers the draft and a line saying who wrote it.
 */
export async function outreachDraft(deps: VentureDeps, ctx: Context, payload: unknown): Promise<{ draft: OutreachView; line: string }> {
  requireAppChannel(ctx, 'venture.outreach.draft');
  const request = draftRequest(payload);
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const now = deps.clock().toISOString();
  const plan = planDraft(state, venture, request, now);
  await refuseNeverContact(deps, [plan.address, ...handlesOf(plan.recipient)], plan.to.name); // 4J6 (C10)
  if (plan.mx === 'check') {
    const checked = await checkEmail(plan.address, { ...(deps.mx ? { resolver: deps.mx } : {}), now });
    check(checked.status === 'verified', 'LEADS_EMAIL_UNVERIFIED', `${checked.line} Only an email with a working mail server gets a cold email.`);
  }
  const footer: OutreachFooter | null = outreachFooter({
    kind: request.kind, channel: request.channel, band: plan.band,
    business: { name: venture.workingName, postalAddress: postalAddressOf(state, venture, request.postalAddress), ...(request.language === 'hi' ? { unsubscribeLine: HINDI_UNSUBSCRIBE_LINE } : {}) },
  });
  const excluded = excludedServicesOf(state, venture.id);
  refuseExcluded([request.about], excluded);
  const { words, callId, line } = await draftWords(deps, ctx, state, venture, request, plan, excluded);
  refuseExcluded([words.subject, words.text, words.blurb], excluded);
  // A stored field that holds an id number never reaches a draft either, whoever wrote the words.
  check(![words.subject, words.text, words.blurb].some(part => part && holdsIdNumber(part)), 'CHAT_KEY_REFUSED', ID_REFUSED);
  if (request.kind === 'connection-note') {
    const used = characters(words.text);
    check(used <= request.limit, 'OUTREACH_TOO_LONG', `This note is ${used} characters; your limit is ${request.limit}. Shorten your words and draft it again.`);
  }
  const text = withFooter(words.text, footer);
  return ventureAction(deps, ctx, 'prepare', 'outreach.draft', tx => {
    const current = tx.venture!;
    const again = planDraft(tx.state, current, request, tx.now);
    check(again.address === plan.address && again.recipient?.id === plan.recipient?.id && again.cold === plan.cold, 'APPROVAL_STALE',
      'This card changed while Chausar was drafting. Draft it again.');
    const card = again.card;
    const firstTouch = !card.touches.some(touch => touch.what === 'sent');
    const stored = card.stored ?? storeCard(tx, card);
    // The lawful basis is kept on the card for its own person; an intro's is for the connector, so it stays on the draft.
    if (request.basis && request.kind !== 'intro-request' && stored.basis !== request.basis) {
      tx.replace<OpportunityRecord>({ ...tx.find('venture-opportunity', stored.id)!, basis: request.basis });
    }
    if (request.postalAddress) {
      const settings = tx.list('venture-lead-settings')[0];
      if (settings && settings.postalAddress !== request.postalAddress) tx.replace<LeadSettingsRecord>({ ...settings, postalAddress: request.postalAddress });
      if (!settings) tx.put<LeadSettingsRecord>({ ...tx.base('venture-lead-settings'), postalAddress: request.postalAddress, blockedEmails: [], blockedDomains: [] });
    }
    const counter = request.kind === 'connection-note' ? { used: characters(text), limit: request.limit } : null;
    const lints = draftLints({
      kind: request.kind, channel: request.channel, text: words.text, firstTouch, counter, lastTouch: lastTouch(tx.state, current, again), today: again.today, order: current.country.dateOrder,
      also: [words.subject, words.blurb],
    });
    const base = tx.base('venture-outreach');
    const shownFooter = footer ? { unsubscribe: footer.unsubscribe, postalAddress: footer.postalAddress } : null;
    const record = tx.put<OutreachRecord>({
      ...base, opportunityId: stored.id, invoiceId: null, personId: again.recipient?.id ?? null, outreachKind: request.kind, channel: request.channel, to: again.address,
      subject: words.subject, text, blurb: words.blurb, footer: shownFooter, sourceUrl: again.sourceUrl, basis: again.basis, lints, by: 'agent', callId,
      digest: digest({ id: base.id, kind: request.kind, channel: request.channel, to: again.address, subject: words.subject, text, blurb: words.blurb, footer: shownFooter }),
      sent: null, acceptedOn: null, language: request.language, ...(request.kind === 'connection-note' ? { noteLimit: request.limit } : {}),
      aboutPersonId: again.aboutPersonId,
    });
    announce(tx, stored.id);
    return { draft: outreachView(tx.state, current, record), line };
  });
}

// ---------------------------------------------------------------------------
// venture.outreach.open
// ---------------------------------------------------------------------------

/** A lead's own cold email (the lead list's draft), by its id, with its lead. */
function leadDraftOf(state: State, venture: VentureRecord, draftId: string): { lead: LeadRecord; draft: LeadRecord['drafts'][number] } | null {
  for (const lead of listRecords(state, 'venture-lead', venture.id)) {
    const draft = lead.drafts.find(item => item.id === draftId);
    if (draft) return { lead, draft };
  }
  return null;
}

const sentLine = (at: IsoTime, venture: VentureRecord) =>
  `You already sent this, on ${venture.country ? formatVentureDate(localDayAt(at, venture.country), venture.country.dateOrder) : at.slice(0, 10)}.`;

/**
 * Refuses opening when the governor says not now: a paused channel, mail held after a delivery report, a day the owner
 * does not send on, a cap reached (in the draft's own lane).
 */
function governed(state: State, venture: VentureRecord, record: Pick<OutreachRecord, 'outreachKind' | 'channel' | 'personId' | 'to'>, now: IsoTime): void {
  const lane = draftLane(record, peopleById(state, venture));
  const refusal = openRefusal(state, venture, { kind: record.outreachKind, channel: record.channel, lane, to: record.to, now });
  if (refusal) throw new ChausarError(refusal.code, refusal.line);
}

/**
 * venture.outreach.open { draftId } (read, inside the app): one handoff to the owner's own app, and nothing is sent or
 * recorded. Checked again first: not already sent, the blocklist, the card still open, WhatsApp only to someone the
 * owner knows or who wrote first, then the send governor. A lead's own cold email opens in mail the same way.
 */
export async function outreachOpen(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OutreachHandoff> {
  requireAppChannel(ctx, 'venture.outreach.open');
  const body = exactPayload(payload, ['draftId'], ['draftId']);
  const draftId = identifier(body.draftId, 'draftId');
  const { state, venture } = readAs(deps, ctx, 'read');
  const now = deps.clock().toISOString();
  const record = listRecords(state, 'venture-outreach', venture.id).find(item => item.id === draftId);
  const blocklist = blocklistOf(state, venture.id);
  if (!record) {
    const found = leadDraftOf(state, venture, draftId);
    check(found, 'INVALID_VENTURE_REQUEST', 'This draft is not in this business.');
    const send = found.lead.sends.find(item => item.draftId === draftId);
    check(!send, 'ALREADY_DECIDED', send ? sentLine(send.sentAt, venture) : '');
    check(found.lead.status !== 'blocked' && !isBlocked(blocklist, found.draft.to), 'OUTREACH_BLOCKED', blockedLine(found.lead.name));
    await refuseNeverContact(deps, [found.draft.to], found.lead.name); // 4J6 (C10)
    governed(state, venture, { outreachKind: 'cold-email', channel: 'email', personId: null, to: found.draft.to }, now);
    return mailHandoff(found.draft.to, found.draft.subject, found.draft.text);
  }
  check(!record.sent, 'ALREADY_DECIDED', record.sent ? sentLine(record.sent.at, venture) : '');
  const person = record.personId ? listRecords(state, 'venture-person', venture.id).find(item => item.id === record.personId) ?? null : null;
  const card = record.opportunityId && venture.country ? findCard(cardsOf(state, venture, localDayAt(now, venture.country)), record.opportunityId) ?? null : null;
  const name = recipientName(state, venture, record) ?? 'This person';
  check(!card?.blocked && !isBlocked(blocklist, record.to) && !(person && blockedPerson(state, venture, person)), 'OUTREACH_BLOCKED', blockedLine(name));
  await refuseNeverContact(deps, [record.to, ...handlesOf(person)], name); // 4J6 (C10)
  if (card) check(!CLOSED_STAGES.has(card.stage), 'PIPELINE_STAGE_CLOSED', closedLine(card, venture));
  if (record.channel === 'whatsapp' && record.outreachKind !== 'reminder') {
    const toCardPerson = !card || record.personId === null || card.personId === record.personId;
    const basis = toCardPerson ? record.basis ?? card?.stored?.basis ?? null : null;
    check(isWarm(tieOf(state, venture, record.personId)) || wroteFirst(person, toCardPerson ? card : null, basis), 'OUTREACH_WHATSAPP_COLD', WHATSAPP_COLD);
  }
  governed(state, venture, record, now);
  return handoffFor(record);
}

// ---------------------------------------------------------------------------
// venture.outreach.sent
// ---------------------------------------------------------------------------

/** What a card says comes next after a send. */
function afterSend(tx: VentureTx, cardId: string): string {
  const venture = tx.venture!, order = venture.country.dateOrder;
  const card = findCard(cardsOf(tx.state, venture, localDayAt(tx.now, venture.country)), cardId);
  const plan = card && card.stage === 'asked' ? planOf(card) : null;
  if (!plan) return 'Recorded.';
  if (plan.kind === 'nudge') return `Recorded. Next follow-up ${shortDay(plan.due, order)}.`;
  if (plan.kind === 'other-path') return `Recorded. If there is no reply by ${shortDay(plan.due, order)}, try another path, or Not now.`;
  return `Recorded. If there is no reply by ${shortDay(plan.on, order)}, the card parks as Not now.`;
}

/**
 * venture.outreach.sent { draftId, at, channel } (approve, inside the app): the owner says they sent one draft
 * themselves, from their own mailbox, LinkedIn, WhatsApp or by phone, at a time after the draft and not in the future.
 * The draft is marked sent; on a card, the send is recorded there (4E1's recordCardSend: Found moves to Asked and the
 * follow-ups start). It counts toward the send governor, and the line says when it reached today's limit or went past
 * it: the owner already sent it, so it is never refused for that. A second record of the same draft is ALREADY_DECIDED.
 */
export async function outreachSent(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OutreachSentResult> {
  requireAppChannel(ctx, 'venture.outreach.sent');
  const body = exactPayload(payload, ['draftId', 'at', 'channel'], ['draftId', 'at', 'channel']);
  const draftId = identifier(body.draftId, 'draftId');
  check(typeof body.at === 'string' && body.at.length <= 40 && Number.isFinite(Date.parse(body.at)), 'INVALID_VENTURE_REQUEST', 'Send the time you sent it.');
  check(typeof body.channel === 'string' && (SENT_CHANNELS as readonly string[]).includes(body.channel), 'INVALID_VENTURE_REQUEST',
    'Say how you sent it: from your own mailbox, on LinkedIn, on WhatsApp or by phone.');
  const at = body.at, channel = body.channel as OutreachSentChannel;
  return ventureAction(deps, ctx, 'approve', 'outreach.sent', tx => {
    const venture = tx.venture!;
    const today = localDayAt(tx.now, venture.country);
    const record = tx.find('venture-outreach', draftId);
    if (!record) return leadSent(deps, ctx, tx, draftId, at, channel);
    check(!record.sent, 'ALREADY_DECIDED', record.sent ? sentLine(record.sent.at, venture) : '');
    // Its own channel, or a call instead; either way it counts in the draft's own lane.
    check(channel === SENT_OF[record.channel] || channel === 'phone', 'INVALID_VENTURE_REQUEST', `${SENT_WORDS[record.channel]} Mark it sent from there, or by phone if you called instead.`);
    const sentAt = Date.parse(at);
    check(sentAt >= Date.parse(record.at) && sentAt <= Date.parse(tx.now), 'INVALID_VENTURE_REQUEST', 'The send time must be after the draft and not in the future.');
    const iso = new Date(sentAt).toISOString();
    const updated = tx.replace<OutreachRecord>({ ...record, sent: { at: iso, channel, recordedAt: tx.now, recordedBy: ctx.memberId } });
    let line = 'Recorded.';
    let card: OutreachSentResult['card'] = null;
    if (record.opportunityId) {
      const stored = recordCardSend(tx, record.opportunityId, { on: localDayAt(iso, venture.country), channel, outreachKind: record.outreachKind, ref: record.id, by: ctx.memberId });
      line = afterSend(tx, stored.id);
      card = personCardView(deps, tx.state, venture, stored.personId);
    } else {
      tx.emit('queue.changed', {});
    }
    line += sentLimitLine(tx.state, venture, draftLane(record, peopleById(tx.state, venture)), today, record.outreachKind);
    return { draft: outreachView(tx.state, venture, updated), card, line };
  });
}

/** "I sent it" on a lead's own cold email: recorded on the lead as the lead list records it, and its card stored. */
function leadSent(deps: VentureDeps, ctx: Context, tx: VentureTx, draftId: string, at: string, channel: OutreachSentChannel): OutreachSentResult {
  const venture = tx.venture!;
  const found = leadDraftOf(tx.state, venture, draftId);
  check(found, 'INVALID_VENTURE_REQUEST', 'This draft is not in this business.');
  check(channel === 'own-mailbox', 'INVALID_VENTURE_REQUEST', "A lead's email goes from your own mailbox.");
  const already = found.lead.sends.find(item => item.draftId === draftId);
  check(!already, 'ALREADY_DECIDED', already ? sentLine(already.sentAt, venture) : '');
  const lead = recordSend({ ...found.lead, moves: found.lead.moves ?? [], id: found.lead.id } as Lead, { draftId, sentAt: at }, ctx, tx.now);
  const { id: _id, ...fields } = lead;
  tx.replace<LeadRecord>({ ...found.lead, ...fields });
  ensureLeadCard(tx, found.lead.id);
  const card = findCard(cardsOf(tx.state, venture, localDayAt(tx.now, venture.country)), found.lead.id);
  const line = (card ? afterSend(tx, card.id) : 'Recorded.') + sentLimitLine(tx.state, venture, 'email', localDayAt(tx.now, venture.country));
  const draft: OutreachView = {
    id: found.draft.id, opportunityId: card?.stored?.id ?? null, kind: 'cold-email', channel: 'email', to: `${found.lead.name}, ${found.draft.to}`, subject: found.draft.subject,
    text: found.draft.text, blurb: null, footer: { unsubscribe: found.draft.footer.unsubscribe, postalAddress: found.draft.footer.postalAddress }, lints: [], counter: null,
    sent: { at: new Date(Date.parse(at)).toISOString(), channel }, digest: found.draft.digest, author: found.draft.by === 'owner' ? 'owner' : 'model', language: 'en', accepted: null,
    line: sendLine('email'),
  };
  return { draft, card: card ? personCardView(deps, tx.state, venture, card.personId) : null, line };
}

// ---------------------------------------------------------------------------
// venture.outreach.restricted, and a reminder's "I sent it" on Today
// ---------------------------------------------------------------------------

/**
 * venture.outreach.restricted { channel } (approve, inside the app): the owner says the platform restricted the
 * account. The channel is paused for 72 hours (LinkedIn's posting with it) and Today shows a notice until then.
 */
export async function outreachRestricted(deps: VentureDeps, ctx: Context, payload: unknown): Promise<OutreachRestriction> {
  requireAppChannel(ctx, 'venture.outreach.restricted');
  const body = exactPayload(payload, ['channel'], ['channel']);
  check(typeof body.channel === 'string' && (CHANNELS as readonly string[]).includes(body.channel), 'INVALID_VENTURE_REQUEST', 'Choose mail, LinkedIn or WhatsApp.');
  const channel = body.channel as OutreachChannel;
  return ventureAction(deps, ctx, 'approve', 'outreach.restricted', tx => {
    const hold = restrictChannel(tx, channel);
    return { channel, until: hold.until!, line: hold.line };
  });
}

/**
 * "I sent it" on a reminder's Today row (views/queue-w4.ts decideSent; the row's subject is `reminder:<draft id>`, the
 * row 4J5 shows for its reminder draft): the owner sent it themselves, today, on the draft's channel. A reminder
 * already recorded is APPROVAL_STALE, so a second tap records nothing more. Nothing is sent.
 */
export async function decideReminderSent(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  const draftId = decision.subject.slice('reminder:'.length);
  return ventureAction(deps, ctx, 'approve', 'outreach.reminderSent', tx => {
    const record = tx.find('venture-outreach', draftId);
    check(record && record.outreachKind === 'reminder' && !record.sent, 'APPROVAL_STALE', 'This reminder is no longer waiting to be sent.');
    tx.replace<OutreachRecord>({ ...record, sent: { at: tx.now, channel: SENT_OF[record.channel], recordedAt: tx.now, recordedBy: ctx.memberId } });
    tx.emit('queue.changed', {});
    return { line: 'Recorded as sent today.' };
  });
}
