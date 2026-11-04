// A4 review round 2 (H2): what an AI must pass before a business connects it, shared by venture.models.connect
// (models/handlers.ts) and a gallery business reusing another business's AI (core/venture.ts).
import { check } from '../../contracts.ts';
import type { ModelPresetId, VentureDeps } from '../contracts.ts';
import { AVAILABILITY_REASONS, claudeTermsOpen, presetSpec } from './presets.ts';

/**
 * presetGates: this host can run it, Claude Code's terms are open, and the owner agreed to this preset's words as they
 * are now. liveGates (after the tool's own fresh check): the preset is available, and Codex has a trusted setup (A2).
 */
export function presetGates(deps: VentureDeps, presetId: ModelPresetId, consentDigest: unknown): void {
  const spec = presetSpec(presetId);
  check(!(deps.host === 'hosted-web' && spec.runsOn === 'this-computer'), 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.hostedCli);
  check(presetId !== 'claude-code-cli' || claudeTermsOpen(deps.claudeCodeTerms), 'PRESET_UNAVAILABLE', AVAILABILITY_REASONS.claudeTerms);
  check(typeof consentDigest === 'string' && consentDigest === spec.consentDigest, 'MODEL_CONSENT_REQUIRED', 'Read and accept what this connection sends before connecting.');
}
export function liveGates(deps: VentureDeps, presetId: ModelPresetId): void {
  const live = deps.models.presets().find(preset => preset.id === presetId);
  check(live && live.availability !== 'unavailable', 'PRESET_UNAVAILABLE', live?.availabilityReason ?? 'This AI option is not available here.');
  check(presetId !== 'codex-cli' || live.availability !== 'needs-setup', 'PRESET_UNAVAILABLE', live.availabilityReason);
}

/** All of connect's gates for an AI app on this computer, the tool's fresh check included. */
export async function cliGates(deps: VentureDeps, presetId: ModelPresetId, consentDigest: unknown): Promise<void> {
  presetGates(deps, presetId, consentDigest);
  if (presetSpec(presetId).runsOn === 'this-computer') await deps.models.checkCli(presetId);
  liveGates(deps, presetId);
}
