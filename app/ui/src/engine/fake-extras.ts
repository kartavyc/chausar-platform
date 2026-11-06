/**
 * The fake engine's answers for the last screens, kept per business: Money at a glance (venture.money.overview), the
 * tax working (venture.tax.working), spend settings (venture.spend.policy.*), the CA firm page (venture.ca.*), leads
 * (venture.leads.*), bank statement imports (venture.bank.*), staged website edits (venture.site.*) and preview links
 * (venture.share.*). It keeps the engine's rules the screens rely on: whole micro-dollars for spend settings, a lead
 * needs the page it was found on, a draft needs a checked email and a postal address and never goes to a blocked
 * address, a CA writes with their own membership number, a site edit applies only with the hash that was reviewed,
 * a statement import never counts a line twice, and a preview link needs a public address.
 */

import { CA_RECEIPTS, CA_REQUEST_TITLES, CA_VIEWS, LEADS, OVERVIEW, POSTAL_ADDRESSES, SITE_FILES, SPEND_POLICIES, TAX_WORKINGS } from './fixtures-extras';
import { dayMonthYear, NO_PROVIDER_LINE } from './fake-bank';
import {
  EngineError, type BankConsentView, type BankImportResult, type CaReceiptView, type CaView, type LeadMoveView, type LeadView, type MoneyOverview, type OutreachDraftView,
  type PlaybookPick, type ShareLink, type SiteEditLite, type SpendPolicyView, type SpendRateInput, type VentureRunEvent, type CurrencyLead,
} from './types';
// 4Z3: which currency leads spend, as the engine's money/spend.ts.
import { currencyLeadOf, rupeesLead, spendLead } from './fake-lead';

const clone = <T>(value: T): T => structuredClone(value);
const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export interface ExtrasHost {
  current(): string;
  now(): string;
  businessName(id: string): string;
  playbook(id: string): PlaybookPick | undefined;
  /** "Clients owe you" from the money desk's open invoices, as the engine formats it. */
  owed(): { value: string; receiptId?: string };
  /** Whether this answers as the hosted web server, which has a public address for preview links. */
  hosted(): boolean;
  emit(event: VentureRunEvent): void;
}

const EXTRA_METHODS = new Set([
  'venture.money.overview', 'venture.tax.working', 'venture.spend.policy.get', 'venture.spend.policy.set',
  'venture.ca.get', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates', 'venture.ca.receipt', 'venture.ca.explainDiff',
  'venture.leads.add', 'venture.leads.list', 'venture.leads.draft', 'venture.leads.recordSend', 'venture.leads.block',
  'venture.bank.import', 'venture.bank.consent', 'venture.site.stage', 'venture.site.apply', 'venture.site.revert',
  'venture.share.create', 'venture.share.list', 'venture.share.revoke',
]);

/** USD with four decimals from whole micro-dollars, as the engine's formatMicros writes it. Sample text work only. */
function usd(micros: string): string {
  const padded = micros.padStart(7, '0');
  const tenThousandths = padded.slice(0, -2);
  return `USD ${tenThousandths.slice(0, -4).replace(/^0+(?=\d)/, '')}.${tenThousandths.slice(-4)}`;
}
/** US dollars as typed ('20', '12.50', '0.000075') to whole micro-dollars, as the engine's usdToMicros. Null clears. */
function dollars(value: unknown, field: string, decimals: 2 | 6): string | null {
  if (value === null) return null;
  const match = typeof value === 'string' ? (decimals === 2 ? /^(\d{1,7})(?:\.(\d{1,2}))?$/ : /^(\d{1,7})(?:\.(\d{1,6}))?$/).exec(value.trim()) : null;
  if (!match) {
    throw new EngineError('INVALID_AMOUNT', decimals === 2
      ? `${field} must be an amount in US dollars with at most two decimals, like 20 or 12.50.`
      : `${field} must be an amount in US dollars with at most six decimals, like 3, 0.25 or 0.000075.`);
  }
  return `${match[1]}${(match[2] ?? '').padEnd(6, '0')}`.replace(/^0+(?=\d)/, '');
}
/** Whole micro-dollars as the dollars the owner types back ('20.00', '0.000075'), as the engine's microsAsUsd. */
function asUsd(micros: string | null): string | null {
  if (micros === null) return null;
  const padded = micros.padStart(7, '0');
  return `${padded.slice(0, -6).replace(/^0+(?=\d)/, '')}.${padded.slice(-6).replace(/0+$/, '').padEnd(2, '0')}`;
}
/** The owner's rupee rate in the sample, as the engine keeps it: ten-thousandths of a rupee per dollar, and its day. */
interface SampleRupeeRate { perUsd: bigint; setOn: string }
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** 4J20: the sample month's AI spend per business with its sum receipt, as fake-team.ts sends it, for the meter. */
const MONTH_SPEND: Readonly<Record<string, { micros: number; receiptId: string }>> = { lumen: { micros: 719800, receiptId: 'R-0431' }, ledgerline: { micros: 401200, receiptId: 'R-0412' } };
/** Rupees per US dollar as typed, up to four places, as the engine's rupeeRateOf. Above zero. */
function rupeeRate(value: unknown): bigint {
  const match = typeof value === 'string' ? /^(\d{1,4})(?:\.(\d{1,4}))?$/.exec(value.trim()) : null;
  const perUsd = match ? BigInt(match[1] ?? '0') * 10_000n + BigInt((match[2] ?? '').padEnd(4, '0')) : 0n;
  if (perUsd <= 0n) throw new EngineError('INVALID_AMOUNT', 'Rupees per US dollar must be a number with at most four decimals, like 83.50.');
  return perUsd;
}
/** The rate as typed back ('83.50') and in words ('₹83.50 per $1 (your rate, set 21 Oct 2026)'), as the engine writes them. */
function rateTyped(rate: SampleRupeeRate): string {
  return `${rate.perUsd / 10_000n}.${String(rate.perUsd % 10_000n).padStart(4, '0').replace(/0+$/, '').padEnd(2, '0')}`;
}
function rateWords(rate: SampleRupeeRate): string {
  const [year, month, day] = rate.setOn.split('-');
  const decimals = rateTyped(rate).split('.')[1] ?? '00';
  return `₹${(rate.perUsd / 10_000n).toLocaleString('en-IN')}.${decimals} per $1 (your rate, set ${day} ${MONTH_NAMES[Number(month) - 1]} ${year})`;
}
/** Micro-dollars in rupees beside the dollars, as the engine's rupeesBeside: to the nearest paisa, a half paisa up. */
function rupeesBeside(micros: string, rate: SampleRupeeRate): string {
  const paise = (BigInt(micros) * rate.perUsd + 50_000_000n) / 100_000_000n;
  return `₹${(paise / 100n).toLocaleString('en-IN')}.${String(paise % 100n).padStart(2, '0')} at ${rateWords(rate)}`;
}
const DAY = 86_400_000;
const UNSUBSCRIBE = 'If you would rather not hear from us, reply "unsubscribe" and we will not write again.';
/** Domains the sample treats as having a mail server. The real engine asks DNS for MX records. */
const MAIL_DOMAINS = new Set(['pocketaudio.in', 'boataudio.in', 'mehtatraders.in', 'gmail.com', 'example.in']);
/** The engine's lead stage ranks: open stages move up only; won and lost close a lead; blocked comes from anywhere. */
const STAGE_RANK: Partial<Record<LeadView['status'], number>> = { new: 0, drafted: 1, contacted: 2, replied: 3, won: 4, lost: 4 };

interface HeldShare extends ShareLink { businessId: string; deliveryId: string }

export class FakeExtrasDesk {
  private readonly host: ExtrasHost;
  private policies: Record<string, SpendPolicyView>;
  private rupees: Record<string, SampleRupeeRate | null> = {};
  /** 4Z3: the owner's choice of which currency leads spend, per business; absent: Auto. */
  private leadChoice: Record<string, CurrencyLead> = {};
  private ca: Record<string, CaView>;
  private caReceipts: Record<string, Record<string, CaReceiptView>>;
  private leads: Record<string, LeadView[]>;
  private postal: Record<string, string | null>;
  private blocked: Record<string, string[]> = {};
  private bankLines: Record<string, Set<string>> = {};
  private consents: Record<string, BankConsentView> = {};
  private site: Record<string, Record<string, string>>;
  private edits: Record<string, SiteEditLite[]> = {};
  private shares: HeldShare[] = [];
  private seq = 0;

  constructor(host: ExtrasHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.policies = options.fresh ? {} : clone(SPEND_POLICIES);
    // 4Z3: the sample's own rupee rate, as its policies say it (set 15 Oct 2026), so every spend view agrees with them.
    if (!options.fresh) for (const [biz, policy] of Object.entries(this.policies)) if (policy.inrPerUsd) this.rupees[biz] = { perUsd: rupeeRate(policy.inrPerUsd), setOn: '2026-10-15' };
    this.ca = options.fresh ? {} : clone(CA_VIEWS);
    this.caReceipts = options.fresh ? {} : clone(CA_RECEIPTS);
    this.leads = options.fresh ? {} : clone(LEADS);
    this.postal = options.fresh ? {} : clone(POSTAL_ADDRESSES);
    this.site = options.fresh ? {} : clone(SITE_FILES);
  }

  handles(method: string): boolean {
    return EXTRA_METHODS.has(method);
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.money.overview': return this.overview(biz);
      case 'venture.tax.working': return this.taxWorking(biz);
      case 'venture.spend.policy.get': return this.withLead(biz, this.withMeter(biz, clone(this.policyOf(biz))));
      case 'venture.spend.policy.set': return this.withLead(biz, this.withMeter(biz, this.setPolicy(biz, p)));
      case 'venture.ca.get': return clone(this.caOf(biz));
      case 'venture.ca.setOfRecord': return this.setCa(biz, p);
      case 'venture.ca.recordSignoff': return this.signoff(biz, p);
      case 'venture.ca.confirmRates': return this.confirmRates(biz, p);
      case 'venture.ca.receipt': return this.caReceipt(biz, p);
      case 'venture.ca.explainDiff': return this.explainDiff(biz, p);
      case 'venture.leads.list': return { leads: clone(this.leads[biz] ?? []) };
      case 'venture.leads.add': return this.addLead(biz, p);
      case 'venture.leads.draft': return this.draft(biz, p);
      case 'venture.leads.recordSend': return this.recordSend(biz, p);
      case 'venture.leads.block': return this.block(biz, p);
      case 'venture.bank.import': return this.importStatement(biz, p);
      case 'venture.bank.consent': return this.consent(biz, p);
      case 'venture.site.stage': return this.stage(biz, p);
      case 'venture.site.apply': return this.applyEdit(biz, p, 'apply');
      case 'venture.site.revert': return this.applyEdit(biz, p, 'revert');
      case 'venture.share.create': return this.share(biz, p);
      case 'venture.share.list': {
        // As the engine lists them (build/share-links.ts shareView): the address shows once, when made; never again.
        const links = this.shares.filter((s) => s.businessId === biz && (typeof p.deliveryId !== 'string' || s.deliveryId === p.deliveryId)).map((s) => this.listed(s));
        return { links, shares: structuredClone(links) };
      }
      case 'venture.share.revoke': return this.revoke(biz, p);
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  /** Today's sign-off row was sent to the CA: the request shows on the CA page, waiting for the sign-off. */
  sentToCa(requestId: string): void {
    const biz = this.host.current();
    const known = CA_REQUEST_TITLES[requestId];
    const view = this.ca[biz];
    if (!known || !view || view.requests.some((r) => r.id === requestId)) return;
    view.requests.unshift({ id: requestId, deliveryId: known.deliveryId, title: known.title, state: 'sent', at: this.host.now() });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Money at a glance, the tax working, spend settings
  // ---------------------------------------------------------------------------------------------------------------

  private overview(biz: string): MoneyOverview {
    const owed = this.host.owed();
    // The AI spend line's rupees at the owner's rate now (none without one), and 4Z3: the line as the owner's currency
    // leads it (money/overview.ts), as the engine works both out from the spend settings.
    const rate = this.rupees[biz] ?? null;
    const lines = clone(OVERVIEW[biz] ?? []).map((line) => {
      const month = MONTH_SPEND[biz];
      if (line.id !== 'spent' || !month) return line;
      const { rupees: _sample, ...rest } = line;
      return {
        ...rest, ...(rate ? { rupees: rupeesBeside(String(month.micros), rate) } : {}),
        lead: spendLead(month.micros, rate?.perUsd ?? null, rupeesLead(this.leadChoice[biz] ?? 'auto'), line.estimate ? ', includes estimates' : ''),
      };
    });
    return { lines: [{ id: 'owed', label: 'Clients owe you', value: owed.value, ...(owed.receiptId ? { receiptId: owed.receiptId } : {}) }, ...lines] };
  }

  /** 4Z3: the owner's choice of which currency leads spend, and what leads now: dollars without a rate. */
  private withLead(biz: string, policy: SpendPolicyView): SpendPolicyView {
    const currencyLead = this.leadChoice[biz] ?? 'auto';
    const leads = Boolean(policy.inrPerUsd) && rupeesLead(currencyLead);
    const perUsd = this.rupees[biz]?.perUsd ?? null;
    // The limit lines as the owner's currency leads them (money/spend.ts policyView), absent with no limit.
    const { capLead: _cap, askFirstLead: _ask, ...rest } = policy;
    return {
      ...rest, currencyLead, leads: leads ? 'INR' : 'USD',
      ...(policy.capMicros !== null ? { capLead: spendLead(policy.capMicros, perUsd, leads, ' a month') } : {}),
      ...(policy.askFirstMicros !== null ? { askFirstLead: spendLead(policy.askFirstMicros, perUsd, leads, '', 'Asks you first above ') } : {}),
    };
  }

  private taxWorking(biz: string) {
    const working = TAX_WORKINGS[biz];
    if (!working) throw new EngineError('BLUEPRINT_NOT_FOUND', 'Make your plan first. The tax working follows its tax settings.');
    return clone(working);
  }

  /**
   * 4J20: the month's meter against the monthly limit, as money/spend.ts spendMeter words it, over the sample month's
   * spend (the same total and sum receipt fake-team.ts sends for Team's spend), and the limit-reached choices once it
   * is used up (raise it or wait; never credits). No limit, no meter.
   */
  private withMeter(biz: string, policy: SpendPolicyView): SpendPolicyView {
    const month = MONTH_SPEND[biz];
    if (policy.capMicros === null || !month) return { ...policy, meter: null };
    const cap = Number(policy.capMicros);
    const permille = cap > 0 ? Math.floor((month.micros * 1000) / cap) : 1000;
    const over = month.micros >= cap;
    const now = this.host.now();
    const next = new Date(Date.UTC(Number(now.slice(0, 4)), Number(now.slice(5, 7)), 1));
    const resetOn = next.toISOString().slice(0, 10);
    const day = `${next.getUTCDate()} ${next.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' })}`;
    const percent = Math.floor(permille / 10);
    return {
      ...policy,
      meter: { usedPermille: permille, line: over ? "This month's limit is used up" : `${percent}% of this month's limit used`, near: permille >= (policy.alertPermille ?? 800), over, receiptId: month.receiptId, resetOn, reset: `Starts again on ${day}` },
      ...(over ? { limitReached: { scope: 'business' as const, line: "This month's AI limit is used up. Nothing more is spent until you raise it or the month ends.", options: [{ id: 'raise' as const, label: 'Raise the limit' }, { id: 'wait' as const, label: `Wait until ${day}` }] } } : {}),
    };
  }

  private policyOf(biz: string): SpendPolicyView {
    this.policies[biz] ??= {
      capMicros: null, askFirstMicros: null, capUsd: null, askFirstUsd: null, cap: 'No monthly limit', askFirst: 'Never asks first', rates: [], setAt: null, inrPerUsd: null, rupeeRate: null,
    };
    return this.policies[biz];
  }

  private setPolicy(biz: string, p: Record<string, unknown>): SpendPolicyView {
    const extra = Object.keys(p).find((key) => !['capUsd', 'askFirstUsd', 'rates', 'inrPerUsd', 'currencyLead'].includes(key));
    if (extra) throw invalid(`${extra} is not a spend setting.`);
    const figure = (value: unknown, field: string): string | null => dollars(value, field, 6);
    const policy = clone(this.policyOf(biz));
    if (p.capUsd !== undefined) {
      policy.capMicros = dollars(p.capUsd, 'The monthly limit', 2);
      policy.capUsd = asUsd(policy.capMicros);
      policy.cap = policy.capMicros === null ? 'No monthly limit' : `${usd(policy.capMicros)} a month`;
    }
    if (p.askFirstUsd !== undefined) {
      policy.askFirstMicros = dollars(p.askFirstUsd, 'The ask-first figure', 2);
      policy.askFirstUsd = asUsd(policy.askFirstMicros);
      policy.askFirst = policy.askFirstMicros === null ? 'Never asks first' : `Asks you first above ${usd(policy.askFirstMicros)}`;
    }
    if (p.rates !== undefined) {
      if (!Array.isArray(p.rates) || p.rates.length > 50) throw invalid('A rate card holds up to 50 lines.');
      policy.rates = (p.rates as SpendRateInput[]).map((line) => {
        if (!line || !/^(model|delegate|connector):[a-z0-9._-]{1,80}$/.test(String(line.item))) throw invalid('A rate card line names a model, a heavy-work tool or a connector.');
        if (!['per-million-tokens', 'per-call', 'per-run-cap'].includes(line.unit)) throw invalid('A rate is per million tokens, per call, or a run cap.');
        const input = line.inputUsdPerMillion == null ? null : figure(line.inputUsdPerMillion, 'A rate');
        const output = line.outputUsdPerMillion == null ? null : figure(line.outputUsdPerMillion, 'A rate');
        const perCall = line.usdPerCall == null ? null : figure(line.usdPerCall, 'A rate');
        if (line.unit === 'per-million-tokens' ? input === null || output === null : perCall === null) throw invalid('A rate per million tokens needs both its input and output figures; a rate per call or a run cap needs its figure.');
        if (!text(line.source)) throw invalid('Say where the rate comes from.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(line.checkedOn))) throw invalid('The date checked must be a date like 2026-10-21.');
        const price = line.unit === 'per-million-tokens' ? `${usd(input!)} in and ${usd(output!)} out, per million tokens` : line.unit === 'per-call' ? `${usd(perCall!)} per call` : `Up to ${usd(perCall!)} a run`;
        return {
          item: line.item, unit: line.unit, inputMicrosPerMillion: input, outputMicrosPerMillion: output, microsPerCall: perCall,
          inputUsdPerMillion: asUsd(input), outputUsdPerMillion: asUsd(output), usdPerCall: asUsd(perCall),
          source: text(line.source), checkedOn: line.checkedOn, confirmed: true, by: 'owner' as const, price,
        };
      });
      if (new Set(policy.rates.map((r) => r.item)).size !== policy.rates.length) throw invalid('Each item has one line on the rate card.');
    }
    // The owner's rupee rate: dated the day it is set; the same rate again keeps its day. The limits show in rupees too.
    const held = this.rupees[biz] ?? null;
    const perUsd = p.inrPerUsd === undefined ? undefined : p.inrPerUsd === null ? null : rupeeRate(p.inrPerUsd);
    const rate = perUsd === undefined ? held : perUsd === null ? null : { perUsd, setOn: held && held.perUsd === perUsd ? held.setOn : this.host.now().slice(0, 10) };
    policy.inrPerUsd = rate ? rateTyped(rate) : null;
    policy.rupeeRate = rate ? rateWords(rate) : null;
    delete policy.capRupees;
    delete policy.askFirstRupees;
    if (rate && policy.capMicros !== null) policy.capRupees = rupeesBeside(policy.capMicros, rate);
    if (rate && policy.askFirstMicros !== null) policy.askFirstRupees = rupeesBeside(policy.askFirstMicros, rate);
    // 4Z3: which currency leads; left out, the choice already set is kept.
    if (p.currencyLead !== undefined) this.leadChoice[biz] = currencyLeadOf(p.currencyLead);
    policy.setAt = this.host.now();
    this.rupees[biz] = rate;
    this.policies[biz] = policy;
    return clone(policy);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The CA firm
  // ---------------------------------------------------------------------------------------------------------------

  private caOf(biz: string): CaView {
    if (this.host.playbook(biz)?.id !== 'ca-firm') return { ca: null, pendingRates: [], requests: [] };
    this.ca[biz] ??= { ca: null, pendingRates: [], requests: [] };
    return this.ca[biz];
  }

  private membership(value: unknown): string {
    const typed = text(value);
    if (!/^\d{6}$/.test(typed)) throw new EngineError('INVALID_MEMBERSHIP_NUMBER', 'An ICAI membership number is six digits.');
    return typed;
  }

  private mustBeCaFirm(biz: string): CaView {
    if (this.host.playbook(biz)?.id !== 'ca-firm') throw new EngineError('PLAYBOOK_MISMATCH', 'Only a CA firm has a CA of record.');
    return this.caOf(biz);
  }

  private setCa(biz: string, p: Record<string, unknown>) {
    const view = this.mustBeCaFirm(biz);
    const name = text(p.name);
    if (name.length < 2 || name.length > 120) throw invalid("Your CA's name must be between 2 and 120 characters.");
    view.ca = { name, membershipNo: this.membership(p.membershipNo) };
    return clone(view);
  }

  private ofRecord(view: CaView, membershipNo: unknown): string {
    if (!view.ca) throw new EngineError('CA_NOT_SET', 'Name your CA of record first.');
    const typed = this.membership(membershipNo);
    if (typed !== view.ca.membershipNo) throw new EngineError('CA_MISMATCH', `That is not ${view.ca.name}'s membership number. Only your CA of record signs.`);
    return typed;
  }

  private signoff(biz: string, p: Record<string, unknown>) {
    const view = this.mustBeCaFirm(biz);
    const request = view.requests.find((r) => r.id === p.requestId);
    if (!request) throw new EngineError('SIGNOFF_NOT_FOUND', 'This sign-off request is not in this business.');
    if (request.state !== 'sent') throw new EngineError('SIGNOFF_DONE', 'Your CA has already answered this one.');
    this.ofRecord(view, p.membershipNo);
    const note = text(p.note);
    if (note.length > 500) throw invalid('A note is up to 500 characters.');
    request.state = 'signed';
    request.at = this.host.now();
    this.host.emit({ type: 'queue.changed', businessId: biz, at: request.at });
    return { request: clone(request) };
  }

  /** A stored CA receipt as the engine works it again (Ink v2 2A2): only this business's, else not found. */
  private caReceipt(biz: string, p: Record<string, unknown>) {
    return clone(this.storedReceipt(biz, p.id));
  }

  private storedReceipt(biz: string, id: unknown): CaReceiptView {
    const found = this.host.playbook(biz)?.id === 'ca-firm' ? this.caReceipts[biz]?.[text(id)] : undefined;
    if (!found) throw new EngineError('CA_RECEIPT_NOT_FOUND', "That receipt is not one of your CA firm's calculator receipts.");
    return found;
  }

  /**
   * The CA of record explains one portal difference (Ink v2 2A2), with the engine's rules: their own number, a key that
   * differs on that comparison, and one explanation per difference.
   */
  private explainDiff(biz: string, p: Record<string, unknown>) {
    const view = this.mustBeCaFirm(biz);
    const receipt = this.storedReceipt(biz, p.receiptId);
    if (receipt.engine !== 'portal-diff') throw new EngineError('CA_RECEIPT_NOT_FOUND', "That is not a comparison of the portal's figures with the receipts.");
    if (!view.ca) throw new EngineError('CA_OF_RECORD_REQUIRED', 'Name your CA of record, with their ICAI membership number, first.');
    const typed = text(p.membershipNo).replace(/\s+/g, '');
    if (typed !== view.ca.membershipNo) throw new EngineError('CA_NOT_OF_RECORD', `That is not the ICAI membership number of ${view.ca.name}, your CA of record. Only they explain a difference.`);
    const row = (receipt.portalDifferences ?? []).find((item) => item.key === p.key);
    if (!row) throw new EngineError('CA_DIFF_KEY_UNKNOWN', `${text(p.key)} is not a difference on that comparison.`);
    const note = text(p.note);
    if (note.length < 3 || note.length > 400) throw invalid('An explanation is 3 to 400 characters, on one line.');
    if (row.explanation) throw new EngineError('CA_DIFF_EXPLAINED', `${view.ca.name} explained ${row.key} already: "${row.explanation}" An explanation is not changed once it is recorded.`);
    row.explanation = note;
    const explanation = { receiptId: receipt.id, key: row.key, note, caName: view.ca.name, membershipNo: view.ca.membershipNo, at: this.host.now() };
    receipt.explanations.push(explanation);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: explanation.at });
    return { explanation: clone(explanation) };
  }

  private confirmRates(biz: string, p: Record<string, unknown>) {
    const view = this.mustBeCaFirm(biz);
    const ids = Array.isArray(p.tableIds) ? p.tableIds.filter((id): id is string => typeof id === 'string') : [];
    if (ids.length === 0) throw invalid('Choose at least one rate table.');
    const unknown = ids.find((id) => !view.pendingRates.some((r) => r.tableId === id));
    if (unknown) throw new EngineError('RATE_TABLE_NOT_FOUND', 'That rate table is not waiting for your CA.');
    this.ofRecord(view, p.membershipNo);
    view.pendingRates = view.pendingRates.filter((r) => !ids.includes(r.tableId));
    return clone(view);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Leads: the owner adds them with their source, agents draft, the owner sends from his own mailbox
  // ---------------------------------------------------------------------------------------------------------------

  private lead(biz: string, id: unknown): LeadView {
    const lead = (this.leads[biz] ?? []).find((l) => l.id === id);
    if (!lead) throw new EngineError('LEADS_NOT_FOUND', 'That lead is not in this business.');
    return lead;
  }

  private isBlocked(biz: string, email: string | null): boolean {
    if (!email) return false;
    const list = this.blocked[biz] ?? [];
    const domain = email.split('@')[1] ?? '';
    return list.includes(email) || list.includes(domain);
  }

  /**
   * The engine's stage rule: forward only, won and lost stay, blocked (an opt-out) from any stage and never left.
   * A move that is not forward leaves the stage as it is and records nothing; a move keeps its evidence. `at` is the
   * time of the act that moved it, as the engine stamps both in one transaction.
   */
  private advance(lead: LeadView, to: LeadView['status'], evidence: LeadMoveView['evidence'], at: string = this.host.now()): void {
    const from = lead.status;
    if (from === 'blocked' || (to !== 'blocked' && (from === 'won' || from === 'lost' || STAGE_RANK[to]! <= STAGE_RANK[from]!))) return;
    lead.moves.push({ from, to, at, by: 'owner', evidence });
    lead.status = to;
  }

  private addLead(biz: string, p: Record<string, unknown>): LeadView {
    const name = text(p.name);
    if (name.length < 2 || name.length > 120) throw invalid('A name must be between 2 and 120 characters.');
    const sourceUrl = text(p.sourceUrl);
    let url: URL | null = null;
    try { url = new URL(sourceUrl); } catch { url = null; }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new EngineError('LEADS_SOURCE_REQUIRED', 'A lead needs the web page you found them on, like https://example.in/team.');
    const email = text(p.email).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Use an email address like name@example.com.');
    if (this.isBlocked(biz, email)) throw new EngineError('LEADS_BLOCKED', 'This address is on your blocklist, so Chausar will not add it.');
    const domain = email ? email.split('@')[1]! : null;
    const at = this.host.now();
    const checked = domain !== null && MAIL_DOMAINS.has(domain);
    const lead: LeadView = {
      id: `lead-new-${++this.seq}`, name, company: text(p.company) || null, email, emailDomain: domain, sourceUrl,
      emailCheck: !email ? { status: 'unverified', at: null, line: 'No email yet.' }
        : checked ? { status: 'verified', at, line: `A mail server answers for ${domain}.` }
          : { status: 'failed', at, line: `No mail server answers for ${domain}, so Chausar will not draft to it.` },
      status: 'new', drafts: [], sends: [], moves: [], addedBy: 'owner', addedAt: at,
    };
    (this.leads[biz] ??= []).unshift(lead);
    return clone(lead);
  }

  private draft(biz: string, p: Record<string, unknown>) {
    const lead = this.lead(biz, p.leadId);
    // The engine's order and codes: blocklist, a verified email, the postal address, then the text. A refusal keeps nothing.
    if (lead.status === 'blocked' || this.isBlocked(biz, lead.email)) throw new EngineError('LEADS_BLOCKED', 'This lead is on your blocklist. Chausar does not draft to it.');
    if (!lead.email) throw new EngineError('LEADS_EMAIL_UNVERIFIED', 'Add an email address for this lead first.');
    if (lead.emailCheck.status !== 'verified') throw new EngineError('LEADS_EMAIL_UNVERIFIED', `Chausar drafts only to an address whose mail server answers. ${lead.emailCheck.line}`);
    const postalAddress = text(p.postalAddress) || this.postal[biz] || null;
    if (!postalAddress) throw new EngineError('LEADS_ADDRESS_MISSING', 'Add your postal address. Every outreach email carries it.');
    const subject = text(p.subject);
    const body = text(p.body);
    if (subject.length < 2 || subject.length > 150) throw invalid('A subject must be between 2 and 150 characters.');
    if (body.length < 10 || body.length > 5000) throw invalid('The message must be between 10 and 5000 characters.');
    this.postal[biz] = postalAddress;
    const at = this.host.now();
    const draft: OutreachDraftView = {
      id: `draft-lead-${++this.seq}`, leadId: lead.id, to: lead.email, subject, text: body,
      footer: { businessName: this.host.businessName(biz), postalAddress, unsubscribe: UNSUBSCRIBE }, sourceUrl: lead.sourceUrl, by: 'owner', at,
      digest: `d${this.seq.toString(16).padStart(7, '0')}`,
    };
    lead.drafts.unshift(draft);
    this.advance(lead, 'drafted', { kind: 'draft', id: draft.id }, at);
    return { lead: clone(lead), draft: clone(draft) };
  }

  private recordSend(biz: string, p: Record<string, unknown>): LeadView {
    const lead = this.lead(biz, p.leadId);
    if (lead.status === 'blocked') throw new EngineError('LEADS_BLOCKED', 'This person asked not to be contacted.');
    const draft = lead.drafts.find((d) => d.id === p.draftId);
    if (!draft) throw invalid('Choose one of the drafts for this lead.');
    if (typeof p.sentAt !== 'string' || Number.isNaN(Date.parse(p.sentAt))) throw invalid('Say when you sent it.');
    lead.sends.unshift({ draftId: draft.id, sentAt: new Date(p.sentAt).toISOString(), recordedBy: 'owner', recordedAt: this.host.now(), channel: 'own-mailbox' });
    // Stages move forward only: a lead that replied, won or lost keeps its stage.
    this.advance(lead, 'contacted', { kind: 'send', id: draft.id });
    return clone(lead);
  }

  private block(biz: string, p: Record<string, unknown>) {
    const value = text(p.value).toLowerCase().replace(/^@/, '');
    if (!/^([^\s@]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) throw invalid('Block an email address or a domain, like name@example.in or example.in.');
    const list = (this.blocked[biz] ??= []);
    if (!list.includes(value)) list.push(value);
    for (const lead of this.leads[biz] ?? []) if (this.isBlocked(biz, lead.email)) this.advance(lead, 'blocked', { kind: 'opt-out', id: value });
    return { blocked: [...list] };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Bank statements
  // ---------------------------------------------------------------------------------------------------------------

  private importStatement(biz: string, p: Record<string, unknown>): BankImportResult {
    const account = text(p.account);
    if (account.length < 2 || account.length > 60) throw invalid("Name the account, like 'HDFC current'.");
    const csv = typeof p.csv === 'string' ? p.csv.replace(/\r\n/g, '\n') : '';
    if (!csv.trim()) throw new EngineError('STATEMENT_EMPTY', 'This file has no lines.');
    if (csv.length > 2_000_000) throw new EngineError('UPLOAD_LIMIT', 'Import a statement smaller than two megabytes.');
    const [header = '', ...lines] = csv.split('\n');
    if (!/date/i.test(header) || !/amount|debit|credit/i.test(header)) throw new EngineError('STATEMENT_UNREADABLE', 'Chausar could not find the date and amount columns. Download the statement as CSV from your bank and try again.');
    const seen = (this.bankLines[`${biz}:${account}`] ??= new Set());
    let added = 0;
    let duplicates = 0;
    const rejected: { line: number; reason: string }[] = [];
    lines.forEach((raw, index) => {
      const line = raw.trim();
      if (!line) return;
      const [date = '', amount = ''] = line.split(',');
      if (!/^\d{4}-\d{2}-\d{2}$|^\d{2}[/-]\d{2}[/-]\d{4}$/.test(date.trim())) { rejected.push({ line: index + 2, reason: 'The date is not one Chausar reads.' }); return; }
      if (!/^-?\d+(\.\d{1,2})?$/.test(amount.trim())) { rejected.push({ line: index + 2, reason: 'The amount is not a number.' }); return; }
      if (seen.has(line)) { duplicates += 1; return; }
      seen.add(line);
      added += 1;
    });
    const words = [
      `Added ${added} ${added === 1 ? 'transaction' : 'transactions'} to ${account}.`,
      duplicates ? `${duplicates} ${duplicates === 1 ? 'was' : 'were'} already here, so ${duplicates === 1 ? 'it was' : 'they were'} skipped.` : '',
      rejected.length ? `${rejected.length} ${rejected.length === 1 ? 'line was' : 'lines were'} not read.` : '',
    ].filter(Boolean).join(' ');
    return { account, accountId: `bank-${biz}-${account.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`, added, duplicates, rejected, line: words, transactions: seen.size };
  }

  private consent(biz: string, p: Record<string, unknown>): BankConsentView {
    const account = text(p.account);
    if (account.length < 2) throw invalid('Name the account first.');
    const key = `${biz}:${account}`;
    const now = this.host.now();
    if (p.revoke === true) {
      const held = this.consents[key];
      if (!held) throw new EngineError('CONSENT_NOT_FOUND', 'There is no consent for this account.');
      held.consent.revokedAt = now;
      // The engine's words (build/bank.ts consentStatus).
      held.status = { state: 'revoked', daysLeft: 0, line: `You stopped bank access on ${dayMonthYear(now)}.` };
      return clone(held);
    }
    const days = p.days === undefined ? 90 : p.days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) throw invalid('Consent lasts one to 365 days.');
    const expiresAt = new Date(Date.parse(now) + days * DAY).toISOString();
    const left = days === 1 ? 'in 1 day' : `in ${days} days`;
    const status: BankConsentView['status'] = days <= 7
      ? { state: 'expiring', daysLeft: days, line: `Bank access ends on ${dayMonthYear(expiresAt)}, ${left}. Renew it before then.` }
      : { state: 'active', daysLeft: days, line: `Bank access ends on ${dayMonthYear(expiresAt)}, ${left}.` };
    const view: BankConsentView = {
      account, accountId: `bank-${biz}-${account.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      consent: { id: `consent-${++this.seq}`, provider: null, accountLabel: account, scope: 'read-only', grantedAt: now, expiresAt, revokedAt: null },
      status, provider: NO_PROVIDER_LINE,
    };
    this.consents[key] = view;
    return clone(view);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Website edits: staged, applied only with the reviewed hash, verified, reversible
  // ---------------------------------------------------------------------------------------------------------------

  private stage(biz: string, p: Record<string, unknown>): SiteEditLite {
    const path = text(p.path).replace(/^\/+/, '');
    if (!/^[A-Za-z0-9._/-]{1,200}$/.test(path) || path.includes('..')) throw invalid('Name a file in your site, like index.html.');
    const after = typeof p.after === 'string' ? p.after : '';
    if (after.length > 200_000) throw invalid('A staged edit is up to 200,000 characters.');
    const summary = text(p.summary);
    if (summary.length < 3 || summary.length > 200) throw invalid('Say in a few words what the edit does.');
    const files = (this.site[biz] ??= {});
    const before = files[path] ?? '';
    if (before === after) throw new EngineError('SITE_NO_CHANGE', 'The new text is the same as the file now.');
    const at = this.host.now();
    const n = ++this.seq;
    const edit: SiteEditLite = {
      id: `edit-${biz}-${n}`, at, target: { kind: 'local-folder', identity: `${biz}-site` }, path, summary, before, after,
      beforeDigest: `b${n.toString(16).padStart(7, '0')}`, afterDigest: `a${n.toString(16).padStart(7, '0')}`, planDigest: `p${n.toString(16).padStart(7, '0')}`,
      state: 'staged', log: [{ at, by: 'owner', step: 'staged', line: `Staged ${path}: ${summary}` }],
    };
    (this.edits[biz] ??= []).unshift(edit);
    return clone(edit);
  }

  private applyEdit(biz: string, p: Record<string, unknown>, how: 'apply' | 'revert'): SiteEditLite {
    const edit = (this.edits[biz] ?? []).find((e) => e.id === p.editId);
    if (!edit) throw new EngineError('SITE_EDIT_NOT_FOUND', 'That edit is not in this business.');
    if (p.reviewedHash !== edit.planDigest) throw new EngineError('APPROVAL_STALE', 'This edit changed after you reviewed it. Review it again.');
    const files = (this.site[biz] ??= {});
    const at = this.host.now();
    if (how === 'apply') {
      if (edit.state !== 'staged') throw new EngineError('SITE_EDIT_NOT_STAGED', 'Only a staged edit can be applied.');
      if ((files[edit.path] ?? '') !== edit.before) throw new EngineError('SITE_CHANGED', 'The file changed since this edit was staged. Stage it again.');
      files[edit.path] = edit.after;
      edit.state = 'applied';
      edit.log.push({ at, by: 'owner', step: 'applied', line: `Wrote ${edit.path}.` }, { at, by: 'engine', step: 'verified', line: `Read ${edit.path} back: it matches what you reviewed.` });
    } else {
      if (edit.state !== 'applied') throw new EngineError('SITE_EDIT_NOT_APPLIED', 'Only an applied edit can be put back.');
      if ((files[edit.path] ?? '') !== edit.after) throw new EngineError('SITE_CHANGED', 'The file changed after this edit. Chausar will not overwrite that.');
      if (edit.before) files[edit.path] = edit.before;
      else delete files[edit.path];
      edit.state = 'rolled-back';
      edit.log.push({ at, by: 'owner', step: 'rolled-back', line: `Put ${edit.path} back as it was.` });
    }
    return clone(edit);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Preview links for a client
  // ---------------------------------------------------------------------------------------------------------------

  private link(held: HeldShare): ShareLink {
    return { id: held.id, url: held.url, ...(held.reason ? { reason: held.reason } : {}), expiresAt: held.expiresAt, ...(held.shareKind ? { shareKind: held.shareKind } : {}) };
  }

  /** A link as venture.share.list sends it: no address, and why (shown once when made, or not served here). */
  private listed(held: HeldShare): ShareLink {
    const ended = Date.parse(held.expiresAt) <= Date.parse(this.host.now());
    const reason = held.url ? (ended ? 'This link has ended.' : 'The link was shown once, when it was made.') : held.reason;
    return { ...this.link(held), url: null, ...(reason ? { reason } : {}) };
  }

  private share(biz: string, p: Record<string, unknown>): ShareLink {
    // 4J20: a month of books for the owner's accountant (build/share-links.ts kind 'books'): read only, revocable.
    const books = p.kind === 'books';
    if (books && (typeof p.month !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(p.month) || p.deliveryId !== undefined)) throw invalid('Choose a month like 2026-10.');
    if (p.kind !== undefined && p.kind !== 'draft' && !books) throw invalid('Choose a draft, an order status, a statement or a month of books to share.');
    const deliveryId = books ? `books:${String(p.month)}` : text(p.deliveryId);
    if (!deliveryId) throw invalid('Choose the draft to share.');
    const hours = p.expiresInHours === undefined ? 168 : p.expiresInHours;
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 720) throw invalid('A link lasts 1 to 720 hours.');
    const id = `share-${++this.seq}`;
    const expiresAt = new Date(Date.parse(this.host.now()) + hours * 3_600_000).toISOString();
    const kind = books ? { shareKind: 'books' as const } : {};
    const held: HeldShare = this.host.hosted()
      ? { id, businessId: biz, deliveryId, url: `https://share.chausar.test/s/${id}`, expiresAt, ...kind }
      : { id, businessId: biz, deliveryId, url: null, reason: 'Share links open only on the hosted Chausar with a public address. Send your client the draft yourself and record their answer.', expiresAt, ...kind };
    // Kept with or without an address, as the engine keeps a link it does not serve: the owner records the answer on it.
    this.shares.unshift(held);
    return this.link(held);
  }

  private revoke(biz: string, p: Record<string, unknown>): ShareLink {
    const held = this.shares.find((s) => s.id === p.id && s.businessId === biz);
    if (!held) throw new EngineError('SHARE_NOT_FOUND', 'That link is not in this business.');
    this.shares = this.shares.filter((s) => s !== held);
    return this.link(held);
  }
}
