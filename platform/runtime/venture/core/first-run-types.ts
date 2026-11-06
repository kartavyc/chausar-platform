import type { FamilyId, FamilyOffer, NeedConnect, NeedLabel, NeedView, NeedsList } from '../../../contract/venture/core/first-run-types.ts';
export type { FamilyId, FamilyOffer, NeedConnect, NeedLabel, NeedView, NeedsList } from '../../../contract/venture/core/first-run-types.ts';
// Chausar venture launcher (wave 6, 6C1, 6C2, 6C7): the shapes of the first run's answers, in one file with no imports,
// so contracts.ts and onboarding-contracts.ts can name them without pulling the engine into every type graph.
// families.ts, about.ts, needs-data.ts and models/login.ts hold the code; a test checks FAMILY_IDS against FamilyId.

/** The eleven profession families of DECISIONS D2 (core/families.ts FAMILY_IDS, same order). */


/** One offer the owner could sell: a short name and one line. Never an amount. */


export type AboutFile = { name: string; included: boolean; line: string | null };
export type AboutRead = {
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
  /** C5 task 6: your AI's first reply after About you (at most two sentences, no digits); absent without one. */
  reply?: string;
};

/** A family tile (venture.about.families) with its professions in the catalogue's order (A5). */
export type FamilyTile = { id: FamilyId; label: string; line: string; professions: { id: string; label: string }[] };


/** How the owner connects it: the service's own sign-in, a key into the keychain, a setup guide, or nothing yet. */




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
