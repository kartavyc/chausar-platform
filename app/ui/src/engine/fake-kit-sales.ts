/**
 * The fake engine's answers for the sales mechanics (Ink v2 wave 5, package 5A2), in the engine's shapes, codes, order
 * and words (platform/runtime/venture/playbooks/kit/proposal.ts, go-no-go.ts): venture.salesProposal.draft and .get,
 * the proposal's Today row (Read shows its five sections; Approve hands it off; fake.ts asks this desk for both), and
 * venture.goNoGo.card and .list with the receipt behind a card's maximum loss. The fake drafts with Chausar's own
 * template (no AI is connected here) and runs no kit playbook, so the honest exit never decides here.
 */

import {
  EngineError,
  type BlueprintViewLite, type ClientLite, type GoNoGoCardView, type GoNoGoInputName, type OfferLite, type OrderLite, type OutreachHandoff, type PersonView,
  type QueueItemView, type QueueRow, type ReceiptLite, type SalesProposalCheck, type SalesProposalSection, type SalesProposalView,
} from './types';
import type { W4DeskHost } from './fake-w4';

const METHODS = new Set<string>([
  'venture.salesProposal.draft',
  'venture.salesProposal.get',
  'venture.goNoGo.card',
  'venture.goNoGo.list',
]);

// The engine's words (kit/proposal.ts), exactly.
const TITLES: Readonly<Record<SalesProposalSection['id'], string>> = { heard: 'What we heard', roadmap: 'Roadmap', investment: 'Investment', next: 'Next step', questions: 'Open questions' };
const NEXT_LINE = 'Read it on Today and approve it; then you send it yourself. Chausar never sends it.';
const TEMPLATE_LINE = `Drafted by Chausar from your records. ${NEXT_LINE}`;
const APPROVED_LINE = 'Approved. Open it in Clients to send it yourself; Chausar never sends it.';
const APPROVED_VIEW_LINE = 'You approved it. Send it yourself from here; Chausar never sends it.';
const PILOT_UNPRICED = 'A pilot is never free. Set a price for it.';
const HEARD_PLACEHOLDER = '[what they told you they need]';
const START_PLACEHOLDER = '[the day you would like to start]';
const PILOT_TERMS = ['startsOn', 'weeks', 'hypothesis', 'measure', 'ownerHours', 'clientHours', 'reference'];

/** A day N days after another ('YYYY-MM-DD'), on the calendar. */
const addDays = (day: string, days: number): string => {
  const date = new Date(`${day}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

/**
 * The engine's pilot page lines (playbooks/kit/pilot.ts pilotOf), from the terms agreed so far: a fact not agreed is a
 * placeholder; a window outside 2 to 6 weeks, or a success date outside it, refuses PILOT_WINDOW.
 */
function pilotLines(offerName: string, raw: unknown): { lines: string[]; startsOn: string | null } {
  const terms = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  for (const key of Object.keys(terms)) if (!PILOT_TERMS.includes(key)) throw invalid(`Unknown field: ${key}.`);
  const measure = (terms.measure && typeof terms.measure === 'object' ? terms.measure : {}) as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '') : null);
  const start = typeof terms.startsOn === 'string' ? terms.startsOn : null;
  const weeks = typeof terms.weeks === 'number' ? terms.weeks : null;
  if (weeks !== null && !(Number.isInteger(weeks) && weeks >= 2 && weeks <= 6)) throw new EngineError('PILOT_WINDOW', 'A pilot runs 2 to 6 weeks.');
  const to = weeks !== null && start ? addDays(start, weeks * 7) : null;
  const by = typeof measure.by === 'string' ? measure.by : null;
  if (by !== null) {
    if (!start) throw new EngineError('PILOT_WINDOW', 'Agree the day the pilot starts before its success date.');
    const last = to ?? addDays(start, 42);
    if (!(by > start && by <= last)) throw new EngineError('PILOT_WINDOW', `The success date must fall inside the pilot, after ${start} and by ${last}.`);
  }
  const hours = (value: unknown) => (typeof value === 'number' ? `${value} ${value === 1 ? 'hour' : 'hours'} a week` : null);
  const span = weeks === null ? '[2 to 6 weeks]' : `${weeks} weeks`;
  const from = start ?? '[the day it starts]';
  const reference = typeof terms.reference === 'boolean' ? terms.reference : null;
  return {
    startsOn: start,
    lines: [
      `A paid pilot of ${offerName} ${to === null ? `for ${span}, from ${from}.` : `for ${span}, from ${from} to ${to}.`}`,
      `What we test: ${text(terms.hypothesis) ?? '[the one thing we expect to change]'}.`,
      `Success: ${text(measure.what) ?? '[what we measure]'}, ${text(measure.target) ?? '[the number you agree on]'}, by ${by ?? '[the date, inside the pilot]'}.`,
      `Time needed: ${hours(terms.clientHours) ?? '[hours a week from you]'} from you, ${hours(terms.ownerHours) ?? '[hours a week from us]'} from us.`,
      reference === null ? 'May we mention you as a client? [may we mention you as a client: yes or no]'
        : reference ? 'You agreed we may mention you as a client.' : 'You asked us not to mention you as a client.',
    ],
  };
}
const AFTER = ['A short case study, if the pilot meets its measure.', 'An introduction to one business like yours.'];
const UNIT: Readonly<Record<OfferLite['pricing']['quantityUnit'], string>> = { month: 'per month', project: 'per project', hour: 'per hour' };
const COUNTED = 'Chausar sends nothing here, and counts only the notes you mark as sent.';
const PLACEHOLDER = /\[[^\][\n]{2,120}\]/g;

// The engine's words (kit/go-no-go.ts), exactly.
const INPUTS: readonly { name: GoNoGoInputName; label: string; ask: string; kind: 'money' | 'months' }[] = [
  { name: 'upfront', label: 'What it costs to start', ask: 'what it costs to start', kind: 'money' },
  { name: 'monthly', label: 'What it costs each month', ask: 'what it costs each month', kind: 'money' },
  { name: 'months', label: 'How many months you will try it', ask: 'how many months you will try it', kind: 'months' },
  { name: 'limit', label: 'The most you are willing to lose', ask: 'the most you are willing to lose', kind: 'money' },
];
const SPENDS_NOTHING = 'GO spends nothing: each spend still asks you.';

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const sentence = (text: string) => text.trim().replace(/[.\s]+$/, '');
const joined = (items: readonly string[]) => (items.length <= 1 ? items[0] ?? '' : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);
const ID = /^[A-Za-z0-9_-]{1,100}$/;

/** Minor units as the engine's formatMinor writes rupees: "INR 35,000.00". */
function inrMinor(minor: bigint): string {
  const negative = minor < 0n;
  const absolute = negative ? -minor : minor;
  const whole = String(absolute / 100n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}INR ${whole}.${String(absolute % 100n).padStart(2, '0')}`;
}

/**
 * Rupees as the owner typed them, read as the engine's ownerPrice reads a price (core/words.ts): spaces and thousands
 * commas dropped, at most two decimals, at most 1,000,000,000,000 paise; zero is a cost of nothing on the GO card.
 */
function rupeesTyped(value: unknown, label: string): string {
  const text = typeof value === 'string' && value.length <= 40 ? value.replace(/[\s,]/g, '') : '';
  if (!/^\d+(?:\.\d+)?$/.test(text)) throw new EngineError('INVALID_AMOUNT', `${label} must be a positive amount like 2499 or 2499.50.`);
  const [whole = '0', raw = ''] = text.split('.');
  const fraction = raw.replace(/0+$/, '');
  if (fraction.length > 2) throw new EngineError('INVALID_AMOUNT', 'The amount contains a fractional minor unit for its currency.');
  const minor = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0') || '0');
  if (minor > 1_000_000_000_000n) throw new EngineError('INVALID_AMOUNT', `${label} is larger than Chausar accepts.`);
  return String(minor);
}

interface StoredProposal { business: string; clientId: string | null; personId: string | null; contact: { email: string | null; phone: string | null; linkedin: string | null }; text: string; view: SalesProposalView }
interface StoredCard { business: string; view: GoNoGoCardView; figures: ReceiptLite['figures']; explanation: string | null }

export class FakeKitSalesDesk {
  protected readonly host: W4DeskHost;
  protected readonly fresh: boolean;
  private readonly proposals: StoredProposal[] = [];
  private readonly cards: StoredCard[] = [];
  private seq = 1;

  constructor(host: W4DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.fresh = options.fresh ?? false;
  }

  handles(method: string): boolean {
    return METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    switch (method) {
      case 'venture.salesProposal.draft': return this.draft(p);
      case 'venture.salesProposal.get': return this.get(p);
      case 'venture.goNoGo.card': return this.card(p);
      case 'venture.goNoGo.list': {
        if (Object.keys(p).length) throw invalid('This takes nothing.');
        return { cards: this.cards.filter((c) => c.business === this.host.current()).map((c) => clone(c.view)).reverse() };
      }
      default: throw new EngineError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
    }
  }

  // ---------------------------------------------------------------------------
  // The sales proposal
  // ---------------------------------------------------------------------------

  private draft(p: Record<string, unknown>): SalesProposalView {
    for (const key of Object.keys(p)) if (!['clientId', 'personId', 'offerId', 'pilot'].includes(key)) throw invalid(`Unknown field: ${key}.`);
    const clientId = typeof p.clientId === 'string' ? p.clientId : null;
    const personId = typeof p.personId === 'string' ? p.personId : null;
    if ((clientId === null) === (personId === null)) throw invalid('Name one client or one person from your pipeline.');
    if (typeof p.offerId !== 'string' || !ID.test(p.offerId)) throw invalid('Send the offer id.');
    if (p.pilot !== undefined && typeof p.pilot !== 'boolean' && (typeof p.pilot !== 'object' || p.pilot === null)) throw invalid('Say whether it is a pilot with true or false.');
    const pilot = p.pilot !== undefined && p.pilot !== false;
    const plan = this.host.ask('venture.blueprint.get', {}) as BlueprintViewLite | null;
    if (!plan) throw new EngineError('BLUEPRINT_NOT_ACCEPTED', 'Accept your plan first.');
    const offer = plan.blueprint.offers.find((o) => o.id === p.offerId);
    if (!offer) throw new EngineError('OFFER_NOT_FOUND', 'Your plan has no such offer.');
    const share = offer.pricing.share ?? null;
    if (!share && (offer.pricing.unitPriceMinor === null || /^0+$/.test(offer.pricing.unitPriceMinor))) {
      if (pilot) throw new EngineError('PILOT_UNPRICED', PILOT_UNPRICED);
      throw new EngineError('OFFER_UNPRICED', `Set your price for ${offer.name.value} before you draft a proposal for it.`);
    }
    let name: string;
    let heard: string | null = null;
    let contact: StoredProposal['contact'];
    if (clientId) {
      const client = (this.host.ask('venture.client.list', {}) as ClientLite[]).find((c) => c.id === clientId);
      if (!client) throw new EngineError('CLIENT_NOT_FOUND', 'Add this client first.');
      name = client.name;
      const orders = (this.host.ask('venture.order.list', {}) as OrderLite[]).filter((o) => o.clientId === clientId).sort((a, b) => b.at.localeCompare(a.at));
      heard = orders[0]?.request ?? client.note ?? null;
      contact = { email: client.email, phone: null, linkedin: null };
    } else {
      let person: PersonView;
      try {
        person = this.host.ask('venture.network.person', { id: personId }) as PersonView;
      } catch {
        throw invalid('This person is not in your network.');
      }
      name = person.person.name;
      contact = { email: person.fields.find((f) => f.field === 'email')?.value ?? null, phone: person.fields.find((f) => f.field === 'phone')?.value ?? null, linkedin: person.linkedin };
    }

    const intro = `${offer.name.value}: ${sentence(offer.description.value)}.`;
    const steps = (plan.blueprint.flagshipSteps ?? plan.blueprint.deliverySteps).map((step) => step.title.value);
    // As the engine quotes them: one line, at most 300 characters. An amount in their own words is theirs, so the
    // engine's figures-resolve lets the quote through, as here; the fake runs no kit playbook, so scope is never checked.
    const said = heard?.replace(/\s+/g, ' ').trim() ?? '';
    const heardLines = [heard ? `You asked: "${said.length > 300 ? `${said.slice(0, 297)}...` : said}"` : HEARD_PLACEHOLDER];
    const page = pilot ? pilotLines(offer.name.value, p.pilot) : null;
    const roadmap = page ? [intro, ...page.lines] : [intro, ...steps];
    const next = page
      ? [`Reply to say yes to the pilot, and we start on ${page.startsOn ?? '[the day it starts]'}.`, ...AFTER.map((ask) => `After the pilot: ${ask}`)]
      : [`Reply to say yes, and we start on ${START_PLACEHOLDER}.`];
    const label = `${pilot ? 'Pilot of ' : ''}${offer.name.value}`;
    let investment: SalesProposalView['investment'];
    let investmentLines: string[];
    if (share) {
      const words = share.words;
      investment = [{ kind: 'share', offerId: offer.id, offerName: offer.name.value, bps: share.bps, words }];
      investmentLines = [`${label}: ${words}`, 'Chausar\'s calculator works the amount out once you confirm it, with the file that shows it.'];
    } else {
      const receipt = this.host.ask('venture.price.quote', { offerId: offer.id }) as ReceiptLite;
      const total = receipt.figures.find((f) => f.key === 'total') ?? receipt.figures[receipt.figures.length - 1]!;
      const per = UNIT[offer.pricing.quantityUnit];
      investment = [{ kind: 'price', offerId: offer.id, offerName: offer.name.value, receiptId: receipt.id, totalMinor: offer.pricing.unitPriceMinor ?? '0', display: total.display, per }];
      investmentLines = [`${label}: ${total.display} ${per}`, receipt.explanation];
    }
    const body: SalesProposalSection[] = [
      { id: 'heard', title: TITLES.heard, lines: heardLines }, { id: 'roadmap', title: TITLES.roadmap, lines: roadmap },
      { id: 'investment', title: TITLES.investment, lines: investmentLines }, { id: 'next', title: TITLES.next, lines: next },
    ];
    const placeholders = [...new Set(body.flatMap((section) => section.lines.flatMap((line) => line.match(PLACEHOLDER) ?? [])))];
    const sections = [...body, { id: 'questions' as const, title: TITLES.questions, lines: placeholders.map((item) => `Please tell us ${item}.`) }];
    const checks: SalesProposalCheck[] = [
      { id: 'required-sections', passed: true, detail: 'The five sections are there, in order.' },
      { id: 'figures-resolve', passed: true, detail: 'Every amount opens a price receipt from your list.' },
      { id: 'placeholders-listed', passed: true, detail: 'Every gap is an open question.' },
    ];
    const id = `salesprop_${this.seq++}`;
    const view: SalesProposalView = {
      id, at: this.host.now(), to: name, offerId: offer.id, offerName: offer.name.value, pilot, status: 'waiting', sections, investment, placeholders, checks,
      author: 'template', line: TEMPLATE_LINE, exit: null, digest: '', handoffs: null,
    };
    view.digest = this.host.digest({ ...view, digest: '' });
    const text = sections.filter((section) => section.lines.length).map((section) => [section.title, ...section.lines.map((line) => `- ${line}`)].join('\n')).join('\n\n');
    this.proposals.push({ business: this.host.current(), clientId, personId, contact, text, view });
    this.addRow(view);
    this.host.emit({ type: 'queue.changed', businessId: this.host.current(), at: this.host.now() });
    return clone(view);
  }

  private get(p: Record<string, unknown>): SalesProposalView {
    const keys = Object.keys(p);
    if (keys.length !== 1 || !['id', 'clientId', 'personId'].includes(keys[0]!)) throw invalid('Name one proposal, one client or one person.');
    const key = keys[0] as 'id' | 'clientId' | 'personId';
    const wanted = p[key];
    if (typeof wanted !== 'string' || !ID.test(wanted)) throw invalid('Send the id.');
    const found = this.proposals.filter((item) => item.business === this.host.current() && (key === 'id' ? item.view.id : item[key]) === wanted).at(-1);
    if (!found) throw new EngineError('PROPOSAL_NOT_FOUND', key === 'id' ? 'This proposal was not found.' : 'There is no proposal for them yet.');
    return this.viewOf(found);
  }

  private viewOf(found: StoredProposal): SalesProposalView {
    const approved = found.view.status === 'approved';
    return clone({ ...found.view, line: approved ? APPROVED_VIEW_LINE : found.view.line, handoffs: approved ? this.handoffs(found) : null });
  }

  /** The engine's proposalHandoffs: mail, WhatsApp, LinkedIn copy; else the text to copy. */
  private handoffs(found: StoredProposal): OutreachHandoff[] {
    const subject = `${found.view.pilot ? 'A paid pilot' : 'A proposal'}: ${found.view.offerName}`;
    const out: OutreachHandoff[] = [];
    const { email, phone, linkedin } = found.contact;
    if (email) out.push({ action: 'mailto', url: `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(found.text.replace(/\n/g, '\r\n'))}`, line: `Opens your mail app with the text filled in. ${COUNTED}` });
    if (phone && /^\+[1-9]\d{6,14}$/.test(phone)) out.push({ action: 'whatsapp', url: `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(found.text)}`, line: `Opens WhatsApp with the text filled in. ${COUNTED}` });
    if (linkedin) out.push({ action: 'linkedin', profileUrl: linkedin, text: found.text, line: `Copy the proposal, then open the profile and paste it into Message. ${COUNTED}` });
    if (!out.length) out.push({ action: 'copy', to: found.view.to, subject, text: found.text, line: `Copy the text into a message to ${found.view.to}. Chausar never sends it.` });
    return out;
  }

  private addRow(view: SalesProposalView): void {
    const seed: Omit<QueueRow, 'digest'> = {
      id: `salesprop:${view.id}:${view.digest!.slice(0, 12)}`, businessId: this.host.current(), businessName: this.businessName(), kind: 'proposal', createdAt: view.at!,
      title: `Proposal for ${view.to} is ready`,
      line: `${view.offerName}${view.pilot ? ', a paid pilot' : ''}. Read it, then approve it. You send it yourself; Chausar never sends it.`,
      viewRef: { kind: 'file', id: view.id! },
      actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Approve', primary: true, requiresView: true }],
    };
    this.host.setRows([...this.host.rows(), { ...seed, digest: this.host.digest(seed) } as QueueRow]);
  }

  private businessName(): string {
    const businesses = this.host.businesses?.() ?? [];
    return businesses.find((b) => b.id === this.host.current())?.name ?? this.host.current();
  }

  /** Approve on a proposal's Today row (fake.ts asks): the engine's words, or null for any other row. */
  decide(row: QueueRow, action: string): string | null {
    if (!row.id.startsWith('salesprop:') || action !== 'approve') return null;
    const found = this.proposals.find((item) => item.view.id === row.viewRef?.id);
    if (!found) return null;
    found.view = { ...found.view, status: 'approved' };
    return APPROVED_LINE;
  }

  /** What Read shows for a proposal's row (fake.ts asks for a file it does not hold): its five sections. */
  view(kind: unknown, id: unknown): QueueItemView | null {
    if (kind !== 'file') return null;
    const found = this.proposals.find((item) => item.view.id === id);
    if (!found) return null;
    return {
      kind: 'file', id: found.view.id!, businessName: this.businessName(), title: `Proposal for ${found.view.to}`, line: found.view.offerName,
      sections: found.view.sections.map((section) => ({ heading: section.title, lines: [...section.lines] })),
    };
  }

  // ---------------------------------------------------------------------------
  // The GO, HOLD or NO-GO card
  // ---------------------------------------------------------------------------

  private card(p: Record<string, unknown>): GoNoGoCardView {
    for (const key of Object.keys(p)) if (!['playbook', 'subject', 'inputs'].includes(key)) throw invalid(`Unknown field: ${key}.`);
    if (typeof p.playbook !== 'string' || !/^[a-z][a-z0-9-]{0,40}$/.test(p.playbook)) throw invalid('Name the playbook by its short id, or general.');
    const subject = typeof p.subject === 'string' ? p.subject.replace(/\s+/g, ' ').trim() : '';
    if (subject.length < 2 || subject.length > 120) throw invalid('What you are deciding must be between 2 and 120 characters.');
    const raw = p.inputs;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw invalid('Send the inputs by name.');
    for (const key of Object.keys(raw)) if (!INPUTS.some((input) => input.name === key)) throw invalid(`The card does not read ${key}.`);
    const values = {} as Record<GoNoGoInputName, string | null>;
    for (const input of INPUTS) {
      const value = (raw as Record<string, unknown>)[input.name];
      if (value === undefined || value === null) { values[input.name] = null; continue; }
      if (input.kind === 'months') {
        if (typeof value !== 'string' || !/^[1-9]\d?$/.test(value) || Number(value) > 36) throw invalid('Months must be a whole number from 1 to 36.');
        values[input.name] = value;
      } else {
        values[input.name] = rupeesTyped(value, input.label);
      }
    }
    const unknown = INPUTS.filter((input) => values[input.name] === null);
    const { upfront: upfrontMinor, monthly: monthlyMinor, months, limit: limitMinor } = values;
    let maxLoss: bigint | null = null;
    let figures: ReceiptLite['figures'] = [];
    let explanation: string | null = null;
    if (upfrontMinor !== null && monthlyMinor !== null && months !== null) {
      const running = BigInt(monthlyMinor) * BigInt(months);
      maxLoss = BigInt(upfrontMinor) + running;
      figures = [
        { key: 'upfront', label: 'What it costs to start', display: inrMinor(BigInt(upfrontMinor)) },
        { key: 'monthly', label: 'What it costs each month', display: inrMinor(BigInt(monthlyMinor)) },
        { key: 'running', label: `Each month for ${months} months`, display: inrMinor(running) },
        { key: 'max-loss', label: 'The most you could lose', display: inrMinor(maxLoss) },
        ...(limitMinor === null ? [] : [{ key: 'limit', label: 'Your limit', display: inrMinor(BigInt(limitMinor)) }]),
      ];
      explanation = `${inrMinor(BigInt(upfrontMinor))} to start, plus ${inrMinor(BigInt(monthlyMinor))} a month for ${months} months (${inrMinor(running)}) = ${inrMinor(maxLoss)} at most.`
        + (limitMinor === null ? '' : ` Your limit is ${inrMinor(BigInt(limitMinor))}.`);
    }
    const verdict = unknown.length ? 'HOLD' : maxLoss! > BigInt(limitMinor!) ? 'NO-GO' : 'GO';
    const id = `gonogo_${this.seq++}`;
    const line = verdict === 'HOLD'
      ? `HOLD: say ${joined(unknown.map((input) => input.ask))}, then make the card again.`
      : verdict === 'NO-GO'
        ? `NO-GO: the most you could lose, ${inrMinor(maxLoss!)}, is above your limit of ${inrMinor(BigInt(limitMinor!))}.`
        : `GO: the most you could lose is ${inrMinor(maxLoss!)}, within your limit of ${inrMinor(BigInt(limitMinor!))}.`;
    const view: GoNoGoCardView = {
      id, at: this.host.now(), playbook: p.playbook, subject, verdict, line,
      unknown: unknown.map((input) => ({ input: input.name, label: input.label })),
      maxLoss: maxLoss === null ? null : { minor: String(maxLoss), display: inrMinor(maxLoss), receiptId: id },
      limit: limitMinor === null ? null : { minor: limitMinor, display: inrMinor(BigInt(limitMinor)) },
      spendsNothing: verdict === 'GO' ? SPENDS_NOTHING : null,
    };
    this.cards.push({ business: this.host.current(), view, figures, explanation });
    return clone(view);
  }

  /** The receipt behind a card's maximum loss (fake.ts asks for an id it does not hold), or undefined. */
  receipt(id: string): ReceiptLite | undefined {
    const found = this.cards.find((c) => c.view.id === id);
    if (!found || found.explanation === null) return undefined;
    return { id, at: found.view.at, figures: clone(found.figures), explanation: found.explanation, stale: false };
  }
}
