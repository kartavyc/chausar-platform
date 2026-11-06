// Venture business contract. Types only; public imports use ../contracts.ts.
import type { SERVICE_TYPES, LAUNCH_STAGES, VENTURE_RECORD_KINDS, SCENARIO_KINDS } from '../contract-values.ts';
import type { ApprovalBlockId, ComposedNote, ComposedPage, OfferBlockId, PlanKind, StepBlockId, ToolBlockId, ViewSelection } from '../onboarding-contracts.ts';
import type { RightsBasis } from '../delivery/rights.ts';
import type { PriceGuideView } from '../core/price-ranges.ts';
import type { KitIntakeField } from '../playbooks/kit/define.ts';
import type { SharePrice } from '../playbooks/kit/records-sales.ts';
import type { CountryCode, TaxMode, DateOrder, CountryProfile } from '../core/country-types.ts';
import type { ModelPresetId } from './models.ts';
import type { Display } from './spend.ts';
import type { PriceReceiptRecord } from './money.ts';

// ---------------------------------------------------------------------------
// 1. Primitives
// ---------------------------------------------------------------------------

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Calendar date, 'YYYY-MM-DD'. */
export type IsoDate = string;

/** Instant, ISO 8601 with 'Z'. */
export type IsoTime = string;

/** Integer amount in the currency's minor unit, as decimal text. Never a JS number. */
export type MinorString = string;

/** Integer basis points as decimal text. '1800' is 18 percent. A CGST or SGST invoice line holds half the rate, so half of an odd rate reads 'n.5'. */
export type BpsString = string;

/** Integer millionths of a currency unit as decimal text. Used for model costs only. */
export type MicroString = string;

/** Who said a line, and how sure it is. Shown next to every blueprint line. */
export type LineLabel = 'told-by-you' | 'assumption' | 'computed';

export type LineAuthor = 'owner' | 'model' | 'template' | 'engine';

/** estimate: true when the model wrote a number in the line; shown as a model estimate, never with a receipt. */
export type Labelled<T> = { value: T; label: LineLabel; by: LineAuthor; estimate?: true };

export type { CountryCode, TaxMode, DateOrder, CountryProfile } from '../core/country-types.ts';

export type ServiceType = typeof SERVICE_TYPES[number];

export type LaunchStage = typeof LAUNCH_STAGES[number];

export type VentureStatus = 'interview' | 'blueprint' | 'build' | 'rehearsal' | 'live';

export type VentureRecordKind = typeof VENTURE_RECORD_KINDS[number];

/** Every venture record lives in State.conversations with one of the kinds above. */
export type RecordBase<K extends VentureRecordKind> = {
  id: string;
  kind: K;
  ventureId: string;
  memberId: string;
  epoch: number;
  at: IsoTime;
};

export type VentureRecord = RecordBase<'venture-record'> & {
  aiSettings?: import('../agent-runtime/settings.ts').AiSettings;
  /** C7: the backup AI for routines (agents/routine-backup.ts): off by default; at is when the owner last set it. */
  routineBackup?: { on: boolean; order: ModelPresetId[]; at: IsoTime };
  /** C7: the event relay's host and when it was last read (build/event-triggers.ts). The address itself is in protected storage. */
  eventRelay?: { host: string | null; calKey: boolean; since: IsoTime; lastRead?: IsoTime };
  /** Host-owned revocation generations; owner settings never accept these counters. */
  aiNetworkRevision?: Partial<Record<'codex' | 'claude', number>>;
  idea: string;
  ideaDigest: string;
  workingName: string;
  country: CountryProfile;
  /** Profile for immutable plans made before the first owner-approved country change. */
  originalCountry?: CountryProfile;
  serviceType: ServiceType | null;
  status: VentureStatus;
  launchStage: LaunchStage;
  /** When this business last entered Live; absent for a stage recorded before dates were kept. */
  liveSince?: IsoTime | null;
  blueprintId: string | null; // latest blueprint version
  acceptedBlueprintId: string | null;
  /** Opaque Electron partition IDs awaiting an already owner-approved Forget. No credentials or client text. */
  formsSignInErasure?: string[];
  /** Opaque owned containers awaiting an already owner-approved client Forget. */
  appTestErasure?: import('../playbooks/app-testing/records.ts').AppTestErasure[];
  appTestScreenErasure?: import('../build/android.ts').AndroidScreenFile[];
  demoDesktopErasure?: import('../playbooks/app-testing/demo-records.ts').DemoSession[];
  playbookId: string | null; // latest validated playbook
  youtubePublicQuota?: import('../playbooks/youtube/public-state.ts').YoutubeQuotaUse[];
  invoiceSequence: number; // last issued invoice number
  updatedAt: IsoTime;
  /**
   * 4J10 (H26): the chained journal's newest link, pinned here too, so a chain cut short or deleted shows. mac: HMAC
   * with a key derived from the vault's own key (journal:head), so a forged pin shows; absent where no key is derived.
   */
  journalHead?: { seq: number; digest: string; mac?: string };
  /** 4J10 (H26): when this business first signed a receipt, HMAC'd like journalHead: an unsigned receipt made after it was changed. */
  signingSince?: { at: IsoTime; mac?: string };
  /** Wave 6 (6D1, 6D2): the owner's billing settings (money/billing.ts); absent fields read as the defaults. */
  billing?: Partial<import('../money/billing-types.ts').BillingSettings>;
  /** Wave 6 (6F3): the owner's own web search key: which provider, its last four characters, when (web/search.ts). The key is in protected storage. */
  webSearchKey?: import('../web/search-types.ts').SavedSearchKey | null;
  /** Wave 6 (6F8): which people search services have the owner's own key saved (people/services.ts). Keys are in protected storage. */
  peopleKeys?: import('../people/people-types.ts').SavedPeopleKeys;
};

export type TermLifecycle = 'proposed' | 'active' | 'retired';

export type TermRecord = RecordBase<'venture-term'> & {
  key: 'client' | 'offer' | 'order' | 'deliverable' | 'revision-round' | 'invoice' | 'payment' | 'retainer-period';
  name: string;
  meaning: string; // no digits
  lifecycle: TermLifecycle;
  evidence: { recordId: string; kind: VentureRecordKind; at: IsoTime }[];
};

export type ChecklistItemId =
  | 'idea' | 'ai' | 'questions' | 'plan' | 'prices' | 'brief' | 'builder' | 'repo'
  | 'rehearsal' | 'first-client' | 'first-invoice' | 'first-payment';

/** link (Ink v2 wave 4, 4J8): the app address where the item is done, such as #/business/prices. */
export type ChecklistItem = { id: ChecklistItemId; label: string; done: boolean; place: LaunchPlace; link: string };

export type LaunchPlace = 'today' | 'business' | 'build' | 'clients' | 'agents' | 'money' | 'connections';

export type NextStep = { item: ChecklistItemId; label: string; place: LaunchPlace } | null;

export type VentureView = {
  venture: VentureRecord;
  checklist: ChecklistItem[];
  done: number;
  total: number;
  next: NextStep;
  terms: TermRecord[];
  /** The flagship playbook the idea picks (venture/playbooks/registry.ts); absent when the plain service type serves. */
  playbook?: PlaybookPick;
  /** 4F3: while the owner has paused the business (Pause all), since when and the engine's line; absent otherwise. */
  paused?: { since: IsoTime; line: Display };
};

/** A flagship playbook as the screens show it, for example { id: 'youtube', label: 'YouTube channel' }. Worked out from the idea, never stored. */
export type PlaybookPick = { id: string; label: string };

// ---------------------------------------------------------------------------
// 4. Plan preview, interview and blueprint (P1)
// ---------------------------------------------------------------------------

export type InterviewQuestionKind = 'choice' | 'text' | 'money' | 'yesno' | 'rate';

export type InterviewField = 'customer' | 'first-offer' | 'channel' | 'pricing-model' | 'price' | 'tax-registered' | 'tax-rate' | 'other';

export type InterviewQuestion = {
  id: string;
  kind: InterviewQuestionKind;
  field: InterviewField;
  text: string; // no digits when written by a model or template
  choices: { id: string; label: string }[]; // empty unless kind is 'choice'
  by: 'model' | 'template' | 'engine';
  required: boolean;
  prefill: string | null; // engine answer text the owner may keep, e.g. '18' for q_tax_rate in India
};

/**
 * amount is the owner's typed decimal text in the venture currency; rate is percent text like '18' or '8.25'.
 * assumed: only as { yes: false, assumed: true } on q_tax, when the owner left tax unanswered and a screen filled the
 * default. The plan then labels it an assumption, not the owner's answer, until the owner confirms it.
 */
export type InterviewAnswer = { choiceId?: string; text?: string; amount?: string; yes?: boolean; rate?: string; skipped?: true; assumed?: true };

export type InterviewRecord = RecordBase<'venture-interview'> & {
  serviceType: Labelled<ServiceType>;
  questions: (InterviewQuestion & { answer: InterviewAnswer | null; answerMinor: MinorString | null; answerBps: BpsString | null; answeredAt: IsoTime | null })[];
  modelCallIds: string[];
  source: 'model' | 'template';
};

export type InterviewView = {
  interview: InterviewRecord;
  next: InterviewQuestion | null;
  done: boolean;
  asked: number;
  limit: number; // at most 6 questions in total
};

export type PricingModel = 'monthly' | 'project' | 'hourly';

export type Offer = {
  id: string; // 'offer_1' .. 'offer_3', stable across versions
  /** The library block a composed plan built this offer from; absent on template offers. Allowed pricing is OFFER_BLOCKS[block].allowed. */
  block?: OfferBlockId;
  /**
   * The flagship playbook offer this offer is (venture/playbooks/plan.ts), for example 'licensed-clips'. Set on plans
   * an idea's flagship playbook made; absent on every other plan. It decides the rights asked at intake and the step
   * that drafts an order's reply.
   */
  playbookOffer?: string;
  /**
   * Ink v2 wave 4 (4J8): an offer the owner added (a venture-owner-offer record holds it, so "Rewrite with AI" keeps it).
   * Its words are the owner's: Rewrite with AI never touches them, a suggestion may reword them only through a patch the
   * owner applies, and the owner may take it out again.
   */
  addedByOwner?: true;
  /**
   * Ink v2 wave 4 (4J12, H24): every order of this offer needs a contract the owner signed before a run starts
   * (money/order-contracts.ts). Fixtures only in W4: no shipped plan sets it.
   */
  contract?: 'required';
  name: Labelled<string>;
  description: Labelled<string>;
  pricing: {
    model: PricingModel;
    quantityUnit: 'month' | 'project' | 'hour';
    unitPriceMinor: MinorString | null; // owner-entered only; null shows "Set your price"
    unitPriceLabel: 'told-by-you' | 'not-set';
    defaultQuantity: string; // integer text, engine default '1'
    /**
     * Ink v2 wave 5 (5A2): the offer is priced as a share of an amount the client confirms later (money/share-price.ts),
     * in place of a fixed price; base and evidence stay null on the plan. Absent on every fixed-price offer.
     */
    share?: SharePrice;
  };
};

/**
 * One step a flagship playbook delivers with (venture/playbooks/steps.ts), as the plan lists it: its own title, fixed
 * engine words, and who does it. doneBy: you, an agent (who is its role, such as 'Packager'), code with no model (who
 * is its name, such as 'Calculator'), or another person (who is, for example, 'CA of record' or 'Your client'). A
 * flagship plan lists these in place of the four template steps, so the plan the owner accepts names the steps that run.
 */
export type PlanFlagshipStep = { id: string; title: Labelled<string>; doneBy: 'you' | 'agent' | 'code' | 'person'; who: string };

/**
 * What an order for one flagship offer asks at intake (venture/playbooks/intake.ts), worked out by code, never stored.
 * rights: the rights to the footage this offer accepts, in order; empty when it cuts no footage. fields: the other
 * intake fields its checks read; 'cutFile' never on the hosted server, which reads no file on the owner's computer.
 */
export type OfferIntakeAsk = {
  rights: RightsBasis[]; fields: ('format' | 'aiVoice' | 'aiPresenter' | 'paidPromotion' | 'cutFile' | 'calendar' | 'clientRules')[];
  /** Ink v2 wave 5 (5A1): a kit offer's own intake fields, in order (kept under OrderIntake.fields); absent on the flagships. */
  kit?: KitIntakeField[];
};

/** 'yours': work only the owner does, with no agent planned (composed plans only). */
export type StepCapability = 'drafts-now' | 'planned' | 'yours';

export type BlueprintStep = {
  id: string;
  /** The library block a composed plan built this step from; absent on template steps. */
  block?: StepBlockId;
  title: Labelled<string>;
  doneBy: 'agent' | 'you' | 'agent-then-you'; // who does it in this build
  capability: StepCapability; // code-computed from STEP_PLAN; 'planned' shows the chip 'planned: agent'
  note: string; // fixed engine words from STEP_PLAN
};

export type BackOffice = {
  currency: string;
  taxMode: TaxMode;
  taxLabel: string;
  taxRegistered: Labelled<boolean>;
  taxRateBps: BpsString; // '0' unless registered
  taxRateBy: 'country-table' | 'told-by-you' | 'not-registered';
  taxId: string | null; // GSTIN, VAT or GST number, owner-typed and checked
  taxState: string | null; // India only: two-digit state code; must equal the GSTIN's first two digits
  sacCode: string | null; // India only: six-digit SAC starting 99, owner-typed
  lutConfirmed: boolean; // India only: the owner confirms a Letter of Undertaking for zero-rated exports
  invoiceKind: 'tax-invoice' | 'invoice'; // from the country
  taxInvoiceReady: boolean; // every field a tax invoice needs is present (always false for kind 'invoice')
  taxInvoiceMissing: string[]; // plain words such as 'Your GSTIN'; [] when ready or not registered
  paymentRail: string; // connector id
  invoicePrefix: string; // 'INV'
};

export type BlueprintRecord = RecordBase<'venture-blueprint'> & {
  /** Frozen profile used by this plan's prices, tax rules and historical documents. */
  country?: CountryProfile;
  version: number;
  status: 'draft' | 'accepted';
  /** Who wrote its words: the AI, the built-in templates, or (one-shot A1, row 3) the owner, once they changed any. */
  source: 'model' | 'template' | 'owner';
  structureHash: string; // hash of the code-made structure the model may only fill with words
  digest: string; // digest of the whole blueprint except id, at, digest and status; approved on accept
  modelCallIds: string[];
  serviceType: ServiceType;
  name: Labelled<string>;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: Offer[]; // 1 to 3
  deliverySteps: BlueprintStep[]; // 3 to 6
  approvals: Labelled<string>[]; // what the owner approves, 1 to 4
  backOffice: BackOffice;
  starterConnectorIds: string[]; // about six
  // Composed plans only (onboarding v2). Absent on template records, so their digests do not change.
  composition?: { id: string; composeId: string; kind: PlanKind; views: ViewSelection[] } | null;
  approvalBlocks?: ApprovalBlockId[];
  pages?: ComposedPage[];
  tools?: { block: ToolBlockId; reason: Labelled<string> }[];
  notes?: ComposedNote[];
  /**
   * Flagship playbook plans only (venture/playbooks/steps.ts): the steps that run, which the plan lists in place of
   * deliverySteps. Part of the digest the owner accepts. Absent on every other plan, so their digests do not change.
   */
  flagshipSteps?: PlanFlagshipStep[];
};

/** Owner edits. Every field optional; at least one required. Creates a new draft version. */
export type BlueprintPatch = {
  countryCode?: CountryCode;
  name?: string;
  oneLiner?: string;
  customer?: string;
  taxRegistered?: boolean;
  taxRate?: string; // percent text like '18' or '8.25'; percentBps turns it into basis points
  taxId?: string | null;
  taxState?: string | null;
  sacCode?: string | null;
  lutConfirmed?: boolean;
  /** share (5A2): a share of an amount the client confirms later, as percent text ('8.33'), in place of a fixed price; null takes it away. */
  offers?: { id: string; name?: string; description?: string; unitPrice?: string | null; pricingModel?: PricingModel; share?: { percent: string } | null }[];
  /** Ink v2 wave 4 (4J8): a new offer of the owner's, with no price yet (Set your prices then names it). */
  addOffer?: { name: string; description: string; pricingModel: PricingModel } | { youtubeService: string };
  /** Ink v2 wave 4 (4J8): takes out an offer the owner added. A playbook's or the plan's own offers stay. */
  removeOffer?: { id: string };
};

/** Blueprint plus the current (non-stale) price receipt per offer, looked up by subject and this version's digest. */
export type BlueprintView = {
  blueprint: BlueprintRecord;
  offerReceipts: Record<string, PriceReceiptRecord | null>;
  /** The flagship playbook the venture's idea picks; absent when none fits. Not part of the record or its digest. */
  playbook?: PlaybookPick;
  /** What an order for each offer asks at intake, by offer id; absent when no offer asks anything. Not part of the record. */
  intake?: Record<string, OfferIntakeAsk>;
  /**
   * W6 6C3 (D17): what clients pay for this business's profession, from credible sources with the date checked, or "No
   * reliable data". Information only: it never sets or changes a price. Absent when the plan maps to no beta profession.
   */
  priceGuide?: PriceGuideView;
  /**
   * One-shot C4 task 33: present only on the answer to the owner's own price saved in the app, which applied at once: the
   * decided line and the row id venture.queue.undo takes to put back the version before. Not part of the record.
   */
  decided?: { line: string; undoRowId: string };
};

/** W6 6C3 (D17): the price range views, defined beside their code (core/price-ranges.ts) so the app's fake engine can use them. */
export type { PriceGuideView, PriceRangeView, PriceSourceView } from '../core/price-ranges.ts';

/** venture.preview: the instant plan shown before any vault exists. Template words only; nothing is stored. */
export type PlanPreview = {
  idea: string;
  country: CountryProfile;
  serviceType: Labelled<ServiceType>;
  serviceLabel: string;
  oneLiner: Labelled<string>;
  customer: Labelled<string>;
  offers: Offer[]; // template words, unitPriceMinor null
  deliverySteps: BlueprintStep[];
  approvals: Labelled<string>[];
  backOffice: BackOffice; // taxRegistered is { value: false, label: 'assumption', by: 'engine' }
  questions: InterviewQuestion[]; // the template interview the screen fills inline (q_tax_rate shows when q_tax is yes)
  by: 'template';
  saved: false;
  /** The flagship playbook the idea picks; absent when none fits. */
  playbook?: PlaybookPick;
  /** The flagship playbook's delivery steps, listed in place of deliverySteps; absent when no playbook fits. */
  flagshipSteps?: PlanFlagshipStep[];
};

export type ScenarioKind = typeof SCENARIO_KINDS[number];
