import {youtubeService} from '../../../../platform/runtime/venture/playbooks/youtube/offers2';
import {fakeYoutubeServiceIntake} from './fake-youtube-plan';
import { fakeCaPlan, fakeCaForIdea } from './fake-ca-plan';
/**
 * The fake engine's answers for Connections and the business menu: Your AI (venture.models.* in a business,
 * venture.ai.* before one exists), plan and playbook (venture.blueprint.get and .update), prices (venture.price.quote)
 * and website build (venture.build.*). It keeps the engine's rules: a key is taken once and never handed back; a plan
 * edit makes a new draft version that waits on Today (a price change asks twice); every receipt is new and numbered;
 * the brief needs an accepted plan; a handoff needs a brief that passed its checks; a repo link keeps no token.
 * FakeEngine (fake.ts) owns the queue; this desk reaches it only through DeskHost.
 */

import { BLUEPRINTS, BUILDS, DRAFT_AI_STATUS, GITHUB_TOKEN_LINK, HANDOFF_NOTES, MODEL_PRESETS, MODEL_STATUS, OFFER_RECEIPTS, PLAYBOOKS, TEMPLATES_TIER, templateBrief } from './fixtures-business';
import { CUSTODY_ERROR_WORDS, SAMPLE_MOVE_CODE } from './fixtures';
import {
  EngineError, type BackupLite, type BlueprintLite, type BlueprintViewLite, type BuilderId, type BuildStatusView, type BusinessOnComputer,
  type CustodyViewLite, type ModelStatusLite, type ModelTier, type MoveFile, type OfferLite, type PlaybookPick, type PricingModel, type QueueRow, type ReceiptLite, type VentureRunEvent,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

export interface DeskHost {
  current(): string;
  orders?(): {offerId:string;status:string}[];
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
  business(id: string): { opens: BusinessOnComputer['opens']; recovery: 'made' | 'not-made'; passphrase?: string | undefined } | null;
  /** Whether this computer's protected storage can keep a business key. */
  deviceKeys(): boolean;
  /** 4H2: whether this answers as the hosted web server. */
  hosted?(): boolean;
}

const DESK_METHODS = new Set([
  'venture.models.presets', 'venture.models.status', 'venture.models.connect', 'venture.models.disconnect',
  'venture.ai.options', 'venture.ai.status', 'venture.ai.connect', 'venture.ai.disconnect',
  'venture.blueprint.get', 'venture.blueprint.update', 'venture.price.quote',
  'venture.build.brief', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status',
  'workspace.custody.get', 'workspace.custody.recoveryCode', 'workspace.custody.passphraseOn', 'workspace.custody.passphraseOff',
  'workspace.backups.list', 'workspace.backups.create', 'workspace.backups.restore', 'workspace.transfer.export', 'workspace.export',
  'trust.update',
]);
/** The engine's move file format, in the sample. The real file is the encrypted vault, sealed under the move code. */
export const SAMPLE_MOVE_FORMAT = 'chausar.move.sample';
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
  private accepted: Record<string, BlueprintViewLite> = {};
  private builds: Record<string, BuildStatusView>;
  private receipts: ReceiptLite[];
  /** What each priced offer costs, as the engine would show it, by business and offer. */
  private prices: Record<string, string> = { 'lumen:offer_sponsor': '₹15,000.00', 'ledgerline:offer_books': '₹16,000.00', 'ledgerline:offer_gst': '₹5,000.00' };
  /** 4J8: how many offers each business's owner has added, so an added offer's id is never reused. */
  private ownerOffers: Record<string, number> = {};
  private seq = 0;

  constructor(host: DeskHost, options: { fresh?: boolean } = {}) {
    this.host = host;
    this.models = options.fresh ? {} : clone(MODEL_STATUS);
    this.draftAi = clone(DRAFT_AI_STATUS);
    this.blueprints = options.fresh ? {} : clone(BLUEPRINTS);
    for (const [id, view] of Object.entries(this.blueprints)) if (view.playbook?.id === 'ca-firm') this.blueprints[id] = fakeCaPlan(view, true);
    for (const [id, view] of Object.entries(this.blueprints)) if (view.blueprint.status === 'accepted') this.keepAccepted(id, view);
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

  /** Internal queue projection, without changing the open business. */
  acceptedOffersFor(businessId: string) { return clone(this.accepted[businessId]?.blueprint.offers ?? []); }
  acceptedPlanFor(businessId: string): BlueprintViewLite | null { return this.accepted[businessId] ? clone(this.accepted[businessId]!) : null; }
  blueprintFor(businessId: string): BlueprintViewLite | null { return this.blueprints[businessId] ? clone(this.blueprints[businessId]!) : null; }

  /** A plan written elsewhere in the fake (onboarding) becomes this business's plan. */
  putBlueprint(businessId: string, view: BlueprintViewLite): void {
    const prior=this.blueprints[businessId];
    if(view.playbook?.id==='youtube'&&prior?.playbook?.id==='youtube'){
      const kept=prior.blueprint.offers.filter(offer=>offer.addedByOwner&&offer.playbookOffer);
      view.blueprint.offers.push(...clone(kept));
      view.intake={...view.intake,...Object.fromEntries(kept.map(offer=>[offer.id,fakeYoutubeServiceIntake(offer.playbookOffer!,!!this.host.hosted?.())]))};
      view.offerReceipts={...view.offerReceipts,...Object.fromEntries(kept.map(offer=>[offer.id,null]))};
      view.blueprint.digest=this.host.digest({...view.blueprint,digest:''});
    }
    this.blueprints[businessId] = clone(view);
  }

  /** The queue accepted a plan row: that version becomes the accepted plan. */
  accept(businessId: string, blueprintId: string): void {
    const view = this.blueprints[businessId];
    if (!view || view.blueprint.id !== blueprintId) return;
    view.blueprint.status = 'accepted';
    this.keepAccepted(businessId, view);
  }

  private keepAccepted(businessId: string, view: BlueprintViewLite): void {
    this.accepted[businessId] = clone(view);
    for (const offer of view.blueprint.offers) {
      const shown = this.prices[`${businessId}:${offer.id}`];
      if (shown) this.prices[`accepted:${businessId}:${offer.id}`] = shown;
    }
  }

  /**
   * The presets with this host's availability: on the hosted app no command-line tool ever runs, so both are
   * unavailable there, in the engine's words (models/presets.ts availabilityOf, AVAILABILITY_REASONS.hostedCli).
   */
  private presets() {
    const presets = clone(MODEL_PRESETS);
    if (!this.host.hosted?.()) return presets;
    return presets.map((preset) => (preset.runsOn === 'this-computer'
      ? { ...preset, availability: 'unavailable' as const, availabilityReason: 'Runs only in the desktop app, on your own computer. The hosted web app uses keys only.' }
      : preset));
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.models.presets': return this.presets();
      case 'venture.models.status': return clone(this.modelsOf(biz));
      case 'venture.models.connect': return this.connect(this.modelsOf(biz), p, biz);
      case 'venture.models.disconnect': return this.disconnect(this.modelsOf(biz), p);
      case 'venture.ai.options': return { presets: this.presets(), status: clone(this.draftAi), unchecked: true };
      case 'venture.ai.status': return clone(this.draftAi);
      case 'venture.ai.connect': return this.connect(this.draftAi, p, null);
      case 'venture.ai.disconnect': return this.disconnect(this.draftAi, p);
      case 'venture.blueprint.get': { const view = this.blueprints[biz]; return view ? clone(view) : null; }
      case 'venture.blueprint.update': return this.update(biz, p.patch, p.basedOn);
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
      case 'workspace.backups.create': return clone(this.addBackup(biz, 'manual'));
      case 'workspace.backups.restore': return this.restoreBackup(biz, p);
      case 'trust.update': {
        // trust.ts updatePolicy: only known fields, and send is one of three.
        if (Object.keys(p).some((key) => key !== 'send') || !['nothing', 'shape', 'samples'].includes(p.send as string)) throw new EngineError('INVALID_POLICY', 'Choose nothing, shape, or samples.');
        this.modelsOf(biz).sendPolicy = p.send as ModelStatusLite['sendPolicy'];
        return { send: this.modelsOf(biz).sendPolicy };
      }
      case 'workspace.transfer.export': return this.moveFile(biz, p);
      case 'workspace.export': {
        if (p.confirmed !== true) throw new EngineError('CONFIRMATION_REQUIRED', 'Confirm the export in the app.');
        const plaintext = p.plaintext === true;
        return { path: `/Users/you/Chausar/exports/chausar-${biz}-${++this.seq}.${plaintext ? 'json' : 'vault'}`, encrypted: !plaintext };
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

  private update(biz: string, raw: unknown, basedOn?: unknown): BlueprintViewLite {
    const view = this.planOf(biz);
    const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (Object.keys(patch).length === 0) throw invalid('Change at least one thing.');
    // 4J8: a suggestion's patch is bound to the plan it read (core/blueprint.ts blueprintUpdate).
    if (basedOn !== undefined) {
      const bound = (basedOn && typeof basedOn === 'object' ? basedOn : {}) as Record<string, unknown>;
      if (typeof bound.blueprintId !== 'string' || typeof bound.digest !== 'string') throw invalid('Send the id and digest of the plan the change was made from.');
      if (bound.blueprintId !== view.blueprint.id || bound.digest !== view.blueprint.digest) throw new EngineError('APPROVAL_STALE', 'Your plan changed since this was suggested. Ask again, then apply it.');
    }
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
      // 5A2 (money/share-price.ts applyShareChange): a share in place of a fixed price; a fixed price takes it away.
      if (change.share !== undefined) {
        if (change.unitPrice !== undefined) throw invalid('Set a fixed price or a share, not both.');
        if (change.share === null) delete offer.pricing.share;
        else {
          const typed = String((change.share as { percent?: unknown }).percent ?? '').replace(/[\s%]/g, '');
          const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(typed);
          const bps = match ? Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')) : 0;
          if (!match || bps < 1 || bps > 10000) throw new EngineError('INVALID_SHARE', match ? 'A share must be from 0.01% to 100%.' : 'Type the share as a percent, like 8.33 or 12.');
          offer.pricing.share = { kind: 'share', bps: String(bps), baseMinor: null, baseEvidenceFileId: null, words: '' };
          offer.pricing.share.words = this.priceText(offer, '');
          offer.pricing.unitPriceMinor = null;
          offer.pricing.unitPriceLabel = 'not-set';
        }
      } else if (change.unitPrice !== undefined) delete offer.pricing.share;
    }
    // 4J8: an offer the owner adds, with no price yet, or takes out again (core/owner-offers.ts).
    if (patch.removeOffer !== undefined) {
      const id = (patch.removeOffer as Record<string, unknown> | null)?.id;
      const offer = next.offers.find((o) => o.id === id);
      if (!offer) throw new EngineError('OFFER_NOT_FOUND', 'That offer is not in your plan.');
      if (!offer.addedByOwner) throw invalid('Only an offer you added can be taken out.');
      if(this.host.orders?.().some(order=>order.offerId===id&&order.status==='open'))throw invalid('An open order uses this offer. Deliver or cancel it first.');
      next.offers = next.offers.filter((o) => o.id !== id);
    }
    if (patch.addOffer !== undefined) {
      let add = (patch.addOffer ?? {}) as Record<string, unknown>;let service:string|undefined;
      if(Object.hasOwn(add,'youtubeService')){
        if(Object.keys(add).length!==1)throw invalid('Send the required fields and nothing else.');
        let chosen:ReturnType<typeof youtubeService>;try{chosen=youtubeService(add.youtubeService);}catch{throw invalid('Choose a named YouTube service.');}
        if(view.playbook?.id!=='youtube')throw new EngineError('YOUTUBE_SERVICE_INVALID','Add a YouTube service only to a YouTube business.');
        if(next.offers.some(offer=>offer.addedByOwner&&offer.playbookOffer===chosen.id))throw new EngineError('YOUTUBE_SERVICE_EXISTS','This service is already on your plan. Set its price or open that service.');
        service=chosen.id;add={name:chosen.name,description:chosen.description,pricingModel:chosen.pricing};
      }
      const model = add.pricingModel as PricingModel;
      if (!(model in UNITS)) throw invalid('Choose per month, per project or per hour.');
      if (next.offers.filter((o) => o.addedByOwner).length >= 5) throw invalid('Your plan holds five offers you added. Take one out first.');
      this.ownerOffers[biz] = (this.ownerOffers[biz] ?? 0) + 1;
      next.offers.push({
        id: `offer_own_${this.ownerOffers[biz]}`, addedByOwner: true, ...(service?{playbookOffer:service}:{}), name: told(text(add.name, 60, 'The offer name')), description: told(text(add.description, 200, 'The offer description')),
        pricing: { model, quantityUnit: UNITS[model], unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' },
      });
    }
    next.digest = this.host.digest({ ...next, digest: '' });
    for (const [offerId, display] of Object.entries(typedPrices)) this.prices[`${biz}:${offerId}`] = display;
    // Receipts belong to a version: a new version has none until it is priced again.
    this.blueprints[biz] = {
      blueprint: next, offerReceipts: Object.fromEntries(next.offers.map((o) => [o.id, null])),
      ...(view.playbook ? { playbook: view.playbook } : {}), ...(view.intake ? { intake: {...clone(view.intake),...Object.fromEntries(next.offers.filter(offer=>offer.addedByOwner&&offer.playbookOffer&&view.playbook?.id==='youtube').map(offer=>[offer.id,fakeYoutubeServiceIntake(offer.playbookOffer!,!!this.host.hosted?.())]))} } : {}),
    };
    this.planRow(biz, next);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return clone(this.blueprints[biz]!);
  }

  private priceText(offer: OfferLite | undefined, key: string): string {
    // 5A2: a share reads as the engine's shareWords ("8.33% of the amount your client confirms").
    if (offer?.pricing.share) {
      const bps = offer.pricing.share.bps.padStart(3, '0');
      const fraction = bps.slice(-2).replace(/0+$/, '');
      return `${bps.slice(0, -2).replace(/^0+(?=\d)/, '')}${fraction ? `.${fraction}` : ''}% of the amount your client confirms`;
    }
    if (!offer || offer.pricing.unitPriceMinor === null) return 'Not set';
    return `${this.prices[key] ?? rupees(offer.pricing.unitPriceMinor.slice(0, -2) || '0')} per ${offer.pricing.quantityUnit}`;
  }

  /** The engine's plan row (views/queue.ts planRows): one per business, for the latest draft version. */
  private planRow(biz: string, latest: BlueprintLite): void {
    const rows = this.host.rows().filter((r) => !(r.businessId === biz && r.viewRef?.kind === 'plan'));
    const accepted = this.accepted[biz]?.blueprint;
    const base = { id: `q-plan-${biz}-v${latest.version}`, businessId: biz, businessName: this.host.businessName(biz), createdAt: latest.at, line: latest.oneLiner.value, viewRef: { kind: 'plan' as const, id: latest.id } };
    let seed: Omit<QueueRow, 'digest'>;
    const changes = accepted ? latest.offers.filter((o) => {
      const before = accepted.offers.find((a) => a.id === o.id);
      // 5A2: setting or changing a share is a price change too.
      return (before?.pricing.unitPriceMinor ?? null) !== o.pricing.unitPriceMinor || (before?.pricing.share?.bps ?? null) !== (o.pricing.share?.bps ?? null);
    }) : [];
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
    if (Object.keys(p).some(key => !['offerId', 'quantity'].includes(key))) throw invalid('Send the required fields and nothing else.');
    const view = this.planOf(biz);
    const offer = view.blueprint.offers.find((o) => o.id === p.offerId);
    if (!offer) throw new EngineError('OFFER_NOT_FOUND', 'That offer is not in your plan.');
    if (offer.pricing.unitPriceMinor === null) throw new EngineError('PRICE_REQUIRED', `Set your price for ${offer.name.value} first.`);
    const quantityText = p.quantity === undefined ? offer.pricing.defaultQuantity : p.quantity;
    if (typeof quantityText !== 'string' || !/^[1-9][0-9]{0,4}$/.test(quantityText) || BigInt(quantityText) > 10000n) throw invalid('Quantity must be a whole number from 1 to 10000.');
    const quantity = BigInt(quantityText);
    // The fake computes paise here, where the engine computes them, and sends both the raw total and its display.
    // Tax follows the existing sample receipt only; other tax settings retain the explicit manual limitation below.
    const showMinor = (minor: bigint) => rupees(`${minor / 100n}.${String(minor % 100n).padStart(2, '0')}`);
    const readSampleMinor = (display: string) => BigInt(display.replace(/[^0-9]/g, ''));
    const unit = BigInt(offer.pricing.unitPriceMinor);
    const display = this.prices[`${biz}:${offer.id}`] ?? showMinor(unit);
    const taxed = view.blueprint.backOffice.taxRegistered.value;
    const sample = OFFER_RECEIPTS.find((r) => r.figures[0]?.display === display && taxed && r.figures.length > 2);
    const total = sample ? readSampleMinor(sample.figures.find(figure => figure.key === 'total')!.display) * quantity : unit * quantity;
    const sampleFigures = sample ? [...(sample.figures.some(figure => figure.key === 'unit') ? [] : [{ key: 'unit', label: offer.name.value, display }]), ...sample.figures] : [];
    const figures = sample ? sampleFigures.map(figure => ({ ...figure, display: figure.key === 'unit' || quantity === 1n ? figure.display : showMinor(readSampleMinor(figure.display) * quantity) }))
      : [{ key: 'unit', label: offer.name.value, display }, { key: 'total', label: taxed ? 'Total before GST' : 'Total', display: quantity === 1n ? display : showMinor(total) }];
    const receipt: ReceiptLite = {
      id: this.host.receiptId(), at: this.host.now(), stale: false, totalMinor: String(total), figures,
      explanation: sample ? (quantity === 1n ? sample.explanation : `${quantityText} units of ${offer.name.value} at ${display}, with the sample GST: ${showMinor(total)}.`) : taxed
        ? `${offer.name.value} at ${display}. The sample engine does not work out GST; the real one does, with each step on this receipt.`
        : `${offer.name.value} at ${display}, no discount, no tax added, because tax is not turned on for this price.`,
    };
    this.receipts.push(receipt);
    view.offerReceipts[offer.id] = receipt;
    return clone(receipt);
  }
  // ---------------------------------------------------------------------------------------------------------------
  // Keeping the business: this computer's key, the recovery code, the optional passphrase, backups
  // ---------------------------------------------------------------------------------------------------------------

  private backups: Record<string, BackupLite[]> = {};
  /** A business's backups, newest first. Lumen Studio's sample has one of each kind, the oldest from before a lock change. */
  backupsOf(biz: string): BackupLite[] {
    const name = this.host.businessName(biz);
    const sample = (file: string, kind: BackupLite['kind'], at: string, revision: number, opensNow = true): BackupLite => ({ file: `chausar-${biz}-${file}.backup`, kind, at, revision, bytes: 47_902, name, opensNow });
    this.backups[biz] ??= biz === 'lumen'
      ? [sample('auto', 'auto', '2026-10-21T06:00:00.000Z', 14), sample('safety', 'safety', '2026-10-20T18:30:00.000Z', 12), sample('manual', 'manual', '2026-10-18T08:33:00.000Z', 9, false)]
      : [sample('auto', 'auto', '2026-10-21T06:00:00.000Z', 1)];
    return this.backups[biz];
  }

  /** A business left this computer: its backups go with it. */
  dropBackups(biz: string): void {
    delete this.backups[biz];
  }

  private addBackup(biz: string, kind: BackupLite['kind']): BackupLite {
    const backup: BackupLite = { file: `chausar-${biz}-${++this.seq}.backup`, kind, at: this.host.now(), revision: this.seq, bytes: 48_211, name: this.host.businessName(biz), opensNow: true };
    this.backupsOf(biz).unshift(backup);
    return backup;
  }

  /** workspace.backups.restore: confirmed, this business's own backup, and a safety copy of how it is now first. */
  private restoreBackup(biz: string, p: Record<string, unknown>) {
    if (p.confirmed !== true) throw new EngineError('CONFIRMATION_REQUIRED', 'Confirm the restore in the app.');
    const restoredFrom = this.backupsOf(biz).find((b) => b.file === p.file);
    if (!restoredFrom) {
      const elsewhere = Object.entries(this.backups).some(([other, list]) => other !== biz && list.some((b) => b.file === p.file));
      throw elsewhere ? new EngineError('BACKUP_OTHER_BUSINESS', CUSTODY_ERROR_WORDS.BACKUP_OTHER_BUSINESS) : new EngineError('BACKUP_NOT_FOUND', CUSTODY_ERROR_WORDS.BACKUP_NOT_FOUND);
    }
    const safety = this.addBackup(biz, 'safety');
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return { workspace: { id: biz, name: this.host.businessName(biz) }, restoredFrom: clone(restoredFrom), safety: clone(safety) };
  }

  /** workspace.transfer.export: one file and one code. A business locked with a passphrase needs it. */
  private moveFile(biz: string, p: Record<string, unknown>): MoveFile {
    const held = this.heldOrThrow(biz);
    if (held.opens === 'needs-passphrase' && !(typeof p.passphrase === 'string' && p.passphrase === held.passphrase)) throw new EngineError('PASSPHRASE_WRONG', CUSTODY_ERROR_WORDS.PASSPHRASE_WRONG);
    const madeAt = this.host.now();
    const text = JSON.stringify({ backupFormat: SAMPLE_MOVE_FORMAT, business: biz, name: this.host.businessName(biz), madeAt });
    return { fileName: `chausar-move-${madeAt.slice(0, 10)}.backup`, text, transferCode: SAMPLE_MOVE_CODE, bytes: text.length };
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
    if (held.opens === 'needs-passphrase' && held.passphrase !== undefined && p.passphrase !== held.passphrase) throw new EngineError('PASSPHRASE_WRONG', CUSTODY_ERROR_WORDS.PASSPHRASE_WRONG);
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
    held.passphrase = passphrase;
    if (first) this.madeCode(biz);
    return { custody: this.custodyView(biz), recoveryCode: first ? SAMPLE_CODE : null };
  }

  private passphraseOff(biz: string, p: Record<string, unknown>) {
    const held = this.heldOrThrow(biz);
    if (held.opens !== 'needs-passphrase') throw new EngineError('CUSTODY_UNCHANGED', "It's already set that way.");
    if (!(typeof p.passphrase === 'string' && p.passphrase)) throw new EngineError('PASSPHRASE_REQUIRED', 'This business is locked with a passphrase. Type it to open.');
    if (held.passphrase !== undefined && p.passphrase !== held.passphrase) throw new EngineError('PASSPHRASE_WRONG', CUSTODY_ERROR_WORDS.PASSPHRASE_WRONG);
    if (!this.host.deviceKeys()) throw new EngineError('DEVICE_KEYS_UNAVAILABLE', NO_KEYRING);
    held.opens = 'with-this-computer';
    delete held.passphrase;
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
    const markdown = templateBrief(this.accepted[biz].blueprint.name.value, version);
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
