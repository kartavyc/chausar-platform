/**
 * The fake engine's answers for Connections and the business menu: Your AI (venture.models.* in a business,
 * venture.ai.* before one exists), plan and playbook (venture.blueprint.get and .update), prices (venture.price.quote)
 * and website build (venture.build.*). It keeps the engine's rules: a key is taken once and never handed back; a plan
 * edit makes a new draft version that waits on Today (a price change asks twice); every receipt is new and numbered;
 * the brief needs an accepted plan; a handoff needs a brief that passed its checks; a repo link keeps no token.
 * FakeEngine (fake.ts) owns the queue; this desk reaches it only through DeskHost.
 */

import { BLUEPRINTS, BUILDS, DRAFT_AI_STATUS, GITHUB_TOKEN_LINK, HANDOFF_NOTES, MODEL_PRESETS, MODEL_STATUS, OFFER_RECEIPTS, PLAYBOOKS, TEMPLATES_TIER, templateBrief } from './fixtures-business';
import {
  EngineError, type BackupLite, type BlueprintLite, type BlueprintViewLite, type BuilderId, type BuildStatusView, type BusinessOnComputer,
  type CustodyViewLite, type ModelStatusLite, type ModelTier, type OfferLite, type PlaybookPick, type PricingModel, type QueueRow, type ReceiptLite, type VentureRunEvent,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

export interface DeskHost {
  current(): string;
  businessName(id: string): string;
  now(): string;
  /** The next receipt number, shared with the queue's receipts. */
  receiptId(): string;
  rows(): QueueRow[];
  setRows(rows: QueueRow[]): void;
  digest(value: unknown): string;
  /** Takes a row off Today, as if decided. */
  settle(rowId: string): void;
  emit(event: VentureRunEvent): void;
  /** The business as the fake keeps it; the desk changes how it opens and whether its recovery code exists. */
  business(id: string): { opens: BusinessOnComputer['opens']; recovery: 'made' | 'not-made' } | null;
  /** Whether this computer's protected storage can keep a business key. */
  deviceKeys(): boolean;
}

const DESK_METHODS = new Set([
  'venture.models.presets', 'venture.models.status', 'venture.models.connect', 'venture.models.disconnect',
  'venture.ai.options', 'venture.ai.status', 'venture.ai.connect', 'venture.ai.disconnect',
  'venture.blueprint.get', 'venture.blueprint.update', 'venture.price.quote',
  'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status',
  'workspace.custody.get', 'workspace.custody.recoveryCode', 'workspace.custody.passphraseOn', 'workspace.custody.passphraseOff',
  'workspace.backups.list', 'workspace.backups.create',
]);
/** CUSTODY_WORDS in platform/runtime/workspace-custody-contracts.ts, for a Windows computer. */
const WHERE = 'Windows keeps the key for your login on this computer.';
const LOSS = 'Reinstalling Windows, or a password reset by someone else, can lose the key.';
const NO_KEYRING = 'This computer has no keyring Chausar can use, so Chausar asks for a passphrase.';
/** A sample recovery code: 24 characters from the engine's alphabet. The real one is random and shown once. */
const SAMPLE_CODE = 'R4KD9QXM2HTW7PLB3NCF6YJV';
const BUILDERS: readonly BuilderId[] = ['lovable', 'replit', 'bolt', 'v0'];
const BARE_SITES: Record<BuilderId, string> = { lovable: 'https://lovable.dev/', replit: 'https://replit.com/', bolt: 'https://bolt.new/', v0: 'https://v0.app/' };
const UNITS: Record<PricingModel, OfferLite['pricing']['quantityUnit']> = { monthly: 'month', project: 'project', hourly: 'hour' };
const SYNTHETIC = 'These answers come from a synthetic recording of GitHub, not your real repo.';

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);
const told = (value: string) => ({ value, label: 'told-by-you' as const, by: 'owner' as const });

/** Indian grouping for the sample: '1500000' gives '₹15,00,000.00'. Text work only; the real engine formats minor units. */
function rupees(typed: string): string {
  const [whole = '0', fraction = ''] = typed.split('.');
  const last = whole.slice(-3);
  const rest = whole.slice(0, -3);
  const grouped = rest ? `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last}` : last;
  return `₹${grouped}.${`${fraction}00`.slice(0, 2)}`;
}

export class FakeBusinessDesk {
  private readonly host: DeskHost;
  private models: Record<string, ModelStatusLite>;
  private draftAi: ModelStatusLite;
  private blueprints: Record<string, BlueprintViewLite>;
  private accepted: Record<string, BlueprintLite> = {};
  private builds: Record<string, BuildStatusView>;
  private receipts: ReceiptLite[];
  /** What each priced offer costs, as the engine would show it, by business and offer. */
  private prices: Record<string, string> = { 'lumen:offer_sponsor': '₹15,000.00', 'ledgerline:offer_books': '₹16,000.00', 'ledgerline:offer_gst': '₹5,000.00' };
  private seq = 0;

  constructor(host: DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.models = options.fresh ? {} : clone(MODEL_STATUS);
    this.draftAi = clone(DRAFT_AI_STATUS);
    this.blueprints = options.fresh ? {} : clone(BLUEPRINTS);
    for (const [id, view] of Object.entries(this.blueprints)) if (view.blueprint.status === 'accepted') this.keepAccepted(id, view.blueprint);
    this.builds = options.fresh ? {} : clone(BUILDS);
    this.receipts = clone(OFFER_RECEIPTS);
  }

  handles(method: string): boolean {
    return DESK_METHODS.has(method);
  }

  receipt(id: string): ReceiptLite | undefined {
    const found = this.receipts.find((r) => r.id === id);
    return found ? clone(found) : undefined;
  }

  /** The flagship playbook the business's idea picks, as venture.get and venture.blueprint.get carry it. */
  playbook(businessId: string): PlaybookPick | undefined {
    const pick = this.blueprints[businessId]?.playbook ?? PLAYBOOKS[businessId];
    return pick ? clone(pick) : undefined;
  }

  /** A plan written elsewhere in the fake (onboarding) becomes this business's plan. */
  putBlueprint(businessId: string, view: BlueprintViewLite): void {
    this.blueprints[businessId] = clone(view);
  }

  /** The queue accepted a plan row: that version becomes the accepted plan. */
  accept(businessId: string, blueprintId: string): void {
    const view = this.blueprints[businessId];
    if (!view || view.blueprint.id !== blueprintId) return;
    view.blueprint.status = 'accepted';
    this.keepAccepted(businessId, view.blueprint);
  }

  private keepAccepted(businessId: string, blueprint: BlueprintLite): void {
    this.accepted[businessId] = clone(blueprint);
    for (const offer of blueprint.offers) {
      const shown = this.prices[`${businessId}:${offer.id}`];
      if (shown) this.prices[`accepted:${businessId}:${offer.id}`] = shown;
    }
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.models.presets': return clone(MODEL_PRESETS);
      case 'venture.models.status': return clone(this.modelsOf(biz));
      case 'venture.models.connect': return this.connect(this.modelsOf(biz), p, biz);
      case 'venture.models.disconnect': return this.disconnect(this.modelsOf(biz), p);
      case 'venture.ai.options': return { presets: clone(MODEL_PRESETS), status: clone(this.draftAi), unchecked: true };
      case 'venture.ai.status': return clone(this.draftAi);
      case 'venture.ai.connect': return this.connect(this.draftAi, p, null);
      case 'venture.ai.disconnect': return this.disconnect(this.draftAi, p);
      case 'venture.blueprint.get': { const view = this.blueprints[biz]; return view ? clone(view) : null; }
      case 'venture.blueprint.update': return this.update(biz, p.patch);
      case 'venture.price.quote': return this.quote(biz, p);
      case 'venture.build.status': return clone(this.buildOf(biz));
      case 'venture.build.brief': return this.brief(biz);
      case 'venture.build.handoff': return this.handoff(biz, p.builder);
      case 'venture.build.handoffOpened': {
        const handoff = this.buildOf(biz).handoffs.find((h) => h.id === p.handoffId);
        if (!handoff) throw new EngineError('HANDOFF_NOT_FOUND', 'This handoff is not on this computer.');
        handoff.openedAt ??= this.host.now();
        return clone(handoff);
      }
      case 'venture.build.link': return this.link(biz, p);
      case 'venture.build.sync': return this.sync(biz);
      case 'workspace.custody.get': return this.custodyView(biz);
      case 'workspace.custody.recoveryCode': return this.recoveryCode(biz, p);
      case 'workspace.custody.passphraseOn': return this.passphraseOn(biz, p);
      case 'workspace.custody.passphraseOff': return this.passphraseOff(biz, p);
      case 'workspace.backups.list': return { backups: clone(this.backupsOf(biz)), more: false };
      case 'workspace.backups.create': {
        const backup: BackupLite = { file: `backup-${biz}-${++this.seq}.vault`, kind: 'manual', at: this.host.now(), revision: this.seq, bytes: 48_211, name: this.host.businessName(biz), opensNow: true };
        this.backupsOf(biz).unshift(backup);
        return clone(backup);
      }
      default: throw new EngineError('METHOD_NOT_ALLOWED', `The fake engine does not answer ${method}.`);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Your AI
  // ---------------------------------------------------------------------------------------------------------------

  private modelsOf(biz: string): ModelStatusLite {
    this.models[biz] ??= clone(DRAFT_AI_STATUS);
    return this.models[biz];
  }

  private connect(state: ModelStatusLite, p: Record<string, unknown>, biz: string | null): ModelStatusLite {
    const preset = MODEL_PRESETS.find((x) => x.id === p.presetId);
    if (!preset) throw invalid('Choose one of the listed AI options.');
    if (p.consentDigest !== preset.consentDigest) throw new EngineError('MODEL_CONSENT_REQUIRED', 'Read what is sent and agree to it first.');
    if (preset.availability === 'unavailable' || preset.availability === 'needs-setup') throw new EngineError('PRESET_UNAVAILABLE', preset.availabilityReason);
    const key = typeof p.apiKey === 'string' ? p.apiKey.trim() : '';
    if (preset.needsKey && !key) throw new EngineError('MODEL_KEY_MISSING', 'Paste your key first.');
    if (!preset.needsKey && p.apiKey !== undefined) throw invalid('This option takes no key.');
    let model = preset.model;
    if (typeof p.model === 'string' && p.model.trim()) {
      if (!preset.modelEditable) throw invalid('This option has a fixed model.');
      model = p.model.trim();
    }
    if (p.monthlyCapUsd !== undefined && !/^\d{1,6}(\.\d{1,2})?$/.test(String(p.monthlyCapUsd))) throw new EngineError('INVALID_AMOUNT', 'Type the monthly limit in US dollars, like 20 or 12.50.');
    const asked = Array.isArray(p.tiers) ? (p.tiers as unknown[]).filter((t): t is ModelTier => t === 'fast' || t === 'main') : [];
    const tiers = asked.length > 0 ? asked : [...preset.tiers];
    // The key is checked and dropped: the sample keeps only that one is loaded, never the key itself.
    state.connections.push({
      id: `mc-${biz ?? 'draft'}-${++this.seq}`, presetId: preset.id, model, tiers, status: 'connected', consentedAt: this.host.now(),
      keyLoaded: preset.needsKey, usable: true, reason: preset.availabilityReason, verificationNote: preset.verificationNote ?? null,
    });
    this.retier(state);
    if (biz && preset.kind !== 'template') {
      // Today's "Connect your AI" leaves once an AI serves the business.
      for (const row of this.host.rows()) if (row.businessId === biz && row.kind === 'setup' && row.actions.some((a) => a.id === 'connect')) this.host.settle(row.id);
      this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    }
    return clone(state);
  }

  private disconnect(state: ModelStatusLite, p: Record<string, unknown>): ModelStatusLite {
    const connection = state.connections.find((c) => c.id === p.connectionId && c.status === 'connected');
    if (!connection) throw invalid('No such AI connection.');
    Object.assign(connection, { status: 'disconnected', usable: false, keyLoaded: false, reason: 'Disconnected.' });
    this.retier(state);
    return clone(state);
  }

  /** Later connections win per tier; with none, built-in templates serve it. */
  private retier(state: ModelStatusLite): void {
    for (const tier of ['fast', 'main'] as const) {
      const serving = [...state.connections].reverse().find((c) => c.status === 'connected' && c.tiers.includes(tier));
      state.tiers[tier] = serving
        ? { presetId: serving.presetId, model: serving.model, usable: serving.usable, reason: serving.reason, verificationNote: serving.verificationNote ?? null }
        : { ...TEMPLATES_TIER };
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Plan, playbook and prices
  // ---------------------------------------------------------------------------------------------------------------

  private planOf(biz: string): BlueprintViewLite {
    const view = this.blueprints[biz];
    if (!view) throw new EngineError('BLUEPRINT_NOT_FOUND', 'There is no plan yet.');
    return view;
  }

  private update(biz: string, raw: unknown): BlueprintViewLite {
    const view = this.planOf(biz);
    const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (Object.keys(patch).length === 0) throw invalid('Change at least one thing.');
    const text = (value: unknown, max: number, what: string) => {
      const s = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
      if (s.length < 2 || s.length > max) throw invalid(`${what} must be between 2 and ${max} characters.`);
      return s;
    };
    const next = clone(view.blueprint);
    next.version += 1;
    next.id = `bp-${biz}-${next.version}`;
    next.at = this.host.now();
    next.status = 'draft';
    if (patch.name !== undefined) next.name = told(text(patch.name, 60, 'The name'));
    if (patch.oneLiner !== undefined) next.oneLiner = told(text(patch.oneLiner, 160, 'The one line'));
    if (patch.customer !== undefined) next.customer = told(text(patch.customer, 200, "Who it's for"));
    const typedPrices: Record<string, string> = {};
    for (const change of Array.isArray(patch.offers) ? (patch.offers as Record<string, unknown>[]) : []) {
      const offer = next.offers.find((o) => o.id === change.id);
      if (!offer) throw new EngineError('OFFER_NOT_FOUND', 'That offer is not in your plan.');
      if (change.name !== undefined) offer.name = told(text(change.name, 60, 'The offer name'));
      if (change.description !== undefined) offer.description = told(text(change.description, 200, 'What it includes'));
      if (change.pricingModel !== undefined) {
        const model = change.pricingModel as PricingModel;
        if (!(model in UNITS)) throw invalid('Charge per month, per project or per hour.');
        offer.pricing.model = model;
        offer.pricing.quantityUnit = UNITS[model];
      }
      if (change.unitPrice === null) {
        offer.pricing.unitPriceMinor = null;
        offer.pricing.unitPriceLabel = 'not-set';
      } else if (change.unitPrice !== undefined) {
        const typed = String(change.unitPrice).replace(/[,\s₹]/g, '');
        if (!/^\d{1,9}(\.\d{1,2})?$/.test(typed) || /^0+(\.0+)?$/.test(typed)) throw new EngineError('INVALID_AMOUNT', 'Type the price as a number, like 15000 or 15000.50.');
        const [whole = '0', fraction = ''] = typed.split('.');
        offer.pricing.unitPriceMinor = `${whole.replace(/^0+(?=\d)/, '')}${`${fraction}00`.slice(0, 2)}`;
        offer.pricing.unitPriceLabel = 'told-by-you';
        typedPrices[offer.id] = rupees(typed);
      }
    }
    next.digest = this.host.digest({ ...next, digest: '' });
    for (const [offerId, display] of Object.entries(typedPrices)) this.prices[`${biz}:${offerId}`] = display;
    // Receipts belong to a version: a new version has none until it is priced again.
    this.blueprints[biz] = {
      blueprint: next, offerReceipts: Object.fromEntries(next.offers.map((o) => [o.id, null])),
      ...(view.playbook ? { playbook: view.playbook } : {}), ...(view.intake ? { intake: clone(view.intake) } : {}),
    };
    this.planRow(biz, next);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return clone(this.blueprints[biz]!);
  }

  private priceText(offer: OfferLite | undefined, key: string): string {
    if (!offer || offer.pricing.unitPriceMinor === null) return 'Not set';
    return `${this.prices[key] ?? rupees(offer.pricing.unitPriceMinor.slice(0, -2) || '0')} per ${offer.pricing.quantityUnit}`;
  }

  /** The engine's plan row (views/queue.ts planRows): one per business, for the latest draft version. */
  private planRow(biz: string, latest: BlueprintLite): void {
    const rows = this.host.rows().filter((r) => !(r.businessId === biz && r.viewRef?.kind === 'plan'));
    const accepted = this.accepted[biz];
    const base = { id: `q-plan-${biz}-v${latest.version}`, businessId: biz, businessName: this.host.businessName(biz), createdAt: latest.at, line: latest.oneLiner.value, viewRef: { kind: 'plan' as const, id: latest.id } };
    let seed: Omit<QueueRow, 'digest'>;
    const changes = accepted ? latest.offers.filter((o) => (accepted.offers.find((a) => a.id === o.id)?.pricing.unitPriceMinor ?? null) !== o.pricing.unitPriceMinor) : [];
    if (!accepted) {
      seed = { ...base, kind: 'plan', title: 'Your plan is ready. Read it.', actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }] };
    } else if (changes.length === 0) {
      seed = { ...base, kind: 'plan', title: 'Your plan changed. Read it, then accept it.', actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }] };
    } else {
      const [first, ...rest] = changes as [OfferLite, ...OfferLite[]];
      seed = {
        ...base, kind: 'price', title: changes.length === 1 ? `New price for ${first.name.value}` : 'New prices in your plan',
        line: rest.length ? `Also changes ${rest.map((o) => o.name.value).join(', ')}.` : 'Accept the plan to use it on new orders and invoices.',
        change: { label: first.name.value, before: this.priceText(accepted.offers.find((a) => a.id === first.id), `accepted:${biz}:${first.id}`), after: this.priceText(first, `${biz}:${first.id}`) },
        actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, secondAsk: true }],
      };
    }
    this.host.setRows([...rows, { ...seed, digest: this.host.digest(seed) }]);
  }

  private quote(biz: string, p: Record<string, unknown>): ReceiptLite {
    const view = this.planOf(biz);
    const offer = view.blueprint.offers.find((o) => o.id === p.offerId);
    if (!offer) throw new EngineError('OFFER_NOT_FOUND', 'That offer is not in your plan.');
    if (offer.pricing.unitPriceMinor === null) throw new EngineError('PRICE_REQUIRED', `Set your price for ${offer.name.value} first.`);
    const display = this.prices[`${biz}:${offer.id}`] ?? rupees(offer.pricing.unitPriceMinor.slice(0, -2) || '0');
    const taxed = view.blueprint.backOffice.taxRegistered.value;
    const sample = OFFER_RECEIPTS.find((r) => r.figures[0]?.display === display && taxed && r.figures.length > 2);
    const receipt: ReceiptLite = {
      id: this.host.receiptId(), at: this.host.now(), stale: false,
      figures: sample ? clone(sample.figures) : [{ key: 'unit', label: offer.name.value, display }, { key: 'total', label: taxed ? 'Total before GST' : 'Total', display }],
      explanation: sample ? sample.explanation : taxed
        ? `${offer.name.value} at ${display}. The sample engine does not work out GST; the real one does, with each step on this receipt.`
        : `${offer.name.value} at ${display}, no discount. Not registered for GST, so no tax.`,
    };
    this.receipts.push(receipt);
    view.offerReceipts[offer.id] = receipt;
    return clone(receipt);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Keeping the business: this computer's key, the recovery code, the optional passphrase, backups
  // ---------------------------------------------------------------------------------------------------------------

  private backups: Record<string, BackupLite[]> = {};
  private backupsOf(biz: string): BackupLite[] {
    this.backups[biz] ??= [{ file: `backup-${biz}-auto.vault`, kind: 'auto', at: '2026-10-21T06:00:00.000Z', revision: 1, bytes: 47_902, name: this.host.businessName(biz), opensNow: true }];
    return this.backups[biz];
  }

  private custodyView(biz: string): CustodyViewLite {
    const available = this.host.deviceKeys();
    const computer = available
      ? { available, scheme: 'windows-dpapi', reason: null, checked: true, where: WHERE, loss: LOSS }
      : { available, scheme: null, reason: 'no-keyring', checked: false, where: NO_KEYRING, loss: null };
    const held = this.host.business(biz);
    if (!held) return { computer, business: null };
    const backups = this.backupsOf(biz);
    return {
      computer,
      business: {
        folder: biz, unlock: held.opens === 'needs-passphrase' ? 'passphrase' : 'this-computer', recovery: held.recovery, storage: 'experimental-file',
        backups: { auto: true, count: backups.length, newestAt: backups[0]?.at ?? null, nextDueAt: null, lastError: null },
      },
    };
  }

  private heldOrThrow(biz: string) {
    const held = this.host.business(biz);
    if (!held) throw new EngineError('VAULT_LOCKED', 'Open your workspace first.');
    return held;
  }

  /** Making the code keeps the business: Today's "Keep this business" leaves. */
  private madeCode(biz: string): void {
    this.heldOrThrow(biz).recovery = 'made';
    for (const row of this.host.rows()) if (row.businessId === biz && row.kind === 'setup' && row.actions.some((a) => a.id === 'keep')) this.host.settle(row.id);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
  }

  private recoveryCode(biz: string, p: Record<string, unknown>) {
    const held = this.heldOrThrow(biz);
    if (held.opens === 'needs-passphrase' && !(typeof p.passphrase === 'string' && p.passphrase)) throw new EngineError('PASSPHRASE_REQUIRED', 'This business is locked with a passphrase. Type it to open.');
    this.madeCode(biz);
    return { custody: this.custodyView(biz), recoveryCode: SAMPLE_CODE };
  }

  private passphraseOn(biz: string, p: Record<string, unknown>) {
    const held = this.heldOrThrow(biz);
    const passphrase = typeof p.passphrase === 'string' ? p.passphrase : '';
    if (held.opens === 'needs-passphrase') throw new EngineError('CUSTODY_UNCHANGED', "It's already set that way.");
    if (passphrase.length < 12 || passphrase.length > 1024) throw new EngineError('WEAK_PASSPHRASE', 'Use a passphrase of 12 to 1024 characters.');
    const first = held.recovery !== 'made';
    held.opens = 'needs-passphrase';
    if (first) this.madeCode(biz);
    return { custody: this.custodyView(biz), recoveryCode: first ? SAMPLE_CODE : null };
  }

  private passphraseOff(biz: string, p: Record<string, unknown>) {
    const held = this.heldOrThrow(biz);
    if (held.opens !== 'needs-passphrase') throw new EngineError('CUSTODY_UNCHANGED', "It's already set that way.");
    if (!(typeof p.passphrase === 'string' && p.passphrase)) throw new EngineError('PASSPHRASE_REQUIRED', 'This business is locked with a passphrase. Type it to open.');
    if (!this.host.deviceKeys()) throw new EngineError('DEVICE_KEYS_UNAVAILABLE', NO_KEYRING);
    held.opens = 'with-this-computer';
    return { custody: this.custodyView(biz) };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Website build
  // ---------------------------------------------------------------------------------------------------------------

  private buildOf(biz: string): BuildStatusView {
    this.builds[biz] ??= { brief: null, handoffs: [], follow: null, tokenLink: GITHUB_TOKEN_LINK };
    return this.builds[biz];
  }

  private brief(biz: string) {
    const view = this.blueprints[biz];
    if (!view || !this.accepted[biz]) throw new EngineError('BLUEPRINT_NOT_ACCEPTED', 'Accept your plan first. The brief is written from the accepted plan.');
    const build = this.buildOf(biz);
    const version = (build.brief?.version ?? 0) + 1;
    const markdown = templateBrief(this.accepted[biz].name.value, version);
    build.brief = { id: `brief-${biz}-${version}`, at: this.host.now(), briefId: `chb_${biz.slice(0, 8)}`, version, markdown, chars: markdown.length, wordsBy: 'template', lint: { ok: true, findings: [] } };
    return clone(build.brief);
  }

  private handoff(biz: string, builder: unknown) {
    if (!BUILDERS.includes(builder as BuilderId)) throw invalid('Choose Lovable, Replit, Bolt or v0.');
    const id = builder as BuilderId;
    const build = this.buildOf(biz);
    const brief = build.brief;
    if (!brief) throw new EngineError('BRIEF_NOT_FOUND', 'Write the build brief first.');
    if (!brief.lint.ok) throw new EngineError('BRIEF_LINT_FAILED', brief.lint.findings[0]?.message ?? 'The brief did not pass its checks.');
    const link = id === 'lovable' || id === 'replit';
    // The real Replit link compresses the brief (lz-string); the sample only encodes it.
    const url = id === 'lovable' ? `https://lovable.dev/#prompt=${encodeURIComponent(brief.markdown)}` : id === 'replit' ? `https://replit.com/?stack=Build&prompt=${encodeURIComponent(brief.markdown)}&referrer=chausar` : BARE_SITES[id];
    const handoffId = `ho-${biz}-${++this.seq}`;
    build.handoffs.unshift({ id: handoffId, at: this.host.now(), builder: id, mode: link ? 'link' : 'copy', openedAt: null });
    return {
      handoffId, builder: id, mode: link ? 'link' : 'copy', url, clipboardText: link ? null : brief.markdown,
      notes: [...(id === 'lovable' ? HANDOFF_NOTES.lovable : id === 'replit' ? HANDOFF_NOTES.replit : HANDOFF_NOTES.copy)], label: 'handoff', status: 'available',
    };
  }

  private link(biz: string, p: Record<string, unknown>) {
    const typed = typeof p.repo === 'string' ? p.repo.trim() : '';
    const match = /^(?:https:\/\/github\.com\/)?([A-Za-z0-9-]{1,39})\/([A-Za-z0-9._-]{1,100}?)(?:\.git)?\/?$/.exec(typed);
    if (!match) throw new EngineError('INVALID_REPO', 'Type the repo as owner/name, as GitHub shows it.');
    if (p.token !== undefined && !(typeof p.token === 'string' && p.token.startsWith('github_pat_'))) throw new EngineError('TOKEN_NOT_FINE_GRAINED', 'Use a fine-grained token for this one repo, read only. It starts with github_pat_.');
    const build = this.buildOf(biz);
    // The token is used for this session's reads and never stored.
    build.follow = { id: `follow-${biz}`, repo: { owner: match[1]!, name: match[2]! }, tokenState: p.token === undefined ? 'none' : 'in-memory', linkedAt: this.host.now(), lastStatus: null };
    return clone(build.follow);
  }

  private sync(biz: string) {
    const follow = this.buildOf(biz).follow;
    if (!follow) throw new EngineError('REPO_NOT_LINKED', 'Follow a repo first.');
    const at = this.host.now();
    follow.lastStatus = follow.lastStatus ? { ...follow.lastStatus, asOf: at } : {
      word: 'repo-connected', asOf: at,
      repo: { fullName: `${follow.repo.owner}/${follow.repo.name}`, private: null, defaultBranch: 'main', htmlUrl: `https://github.com/${follow.repo.owner}/${follow.repo.name}` },
      lastCommit: null, briefMarker: 'missing', briefMarkerVersion: null, uiWorkflow: 'missing', checks: 'none-reported',
      deployment: null, syncConflictBranch: null, cannotSay: [SYNTHETIC],
    };
    return clone(follow.lastStatus);
  }
}
