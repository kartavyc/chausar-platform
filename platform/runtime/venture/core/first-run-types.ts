// Chausar venture launcher (wave 6, 6C1, 6C2, 6C7): the shapes of the first run's answers, in one file with no imports,
// so contracts.ts and onboarding-contracts.ts can name them without pulling the engine into every type graph.
// families.ts, about.ts, needs-data.ts and models/login.ts hold the code; a test checks FAMILY_IDS against FamilyId.

/** The eleven profession families of DECISIONS D2 (core/families.ts FAMILY_IDS, same order). */
export type FamilyId =
  | 'money-tax' | 'teaching' | 'creative' | 'writing' | 'local-services' | 'documents' | 'research' | 'people' | 'shop-office' | 'tech' | 'licensed';

/**
 * One offer the owner could sell: a short name and one line. Never an amount. unit: the unit it is priced in
 * (core/offer-units.ts OFFER_UNITS), written only where it is not per project: the field's own for a starting offer,
 * the AI's checked suggestion for one it read. An offer with none is per project until the owner chooses.
 */
export type FamilyOffer = { name: string; line: string; unit?: 'project' | 'month' | 'year' | 'hour' | 'visit' | 'piece' | 'set' | 'minute' | 'word' | 'page' };

export type AboutFile = { name: string; included: boolean; line: string | null };
export type AboutRead = {
  /** The listed field the work fits; null when it fits none (the offers and the idea may still stand) or is not known yet. */
  family: { id: FamilyId; label: string; line: string } | null;
  /**
   * One-shot A5 (founder answer 3a): the owner's exact profession as the AI picked it, checked against the catalogue
   * (core/professions.ts) and the family; null when nothing was picked (keywords, a tile, or no clear pick).
   */
  profession: { id: string; label: string } | null;
  offers: FamilyOffer[];
  country: { code: string; name: string; currency: string } | null;
  evidence: string | null;
  /** The sentence venture.preview and venture.create start the plan from, or null until a family is chosen. */
  idea: string | null;
  source: 'ai' | 'keywords' | 'tile';
  /** A1 final check: the AI read's own call, when the AI read it; the kept card names it so the plan can say who wrote it. */
  callId?: string;
  file?: AboutFile;
  /** C5 task 6: your AI's reply after About you, as it wrote it (no links); absent without one. */
  reply?: string;
  /**
   * The AI read the work, placed it in a field and found none of that field's listed professions clearly the owner's,
   * and no profession of the field switches a tool off: "Which of these are you?" is not asked (core/about.ts
   * ownKindOfWork). Absent otherwise.
   */
  ownKind?: true;
  /**
   * No AI read this and the words match no listed field, but they are clear enough to keep (core/own-offer.ts): the
   * plan starts from the owner's own words with no field, and the owner names what they sell on the card. offers then
   * holds at most one row, taken from their own words by code, or the rows they already typed. Absent otherwise.
   */
  ownOffers?: true;
  /** A short plain business name your AI proposed from the owner's words, checked by code (core/business-name.ts); the owner types over it. */
  name?: string;
  /** The way to earn your AI proposed (core/way.ts): who pays, how they are reached, who does what, the first week. */
  way?: { customer: string; reach: string; teamDoes: string; youDo: string; firstWeek: string[] };
  /**
   * The small team your AI proposed for that way (agents/team-proposal.ts): one to three agents that passed the hire
   * rules, each with the digest of its own card. Only beside a way; venture.agents.hire.team hires the ones kept.
   */
  team?: { name: string; job: string; duties: string[]; reads: string[]; department?: string; digest: string }[];
  /**
   * The agents that will do each order (agents/order-agents.ts): a playbook's own, else the one delivery agent. They
   * join when the plan is accepted; the card shows them beside the proposed team so the owner sees one team. Only
   * beside a way.
   */
  orderAgents?: { name: string; does: string }[];
  /** What this business needs from outside, as your AI named it beside the way: up to four ids from NEED_IDS, checked. */
  needs?: NeedId[];
};

/**
 * What came before a follow-up in About you, as the window sends it with venture.about.read (core/about-before.ts
 * checks it): the talk so far, and the plan as the card shows it now. kept: still ticked; yours: the owner typed that
 * name; left: the owner left that agent out.
 */
export type AboutBeforePayload = {
  turns: { from: 'owner' | 'you'; text: string }[];
  plan: {
    familyId?: string | null; professionId?: string | null; name?: string | null;
    offers: { name: string; line: string; kept: boolean; yours: boolean; unit?: string }[];
    way: { customer: string; reach: string; teamDoes: string; youDo: string; firstWeek: string[] } | null;
    team: { name: string; job: string; duties: string[]; reads: string[]; left: boolean; department?: string }[];
  };
};

/** A family tile (venture.about.families) with its professions in the catalogue's order (A5). */
export type FamilyTile = { id: FamilyId; label: string; line: string; professions: { id: string; label: string }[] };

export type NeedLabel = 'write' | 'read' | 'handoff' | 'planned';
/**
 * How the owner connects it: the service's own sign-in, a key into the keychain, a setup guide, or nothing yet.
 * mcpServerId: a server of the curated list (agent-runtime/mcp-registry.ts), or one the owner already saved, whose own
 * server form is the connect flow.
 */
export type NeedConnect = { kind: 'sign-in' | 'key' | 'guide' | 'none'; connectorId: string | null; place: 'connections' | 'connections/ai' | null; mcpServerId?: string };
/** The one thing a row offers: a real connect flow, nothing (it already works), or the manual path of a planned one. */
export type NeedAction = 'set-up' | 'none' | 'manual';
export type NeedView = {
  id: string; name: string; why: string; label: NeedLabel; connect: NeedConnect;
  /** Planned only: who or what it waits on, and the manual path until then. */
  waitsOn: string | null; meanwhile: string | null;
  /** Never true: skipping every service still leaves a working business. */
  required: false;
  action: NeedAction;
};
/** What a business may need from outside (core/needs-data.ts NEED_IDS, same order; a test checks the two). */
export type NeedId = 'find-customers' | 'write-to-customers' | 'designs-documents' | 'payments' | 'appointments';
/** One kept need with the ways Chausar can meet it today, the most useful first. */
export type NeedGroup = {
  id: NeedId; ways: NeedView[];
  /** One plain line of the need's own, when its ways do not say everything (the public map lists places only); else null. */
  note: string | null;
};
/**
 * groups: the kept plan's needs, each with its ways; empty when no need was kept. needs: the field's list, used only
 * then (it is empty beside groups). chosen: the needs kept now, in order (a kept need with no way here has no group but
 * is still chosen); choices: every need that can be chosen. The owner ticks and unticks them through venture.owner.set.
 */
export type NeedsList = { family: { id: FamilyId; label: string } | null; needs: NeedView[]; groups: NeedGroup[]; chosen: NeedId[]; choices: NeedId[] };

export type LoginState = 'idle' | 'starting' | 'waiting' | 'signed-in' | 'failed' | 'cancelled';
export type ToolLogin = { state: LoginState; code: string | null; link: string | null; line: string | null };
/**
 * A2: a Codex setup as the owner reads it (codex-trust.ts): 'trusted' in use, 'review' found and checked and waiting for
 * the owner's yes, 'refused' found but not usable, 'none' not found. sha256 is the program's digest the yes names.
 */
export type CodexSetupView = {
  state: 'trusted' | 'review' | 'refused' | 'none'; origin: 'operator' | 'bundled' | 'owner' | null;
  path: string | null; version: string | null; sha256: string | null; line: string;
};
/** setup (A2): Codex only, when the host keeps a Codex trust. */
/**
 * tested and problem (A2): the tiny test call that earns "Signed in" (models/cli-test.ts); signedIn is 'yes' only once it
 * passed, and problem holds its failure in owner words.
 */
/** A2: the AI provider's own status page when it says the provider has problems, with its source and when it was read. */
export type ProviderTrouble = { line: string; source: string; readAt: string };
export type ToolView = { cli: 'codex' | 'claude-code'; label: string; found: boolean; signedIn: 'yes' | 'no' | 'unknown'; login: ToolLogin; setup?: CodexSetupView; tested?: 'passed' | 'failed'; problem?: string; provider?: ProviderTrouble };
export type ToolsView = { tools: ToolView[]; line: string };
