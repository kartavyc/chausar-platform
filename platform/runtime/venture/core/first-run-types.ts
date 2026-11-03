// Chausar venture launcher (wave 6, 6C1, 6C2, 6C7): the shapes of the first run's answers, in one file with no imports,
// so contracts.ts and onboarding-contracts.ts can name them without pulling the engine into every type graph.
// families.ts, about.ts, needs-data.ts and models/login.ts hold the code; a test checks FAMILY_IDS against FamilyId.

/** The eleven profession families of DECISIONS D2 (core/families.ts FAMILY_IDS, same order). */
export type FamilyId =
  | 'money-tax' | 'teaching' | 'creative' | 'writing' | 'local-services' | 'documents' | 'research' | 'people' | 'shop-office' | 'tech' | 'licensed';

/** One offer the owner could sell: a short name and one line. Never an amount. */
export type FamilyOffer = { name: string; line: string };

export type AboutFile = { name: string; included: boolean; line: string | null };
export type AboutRead = {
  family: { id: FamilyId; label: string; line: string } | null;
  offers: FamilyOffer[];
  country: { code: string; name: string; currency: string } | null;
  evidence: string | null;
  /** The sentence venture.preview and venture.create start the plan from, or null until a family is chosen. */
  idea: string | null;
  source: 'ai' | 'keywords' | 'tile';
  /** A1 final check: the AI read's own call, when the AI read it; the kept card names it so the plan can say who wrote it. */
  callId?: string;
  file?: AboutFile;
};

export type NeedLabel = 'write' | 'read' | 'handoff' | 'planned';
/** How the owner connects it: the service's own sign-in, a key into the keychain, a setup guide, or nothing yet. */
export type NeedConnect = { kind: 'sign-in' | 'key' | 'guide' | 'none'; connectorId: string | null; place: 'connections' | 'connections/ai' | null };
export type NeedView = {
  id: string; name: string; why: string; label: NeedLabel; connect: NeedConnect;
  /** Planned only: who or what it waits on, and the manual path until then. */
  waitsOn: string | null; meanwhile: string | null;
  /** Never true: skipping every service still leaves a working business. */
  required: false;
};
export type NeedsList = { family: { id: FamilyId; label: string } | null; needs: NeedView[] };

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
export type ToolView = { cli: 'codex' | 'claude-code'; label: string; found: boolean; signedIn: 'yes' | 'no' | 'unknown'; login: ToolLogin; setup?: CodexSetupView };
export type ToolsView = { tools: ToolView[]; line: string };
