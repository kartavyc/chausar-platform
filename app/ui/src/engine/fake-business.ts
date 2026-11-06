import { countryProfile } from '../../../../platform/runtime/venture/core/countries';
import { exportFileName } from '../../../../platform/runtime/workspace-custody-contracts';
import { currencyMinorDigits, decimalMinor } from '../../../../platform/runtime/currency';
import { formatMoney } from '../../../../platform/runtime/owner-format';
import { resetCountry } from './fake-country-plan';
import {youtubeService} from '../../../../platform/runtime/venture/playbooks/youtube/offers2';
import {fakeYoutubeServiceIntake} from './fake-youtube-plan';
import { fakeCaPlan, fakeCaForIdea } from './fake-ca-plan';
import { withPriceGuide } from './fake-price-ranges';
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
  EngineError, type BackupInspectLite, type BackupLite, type BlueprintLite, type BlueprintViewLite, type BuilderId, type BuildStatusView, type BusinessOnComputer,
  type CustodyViewLite, type ModelPresetLite, type ModelStatusLite, type ModelTier, type MoveFile, type OfferLite, type PlaybookPick, type PricingModel, type QueueRow, type ReceiptLite, type VentureRunEvent,
} from './types';

const clone = <T>(value: T): T => structuredClone(value);

export interface DeskHost {
  quote?(quote: import('./fake-pipeline').HeldPipelineQuote): void;
  country?(id: string): { code: string; currency: string };
  acceptCountry?(id: string, code: string): void;
  current(): string;
  orders?(): {id:string;offerId:string;status:string}[];
  /** B4 task 7: the invoices of the open business, so an accepted price knows it was billed. */
  invoices?(): {id:string;orderId:string}[];
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
  /** C5 task 19: how big the open business is. */
  storeBytes?(): number;
  /** C5 task 20: what the owner last decided. */
  lastDecided?(): string | null;
  /** 4H2: whether this answers as the hosted web server. */
  hosted?(): boolean;
  /** W6 6C1: whether the sample Codex says it is signed in (fake-first-run.ts). */
  codexSignedIn?(): boolean;
  /** A3 (L1): the sample Codex as the engine's availability reads it: a setup in use, its own sign-in, its version. */
  codexLook?(): { trusted: boolean; signedIn: 'yes' | 'no'; version: string | null };
}

const DESK_METHODS = new Set([
  'venture.models.presets', 'venture.models.status', 'venture.models.connect', 'venture.models.disconnect',
  'venture.ai.options', 'venture.ai.status', 'venture.ai.connect', 'venture.ai.disconnect',
  'venture.blueprint.get', 'venture.blueprint.update', 'venture.price.quote',
  'venture.build.brief', 'venture.build.briefFile', 'venture.build.handoff', 'venture.build.handoffOpened', 'venture.build.link', 'venture.build.sync', 'venture.build.status',
  'workspace.custody.get', 'workspace.custody.recoveryCode', 'workspace.custody.passphraseOn', 'workspace.custody.passphraseOff',
  'workspace.backups.list', 'workspace.backups.create', 'workspace.backups.restore', 'workspace.backups.inspect', 'workspace.transfer.export', 'workspace.export',
  'workspace.backups.drive.status', 'workspace.backups.drive.connect', 'workspace.backups.drive.disconnect',
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

/** views/queue-actions.ts ACTION_WORDS, word for word. */
const FAKE_PRICE_WORDS = {
  back: (offer: string) => `You took back the new price for ${offer}.`,
  inUse: 'Too late to undo: this price is already in use.',
  planUndo: 'Your plan change is still a draft in the business menu. Accept it there.',
} as const;

/** The offers whose price or share differs between two versions (views/price-only.ts changedPrices). */
function changedPrices(from: BlueprintLite, to: BlueprintLite): OfferLite[] {
  return to.offers.filter((offer) => {
    const before = from.offers.find((item) => item.id === offer.id);
    return (before?.pricing.unitPriceMinor ?? null) !== offer.pricing.unitPriceMinor || (before?.pricing.share?.bps ?? null) !== (offer.pricing.share?.bps ?? null);
  });
}

/** B4 task 7: one price accepted on one press, and what its Undo needs. */
interface PricePress {
  businessId: string; blueprintId: string; offer: string; offerName: string; before: BlueprintViewLite;
  shown: readonly (readonly [string, string | undefined])[]; quoted: boolean; orders: readonly string[]; invoices: readonly string[];
}

export class FakeBusinessDesk {
  private readonly host: DeskHost;
  private readonly presses = new Map<string, PricePress>();
  /** Rows accepted that asked more than one price: their Undo is refused (views/queue-actions.ts planUndo). */
  private readonly planPresses = new Set<string>();
  private models: Record<string, ModelStatusLite>;
  private draftAi: ModelStatusLite;
  private blueprints: Record<string, BlueprintViewLite>;
  private accepted: Record<string, BlueprintViewLite> = {};
  private builds: Record<string, BuildStatusView>;
  private receipts: ReceiptLite[];
  /** What each priced offer costs, as the engine would show it, by business and offer. */
  private prices: Record<string, string> = { 'lumen:offer_sponsor': '₹15,000', 'ledgerline:offer_books': '₹16,000', 'ledgerline:offer_gst': '₹5,000' };
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
    const country = prior?.blueprint.country;
    if (country) {
      // A rewritten plan keeps the owner's prices and tax choices from its latest country draft.
      view.blueprint.country = clone(country);
      view.blueprint.backOffice = clone(prior.blueprint.backOffice);
      view.blueprint.starterConnectorIds = clone(prior.blueprint.starterConnectorIds);
      for (const offer of view.blueprint.offers) {
        const before = prior.blueprint.offers.find(item => item.id === offer.id);
        if (before) offer.pricing = clone(before.pricing);
        else offer.pricing = { model: offer.pricing.model, quantityUnit: offer.pricing.quantityUnit, unitPriceMinor: null, unitPriceLabel: 'not-set', defaultQuantity: '1' };
      }
      view.offerReceipts = Object.fromEntries(view.blueprint.offers.map(offer => [offer.id, null]));
      view.blueprint.digest = this.host.digest({ ...view.blueprint, digest: '' });
    }
    this.blueprints[businessId] = clone(view);
  }

  /** The queue accepted a plan row: that version becomes the accepted plan. */
  accept(businessId: string, blueprintId: string): void {
    const view = this.blueprints[businessId];
    if (!view || view.blueprint.id !== blueprintId) return;
    view.blueprint.status = 'accepted';
    if (view.blueprint.country) this.host.acceptCountry?.(businessId, view.blueprint.country.code);
    this.keepAccepted(businessId, view);
  }

  /**
   * B4 task 7, as views/price-only.ts priceOnlyOffer: the one offer whose price is all that changed between two versions,
   * or null when anything else did. Two prices, or a price with any other change, keep the second ask.
   */
  private priceOnly(from: BlueprintLite, to: BlueprintLite): OfferLite | null {
    const changed = changedPrices(from, to);
    if (changed.length !== 1) return null;
    const saying = (plan: BlueprintLite, offerId: string) => {
      const { id: _id, at: _at, digest: _digest, status: _status, version: _version, source: _source, country: _country, ...rest } = plan;
      return { ...rest, offers: rest.offers.map((offer) => {
        if (offer.id !== offerId) return offer;
        const { unitPriceMinor: _minor, unitPriceLabel: _label, share: _share, ...pricing } = offer.pricing;
        return { ...offer, pricing };
      }) };
    };
    const [offer] = changed as [OfferLite];
    return this.host.digest(saying(from, offer.id)) === this.host.digest(saying(to, offer.id)) ? offer : null;
  }

  /** What the press on this row put aside, so its Undo restores it: taken before the plan row is accepted. */
  pressed(rowId: string, businessId: string, blueprintId: string): boolean {
    const view = this.blueprints[businessId];
    const before = this.accepted[businessId];
    const offer = view && before && view.blueprint.id === blueprintId ? this.priceOnly(before.blueprint, view.blueprint) : null;
    if (!offer) { this.planPresses.add(rowId); return false; }
    this.presses.set(rowId, {
      businessId, blueprintId, offer: offer.id, offerName: offer.name.value, before: clone(before!),
      shown: before!.blueprint.offers.map((item) => [item.id, this.prices[`accepted:${businessId}:${item.id}`]] as const),
      quoted: false, ...this.usesNow(offer.id),
    });
    return true;
  }

  /** The orders and invoices of an offer so far (the engine reads their places in its record list). */
  private usesNow(offerId: string): { orders: readonly string[]; invoices: readonly string[] } {
    const orders = (this.host.orders?.() ?? []).filter((order) => order.offerId === offerId).map((order) => order.id);
    return { orders, invoices: (this.host.invoices?.() ?? []).filter((invoice) => orders.includes(invoice.orderId)).map((invoice) => invoice.id) };
  }

  /**
   * B4 task 7, as views/queue-actions.ts undoPriceAccept: the plan goes back to the previous version; this one is a draft
   * again, so the same row comes back to decide anew. Null for a row with no such press, which the approvals desk answers.
   */
  undoPress(rowId: string): { restored: true; line: string; subject: string } | null {
    if (this.planPresses.has(rowId)) throw new EngineError('UNDO_NOTHING', FAKE_PRICE_WORDS.planUndo);
    const press = this.presses.get(rowId);
    if (!press) return null;
    const view = this.blueprints[press.businessId];
    const uses = this.usesNow(press.offer);
    const later = (now: readonly string[], then: readonly string[]) => now.some((id) => !then.includes(id));
    if (!view || view.blueprint.id !== press.blueprintId || press.quoted || later(uses.orders, press.orders) || later(uses.invoices, press.invoices)) {
      throw new EngineError('UNDO_TOO_LATE', FAKE_PRICE_WORDS.inUse);
    }
    this.presses.delete(rowId);
    view.blueprint.status = 'draft';
    this.accepted[press.businessId] = clone(press.before);
    for (const [offerId, shown] of press.shown) {
      if (shown === undefined) delete this.prices[`accepted:${press.businessId}:${offerId}`];
      else this.prices[`accepted:${press.businessId}:${offerId}`] = shown;
    }
    return { restored: true, line: FAKE_PRICE_WORDS.back(press.offerName), subject: `plan:${press.businessId}` };
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
    const presets = clone(MODEL_PRESETS).map((preset) => (preset.id === 'codex-cli' ? { ...preset, ...this.codexAvailability(preset) } : preset));
    if (!this.host.hosted?.()) return presets;
    return presets.map((preset) => (preset.runsOn === 'this-computer'
      ? { ...preset, availability: 'unavailable' as const, availabilityReason: 'Runs only in the desktop app, on your own computer. The hosted web app uses keys only.' }
      : preset));
  }

  /**
   * A3 (L1), as models/presets.ts availabilityOf words Codex: with no setup in use it needs setup (codexMissing, the
   * fixture's words); a setup in use whose own look says signed out needs setup in the engine's signed-out words
   * (cliSignedOutWords); a setup in use and signed in is unverified (codexReady) until a real task worked.
   */
  private codexAvailability(preset: ModelPresetLite): Pick<ModelPresetLite, 'availability' | 'availabilityReason'> {
    const look = this.host.codexLook?.();
    if (!look?.trusted) return { availability: preset.availability, availabilityReason: preset.availabilityReason };
    if (look.signedIn === 'no') {
      const named = look.version ? `Codex ${look.version}` : 'Codex';
      return { availability: 'needs-setup', availabilityReason: `${named} is on this computer but not signed in. Open a terminal, run codex login, then check again.` };
    }
    return { availability: 'unverified', availabilityReason: 'Uses the reviewed Codex install.' };
  }

  request(method: string, p: Record<string, unknown>): unknown {
    const biz = this.host.current();
    switch (method) {
      case 'venture.models.presets': return this.presets();
      case 'venture.models.status': return clone(this.modelsOf(biz));
      case 'venture.models.connect': return this.connect(this.modelsOf(biz), p, biz);
      case 'venture.models.disconnect': return this.disconnect(this.modelsOf(biz), p, biz);
      case 'venture.ai.options': return { presets: this.presets(), status: clone(this.draftAi), unchecked: true };
      case 'venture.ai.status': return clone(this.draftAi);
      case 'venture.ai.connect': return this.connect(this.draftAi, p, null);
      case 'venture.ai.disconnect': return this.disconnect(this.draftAi, p, null);
      // W6 6C3: every plan view carries its profession's price guide, as the engine's blueprintView adds it.
      case 'venture.blueprint.get': { const view = this.blueprints[biz]; return view ? withPriceGuide(clone(view), this.host.country?.(biz).code ?? 'IN') : null; }
      case 'venture.blueprint.update': return withPriceGuide(this.update(biz, p.patch, p.basedOn, p.ownerSave === true ? true : undefined), this.host.country?.(biz).code ?? 'IN');
      case 'venture.price.quote': return this.quote(biz, p);
      case 'venture.build.status': {
        const build = this.buildOf(biz);
        // The real Replit limit reads the compressed link (build/handoff.ts); the sample's briefs are short and always fit.
        return clone({ ...build, linkFits: build.brief ? { lovable: true, replit: true } : null });
      }
      case 'venture.build.brief': return this.brief(biz);
      case 'venture.build.handoff': return this.handoff(biz, p.builder);
      case 'venture.build.briefFile': return this.briefFile(biz, p.builder);
      case 'venture.build.handoffOpened': {
        const handoff = this.buildOf(biz).handoffs.find((h) => h.id === p.handoffId);
        if (!handoff) throw new EngineError('HANDOFF_NOT_FOUND', 'This copy is not on this computer.');
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
      // C5 task 24: the rehearsal has no Google client, as a build has none until the founder registers one.
      case 'workspace.backups.drive.status': case 'workspace.backups.drive.connect': case 'workspace.backups.drive.disconnect':
        throw new EngineError('DRIVE_NOT_SET_UP', "Google Drive needs Chausar's Google sign-in set up first. Until then, pick your Google Drive folder under Keep a copy on a drive.");
      case 'workspace.backups.inspect': return this.inspectBackup(biz, p);
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
        const path = `/Users/you/Chausar/exports/chausar-${biz}-${++this.seq}.${plaintext ? 'json' : 'vault'}`;
        (this.exports[biz] ??= []).push(path);
        return { path, name: path.split('/').pop()!, encrypted: !plaintext };
      }
      default: throw new EngineError('METHOD_NOT_ALLOWED', 'The sample business can\'t do that yet.');
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Your AI
  // ---------------------------------------------------------------------------------------------------------------

  private modelsOf(biz: string): ModelStatusLite {
    this.models[biz] ??= clone(DRAFT_AI_STATUS);
    return this.models[biz];
  }

  /**
   * venture.create's handover (core/venture.ts, draft/handover.ts): the AI connected before the vault comes into the
   * new business, connected connections only, and the draft desk is wiped. Nothing connected: nothing changes.
   */
  /** A4 fix round, as models/ai-setup.ts: the business that last connected Codex or Claude Code, the newest setup. */
  private lastCli: string | null = null;

  /**
   * A4 fix round (core/venture.ts reuseAi): with no AI from the first run, the newest Codex or Claude Code connection of
   * another business comes into this one (its preset, model and jobs; no key, call or consent). Answers where it came
   * from, or null.
   */
  reuseAi(biz: string): string | null {
    if (this.draftAi.connections.some((c) => c.status === 'connected') || !this.lastCli || this.lastCli === biz) return null;
    const from = this.lastCli;
    const carried = this.modelsOf(from).connections.filter((c) => c.status === 'connected' && (c.presetId === 'codex-cli' || c.presetId === 'claude-code-cli'));
    // A4 review round 2 (H2): every AI passes connect's gates now, with the agreement and its time from there.
    const presets = this.presets();
    if (!carried.length || carried.some((c) => { const preset = presets.find((x) => x.id === c.presetId); return !preset || preset.availability === 'unavailable' || preset.availability === 'needs-setup'; })) return null;
    const state = this.modelsOf(biz);
    for (const connection of carried) state.connections.push({ ...clone(connection), id: `mc-${biz}-${++this.seq}` });
    this.retier(state);
    return from;
  }

  /** A4 review round 2 (M2): workspace.delete clears the setup the deleted business saved. */
  forgetAiSetup(biz: string): void { if (this.lastCli === biz) this.lastCli = null; }

  adoptDraft(biz: string): void {
    const connected = this.draftAi.connections.filter((c) => c.status === 'connected');
    if (connected.length) {
      const state = this.modelsOf(biz);
      for (const connection of connected) state.connections.push({ ...clone(connection), id: `mc-${biz}-${++this.seq}` });
      this.retier(state);
    }
    this.draftAi = clone(DRAFT_AI_STATUS);
  }

  /**
   * Today's AI setup row, as views/queue.ts aiState decides it: 'none' while templates serve both tiers, a reason
   * when a connected AI cannot be used now, null when an AI serves the business.
   */
  aiState(biz: string): { kind: 'none' } | { kind: 'attention'; reason: string } | null {
    const { tiers } = this.modelsOf(biz);
    if (tiers.main.presetId === 'built-in-templates' && tiers.fast.presetId === 'built-in-templates') return { kind: 'none' };
    const broken = [tiers.main, tiers.fast].find((tier) => tier.presetId !== 'built-in-templates' && !tier.usable);
    return broken ? { kind: 'attention', reason: broken.reason } : null;
  }

  private connect(state: ModelStatusLite, p: Record<string, unknown>, biz: string | null): ModelStatusLite {
    const preset = this.presets().find((x) => x.id === p.presetId);
    if (!preset) throw invalid('Choose one of the listed AI options.');
    if (p.consentDigest !== preset.consentDigest) throw new EngineError('MODEL_CONSENT_REQUIRED', 'Read what is sent and agree to it first.');
    const key = typeof p.apiKey === 'string' ? p.apiKey.trim() : '';
    if (preset.needsKey && !key) throw new EngineError('MODEL_KEY_MISSING', 'Paste your key first.');
    if (!preset.needsKey && p.apiKey !== undefined) throw invalid('This option takes no key.');
    let model = preset.model;
    if (p.model !== undefined) {
      if (!preset.modelEditable) throw invalid('This option has a fixed model.');
      if (typeof p.model !== 'string' || !(preset.id === 'openrouter' ? /^~?[a-z0-9][a-z0-9._-]{0,63}\/[a-z0-9][a-z0-9._:-]{0,127}$/ : /^[a-z0-9][a-z0-9.-]{1,63}$/).test(p.model)) throw invalid('Type the model id your account shows, in lower case, like gpt-6-luna.');
      model = p.model;
    }
    if (preset.availability === 'unavailable' || preset.availability === 'needs-setup') throw new EngineError('PRESET_UNAVAILABLE', preset.availabilityReason);
    if (p.monthlyCapUsd !== undefined) {
      const cap = typeof p.monthlyCapUsd === 'string' ? /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(p.monthlyCapUsd.trim()) : null;
      if (!cap || BigInt(cap[1]!) * 100n + BigInt((cap[2] ?? '').padEnd(2, '0')) < 1n) throw new EngineError('INVALID_AMOUNT', 'Monthly limit must be an amount in US dollars with at most two decimals, like 20 or 12.50.');
    }
    const asked = Array.isArray(p.tiers) ? (p.tiers as unknown[]).filter((t): t is ModelTier => t === 'fast' || t === 'main') : [];
    const tiers = asked.length > 0 ? asked : [...preset.tiers];
    // The key is checked and dropped: the sample keeps only that one is loaded, never the key itself.
    state.connections.push({
      id: `mc-${biz ?? 'draft'}-${++this.seq}`, presetId: preset.id, model, tiers, status: 'connected', consentedAt: this.host.now(),
      keyLoaded: preset.needsKey, usable: true, reason: preset.availabilityReason, verificationNote: preset.verificationNote ?? null,
    });
    this.retier(state);
    if (biz && (preset.id === 'codex-cli' || preset.id === 'claude-code-cli')) this.lastCli = biz;
    if (biz && preset.kind !== 'template') {
      // Today's "Connect your AI" leaves once an AI serves the business.
      for (const row of this.host.rows()) if (row.businessId === biz && row.kind === 'setup' && row.actions.some((a) => a.id === 'connect')) this.host.settle(row.id);
      this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    }
    return clone(state);
  }

  private disconnect(state: ModelStatusLite, p: Record<string, unknown>, biz: string | null): ModelStatusLite {
    const connection = state.connections.find((c) => c.id === p.connectionId && c.status === 'connected');
    if (!connection) throw invalid('No such AI connection.');
    Object.assign(connection, { status: 'disconnected', usable: false, keyLoaded: false, reason: 'Disconnected.' });
    this.retier(state);
    // A4 review round 2 (M2): the setup this business saved goes with its last Codex or Claude Code connection.
    if (biz && this.lastCli === biz && !state.connections.some((c) => c.status === 'connected' && (c.presetId === 'codex-cli' || c.presetId === 'claude-code-cli'))) this.lastCli = null;
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

  private update(biz: string, raw: unknown, basedOn?: unknown, ownerSave?: true): BlueprintViewLite {
    const view = this.planOf(biz);
    const patch = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
    if (Object.keys(patch).length === 0) throw invalid('Change at least one thing.');
    // 4J8: a suggestion's patch is bound to the plan it read (core/blueprint.ts blueprintUpdate).
    if (basedOn !== undefined) {
      const bound = (basedOn && typeof basedOn === 'object' ? basedOn : {}) as Record<string, unknown>;
      if (typeof bound.blueprintId !== 'string' || typeof bound.digest !== 'string') throw invalid('Look at the plan again first.');
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
    const beforeCountry = next.country ?? countryProfile(this.host.country?.(biz).code ?? 'IN');
    const country = patch.countryCode === undefined ? beforeCountry : countryProfile(patch.countryCode);
    if (country.code !== beforeCountry.code) {
      resetCountry(next, country.code, beforeCountry.code);
    }
    next.country = country;
    // C5 task 13 (core/blueprint.ts applyTaxPatch, core/tax-fields.ts): I charge GST, its rate and the GSTIN.
    if (patch.taxRegistered !== undefined) {
      if (typeof patch.taxRegistered !== 'boolean') throw invalid('Say yes or no to charging tax.');
      next.backOffice.taxRegistered = { value: patch.taxRegistered, label: 'told-by-you', by: 'owner' };
      if (!patch.taxRegistered) { next.backOffice.taxRateBps = '0'; next.backOffice.taxRateBy = 'not-registered'; }
    }
    if (patch.taxRate !== undefined) {
      if (!next.backOffice.taxRegistered.value) throw new EngineError('INVALID_TAX_RATE', 'Turn tax on before you set a rate.');
      const match = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(String(patch.taxRate).trim());
      if (!match) throw new EngineError('INVALID_TAX_RATE', 'Type the rate as a percent, like 18.');
      next.backOffice.taxRateBps = String(Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0')));
      next.backOffice.taxRateBy = 'told-by-you';
    }
    if (patch.taxId !== undefined) {
      const cleaned = patch.taxId === null ? null : String(patch.taxId).toUpperCase().replace(/\s+/g, '');
      if (cleaned !== null && !/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(cleaned)) throw new EngineError('INVALID_TAX_ID', 'Check your GSTIN.');
      next.backOffice.taxId = cleaned;
    }
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
        const digits = currencyMinorDigits(country.currency);
        if (!new RegExp('^\\d{1,9}' + (digits ? '(\\.\\d{1,' + digits + '})?' : '') + '$').test(typed) || /^0+(\.0+)?$/.test(typed)) throw new EngineError('INVALID_AMOUNT', 'Type a positive price using the currency’s decimal places.');
        offer.pricing.unitPriceMinor = decimalMinor(typed, country.currency);
        offer.pricing.unitPriceLabel = 'told-by-you';
        typedPrices[offer.id] = formatMoney(offer.pricing.unitPriceMinor, country.currency);
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
    // One-shot A1 (row 3), as core/blueprint.ts: words the owner wrote make the plan theirs; a price changes no words.
    const offerWords = Array.isArray(patch.offers) && (patch.offers as Record<string, unknown>[]).some((change) => change && (change.name !== undefined || change.description !== undefined));
    if (patch.name !== undefined || patch.oneLiner !== undefined || patch.customer !== undefined || offerWords || patch.addOffer !== undefined) next.source = 'owner';
    next.digest = this.host.digest({ ...next, digest: '' });
    if (country.code !== beforeCountry.code) for (const offer of next.offers) delete this.prices[`${biz}:${offer.id}`];
    for (const [offerId, display] of Object.entries(typedPrices)) this.prices[`${biz}:${offerId}`] = display;
    // Receipts belong to a version: a new version has none until it is priced again.
    this.blueprints[biz] = {
      blueprint: next, offerReceipts: Object.fromEntries(next.offers.map((o) => [o.id, null])),
      ...(view.playbook ? { playbook: view.playbook } : {}), ...(view.intake ? { intake: {...clone(view.intake),...Object.fromEntries(next.offers.filter(offer=>offer.addedByOwner&&offer.playbookOffer&&view.playbook?.id==='youtube').map(offer=>[offer.id,fakeYoutubeServiceIntake(offer.playbookOffer!,!!this.host.hosted?.())]))} } : {}),
    };
    // C4 task 33, as core/owner-price.ts: the owner's own price on an accepted plan applies at once, with an Undo.
    const decided = ownerSave === true ? this.ownerPrice(biz, patch, basedOn, view.blueprint, next) : null;
    if (decided) {
      this.accept(biz, next.id);
      this.host.setRows(this.host.rows().filter((r) => !(r.businessId === biz && r.viewRef?.kind === 'plan')));
      this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
      return { ...clone(this.blueprints[biz]!), decided };
    }
    this.planRow(biz, next);
    this.host.emit({ type: 'queue.changed', businessId: biz, at: this.host.now() });
    return clone(this.blueprints[biz]!);
  }

  /** C4 task 33: the owner's applied prices by Undo row id, with what it puts back and what counts as a use. */
  private ownPrices = new Map<string, { biz: string; appliedId: string; before: BlueprintViewLite; shown: Record<string, string | undefined>; names: string[]; orders: number; used: boolean; undone: boolean }>();

  private ownerPrice(biz: string, patch: Record<string, unknown>, basedOn: unknown, latest: BlueprintLite, next: BlueprintLite): { line: string; undoRowId: string } | null {
    const accepted = this.accepted[biz]?.blueprint;
    const shape = basedOn === undefined && Object.keys(patch).length === 1 && Array.isArray(patch.offers)
      && (patch.offers as unknown[]).every((change) => !!change && typeof change === 'object' && Object.keys(change).every((key) => key === 'id' || key === 'unitPrice') && Object.hasOwn(change, 'unitPrice'));
    if (!shape || !accepted || latest.status !== 'accepted' || accepted.id !== latest.id) return null;
    const changes = next.offers.filter((offer) => (latest.offers.find((item) => item.id === offer.id)?.pricing.unitPriceMinor ?? null) !== offer.pricing.unitPriceMinor);
    if (!changes.length) return null;
    const unit: Record<string, string> = { month: 'a month', project: 'a project', hour: 'an hour' };
    const words = (offer: OfferLite) => `${offer.pricing.unitPriceMinor === null ? 'no price' : formatMoney(offer.pricing.unitPriceMinor, next.backOffice.currency)} ${unit[offer.pricing.quantityUnit] ?? `per ${offer.pricing.quantityUnit}`}`;
    const names = changes.map((offer) => offer.name.value);
    const listed = names.length === 1 ? names[0]! : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
    const undoRowId = `price-set:${biz}:${next.id}`;
    const orders = (this.host.orders?.() ?? []).filter((order) => changes.some((offer) => offer.id === order.offerId)).length;
    const shown = Object.fromEntries(accepted.offers.map((offer) => [offer.id, this.prices[`accepted:${biz}:${offer.id}`]]));
    this.ownPrices.set(undoRowId, { biz, appliedId: next.id, before: clone(this.accepted[biz]!), shown, names, orders, used: false, undone: false });
    return { line: changes.length === 1 ? `You set the price of ${listed} to ${words(changes[0]!)}.` : `You set new prices for ${listed}.`, undoRowId };
  }

  /** venture.queue.undo for an owner's price (fake.ts routes it here): puts back exactly the version before. */
  undoOwnerPrice(rowId: string): { restored: boolean; line: string } {
    const own = this.ownPrices.get(rowId);
    if (!own || own.undone) throw new EngineError('UNDO_NOTHING', 'Nothing to undo here.');
    const now = this.blueprints[own.biz];
    const orders = (this.host.orders?.() ?? []).filter((order) => own.before.blueprint.offers.some((offer) => offer.id === order.offerId && own.names.includes(offer.name.value))).length;
    if (!now || now.blueprint.id !== own.appliedId || own.used || orders > own.orders) throw new EngineError('UNDO_TOO_LATE', 'Too late to undo: the new price is in use or the plan changed since.');
    const restored = clone(own.before);
    restored.blueprint.version = now.blueprint.version + 1;
    restored.blueprint.id = `bp-${own.biz}-${restored.blueprint.version}`;
    restored.blueprint.at = this.host.now();
    restored.blueprint.status = 'accepted';
    restored.blueprint.digest = this.host.digest({ ...restored.blueprint, digest: '' });
    restored.offerReceipts = Object.fromEntries(restored.blueprint.offers.map((o) => [o.id, null]));
    for (const offer of restored.blueprint.offers) {
      const shown = own.shown[offer.id];
      delete this.prices[`${own.biz}:${offer.id}`];
      if (shown) this.prices[`${own.biz}:${offer.id}`] = shown;
    }
    this.blueprints[own.biz] = restored;
    own.undone = true;
    this.accept(own.biz, restored.blueprint.id);
    this.host.emit({ type: 'queue.changed', businessId: own.biz, at: this.host.now() });
    const listed = own.names.length === 1 ? own.names[0]! : `${own.names.slice(0, -1).join(', ')} and ${own.names.at(-1)}`;
    return { restored: true, line: `You took back the new price${own.names.length === 1 ? '' : 's'} for ${listed}.` };
  }

  private priceText(offer: OfferLite | undefined, key: string): string {
    // 5A2: a share reads as the engine's shareWords ("8.33% of the amount your client confirms").
    if (offer?.pricing.share) {
      const bps = offer.pricing.share.bps.padStart(3, '0');
      const fraction = bps.slice(-2).replace(/0+$/, '');
      return `${bps.slice(0, -2).replace(/^0+(?=\d)/, '')}${fraction ? `.${fraction}` : ''}% of the amount your client confirms`;
    }
    if (!offer || offer.pricing.unitPriceMinor === null) return 'Not set';
    return `${this.prices[key] ?? formatMoney(offer.pricing.unitPriceMinor, 'INR')} per ${offer.pricing.quantityUnit}`;
  }

  /** The engine's plan row (views/queue.ts planRows): one per business, for the latest draft version. */
  private planRow(biz: string, latest: BlueprintLite): void {
    const rows = this.host.rows().filter((r) => !(r.businessId === biz && r.viewRef?.kind === 'plan'));
    const accepted = this.accepted[biz]?.blueprint;
    const base = { id: `q-plan-${biz}-v${latest.version}`, businessId: biz, businessName: this.host.businessName(biz), createdAt: latest.at, line: latest.oneLiner.value, viewRef: { kind: 'plan' as const, id: latest.id } };
    let seed: Omit<QueueRow, 'digest'>;
    // 5A2: setting or changing a share is a price change too.
    const changes = accepted ? changedPrices(accepted, latest) : [];
    if (!accepted) {
      seed = { ...base, kind: 'plan', title: 'Your plan is ready. Read it.', actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }] };
    } else if (changes.length === 0) {
      seed = { ...base, kind: 'plan', title: 'Your plan changed. Read it, then accept it.', actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, requiresView: true }] };
    } else {
      const [first, ...rest] = changes as [OfferLite, ...OfferLite[]];
      seed = {
        ...base, kind: 'price', title: changes.length === 1 ? `New price for ${first.name.value}` : 'New prices in your plan',
        line: rest.length ? `Also changes ${rest.map((o) => o.name.value).join(', ')}.` : 'Accept the plan to use it on new orders and invoices.',
        change: { label: first.name.value, before: this.priceText(accepted.offers.find((a) => a.id === first.id), `accepted:${biz}:${first.id}`), after: this.priceText(first, `${biz}:${first.id}`), ownerEntered: true },
        // B4 task 7: one price and nothing else is one press on the price the row shows.
        actions: [{ id: 'read', label: 'Read', primary: false }, { id: 'approve', label: 'Accept', primary: true, ...(this.priceOnly(accepted!, latest) ? {} : { secondAsk: true }) }],
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
    const showMinor = (minor: bigint) => formatMoney(minor, view.blueprint.backOffice.currency);
    // B2: a sample figure reads in the owner form, so paise show only when it has some ("₹15,000", "₹15,000.50").
    const readSampleMinor = (display: string) => {
      const found = /(\d[\d,]*)(?:\.(\d{2}))?/.exec(display);
      return found ? BigInt(`${found[1]!.replace(/,/g, '')}${found[2] ?? '00'}`) : 0n;
    };
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
        ? `${offer.name.value} at ${display}. GST is not included in this sample.`
        : `${offer.name.value} at ${display}, no discount, no tax added, because tax is not turned on for this price.`,
    };
    this.receipts.push(receipt);
    // B4 task 7: a quote after the press uses the price, so its Undo is too late (views/price-only.ts priceInUse).
    for (const press of this.presses.values()) if (press.businessId === biz && press.offer === offer.id) press.quoted = true;
    // C4 task 33: a quote at another quantity than the usual one uses the owner's new price, so its Undo leaves.
    if (quantityText !== offer.pricing.defaultQuantity) for (const own of this.ownPrices.values()) if (own.biz === biz && own.appliedId === view.blueprint.id) own.used = true;
    this.host.quote?.({ receiptId: receipt.id, at: receipt.at, offer: offer.name.value, quantity: quantityText, value: showMinor(unit * quantity), currency: view.blueprint.backOffice.currency, beforeTaxMinor: String(unit * quantity), explanation: receipt.explanation });
    view.offerReceipts[offer.id] = receipt;
    // B3: as the engine's price-quoted, one queue.changed tells every screen.
    this.host.emit({ type: 'queue.changed', businessId: biz, at: receipt.at });
    return clone(receipt);
  }
  // ---------------------------------------------------------------------------------------------------------------
  // Keeping the business: this computer's key, the recovery code, the optional passphrase, backups
  // ---------------------------------------------------------------------------------------------------------------

  private backups: Record<string, BackupLite[]> = {};
  private exports: Record<string, string[]> = {};
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

  /** One-shot A1 (row 1): the copies the owner exported for this business, which Delete keeps. */
  exportsOf(biz: string): string[] {
    return [...(this.exports[biz] ?? [])].sort();
  }

  private addBackup(biz: string, kind: BackupLite['kind']): BackupLite {
    const backup: BackupLite = { file: `chausar-${biz}-${++this.seq}.backup`, kind, at: this.host.now(), revision: this.seq, bytes: 48_211, name: this.host.businessName(biz), opensNow: true, ...(this.host.lastDecided?.() ? { after: this.host.lastDecided!()! } : {}) };
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

  /**
   * One-shot C6, workspace.backups.inspect: the same checks as a restore, then what the backup holds and what changed
   * since, from the sample's own snapshots: the samples carry fixed contents; a copy made in this session holds the
   * newest sample's contents with nothing changed since.
   */
  private inspectBackup(biz: string, p: Record<string, unknown>): BackupInspectLite {
    const backup = this.backupsOf(biz).find((b) => b.file === p.file);
    if (!backup) {
      const elsewhere = Object.entries(this.backups).some(([other, list]) => other !== biz && list.some((b) => b.file === p.file));
      throw elsewhere ? new EngineError('BACKUP_OTHER_BUSINESS', CUSTODY_ERROR_WORDS.BACKUP_OTHER_BUSINESS) : new EngineError('BACKUP_NOT_FOUND', CUSTODY_ERROR_WORDS.BACKUP_NOT_FOUND);
    }
    const count = (kind: string, n: number) => ({ kind, words: kind, count: n });
    const change = (kind: string, added: number, changed: number, removed = 0) => ({ kind, words: kind, added, changed, removed });
    // In the engine's order (venture/views/backup-diff.ts BACKUP_KIND_WORDS).
    const counts = [count('clients', 3), count('orders', 12), count('invoices', 4), count('payments', 3)];
    const sample: Record<string, BackupInspectLite['since']> = {
      auto: [change('clients', 0, 1), change('orders', 2, 0), change('invoices', 1, 0)],
      safety: [change('clients', 1, 1), change('orders', 3, 1), change('invoices', 1, 1)],
      manual: [change('clients', 1, 1), change('orders', 5, 2), change('invoices', 2, 1), change('payments', 1, 0)],
    };
    const fromSample = backup.file === `chausar-${biz}-${backup.kind}.backup`;
    return { file: backup.file, at: backup.at, counts, since: fromSample ? clone(sample[backup.kind] ?? []) : [] };
  }

  /** workspace.transfer.export: one file and one code. A business locked with a passphrase needs it. */
  /** C4 task 38: when a move file was made, by business, until the owner dismisses the line. */
  private moveMade: Record<string, string | null> = {};

  private moveFile(biz: string, p: Record<string, unknown>): MoveFile | { dismissed: true } {
    if (Object.hasOwn(p, 'dismiss')) {
      if (p.dismiss !== true || Object.keys(p).length !== 1) throw new EngineError('INVALID_REQUEST', 'Send dismiss: true to take the line away.');
      this.moveMade[biz] = null;
      return { dismissed: true };
    }
    const held = this.heldOrThrow(biz);
    if (held.opens === 'needs-passphrase' && !(typeof p.passphrase === 'string' && p.passphrase === held.passphrase)) throw new EngineError('PASSPHRASE_WRONG', CUSTODY_ERROR_WORDS.PASSPHRASE_WRONG);
    const madeAt = this.host.now();
    this.moveMade[biz] = madeAt;
    const text = JSON.stringify({ backupFormat: SAMPLE_MOVE_FORMAT, business: biz, name: this.host.businessName(biz), madeAt });
    // A4 review (L3): named by this computer's own date, as the engine's moveFileName.
    const at = new Date(madeAt), day = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`;
    return { fileName: `chausar-move-${day}.chausar-move`, text, transferCode: SAMPLE_MOVE_CODE, bytes: text.length };
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
        backups: { auto: true, count: backups.length, newestAt: backups[0]?.at ?? null, nextDueAt: null, lastError: null, copy: null },
        storeBytes: this.host.storeBytes?.() ?? 4_300_000, storeLimit: 32 * 1024 * 1024,
        // C4 task 36, as the engine: the name the desktop's save dialog offers.
        exportName: exportFileName(this.host.businessName(biz), new Date(this.host.now()), 'Asia/Kolkata', false),
        // C4 task 37: the copies in Chausar's own exports folder.
        exportsHere: (this.exports[biz] ?? []).length,
        // C4 task 38: the move file made, until dismissed.
        moveMadeAt: this.moveMade[biz] ?? null,
      },
    };
  }

  private heldOrThrow(biz: string) {
    const held = this.host.business(biz);
    if (!held) throw new EngineError('VAULT_LOCKED', 'This business is closed. Open it first.');
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

  /** C5 task 35: the same gates and shapes as the engine (build/handoff.ts). */
  private briefFile(biz: string, builder: unknown) {
    if (builder !== 'lovable' && builder !== 'replit') throw invalid('Choose Lovable or Replit.');
    const build = this.buildOf(biz);
    const brief = build.brief;
    if (!brief) throw new EngineError('BRIEF_NOT_FOUND', 'Write the build brief first.');
    if (!brief.lint.ok) throw new EngineError('BRIEF_LINT_FAILED', brief.lint.findings[0]?.message ?? 'The brief did not pass its checks.');
    const handoffId = `ho-${biz}-${++this.seq}`;
    build.handoffs.unshift({ id: handoffId, at: this.host.now(), builder, mode: 'file', openedAt: null });
    const note = `chausar-brief-id: ${brief.briefId}\nMoney numbers come from Chausar. Do not compute totals or tax.\n`;
    return { handoffId, builder, files: [{ name: 'website-brief.md', text: brief.markdown }, { name: builder === 'lovable' ? 'AGENTS.md' : 'replit.md', text: note }] };
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
