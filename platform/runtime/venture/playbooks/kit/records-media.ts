// Chausar playbook kit: brand kits, asset records and voice consent (Ink v2 wave 5, package 5A4). Package 5-0 named the
// record bodies and the methods' shapes as placeholders; 5A4 replaces them here, never in contracts.ts. Types only.
// Written for Chausar; nothing here is learned from an outside source.

/** venture-brand-kit: one client's brand kit, a placeholder until 5A4 lands. */
export type BrandKitBody = { placeholder: true };
/** venture.brandKit.set's kit, as the owner sends it; 5A4 names its fields. */
export type BrandKitInput = Readonly<Record<string, unknown>>;
/** venture.brandKit.get's and .set's answer. */
export type BrandKitView = { placeholder: true };
/** venture-asset: where one delivered file came from, a placeholder until 5A4 lands. */
export type AssetBody = { placeholder: true };
/** venture.assets.list's answer. */
export type AssetsView = { placeholder: true };
/** venture.assets.rerun's answer. */
export type AssetRerunView = { placeholder: true };
/** venture.assets.reuse's answer. */
export type AssetReuseView = { placeholder: true };
/** venture-voice-consent: one versioned consent, a placeholder until 5A4 lands. */
export type VoiceConsentBody = { placeholder: true };
/** venture.voiceConsent.record's and .revoke's answer. */
export type VoiceConsentView = { placeholder: true };
/** venture.voiceConsent.list's answer. */
export type VoiceConsentsView = { placeholder: true };
