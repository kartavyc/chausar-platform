/**
 * The fake engine's models desk for W4 4H2: venture.models.cli.status and venture.models.roles, answered with the
 * engine's codes, shapes, order and words (platform/runtime/venture/models/cli-status.ts, handlers.ts and roles.ts).
 *
 * The CLI status is this fake desktop's look, the same one the preset list already tells (fixtures-business.ts):
 * Claude Code is located but, while Chausar has not accepted Anthropic's terms for running it, never run, so nothing
 * more is known about it; Codex answers its version, help and sign-in commands, but this computer has no reviewed
 * Codex host profile, so Chausar does not run it. Neither has done a real task, so neither is ready. The hosted app
 * looks at nothing (TIER_UNAVAILABLE). Check again ({fresh: true}) looks again and finds the same.
 *
 * The roles list each agent of the fake team (fixtures.ts AGENTS; Keeper, which is code, has none) with the tiers its
 * steps use, the preset serving each tier now (venture.models.status) and that preset's price line as the engine words
 * it. The fake has no playbook steps to read tiers from, so its agents use the tiers below. No owner rupee rate is set
 * in the fake, so no line carries rupees.
 */

import { EngineError, type AgentView, type CliStatusView, type ModelStatusLite, type ModelTier, type RoleModelView } from './types';
import type { W4DeskHost } from './fake-w4';
import { AGENTS } from './fixtures';

export const FAKE_4H2_METHODS: readonly string[] = ['venture.models.cli.status', 'venture.models.roles'];

/** The engine's words, word for word (CLI_STATUS_WORDS, ROLE_WORDS). */
const HOSTED = 'The hosted app uses keys only.';
/** cliListLine: only Codex ran (Claude Code is located, never run, behind the terms gate), and its help listed a sign-in command. */
const LIST = 'Chausar ran only the version, help and sign-in commands of Codex on this computer. It never reads its sign-in files or keys.';
const ONE_AGENT = 'Your team runs as one agent, so each role uses the AI that serves its kind of job: fast for the work, main for checking and writing. Choose them under Your AI. A different AI for each role is not offered.';
const CONNECT = 'Connect your AI: until then, agents that need it wait.';
const TEMPLATES = 'Free. Nothing is sent to any AI.';

/** This fake desktop's look at its two tools (see the file head). */
const LOOK: readonly CliStatusView[] = [
  {
    cli: 'claude-code', label: 'Claude Code', found: true, path: '~\\.local\\bin\\claude.exe', version: null, flags: 'unknown', missingFlags: [],
    signedIn: 'unknown', terms: 'pending', lastTask: null, state: 'needs-setup',
    line: "Chausar hasn't yet accepted Anthropic's terms for running Claude Code.", fix: 'Use an Anthropic key for now.',
  },
  {
    cli: 'codex', label: 'Codex', found: true, path: 'C:\\Tools\\codex\\codex.exe', version: '0.131.0', flags: 'match', missingFlags: [],
    signedIn: 'yes', terms: 'not-needed', lastTask: null, state: 'needs-setup',
    line: 'Codex 0.131.0 is on this computer. Chausar runs it only through the reviewed Codex setup.', fix: "Chausar's reviewed setup for Codex isn't on this computer yet. Use an OpenAI key for now.",
  },
];

/** The list price lines of the key presets (presets.ts price tables, formatMicros, checked 15 Oct 2026). */
const PRICES: Readonly<Record<string, string>> = {
  'anthropic-haiku-5-5': 'USD 0.1000 in, USD 0.5000 out per million tokens. Anthropic list price for prompts up to 100K tokens, checked 15 Oct 2026.',
  'anthropic-sonnet-5-5': 'USD 2.0000 in, USD 10.0000 out per million tokens. Anthropic list price, checked 15 Oct 2026.',
  'openai-gpt-6-luna': 'USD 0.1000 in, USD 0.5000 out per million tokens. Third-party tracker, not confirmed by OpenAI, checked 15 Oct 2026, price unconfirmed.',
  'claude-code-cli': 'Runs on your own Claude Code plan. Chausar adds no charge.',
  'codex-cli': 'Runs on your own Codex plan. Chausar adds no charge.',
  'built-in-templates': TEMPLATES,
};

/** The tiers the fake agents' steps use: fast for the work, main for checking and writing. */
const TIERS: Readonly<Record<string, ModelTier[]>> = { producer: ['main'], publisher: ['main'], billing: ['main'] };
const BOTH: ModelTier[] = ['fast', 'main'];

const invalid = (message: string) => new EngineError('INVALID_VENTURE_REQUEST', message);

function exact(p: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(p).some((key) => !allowed.includes(key))) throw invalid('Send the required fields and nothing else.');
}

/** venture.models.cli.status {fresh?}: the look above, or TIER_UNAVAILABLE on the hosted app. */
export function fakeCliStatus(host: W4DeskHost, p: Record<string, unknown>): { clis: CliStatusView[]; line: string } {
  exact(p, ['fresh']);
  if (p.fresh !== undefined && typeof p.fresh !== 'boolean') throw invalid('Send fresh as true or false, or leave it out.');
  if (host.hosted()) throw new EngineError('TIER_UNAVAILABLE', HOSTED);
  return { clis: LOOK.map((view) => ({ ...view, missingFlags: [...view.missingFlags] })), line: LIST };
}

/** venture.models.roles {}: each agent's tiers, the preset serving each and its price line. */
export function fakeRoles(host: W4DeskHost, p: Record<string, unknown>): { roles: RoleModelView[]; line: string } {
  exact(p, []);
  const status = host.ask('venture.models.status', {}) as ModelStatusLite;
  const agents: AgentView[] = AGENTS[host.current()] ?? [];
  const roles: RoleModelView[] = agents.filter((agent) => agent.kind !== 'code').map((agent) => ({
    agent: agent.id, name: agent.name,
    tiers: (TIERS[agent.id] ?? BOTH).map((tier) => {
      const serving = status.tiers[tier];
      const usable = serving.usable && serving.presetId !== 'built-in-templates';
      return { tier, presetId: serving.presetId, model: serving.model, price: PRICES[serving.presetId] ?? 'No list price is recorded for this AI.', usable };
    }),
  }));
  const waiting = roles.length > 0 && roles.every((role) => role.tiers.every((tier) => !tier.usable));
  return { roles, line: waiting ? `${ONE_AGENT} ${CONNECT}` : ONE_AGENT };
}
