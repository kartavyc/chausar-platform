// Chausar venture launcher, package P2 (models): the six model presets, their price tables and consent texts.
// Prices are list prices typed in by hand on the checkedOn date. The AI never computes a cost: cost.ts does.
// Ink v2 wave 4 (4H1): a command-line preset's availability also follows what the last look at the installed tool
// found (a flag it does not know, signed out), and turns 'ready' only once a real task on it worked.
import { digest } from '../records.ts';
import type { CliFinding, DelegateCli, ModelAvailability, ModelPreset, ModelPresetId, ModelPriceTable } from '../contracts.ts';
import { ENDPOINTS } from './types.ts';

export const PRICES_CHECKED_ON = '2026-10-15';

function priceTable(input: string, output: string, source: string, confirmed: boolean): ModelPriceTable {
  return { currency: 'USD', inputMicrosPerMillion: input, outputMicrosPerMillion: output, source, checkedOn: PRICES_CHECKED_ON, confirmed };
}

export function apiConsentText(provider: 'Anthropic' | 'OpenAI'): string {
  return `Chausar will send your idea, your answers, your plan's words and practice-client conversations to ${provider} with your key, so the model can write questions, plans, briefs and practice drafts. It never sends your books, receipts, keys or real client details under this consent. Real client work is shown to you first and sent only after you approve it. Every call is listed under What was sent, with its cost. If your privacy setting is send nothing, connecting changes it to send question shapes; setting it back to send nothing stops every call.`;
}

export function cliConsentText(tool: 'Claude Code' | 'Codex'): string {
  return `Chausar will run ${tool} on this computer, signed in with your own account, and give it your idea, your answers, your plan's words and practice-client conversations. It never passes your books, receipts, keys or real client details under this consent. Real client work is shown to you first and sent only after you approve it. Every run is listed under What was sent. If your privacy setting is send nothing, connecting changes it to send question shapes; setting it back to send nothing stops every run.`;
}

export const TEMPLATE_CONSENT_TEXT = 'Chausar will use its built-in templates. Nothing is sent to any AI service.';

/** A preset without its live availability. port.presets() adds availability as of now. */
export type PresetSpec = Omit<ModelPreset, 'availability' | 'availabilityReason'>;

/**
 * What the screen says next to 'ready' or 'unverified'. No preset here has been tried against a live account by
 * Chausar, so none claims it: a key option says it was not checked with a live key, a command-line option that it
 * was not tried on a real task.
 */
export const VERIFICATION_NOTES = Object.freeze({
  key: 'Not yet checked with a live key.',
  cli: 'Not yet checked on a real task.',
});

function verificationNoteOf(fields: Omit<PresetSpec, 'consentDigest' | 'verificationNote'>): string | null {
  if (fields.verification === 'built-in') return null;
  return fields.needsKey ? VERIFICATION_NOTES.key : VERIFICATION_NOTES.cli;
}

function spec(fields: Omit<PresetSpec, 'consentDigest' | 'verificationNote'>): PresetSpec {
  return Object.freeze({ ...fields, verificationNote: verificationNoteOf(fields), consentDigest: digest(fields.consentText) });
}

export const PRESETS: readonly PresetSpec[] = Object.freeze([
  spec({
    id: 'anthropic-haiku-5-5', label: 'Claude Haiku 5.5', kind: 'anthropic-messages', model: 'claude-haiku-5-5', modelEditable: false,
    tiers: ['fast'], needsKey: true, keyHint: 'Create a key at console.anthropic.com', runsOn: 'provider-api',
    priceTable: priceTable('100000', '500000', 'Anthropic list price for prompts up to 100K tokens', true),
    consentText: apiConsentText('Anthropic'), verification: 'not-live-verified',
  }),
  spec({
    id: 'anthropic-sonnet-5-5', label: 'Claude Sonnet 5.5', kind: 'anthropic-messages', model: 'claude-sonnet-5-5', modelEditable: false,
    tiers: ['main'], needsKey: true, keyHint: 'Create a key at console.anthropic.com', runsOn: 'provider-api',
    priceTable: priceTable('2000000', '10000000', 'Anthropic list price', true),
    consentText: apiConsentText('Anthropic'), verification: 'not-live-verified',
  }),
  spec({
    id: 'openai-gpt-6-luna', label: 'GPT-6 Luna', kind: 'openai-responses', model: 'gpt-6-luna', modelEditable: true,
    tiers: ['fast', 'main'], needsKey: true, keyHint: 'Create a key at platform.openai.com', runsOn: 'provider-api',
    priceTable: priceTable('100000', '500000', 'Third-party tracker, not confirmed by OpenAI', false),
    consentText: apiConsentText('OpenAI'), verification: 'not-live-verified',
  }),
  spec({
    id: 'claude-code-cli', label: 'Claude Code on this computer', kind: 'claude-cli', model: 'claude-sonnet-5-5', modelEditable: false,
    tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'this-computer', priceTable: null,
    consentText: cliConsentText('Claude Code'), verification: 'not-live-verified',
  }),
  spec({
    id: 'codex-cli', label: 'Codex on this computer', kind: 'codex-cli', model: 'gpt-6-luna', modelEditable: false,
    tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'this-computer', priceTable: null,
    consentText: cliConsentText('Codex'), verification: 'not-live-verified',
  }),
  spec({
    id: 'built-in-templates', label: 'Built-in templates (no AI)', kind: 'template', model: null, modelEditable: false,
    tiers: ['fast', 'main'], needsKey: false, keyHint: null, runsOn: 'chausar-engine', priceTable: null,
    consentText: TEMPLATE_CONSENT_TEXT, verification: 'built-in',
  }),
]);

export function presetSpec(id: ModelPresetId): PresetSpec {
  const found = PRESETS.find(preset => preset.id === id);
  if (!found) throw new Error(`Unknown preset ${id}`);
  return found;
}

export const AVAILABILITY_REASONS = Object.freeze({
  anthropic: 'Uses your Anthropic key. Not yet checked with a live key.',
  luna: 'Not yet tried on a real account, and a past probe failed. Type the model id your account shows. Costs are estimates.',
  claudeMissing: 'Install Claude Code and sign in. Chausar checks for it when you connect.',
  claudeFound: 'Found on this computer. Not yet tried on a real task.',
  codexMissing: "Chausar's reviewed setup for Codex isn't on this computer yet. Use an OpenAI key for now.",
  codexReady: 'Uses the reviewed Codex install. A past gpt-6-luna probe failed.',
  templates: 'Nothing is sent anywhere.',
  hostedCli: 'Runs only in the desktop app, on your own computer. The hosted web app uses keys only.',
  claudeTerms: "Chausar hasn't yet accepted Anthropic's terms for running Claude Code. Use an Anthropic key for now.",
  cliWorked: 'Found on this computer. Its last task worked.',
  codexNoAnswer: 'Codex did not answer its version check on this computer. Update or reinstall it, then check again.',
});

/** The Claude Code terms gate (onboarding spec 2.8): open only when the trusted host says 'accepted'. */
export function claudeTermsOpen(terms: 'accepted' | 'pending' | undefined): boolean {
  return terms === 'accepted';
}

// ---------------------------------------------------------------------------
// The owner's command-line tools in words (4H1), shared by availability and the CLI status
// ---------------------------------------------------------------------------

export const CLI_LABELS: Readonly<Record<DelegateCli, string>> = Object.freeze({ 'claude-code': 'Claude Code', codex: 'Codex' });
const CLI_KEYS: Readonly<Record<DelegateCli, string>> = Object.freeze({ 'claude-code': 'an Anthropic key', codex: 'an OpenAI key' });
const CLI_SIGN_IN: Readonly<Record<DelegateCli, string>> = Object.freeze({
  'claude-code': 'Open a terminal, run claude and sign in, then check again.',
  codex: 'Open a terminal, run codex login, then check again.',
});
/** One line of what was found and, when something needs doing, one fix. */
export type CliWords = { line: string; fix: string | null };

/** 'Claude Code 2.3.1', or the name alone when no version number was read. */
export function cliNamed(cli: DelegateCli, version: string | null): string {
  return version ? `${CLI_LABELS[cli]} ${version}` : CLI_LABELS[cli];
}

/** '--a', '--a and --b', '--a, --b and --c'. */
function listWords(items: readonly string[]): string {
  return items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** "Your Claude Code 2.3.1 doesn't know --safe-mode." with "Update it, or use an Anthropic key." */
export function cliFlagsWords(cli: DelegateCli, version: string | null, missing: readonly string[]): CliWords {
  return { line: `Your ${cliNamed(cli, version)} doesn't know ${listWords(missing)}.`, fix: `Update it, or use ${CLI_KEYS[cli]}.` };
}

/** Signed out, as the tool's own status command said it. */
export function cliSignedOutWords(cli: DelegateCli, version: string | null): CliWords {
  return { line: `${cliNamed(cli, version)} is on this computer but not signed in.`, fix: CLI_SIGN_IN[cli] };
}

/** The line and its fix as one sentence pair, for an error or an availability reason. */
export function cliSentence(words: CliWords): string {
  return words.fix ? `${words.line} ${words.fix}` : words.line;
}

/** What stops a found tool from serving, from the last look at it: a flag it does not know, or signed out. */
export function cliProblemWords(finding: CliFinding | null | undefined): CliWords | null {
  if (!finding || !finding.answered || finding.replay) return null;
  if (finding.flags === 'mismatch') return cliFlagsWords(finding.cli, finding.version, finding.missingFlags);
  if (finding.signedIn === 'no') return cliSignedOutWords(finding.cli, finding.version);
  return null;
}

/**
 * Availability as of now: the Claude Code check result, the Claude Code terms gate and the Codex host profile all
 * change it. On the hosted web server no command-line tool ever runs, so both are unavailable there whatever the
 * server has installed. Until Chausar accepts Anthropic's terms for running Claude Code (claudeTerms 'accepted'),
 * Claude Code needs setup, before the vault and in it alike. With a look at the installed tool (4H1): a flag it does
 * not know or a signed-out tool needs setup in those words; a tool that answered turns 'ready' only once a real task
 * on it worked (worked), and stays 'unverified' until then.
 */
export function availabilityOf(id: ModelPresetId, live: {
  claudeFound: boolean; codexProfile: boolean; hosted?: boolean; claudeTerms?: 'accepted' | 'pending';
  claude?: CliFinding | null; codex?: CliFinding | null; worked?: Partial<Record<DelegateCli, boolean>>;
}): { availability: ModelAvailability; availabilityReason: string } {
  if (live.hosted && (id === 'claude-code-cli' || id === 'codex-cli')) return { availability: 'unavailable', availabilityReason: AVAILABILITY_REASONS.hostedCli };
  if (id === 'claude-code-cli' && !claudeTermsOpen(live.claudeTerms)) return { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.claudeTerms };
  switch (id) {
    case 'anthropic-haiku-5-5':
    case 'anthropic-sonnet-5-5':
      return { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.anthropic };
    case 'openai-gpt-6-luna':
      return { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.luna };
    case 'claude-code-cli': {
      const problem = cliProblemWords(live.claude);
      if (problem) return { availability: 'needs-setup', availabilityReason: cliSentence(problem) };
      if (!live.claudeFound) return { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.claudeMissing };
      return live.worked?.['claude-code']
        ? { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.cliWorked }
        : { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.claudeFound };
    }
    case 'codex-cli': {
      if (!live.codexProfile) return { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.codexMissing };
      if (live.codex && !live.codex.answered) return { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.codexNoAnswer };
      const problem = cliProblemWords(live.codex);
      if (problem) return { availability: 'needs-setup', availabilityReason: cliSentence(problem) };
      return live.codex?.answered && live.worked?.codex
        ? { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.cliWorked }
        : { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.codexReady };
    }
    default:
      return { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.templates };
  }
}

export function endpointFor(spec: PresetSpec): string {
  return ENDPOINTS[spec.kind];
}
