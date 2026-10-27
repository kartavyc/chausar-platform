// Chausar playbook kit: the sales proposal (Ink v2 wave 5, package 5A2; catalogue P3, with P2's pilot and P4's honest
// exit). venture.salesProposal.draft {clientId | personId, offerId, pilot?} drafts a proposal with exactly five
// sections: What we heard, Roadmap, Investment, Next step, Open questions. The Producer is the owner's AI under the chat
// consent (it words What we heard and the Roadmap from the records, never a price), or Chausar's own template; every
// amount under Investment is a price receipt the calculator makes from the owner's own price (money/quote.ts), and a
// typed amount fails figures-resolve; a fact the records lack is a bracketed placeholder, and placeholders-listed fails
// unless each one is repeated under Open questions. An unpriced offer refuses OFFER_UNPRICED (a pilot of one,
// PILOT_UNPRICED: a pilot is never free). For a business a kit playbook runs, the ask is scoped first: wholly outside, no
// proposal is drafted and the person is parked with no follow-up (kit/exit.ts); partly outside, it covers the in-scope
// part and says so. The proposal waits on Today; the owner reads it and approves it there, and only then does it hand
// off to the owner's own mail, WhatsApp or LinkedIn (network/handoff.ts). Chausar never sends it. Learned from
// revenue-squad's skills/proposal/SKILL.md, ideas only, no code taken.
import { ChausarError, check, type Context, type State } from '../../../contracts.ts';
import type {
  BlueprintRecord, ClientRecord, Json, ModelTask, Offer, OutreachHandoff, PersonRecord, PriceReceiptRecord, QueueAction,
  SalesProposalRecord, VentureDeps, VentureRecord,
} from '../../contracts.ts';
import { assertNoNumbers, assertNoSpelledNumbers, digest, exactPayload, findRecord, identifier, listRecords, readVenture, tidyWords, ventureAction } from '../../records.ts';
import { ENGLISH_NUMBER_WORDS, holdsHindiNumber } from '../../agents/number-words.ts';
import { readAs } from '../../delivery/shared.ts';
import { buildPriceReceipt } from '../../money/quote.ts';
import { requireAcceptedBlueprint, requireOffer } from '../../money/shared.ts';
import { shareWords } from '../../money/share-price.ts';
import { chatCall } from '../../agents/answer.ts';
import { chatConsentState } from '../../agents/consent.ts';
import { screenUntrusted } from '../../policy/untrusted.ts';
import { COUNTED_LINE, MAX_HANDOFF_URL, mailHandoff, whatsappUrl } from '../../network/handoff.ts';
import { normalLinkedIn } from '../../network/extract-core.ts';
import type { W4Decision, W4Outcome, W4RowItem } from '../../views/queue-w4.ts';
import type { KitOffer, PlaybookDefinition } from './define.ts';
import { kitDefinitionOf, parkOutsideScope, scopeHi, scopeOf } from './exit.ts';
import { PILOT_AFTER_ASKS, PILOT_UNPRICED_LINE, pilotOf, type PilotTerms } from './pilot.ts';
import type {
  SalesPilotTerms, SalesProposalBody, SalesProposalCheck, SalesProposalInvestment, SalesProposalScope, SalesProposalSection, SalesProposalSectionId,
  SalesProposalView,
} from './records-sales.ts';

/** The five sections, in order, and their titles. */
export const PROPOSAL_SECTIONS: readonly SalesProposalSectionId[] = Object.freeze(['heard', 'roadmap', 'investment', 'next', 'questions']);
export const PROPOSAL_TITLES: readonly string[] = Object.freeze(['What we heard', 'Roadmap', 'Investment', 'Next step', 'Open questions']);
const TITLE_OF: Readonly<Record<SalesProposalSectionId, string>> = Object.freeze({
  heard: 'What we heard', roadmap: 'Roadmap', investment: 'Investment', next: 'Next step', questions: 'Open questions',
});
const HEARD_PLACEHOLDER = '[what they told you they need]';
const START_PLACEHOLDER = '[the day you would like to start]';
const PILOT_START = '[the day it starts]';
const SECTIONS_LINE = `A proposal has exactly five sections: ${PROPOSAL_TITLES.join(', ')}.`;
const NEXT_LINE = 'Read it on Today and approve it; then you send it yourself. Chausar never sends it.';
const TEMPLATE_LINE = `Drafted by Chausar from your records. ${NEXT_LINE}`;
const MODEL_LINE = `Drafted by your AI and checked by Chausar. ${NEXT_LINE}`;
const NO_CONSENT_LINE = `Drafted by Chausar from your records, because you have not agreed to what your AI is sent in Chats. ${NEXT_LINE}`;
const HELD_LINE = `Chausar wrote this itself: their words held text aimed at the AI. ${NEXT_LINE}`;
const OUTSIDE_LINE = 'This is outside what your business does, so nothing was drafted and Chausar will not follow up with them. Copy the reply if you want to answer.';
const APPROVED_LINE = 'Approved. Open it in Clients to send it yourself; Chausar never sends it.';
const APPROVED_VIEW_LINE = 'You approved it. Send it yourself from here; Chausar never sends it.';
const SENT_BY_YOU = 'Chausar never sends it.';
const UNIT: Readonly<Record<Offer['pricing']['quantityUnit'], string>> = Object.freeze({ month: 'per month', project: 'per project', hour: 'per hour' });

/**
 * An amount typed in words, as people write money: a currency sign or code before digits (₹, Rs, INR), or digits before
 * rupees, lakh or crore. Each match is checked against the receipts' own figures.
 */
const AMOUNT = /(?:[₹$€]\s?|\b(?:INR|USD|EUR|Rs\.?)\s?)\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:rupees?|lakhs?|crores?)\b/gi;
const PLACEHOLDER = /\[[^\][\n]{2,120}\]/g;

const unique = <T>(items: readonly T[]): T[] => [...new Set(items)];
const plainAmount = (text: string) => (text.match(/\d[\d,]*(?:\.\d+)?/)?.[0] ?? '').replace(/,/g, '');
const sentence = (text: string) => text.trim().replace(/[.\s]+$/, '');

/** Every bracketed placeholder in the sections before Open questions, in order of first use. */
export function placeholdersOf(sections: readonly SalesProposalSection[]): string[] {
  return unique(sections.filter(section => section.id !== 'questions').flatMap(section => section.lines.flatMap(line => line.match(PLACEHOLDER) ?? [])));
}

/**
 * The proposal's three checks, by code. required-sections: exactly the five sections, in order. figures-resolve: every
 * amount anywhere in it is one of the receipts' own figures (allowed: their displays, such as "INR 2,948.82"), except in
 * the client's own words quoted back to them (quoted: those exact lines, which Chausar never wrote and never states as a
 * price). placeholders-listed: every placeholder is repeated under Open questions.
 */
export function proposalChecks(sections: readonly SalesProposalSection[], allowed: readonly string[], quoted: readonly string[] = []): SalesProposalCheck[] {
  const ids = sections.map(section => section.id);
  const shaped = ids.length === PROPOSAL_SECTIONS.length && ids.every((id, i) => id === PROPOSAL_SECTIONS[i]);
  const known = new Set(allowed.map(plainAmount));
  const theirs = new Set(quoted);
  const typed = sections.flatMap(section => section.lines.filter(line => !theirs.has(line)).flatMap(line => line.match(AMOUNT) ?? [])).find(amount => !known.has(plainAmount(amount)));
  const questions = sections.find(section => section.id === 'questions')?.lines.join('\n') ?? '';
  const unlisted = placeholdersOf(sections).filter(placeholder => !questions.includes(placeholder));
  return [
    { id: 'required-sections', passed: shaped, detail: shaped ? 'The five sections are there, in order.' : SECTIONS_LINE },
    { id: 'figures-resolve', passed: !typed, detail: typed ? `${typed.trim()} is not a price from your list.` : 'Every amount opens a price receipt from your list.' },
    { id: 'placeholders-listed', passed: !unlisted.length, detail: unlisted.length ? `Open questions must repeat ${unlisted.join(', ')}.` : 'Every gap is an open question.' },
  ];
}

// ---------------------------------------------------------------------------
// What the records hold
// ---------------------------------------------------------------------------

type Who = { client: ClientRecord | null; person: PersonRecord | null; name: string; contact: SalesProposalBody['contact'] };

const E164 = /^\+[1-9]\d{6,14}$/;

function whoOf(state: State, venture: VentureRecord, clientId: string | null, personId: string | null): Who {
  if (clientId) {
    const client = findRecord(state, 'venture-client', clientId);
    check(client && client.ventureId === venture.id, 'CLIENT_NOT_FOUND', 'Add this client first.');
    return { client, person: null, name: client.name, contact: { email: client.email, phone: null, linkedin: null } };
  }
  const person = findRecord(state, 'venture-person', personId!);
  check(person && person.ventureId === venture.id && !person.hidden, 'INVALID_VENTURE_REQUEST', 'This person is not in your network.');
  const phone = person.handles.phones.find(item => E164.test(item)) ?? null;
  return { client: null, person, name: person.name, contact: { email: person.handles.emails[0] ?? null, phone, linkedin: normalLinkedIn(person.handles.linkedinUrl) } };
}

/**
 * What they asked for, in their own words from the records: a client's newest order request, else the note the owner
 * keeps on them; a person's newest mail to the business (its subject), from their address or kept as theirs. Null when
 * the records hold nothing they said.
 */
function heardOf(state: State, venture: VentureRecord, who: Who): string | null {
  if (who.client) {
    const order = listRecords(state, 'venture-order', venture.id).filter(item => item.clientId === who.client!.id).sort((a, b) => b.at.localeCompare(a.at))[0];
    return order?.request ?? who.client.note ?? null;
  }
  const emails = new Set(who.person!.handles.emails.map(item => item.toLowerCase()));
  const mail = listRecords(state, 'venture-inbound', venture.id)
    .filter(item => item.personId === who.person!.id || emails.has(item.from.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  return mail?.subject?.trim() ? mail.subject : null;
}

/** Their words, quoted on one line and at most 300 characters. */
function quoted(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return `You asked: "${line.length > 300 ? `${line.slice(0, 297)}...` : line}"`;
}

/** The plan's own steps: a flagship plan's typed steps, else the plan's delivery steps. */
function stepTitles(blueprint: BlueprintRecord): string[] {
  return (blueprint.flagshipSteps ?? blueprint.deliverySteps).map(step => step.title.value);
}

// ---------------------------------------------------------------------------
// The Producer: the owner's AI words two sections; code does the rest
// ---------------------------------------------------------------------------

type ProducerWords = { heard: string[]; roadmap: string[] };
type Words = ProducerWords & { author: 'template' | 'model'; callId: string | null; line: string };

const LINE_SCHEMA: Json = { type: 'array', items: { type: 'string' } };
const PRODUCER_SCHEMA: Json = { type: 'object', additionalProperties: false, required: ['heard', 'roadmap'], properties: { heard: LINE_SCHEMA, roadmap: LINE_SCHEMA } };
const PRODUCER_INSTRUCTIONS = [
  'You write two parts of a sales proposal a small business owner in India will send to a prospective client themselves.',
  'heard: one to three short sentences saying back what the client asked for, using only the words in "asked". If "asked" is empty, write exactly "[what they told you they need]".',
  'roadmap: two to six short lines saying how the work goes, from the offer and its steps only.',
  'Never write a price, an amount, a percentage or any other number. Never promise a result. Plain words, no markup.',
  'Where you need a fact you were not given, write a short placeholder in square brackets, like [your current monthly enquiries].',
].join(' ');

const shapeRefused = () => new ChausarError('MODEL_OUTPUT_REJECTED', 'The proposal came back in the wrong shape.');

function validateProducer(raw: unknown): ProducerWords {
  const lines = (value: unknown, min: number, max: number): string[] => {
    if (!Array.isArray(value) || value.length < min || value.length > max) throw shapeRefused();
    return value.map(item => {
      if (typeof item !== 'string' || !item.trim() || item.length > 300 || /[\r\n]/.test(item)) throw shapeRefused();
      return tidyWords(item);
    });
  };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw shapeRefused();
  const value = raw as Record<string, unknown>;
  return { heard: lines(value.heard, 1, 3), roadmap: lines(value.roadmap, 2, 6) };
}

/** Money and number words the engine's shared lists (records.ts, agents/number-words.ts) leave to context. */
const NUMBER_WORDS = /(?<![\p{L}\p{M}])(?:lakhs?|lacs?|crores?|percent|percentage|per cent|thousands?|hundreds?|millions?|billions?|rs|inr|प्रतिशत|फ़ीसदी|फीसदी|सैकड़ा)(?![\p{L}\p{M}])|[₹%]/iu;

/**
 * Why the AI's lines hold a number, or null: any digit in any script (placeholders included, so "[50000 per month]" is
 * one), or a number or money word in English or Hindi ("fifty thousand rupees", "पचास हज़ार", "two lakh", "percent").
 * The AI never writes a figure in a proposal: Investment is the calculator's, and every other fact is a placeholder.
 */
export function numberProblem(words: ProducerWords): string | null {
  const text = [...words.heard, ...words.roadmap].join(' ');
  if (/\p{Nd}/u.test(text)) return 'they held a number your records do not back.';
  let spelled = false;
  try {
    assertNoNumbers(text, 'proposal');
    assertNoSpelledNumbers(text, 'proposal');
  } catch {
    spelled = true;
  }
  return spelled || ENGLISH_NUMBER_WORDS.test(text) || holdsHindiNumber(text) || NUMBER_WORDS.test(text) ? 'they held a number or a price in words.' : null;
}

/** Words others wrote pass the untrusted screen before the AI reads them; held words keep the AI out (false). */
function screened(text: string | null): string | null | false {
  if (text === null) return null;
  const result = screenUntrusted({ source: 'client-file', text }, { mode: 'enforce' }).text;
  return result === null ? false : tidyWords(result);
}

/**
 * The owner's AI's words for What we heard and the Roadmap, under the chat consent, or Chausar's own: with templates
 * only, without the consent, when their words held text aimed at the AI, or when the AI's words fail a check (a typed
 * amount, a number the records do not back, a placeholder not asked). check: the proposal checks on candidate words.
 */
async function producerWords(deps: VentureDeps, ctx: Context, state: State, venture: VentureRecord, input: {
  template: ProducerWords; heard: string | null; offer: Offer; steps: string[]; pilot: boolean; check: (words: ProducerWords) => string | null;
}): Promise<Words> {
  const template: Words = { ...input.template, author: 'template', callId: null, line: TEMPLATE_LINE };
  const { view, route } = chatConsentState(deps, ctx, state, venture);
  if (!route) return template;
  if (view.state !== 'given') return { ...template, line: NO_CONSENT_LINE };
  const asked = screened(input.heard);
  if (asked === false) return { ...template, line: HELD_LINE };
  const task: ModelTask<ProducerWords> = {
    purpose: 'outreach-draft', instructions: PRODUCER_INSTRUCTIONS, schemaName: 'venture-sales-proposal', schema: PRODUCER_SCHEMA, validate: validateProducer,
    input: { asked: asked ?? '', offer: { name: input.offer.name.value, description: input.offer.description.value, steps: input.steps }, pilot: input.pilot },
    containsClientData: true, maxOutputTokens: 1024,
  };
  const answered = await chatCall(deps, ctx, route, task);
  const fallback = (problem: string): Words => ({ ...template, line: `Your AI's words did not pass Chausar's checks: ${problem} This is Chausar's own draft. ${NEXT_LINE}` });
  if (!answered) return fallback('they came back in a shape Chausar refuses.');
  const problem = input.check(answered.value);
  if (problem) return fallback(problem);
  const numbers = numberProblem(answered.value);
  if (numbers) return fallback(numbers);
  return { ...answered.value, author: 'model', callId: answered.callId, line: MODEL_LINE };
}

// ---------------------------------------------------------------------------
// Building the sections
// ---------------------------------------------------------------------------

/** The sections around the words, with Investment from the receipt lines and Open questions from every placeholder. */
function sectionsOf(words: ProducerWords, investmentLines: string[], next: string[]): { sections: SalesProposalSection[]; placeholders: string[] } {
  const body: SalesProposalSection[] = [
    { id: 'heard', title: TITLE_OF.heard, lines: words.heard },
    { id: 'roadmap', title: TITLE_OF.roadmap, lines: words.roadmap },
    { id: 'investment', title: TITLE_OF.investment, lines: investmentLines },
    { id: 'next', title: TITLE_OF.next, lines: next },
  ];
  const placeholders = placeholdersOf(body);
  return { sections: [...body, { id: 'questions', title: TITLE_OF.questions, lines: placeholders.map(placeholder => `Please tell us ${placeholder}.`) }], placeholders };
}

/** The proposal as one plain text, as a handoff carries it. */
function plainText(sections: readonly SalesProposalSection[]): string {
  return sections.filter(section => section.lines.length).map(section => [section.title, ...section.lines.map(line => `- ${line}`)].join('\n')).join('\n\n');
}

/** Investment: the receipt's total and its sentence, or a share in words; and the figures an amount may repeat. */
function investmentOf(offer: Offer, receipt: PriceReceiptRecord | null, pilot: boolean): { item: SalesProposalInvestment; lines: string[]; allowed: string[] } {
  const name = `${pilot ? 'Pilot of ' : ''}${offer.name.value}`;
  if (offer.pricing.share) {
    const words = shareWords(offer.pricing.share.bps);
    return {
      item: { kind: 'share', offerId: offer.id, offerName: offer.name.value, bps: offer.pricing.share.bps, words },
      lines: [`${name}: ${words}`, 'Chausar\'s calculator works the amount out once you confirm it, with the file that shows it.'], allowed: [],
    };
  }
  const priced = receipt!;
  const total = priced.figures.find(figure => figure.key === 'total')!;
  const per = UNIT[offer.pricing.quantityUnit];
  return {
    item: { kind: 'price', offerId: offer.id, offerName: offer.name.value, receiptId: priced.id, totalMinor: priced.totalMinor, display: total.display, per },
    lines: [`${name}: ${total.display} ${per}`, priced.explanation], allowed: priced.figures.map(figure => figure.display),
  };
}

// ---------------------------------------------------------------------------
// The view and the handoffs
// ---------------------------------------------------------------------------

function subjectOf(record: Pick<SalesProposalBody, 'offerName' | 'pilot'>): string {
  return `${record.pilot ? 'A paid pilot' : 'A proposal'}: ${record.offerName}`;
}

/** The handoffs of an approved proposal, from its contacts: mail, WhatsApp, LinkedIn copy; else the text to copy. */
export function proposalHandoffs(record: SalesProposalBody): OutreachHandoff[] {
  const subject = subjectOf(record);
  const handoffs: OutreachHandoff[] = [];
  const { email, phone, linkedin } = record.contact;
  if (email) {
    try { handoffs.push(mailHandoff(email, subject, record.text)); } catch { /* an address no mail app opens: the other ways stay */ }
  }
  if (phone) {
    const url = whatsappUrl(phone, record.text);
    handoffs.push(url.length > MAX_HANDOFF_URL
      ? { action: 'copy', to: record.toName, subject: null, text: record.text, line: `This is too long to open in WhatsApp in one link. Copy the text into a WhatsApp chat with ${record.toName}. ${SENT_BY_YOU}` }
      : { action: 'whatsapp', url, line: `Opens WhatsApp with the text filled in. ${COUNTED_LINE}` });
  }
  if (linkedin) handoffs.push({ action: 'linkedin', profileUrl: linkedin, text: record.text, line: `Copy the proposal, then open the profile and paste it into Message. ${COUNTED_LINE}` });
  if (!handoffs.length) handoffs.push({ action: 'copy', to: record.toName, subject, text: record.text, line: `Copy the text into a message to ${record.toName}. ${SENT_BY_YOU}` });
  return handoffs;
}

/** A stored proposal as the screens read it. */
export function proposalView(record: SalesProposalRecord): SalesProposalView {
  const exit = record.scope.verdict === 'partly' && record.scope.reply ? { verdict: 'partly' as const, reply: record.scope.reply, rest: record.scope.rest } : null;
  const line = record.status === 'approved' ? APPROVED_VIEW_LINE : record.author === 'model' ? MODEL_LINE : TEMPLATE_LINE;
  return {
    id: record.id, at: record.at, to: record.toName, offerId: record.offerId, offerName: record.offerName, pilot: record.pilot, status: record.status,
    sections: record.sections, investment: record.investment, placeholders: record.placeholders, checks: record.checks, author: record.author, line,
    exit, digest: record.digest, handoffs: record.status === 'approved' ? proposalHandoffs(record) : null,
  };
}

// ---------------------------------------------------------------------------
// venture.salesProposal.draft and .get
// ---------------------------------------------------------------------------

type DraftRequest = { clientId: string | null; personId: string | null; offerId: string; pilot: Omit<PilotTerms, 'priceMinor' | 'shareBps'> | null };

/** What the owner and the client agreed for a pilot (pilot: true agrees nothing yet); kit/pilot.ts checks the values. */
function pilotAsk(value: unknown): DraftRequest['pilot'] {
  if (value === undefined || value === false) return null;
  const none = { startsOn: null, weeks: null, hypothesis: null, measure: { what: null, target: null, by: null }, ownerHours: null, clientHours: null, reference: null };
  if (value === true) return none;
  const body = exactPayload(value, ['startsOn', 'weeks', 'hypothesis', 'measure', 'ownerHours', 'clientHours', 'reference'] satisfies (keyof SalesPilotTerms)[]);
  const measure = body.measure === undefined ? {} : exactPayload(body.measure, ['what', 'target', 'by']);
  const text = (item: unknown, field: string): string | null => {
    check(item === undefined || typeof item === 'string', 'INVALID_VENTURE_REQUEST', `${field} must be text.`);
    return (item as string | undefined) ?? null;
  };
  const whole = (item: unknown, field: string): number | null => {
    check(item === undefined || typeof item === 'number', 'INVALID_VENTURE_REQUEST', `${field} must be a whole number.`);
    return (item as number | undefined) ?? null;
  };
  check(body.reference === undefined || typeof body.reference === 'boolean', 'INVALID_VENTURE_REQUEST', 'Say yes or no to mentioning them as a client.');
  return {
    startsOn: text(body.startsOn, 'The day the pilot starts'), weeks: whole(body.weeks, 'The weeks'), hypothesis: text(body.hypothesis, 'The hypothesis'),
    measure: { what: text(measure.what, 'What you measure'), target: text(measure.target, 'The success number'), by: text(measure.by, 'The success date') },
    ownerHours: whole(body.ownerHours, 'Your hours'), clientHours: whole(body.clientHours, "Your client's hours"), reference: (body.reference as boolean | undefined) ?? null,
  };
}

function draftRequest(payload: unknown): DraftRequest {
  const body = exactPayload(payload, ['clientId', 'personId', 'offerId', 'pilot'], ['offerId']);
  const clientId = body.clientId === undefined ? null : identifier(body.clientId, 'Client');
  const personId = body.personId === undefined ? null : identifier(body.personId, 'Person');
  check((clientId === null) !== (personId === null), 'INVALID_VENTURE_REQUEST', 'Name one client or one person from your pipeline.');
  return { clientId, personId, offerId: identifier(body.offerId, 'Offer'), pilot: pilotAsk(body.pilot) };
}

/**
 * venture.salesProposal.draft {clientId | personId, offerId, pilot?} (prepare). pilot: true, or the terms agreed so far
 * (kit/pilot.ts checks them: PILOT_WINDOW for a window outside 2 to 6 weeks or a success date outside it). definitions:
 * the kit playbooks the honest exit reads (playbooks/definitions.ts by default; a test passes its own).
 */
export async function draftSalesProposal(deps: VentureDeps, ctx: Context, payload: unknown, options: { definitions?: readonly PlaybookDefinition[] } = {}): Promise<SalesProposalView> {
  const request = draftRequest(payload);
  const definitions = options.definitions ?? (await import('../definitions.ts')).PLAYBOOK_DEFINITIONS;
  const { state, venture } = readAs(deps, ctx, 'prepare');
  const blueprint = requireAcceptedBlueprint(venture, listRecords(state, 'venture-blueprint', venture.id));
  const offer = requireOffer(blueprint, request.offerId);
  if (!offer.pricing.share && (offer.pricing.unitPriceMinor === null || BigInt(offer.pricing.unitPriceMinor) === 0n)) {
    if (request.pilot) throw new ChausarError('PILOT_UNPRICED', PILOT_UNPRICED_LINE);
    throw new ChausarError('OFFER_UNPRICED', `Set your price for ${offer.name.value} before you draft a proposal for it.`);
  }
  const who = whoOf(state, venture, request.clientId, request.personId);
  const heard = heardOf(state, venture, who);

  // The honest exit, by code, for a business a kit playbook runs (kit/exit.ts).
  const definition = kitDefinitionOf(venture, definitions);
  const verdict = definition && heard ? scopeOf(definition, heard, { hi: scopeHi(definition) }) : null;
  const scope: SalesProposalScope = verdict
    ? { verdict: verdict.verdict, rest: verdict.rest, reply: verdict.reply }
    : { verdict: definition ? 'unclear' : 'not-checked', rest: [], reply: null };
  const shown = { to: who.name, offerId: offer.id, offerName: offer.name.value, pilot: request.pilot !== null };

  // The pilot page (kit/pilot.ts), checked before anything is written: the kit offer when the plan's offer is one; any
  // offer of a business no kit runs may be a pilot. Its price is the owner's own amount, or the share they set, kept apart.
  const kitOffer: KitOffer | null = definition && offer.playbookOffer ? definition.offers.find(item => item.id === offer.playbookOffer) ?? null : null;
  const pilotPage = request.pilot ? pilotOf({ offers: [kitOffer ?? { id: offer.id, name: offer.name.value, pilotable: true } as KitOffer] }, kitOffer?.id ?? offer.id, {
    ...request.pilot, priceMinor: offer.pricing.unitPriceMinor, shareBps: offer.pricing.share?.bps ?? null,
  }) : null;

  if (scope.verdict === 'outside') {
    await ventureAction(deps, ctx, 'prepare', 'salesProposal.exit', tx => { parkOutsideScope(tx, { personId: who.person?.id ?? null, clientId: who.client?.id ?? null }, ctx.memberId); });
    return {
      ...shown, id: null, at: null, status: 'outside', sections: [], investment: [], placeholders: [], checks: [], author: 'template', line: OUTSIDE_LINE,
      exit: { verdict: 'outside', reply: scope.reply!, rest: scope.rest }, digest: null, handoffs: null,
    };
  }

  const intro = `${offer.name.value}: ${sentence(offer.description.value)}.`;
  const steps = kitOffer ? kitOffer.includes.map(sentence) : stepTitles(blueprint);
  const partly = scope.verdict === 'partly' ? [scope.reply!] : [];
  // Their own words, quoted back: an amount they named is theirs, not a price Chausar states (proposalChecks' quoted).
  const theirWords = heard ? [quoted(heard)] : [];
  const template: ProducerWords = { heard: [...(heard ? theirWords : [HEARD_PLACEHOLDER]), ...partly], roadmap: pilotPage ? [intro, ...pilotPage.lines] : [intro, ...steps] };
  const next = pilotPage
    ? [`Reply to say yes to the pilot, and we start on ${pilotPage.window.from ?? PILOT_START}.`, ...PILOT_AFTER_ASKS.map(ask => `After the pilot: ${ask}`)]
    : [`Reply to say yes, and we start on ${START_PLACEHOLDER}.`];
  // The AI's words are checked before the receipt exists, so no amount at all may stand in them.
  const words = await producerWords(deps, ctx, state, venture, {
    template, heard, offer, steps, pilot: request.pilot !== null,
    check: candidate => proposalChecks(sectionsOf({ heard: [...candidate.heard, ...partly], roadmap: candidate.roadmap }, [], next).sections, []).find(item => !item.passed)?.detail ?? null,
  });
  const chosen: ProducerWords = words.author === 'model'
    ? { heard: [...words.heard, ...partly], roadmap: pilotPage ? [...words.roadmap, ...pilotPage.lines] : words.roadmap }
    : template;

  return ventureAction(deps, ctx, 'prepare', 'salesProposal.draft', tx => {
    const current = requireAcceptedBlueprint(tx.venture!, tx.list('venture-blueprint'));
    check(current.id === blueprint.id, 'APPROVAL_STALE', 'Your plan changed while Chausar was drafting. Draft it again.');
    const receipt = offer.pricing.share ? null : buildPriceReceipt(tx, { type: 'offer', offerId: offer.id }, { quantity: offer.pricing.defaultQuantity }, blueprint, offer, who.client);
    const investment = investmentOf(offer, receipt, request.pilot !== null);
    const { sections, placeholders } = sectionsOf(chosen, investment.lines, next);
    const body: Omit<SalesProposalBody, 'digest' | 'status' | 'approvedAt'> = {
      clientId: who.client?.id ?? null, personId: who.person?.id ?? null, toName: who.name, offerId: offer.id, offerName: offer.name.value, pilot: request.pilot !== null,
      sections, investment: [investment.item], placeholders, checks: proposalChecks(sections, investment.allowed, theirWords), author: words.author, callId: words.callId,
      scope, contact: who.contact, text: plainText(sections),
    };
    const record = tx.put<SalesProposalRecord>({ ...tx.base('venture-sales-proposal'), ...body, status: 'waiting', approvedAt: null, digest: digest(body) });
    tx.emit('queue.changed', {});
    return { ...proposalView(record), line: words.line };
  });
}

/** venture.salesProposal.get {id} | {clientId} | {personId} (read): one proposal, or the newest for a client or a person. */
export async function getSalesProposal(deps: VentureDeps, ctx: Context, payload: unknown): Promise<SalesProposalView> {
  const body = exactPayload(payload, ['id', 'clientId', 'personId']);
  const keys = Object.keys(body);
  check(keys.length === 1, 'INVALID_VENTURE_REQUEST', 'Name one proposal, one client or one person.');
  const key = keys[0] as 'id' | 'clientId' | 'personId';
  const wanted = identifier(body[key], key === 'id' ? 'Proposal' : key === 'clientId' ? 'Client' : 'Person');
  const { state, venture } = readVenture(deps, ctx);
  const found = listRecords(state, 'venture-sales-proposal', venture.id)
    .filter(record => (key === 'id' ? record.id : key === 'clientId' ? record.clientId : record.personId) === wanted)
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))[0];
  check(found, 'PROPOSAL_NOT_FOUND', key === 'id' ? 'This proposal was not found.' : 'There is no proposal for them yet.');
  return proposalView(found);
}

// ---------------------------------------------------------------------------
// Today (views/queue-w4.ts source 'sales-proposal'; Read shows the sections, views/queue-view.ts)
// ---------------------------------------------------------------------------

const ACTIONS: readonly QueueAction[] = Object.freeze([
  { id: 'read', label: 'Read', primary: false },
  { id: 'approve', label: 'Approve', primary: true, requiresView: true },
]);

/** Today's rows: each proposal waiting for the owner whose checks all passed, to read and approve. */
export function salesProposalRows(_deps: VentureDeps, _ctx: Context, state: State, venture: VentureRecord): W4RowItem[] {
  return listRecords(state, 'venture-sales-proposal', venture.id)
    .filter(record => record.status === 'waiting' && record.checks.every(item => item.passed))
    .map(record => ({
      kind: 'proposal' as const, subject: `salesprop:${record.id}`, version: record.digest, createdAt: record.at,
      title: `Proposal for ${record.toName} is ready`,
      line: `${record.offerName}${record.pilot ? ', a paid pilot' : ''}. Read it, then approve it. You send it yourself; Chausar never sends it.`,
      viewRef: { kind: 'file' as const, id: record.id }, actions: ACTIONS.map(action => ({ ...action })),
    }));
}

/**
 * Approve on a proposal's row: the owner read this version (queue.ts checked the view and the digest); it becomes
 * approved, and its handoffs open in Clients. Nothing is sent.
 */
export async function decideSalesProposalRow(deps: VentureDeps, ctx: Context, decision: W4Decision): Promise<W4Outcome> {
  check(decision.action === 'approve', 'INVALID_VENTURE_REQUEST', 'This row only approves the proposal.');
  const id = decision.subject.slice('salesprop:'.length);
  return ventureAction(deps, ctx, 'approve', 'salesProposal.approve', tx => {
    const record = tx.find('venture-sales-proposal', id);
    check(record, 'PROPOSAL_NOT_FOUND', 'This proposal was not found.');
    check(record.status === 'waiting', 'APPROVAL_STALE', 'This proposal was already approved.');
    check(record.checks.every(item => item.passed), 'PROPOSAL_CHECKS_FAILED', 'This proposal did not pass its checks. Draft it again.');
    tx.replace<SalesProposalRecord>({ ...record, status: 'approved', approvedAt: tx.now });
    tx.emit('queue.changed', {});
    return { line: APPROVED_LINE };
  });
}
