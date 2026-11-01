// Chausar venture launcher, recorded flows (wave 6, package 6H2; DECISIONS D41): the plain shapes of a recipe and the
// views the Ink app reads. No imports, so the app's typecheck never pulls the engine in; flows/recipe.ts, replay.ts and
// records.ts build on these.

/** One way to find a control again: its id, its form name, its test id, its aria-label, or the words of its label. */
export type FlowCandidate = { kind: 'id' | 'name' | 'test-id' | 'aria-label' | 'label'; value: string };
/** A control as a step knows it: how to find it, the fingerprint of what it is, and its words for the owner. */
export type FlowTarget = { candidates: FlowCandidate[]; fingerprint: string; label: string };
export type FlowEffect = 'submit' | 'pay' | 'post';
export type FlowSecret = 'password' | 'card' | 'otp';
export type FlowValue = { blank: string } | { fixed: string };
export type FlowControl = 'text' | 'select' | 'checkbox';
export type FlowStep =
  | { kind: 'open'; url: string }
  | { kind: 'fill'; control: FlowControl; target: FlowTarget; value: FlowValue }
  | { kind: 'click'; target: FlowTarget }
  | { kind: 'secret'; secret: FlowSecret; target: FlowTarget }
  | { kind: 'gate'; effect: FlowEffect; target: FlowTarget };
export type FlowBlank = { name: string; label: string };
/** A control on the page now, for a repair: how to find it and its fingerprint, never its value. */
export type FlowControlOption = { label: string; candidates: FlowCandidate[]; fingerprint: string };

export type FlowState = 'draft' | 'approved' | 'replaced';
export type FlowRunState = 'running' | 'held' | 'needs-you' | 'tested' | 'stopped' | 'done' | 'not-sent' | 'outcome-unknown';
export type FlowDryRun = { digest: string; at: string; outcome: 'tested' | 'stopped'; line: string };
export type FlowHeld = { digest: string; effect: FlowEffect; label: string; review: { label: string; value: string }[] };

/** One version of a recorded flow as the app sees it: never the recorded words, only whether samples are kept. */
export type FlowVersionView = {
  id: string; at: string; flowId: string; version: number; name: string; origin: string; steps: FlowStep[]; blanks: FlowBlank[]; digest: string;
  state: FlowState; proposedBy: 'owner' | 'ai'; repairOf: { version: number; step: number } | null; dryRun: FlowDryRun | null;
  approvedAt: string | null; approvedBy: string | null; hasSamples: boolean;
};
/** One dry run or run as the app sees it. */
export type FlowRunView = {
  id: string; at: string; flowId: string; version: number; recipeDigest: string; mode: 'dry' | 'run'; state: FlowRunState; step: number; line: string;
  held: FlowHeld | null; repairOptions: FlowControlOption[] | null; journalEntryId: string | null; endedAt: string | null;
};
export type FlowsListView = { flows: FlowVersionView[]; runs: FlowRunView[] };
export type FlowsActView = { flow: FlowVersionView | null; run: FlowRunView | null };

/** venture.flows.act's payload: the action and its own fields (flows/methods.ts checks each exactly). */
export type FlowsActPayload =
  | { action: 'record'; name: string; url: string }
  | { action: 'dry-run'; flowId: string; version: number; values?: Record<string, string> }
  | { action: 'approve'; flowId: string; version: number; digest: string }
  | { action: 'run'; flowId: string; values: Record<string, string> }
  | { action: 'continue'; runId: string; digest?: string | null }
  | { action: 'repair'; runId: string; option: number }
  | { action: 'stop'; runId: string };
