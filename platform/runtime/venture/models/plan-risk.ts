// The platform's own risk of each sign-in that runs on the owner's own plan, in one short plain line (the founder's
// rule: "Show the platform's own risk in plain words"). Each line is a whole sentence of the engine's own words for
// that row (onboarding-contracts.ts AI_OPTION_WORDS, its `why`); a test holds it inside them, so what the screens show
// at rest where the AI is chosen (the first screen and Connections) and what the engine says cannot drift.
// A leaf with no import, so the app reads the same words.

export const AI_PLAN_RISK = Object.freeze({
  codex: "OpenAI hasn't said yet that apps like Chausar may use a ChatGPT plan this way.",
  'claude-code': 'Plans have limits made for one person, so heavy use can be cut off.',
} as const);
export type PlanRiskTool = keyof typeof AI_PLAN_RISK;

/** The preset each sign-in connects (models/presets.ts). */
const TOOL_OF_PRESET: Readonly<Record<string, PlanRiskTool>> = Object.freeze({ 'codex-cli': 'codex', 'claude-code-cli': 'claude-code' });

/** The line for a preset, or null: a key is billed by the AI company, and the templates use no AI. */
export function planRiskOf(presetId: string): string | null {
  const tool = Object.hasOwn(TOOL_OF_PRESET, presetId) ? TOOL_OF_PRESET[presetId] : undefined;
  return tool ? AI_PLAN_RISK[tool] : null;
}
