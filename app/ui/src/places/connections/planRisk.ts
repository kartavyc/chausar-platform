import words from '../../text/en/first-run.json';
import { planRiskOf } from '../../../../../platform/runtime/venture/models/plan-risk';

const copy: Readonly<Record<string, string>> = words;
const KEY: Readonly<Record<string, string>> = { 'codex-cli': 'first-run.ai.risk.codex', 'claude-code-cli': 'first-run.ai.risk.claude-code' };

/**
 * The platform's own risk of a sign-in that runs on the owner's own plan, in one short line (the founder's rule: "Show
 * the platform's own risk in plain words"), or null for a key and for the templates. The words are the engine's own
 * (models/plan-risk.ts, a sentence of that row's `why`); the text pack holds the same sentence so Hindi can say it, and
 * if the two ever differ the engine's words show as they are.
 */
export function planRiskWords(t: (key: string) => string, presetId: string): string | null {
  const line = planRiskOf(presetId);
  if (line === null) return null;
  const key = KEY[presetId];
  return key && copy[key] === line ? t(key) : line;
}
