/**
 * The fake engine's answers for the last screens, kept per business: Money at a glance (venture.money.overview), the
 * tax working (venture.tax.working), spend settings (venture.spend.policy.*), the CA firm page (venture.ca.*), leads
 * (venture.leads.*), bank statement imports (venture.bank.*), staged website edits (venture.site.*) and preview links
 * (venture.share.*). It keeps the engine's rules the screens rely on: whole micro-dollars for spend settings, a lead
 * needs the page it was found on, a draft needs a checked email and a postal address and never goes to a blocked
 * address, a CA writes with their own membership number, a site edit applies only with the hash that was reviewed,
 * a statement import never counts a line twice, and a preview link needs a public address.
 */

import { CA_REQUEST_TITLES, CA_VIEWS, LEADS, OVERVIEW, POSTAL_ADDRESSES, SITE_FILES, SPEND_POLICIES, TAX_WORKINGS } from './fixtures-extras';
import {
  EngineError, type BankConsentView, type BankImportResult, type CaView, type LeadView, type MoneyOverview, type OutreachDraftView,
  type PlaybookPick, type ShareLink, type SiteEditLite, type SpendPolicyView, type SpendRateInput, type VentureRunEvent,
} from './types';

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
  'venture.ca.get', 'venture.ca.setOfRecord', 'venture.ca.recordSignoff', 'venture.ca.confirmRates',
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
const MICROS = /^\d{1,15}$/;
const DAY = 86_400_000;
const UNSUBSCRIBE = 'If you would rather not hear from us, reply "unsubscribe" and we will not write again.';
/** Domains the sample treats as having a mail server. The real engine asks DNS for MX records. */
const MAIL_DOMAINS = new Set(['pocketaudio.in', 'boataudio.in', 'mehtatraders.in', 'gmail.com', 'example.in']);

interface HeldShare extends ShareLink { businessId: string; deliveryId: string }

export class FakeExtrasDesk {
  private readonly host: ExtrasHost;
  private policies: Record<string, SpendPolicyView>;
  private ca: Record<string, CaView>;
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
    this.ca = options.fresh ? {} : clone(CA_VIEWS);
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
      case 'venture.spend.policy.get': return clone(this.policyOf(biz));
      case 'venture.spend.policy.set': return this.setPolicy(biz, p);
      case 'venture.ca.get': return clone(this.caOf(biz));
      case 'venture.ca.setOfRecord': return this.setCa(biz, p);
      case 'venture.ca.recordSignoff': return this.signoff(biz, p);
      case 'venture.ca.confirmRates': return this.confirmRates(biz, p);
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
        const links = this.shares.filter((s) => s.businessId === biz && (typeof p.deliveryId !== 'string' || s.deliveryId === p.deliveryId)).map((s) => this.link(s));
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
    return { lines: [{ id: 'owed', label: 'Clients owe you', value: owed.value, ...(owed.receiptId ? { receiptId: owed.receiptId } : {}) }, ...clone(OVERVIEW[biz] ?? [])] };
  }

  private taxWorking(biz: string) {
    const working = TAX_WORKINGS[biz];
    if (!working) throw new EngineError('BLUEPRINT_NOT_FOUND', 'Make your plan first. The tax working follows its tax settings.');
    return clone(working);
  }

  private policyOf(biz: string): SpendPolicyView {
    this.policies[biz] ??= { capMicros: null, askFirstMicros: null, cap: 'No monthly limit', askFirst: 'Never asks first', rates: [], setAt: null };
    return this.policies[biz];
  }

  private setPolicy(biz: string, p: Record<string, unknown>): SpendPolicyView {
    const extra = Object.keys(p).find((key) => !['cap', 'askFirst', 'rates'].includes(key));
    if (extra) throw invalid(`${extra} is not a spend setting.`);
    const figure = (value: unknown, field: string): string | null => {
      if (value === null) return null;
      if (typeof value !== 'string' || !MICROS.test(value)) throw new EngineError('INVALID_AMOUNT', `${field} must be whole micro-dollars, like 5000000 for five US dollars.`);
      return value.replace(/^0+(?=\d)/, '');
    };
    const policy = clone(this.policyOf(biz));
    if (p.cap !== undefined) {
      policy.capMicros = figure(p.cap, 'The monthly limit');
      policy.cap = policy.capMicros === null ? 'No monthly limit' : `${usd(policy.capMicros)} a month`;
    }
    if (p.askFirst !== undefined) {
      policy.askFirstMicros = figure(p.askFirst, 'The ask-first figure');
      policy.askFirst = policy.askFirstMicros === null ? 'Never asks first' : `Asks you first above ${usd(policy.askFirstMicros)}`;
    }
    if (p.rates !== undefined) {
      if (!Array.isArray(p.rates) || p.rates.length > 50) throw invalid('A rate card holds up to 50 lines.');
      policy.rates = (p.rates as SpendRateInput[]).map((line) => {
        if (!line || !/^(model|delegate|connector):[a-z0-9._-]{1,80}$/.test(String(line.item))) throw invalid('A rate card line names a model, a heavy-work tool or a connector.');
        if (!['per-million-tokens', 'per-call', 'per-run-cap'].includes(line.unit)) throw invalid('A rate is per million tokens, per call, or a run cap.');
        const input = line.inputMicrosPerMillion == null ? null : figure(line.inputMicrosPerMillion, 'A rate');
        const output = line.outputMicrosPerMillion == null ? null : figure(line.outputMicrosPerMillion, 'A rate');
        const perCall = line.microsPerCall == null ? null : figure(line.microsPerCall, 'A rate');
        if (line.unit === 'per-million-tokens' ? input === null || output === null : perCall === null) throw invalid('A rate per million tokens needs both its input and output figures; a rate per call or a run cap needs its figure.');
        if (!text(line.source)) throw invalid('Say where the rate comes from.');
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(line.checkedOn))) throw invalid('The date checked must be a date like 2026-10-21.');
        const price = line.unit === 'per-million-tokens' ? `${usd(input!)} in and ${usd(output!)} out, per million tokens` : line.unit === 'per-call' ? `${usd(perCall!)} per call` : `Up to ${usd(perCall!)} a run`;
        return { item: line.item, unit: line.unit, inputMicrosPerMillion: input, outputMicrosPerMillion: output, microsPerCall: perCall, source: text(line.source), checkedOn: line.checkedOn, confirmed: true, by: 'owner' as const, price };
      });
      if (new Set(policy.rates.map((r) => r.item)).size !== policy.rates.length) throw invalid('Each item has one line on the rate card.');
    }
    policy.setAt = this.host.now();
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
    if (!lead) throw new EngineError('LEAD_NOT_FOUND', 'That lead is not in this business.');
    return lead;
  }

  private isBlocked(biz: string, email: string | null): boolean {
    if (!email) return false;
    const list = this.blocked[biz] ?? [];
    const domain = email.split('@')[1] ?? '';
    return list.includes(email) || list.includes(domain);
  }

  private addLead(biz: string, p: Record<string, unknown>): LeadView {
    const name = text(p.name);
    if (name.length < 2 || name.length > 120) throw invalid('A name must be between 2 and 120 characters.');
    const sourceUrl = text(p.sourceUrl);
    let url: URL | null = null;
    try { url = new URL(sourceUrl); } catch { url = null; }
    if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) throw new EngineError('SOURCE_REQUIRED', 'A lead needs the web page you found them on, like https://example.in/team.');
    const email = text(p.email).toLowerCase() || null;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('Use an email address like name@example.com.');
    if (this.isBlocked(biz, email)) throw new EngineError('LEAD_BLOCKED', 'This address is on your blocklist, so Chausar will not add it.');
    const domain = email ? email.split('@')[1]! : null;
    const at = this.host.now();
    const checked = domain !== null && MAIL_DOMAINS.has(domain);
    const lead: LeadView = {
      id: `lead-new-${++this.seq}`, name, company: text(p.company) || null, email, emailDomain: domain, sourceUrl,
      emailCheck: !email ? { status: 'unverified', at: null, line: 'No email yet.' }
        : checked ? { status: 'verified', at, line: `A mail server answers for ${domain}.` }
          : { status: 'failed', at, line: `No mail server answers for ${domain}, so Chausar will not draft to it.` },
      status: 'new', drafts: [], sends: [], addedBy: 'owner', addedAt: at,
    };
    (this.leads[biz] ??= []).unshift(lead);
    return clone(lead);
  }

  private draft(biz: string, p: Record<string, unknown>) {
    const lead = this.lead(biz, p.leadId);
    if (lead.status === 'blocked' || this.isBlocked(biz, lead.email)) throw new EngineError('LEAD_BLOCKED', 'This lead is on your blocklist. Chausar does not draft to it.');
    if (!lead.email) throw new EngineError('EMAIL_REQUIRED', 'Add an email address for this lead first.');
    if (lead.emailCheck.status !== 'verified') throw new EngineError('EMAIL_NOT_VERIFIED', `Chausar drafts only to an address whose mail server answers. ${lead.emailCheck.line}`);
    const subject = text(p.subject);
    const body = text(p.body);
    if (subject.length < 2 || subject.length > 150) throw invalid('A subject must be between 2 and 150 characters.');
    if (body.length < 10 || body.length > 5000) throw invalid('The message must be between 10 and 5000 characters.');
    const typedAddress = text(p.postalAddress);
    if (typedAddress) this.postal[biz] = typedAddress;
    const postalAddress = this.postal[biz] ?? null;
    if (!postalAddress) throw new EngineError('POSTAL_ADDRESS_REQUIRED', 'Add your postal address. Every outreach email carries it.');
    const at = this.host.now();
    const draft: OutreachDraftView = {
      id: `draft-lead-${++this.seq}`, leadId: lead.id, to: lead.email, subject, text: body,
      footer: { businessName: this.host.businessName(biz), postalAddress, unsubscribe: UNSUBSCRIBE }, sourceUrl: lead.sourceUrl, by: 'owner', at,
      digest: `d${this.seq.toString(16).padStart(7, '0')}`,
    };
    lead.drafts.unshift(draft);
    if (lead.status === 'new') lead.status = 'drafted';
    return { lead: clone(lead), draft: clone(draft) };
  }

  private recordSend(biz: string, p: Record<string, unknown>): LeadView {
    const lead = this.lead(biz, p.leadId);
    const draft = lead.drafts.find((d) => d.id === p.draftId);
    if (!draft) throw new EngineError('DRAFT_NOT_FOUND', 'That draft is not on this lead.');
    if (typeof p.sentAt !== 'string' || Number.isNaN(Date.parse(p.sentAt))) throw invalid('Say when you sent it.');
    if (lead.sends.some((s) => s.draftId === draft.id)) throw new EngineError('ALREADY_RECORDED', 'You recorded this send already.');
    lead.sends.unshift({ draftId: draft.id, sentAt: new Date(p.sentAt).toISOString(), recordedBy: 'owner', recordedAt: this.host.now(), channel: 'own-mailbox' });
    lead.status = 'contacted';
    return clone(lead);
  }

  private block(biz: string, p: Record<string, unknown>) {
    const value = text(p.value).toLowerCase().replace(/^@/, '');
    if (!/^([^\s@]+@)?[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(value)) throw invalid('Block an email address or a domain, like name@example.in or example.in.');
    const list = (this.blocked[biz] ??= []);
    if (!list.includes(value)) list.push(value);
    for (const lead of this.leads[biz] ?? []) if (this.isBlocked(biz, lead.email)) lead.status = 'blocked';
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
      held.status = { state: 'revoked', daysLeft: 0, line: 'You withdrew this consent.' };
      return clone(held);
    }
    const days = p.days === undefined ? 90 : p.days;
    if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > 365) throw invalid('Consent lasts 1 to 365 days.');
    const expiresAt = new Date(Date.parse(now) + days * DAY).toISOString();
    const view: BankConsentView = {
      account, accountId: `bank-${biz}-${account.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      consent: { id: `consent-${++this.seq}`, provider: null, accountLabel: account, scope: 'read-only', grantedAt: now, expiresAt, revokedAt: null },
      status: { state: 'active', daysLeft: days, line: `Read only, until ${expiresAt.slice(0, 10)}.` },
      provider: 'No bank provider is connected yet, so nothing reads the bank. Statements come in as files you import.',
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
    return { id: held.id, url: held.url, ...(held.reason ? { reason: held.reason } : {}), expiresAt: held.expiresAt };
  }

  private share(biz: string, p: Record<string, unknown>): ShareLink {
    const deliveryId = text(p.deliveryId);
    if (!deliveryId) throw invalid('Choose the draft to share.');
    const hours = p.expiresInHours === undefined ? 168 : p.expiresInHours;
    if (typeof hours !== 'number' || !Number.isInteger(hours) || hours < 1 || hours > 720) throw invalid('A link lasts 1 to 720 hours.');
    const id = `share-${++this.seq}`;
    const expiresAt = new Date(Date.parse(this.host.now()) + hours * 3_600_000).toISOString();
    const held: HeldShare = this.host.hosted()
      ? { id, businessId: biz, deliveryId, url: `https://share.chausar.test/s/${id}`, expiresAt }
      : { id, businessId: biz, deliveryId, url: null, reason: 'This computer has no public address, so a client cannot open a link from it. Send them the file instead.', expiresAt };
    if (held.url) this.shares.unshift(held);
    return this.link(held);
  }

  private revoke(biz: string, p: Record<string, unknown>): ShareLink {
    const held = this.shares.find((s) => s.id === p.id && s.businessId === biz);
    if (!held) throw new EngineError('SHARE_NOT_FOUND', 'That link is not in this business.');
    this.shares = this.shares.filter((s) => s !== held);
    return this.link(held);
  }
}
