// Chausar playbook kit: the sales mechanics' shapes (Ink v2 wave 5, package 5A2; catalogue P2, P3, P4, M18 and the
// share price kind): the GO card's record body, inputs and views, the sales proposal's record body and view, and the
// share price with its worked-out quote. Package 5-0 named them as placeholders; 5A2 filled them here, never in
// contracts.ts. Types only. Written for Chausar; the proposal's five sections follow revenue-squad's proposal skill
// (P3) and the GO card sealeap-ecommerce-skills' decision template (M18), both read for ideas only, no code taken.
import type { BpsString, Display, IsoDate, IsoTime, MinorString, OutreachHandoff, PriceStep } from '../../contracts.ts';

// ---------------------------------------------------------------------------
// Share prices (money/share-price.ts)
// ---------------------------------------------------------------------------

/**
 * An offer priced as a share of a recorded amount (money/share-price.ts): basis points the owner sets, of a base with
 * its evidence. On a plan's offer the base and its file are null: the amount is recorded later, with the file that
 * shows it (an offer letter, a refund order), when there is one to work the share out on.
 */
export type SharePrice = {
  kind: 'share'; bps: BpsString; baseMinor: MinorString | null; baseEvidenceFileId: string | null;
  /** The share in plain words, as Chausar writes it ("8.33% of the amount your client confirms"), so no screen formats it. */
  words: string;
};

/** One figure of a share quote: the recorded amount, or the share of it. */
export type ShareFigure = { key: 'base' | 'share'; label: string; minor: MinorString; display: string };

/**
 * A share worked out on its recorded base (money/share-price.ts shareQuote): the two figures, the BigInt steps, the
 * sentence built from them by template, every number a later sentence may cite, and a digest over all of it.
 */
export type ShareQuote = {
  kind: 'share';
  bps: BpsString;
  baseMinor: MinorString;
  baseEvidenceFileId: string;
  shareMinor: MinorString;
  currency: string;
  figures: ShareFigure[];
  steps: PriceStep[];
  explanation: string;
  allowedNumbers: string[];
  digest: string;
};

// ---------------------------------------------------------------------------
// The GO, HOLD or NO-GO card (playbooks/kit/go-no-go.ts, M18)
// ---------------------------------------------------------------------------

/**
 * The GO card's typed inputs by name; money as the owner typed it in rupees ("20,000"), null for an input the owner
 * does not know. The names the card reads: upfront (what it costs to start), monthly (what it costs each month), months
 * (how many months the owner will try it, a whole number) and limit (the most the owner is willing to lose).
 */
export type GoNoGoInputs = Readonly<Record<string, string | null>>;
export type GoNoGoInputName = 'upfront' | 'monthly' | 'months' | 'limit';
export type GoNoGoVerdict = 'GO' | 'HOLD' | 'NO-GO';

/** venture-go-no-go: one card as code decided it, with the working of its maximum loss. */
export type GoNoGoBody = {
  /** The playbook the card is for ('general' for the business itself). */
  playbook: string;
  /** What the owner is deciding, in their words: "A reels pack for gyms". */
  subject: string;
  /** The inputs as code read them: money in minor units, months as typed, null when not known. */
  inputs: Readonly<Record<GoNoGoInputName, string | null>>;
  verdict: GoNoGoVerdict;
  /** Every input the owner did not know, in the card's order. */
  unknown: GoNoGoInputName[];
  currency: string;
  /** upfront plus monthly times months, by BigInt; null while one of the three is unknown. */
  maxLossMinor: MinorString | null;
  limitMinor: MinorString | null;
  /** The working of the maximum loss, and its sentence; empty and null while it cannot be worked out. */
  steps: PriceStep[];
  explanation: string | null;
  allowedNumbers: string[];
  /** Over everything above; the receipt the card's figure opens carries it. */
  digest: string;
};

/** venture.goNoGo.card's answer, and each card venture.goNoGo.list gives, newest first. */
export type GoNoGoCardView = {
  id: string;
  at: IsoTime;
  playbook: string;
  subject: string;
  verdict: GoNoGoVerdict;
  /** The card's one line, in the engine's words. */
  line: Display;
  /** Each input the owner did not know, with its plain label (HOLD lists them all). */
  unknown: { input: GoNoGoInputName; label: Display }[];
  /** The maximum loss with the receipt that works it out (venture.receipt.get with the card's id). */
  maxLoss: { minor: MinorString; display: Display; receiptId: string } | null;
  limit: { minor: MinorString; display: Display } | null;
  /** On a GO card only: "GO spends nothing: each spend still asks you." */
  spendsNothing: Display | null;
};
export type GoNoGoListView = { cards: GoNoGoCardView[] };

// ---------------------------------------------------------------------------
// The sales proposal (playbooks/kit/proposal.ts, P2 and P3; the honest exit P4 in kit/exit.ts)
// ---------------------------------------------------------------------------

/**
 * What the owner and the client agreed for a pilot so far (venture.salesProposal.draft's pilot; kit/pilot.ts checks it).
 * Left out, a fact is a placeholder on the page. ownerHours: hours a week from the business; clientHours: from the client.
 */
export type SalesPilotTerms = {
  startsOn?: IsoDate; weeks?: number; hypothesis?: string;
  measure?: { what?: string; target?: string; by?: IsoDate };
  ownerHours?: number; clientHours?: number; reference?: boolean;
};

export type SalesProposalSectionId = 'heard' | 'roadmap' | 'investment' | 'next' | 'questions';
/** One of the proposal's five sections, in order: What we heard, Roadmap, Investment, Next step, Open questions. */
export type SalesProposalSection = { id: SalesProposalSectionId; title: string; lines: string[] };

/**
 * One amount under Investment: a price receipt from the owner's own list (venture.receipt.get opens it), or an offer
 * priced as a share, which has no amount until the client confirms the base.
 */
export type SalesProposalInvestment =
  | { kind: 'price'; offerId: string; offerName: string; receiptId: string; totalMinor: MinorString; display: string; per: string }
  | { kind: 'share'; offerId: string; offerName: string; bps: BpsString; words: string };

export type SalesProposalCheckId = 'required-sections' | 'figures-resolve' | 'placeholders-listed';
export type SalesProposalCheck = { id: SalesProposalCheckId; passed: boolean; detail: string };

/**
 * What the honest exit decided about the ask (kit/exit.ts scopeOf): in, partly or outside by the playbook's own
 * phrases; 'unclear' when no phrase decided it (the owner picks); 'not-checked' for a business no kit playbook runs.
 */
export type SalesProposalScope = {
  verdict: 'in' | 'partly' | 'outside' | 'unclear' | 'not-checked';
  /** The parts of the ask the playbook does not do. */
  rest: string[];
  /** The fixed reply, when part of the ask is outside. */
  reply: string | null;
};

/** venture-sales-proposal: one drafted proposal, waiting for the owner on Today, then approved for the owner to send. */
export type SalesProposalBody = {
  clientId: string | null;
  personId: string | null;
  /** The client's or the person's name as the records hold it. */
  toName: string;
  offerId: string;
  offerName: string;
  pilot: boolean;
  sections: SalesProposalSection[];
  investment: SalesProposalInvestment[];
  /** Every bracketed placeholder in the sections, in order of first use. */
  placeholders: string[];
  checks: SalesProposalCheck[];
  /** 'model': the owner's AI wrote What we heard and the Roadmap under the chat consent; 'template': Chausar's code. */
  author: 'template' | 'model';
  callId: string | null;
  scope: SalesProposalScope;
  /** Where the owner can send it from, read from the client or the person at drafting time. */
  contact: { email: string | null; phone: string | null; linkedin: string | null };
  status: 'waiting' | 'approved';
  approvedAt: IsoTime | null;
  /** The proposal as one plain text, the way a handoff carries it. */
  text: string;
  /** Over the sections, the investment and the people: approving binds it. */
  digest: string;
};

/** venture.salesProposal.draft's and .get's answer. */
export type SalesProposalView = {
  /** null when the whole ask is outside what the business does: nothing was drafted (exit says so). */
  id: string | null;
  at: IsoTime | null;
  to: string;
  offerId: string;
  offerName: string;
  pilot: boolean;
  status: 'waiting' | 'approved' | 'outside';
  sections: SalesProposalSection[];
  investment: SalesProposalInvestment[];
  placeholders: string[];
  checks: SalesProposalCheck[];
  author: 'template' | 'model';
  /** The engine's words: who drafted it, and what happens next. */
  line: Display;
  /** Set when part or all of the ask is outside what the business does: the fixed reply and what it leaves out. */
  exit: { verdict: 'partly' | 'outside'; reply: Display; rest: string[] } | null;
  digest: string | null;
  /** Once approved: the handoffs to the owner's own apps (mail, WhatsApp, LinkedIn copy). Chausar never sends it. */
  handoffs: OutreachHandoff[] | null;
};
