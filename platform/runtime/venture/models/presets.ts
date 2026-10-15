// Chausar venture launcher, package P2 (models): the six model presets, their price tables and consent texts.
// Prices are list prices typed in by hand on the checkedOn date. The AI never computes a cost: cost.ts does.
import { digest } from '../records.ts';
import type { ModelAvailability, ModelPreset, ModelPresetId, ModelPriceTable } from '../contracts.ts';
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
  codexMissing: 'Needs the reviewed Codex host profile. See docs/venture/models.md.',
  codexReady: 'Uses the reviewed Codex install. A past gpt-6-luna probe failed.',
  templates: 'Nothing is sent anywhere.',
});

/** Availability as of now: the Claude Code check result and the Codex host profile both change it. */
export function availabilityOf(id: ModelPresetId, live: { claudeFound: boolean; codexProfile: boolean }): { availability: ModelAvailability; availabilityReason: string } {
  switch (id) {
    case 'anthropic-haiku-5-5':
    case 'anthropic-sonnet-5-5':
      return { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.anthropic };
    case 'openai-gpt-6-luna':
      return { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.luna };
    case 'claude-code-cli':
      return live.claudeFound
        ? { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.claudeFound }
        : { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.claudeMissing };
    case 'codex-cli':
      return live.codexProfile
        ? { availability: 'unverified', availabilityReason: AVAILABILITY_REASONS.codexReady }
        : { availability: 'needs-setup', availabilityReason: AVAILABILITY_REASONS.codexMissing };
    default:
      return { availability: 'ready', availabilityReason: AVAILABILITY_REASONS.templates };
  }
}

export function endpointFor(spec: PresetSpec): string {
  return ENDPOINTS[spec.kind];
}
