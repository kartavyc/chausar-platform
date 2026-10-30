// Chausar playbook kit: the methods of brand kits, asset records and voice consent (Ink v2 wave 5, package 5A4), in one
// place for the playbooks handler table (playbooks/index.ts). Each lives beside what it reads and writes. Written for
// Chausar; nothing here is learned from an outside source.
export { brandKitGetHandler, brandKitSetHandler } from './brand-kit.ts';
export { assetsListHandler, assetsRerunHandler, assetsReuseHandler } from './assets.ts';
export { voiceConsentListHandler, voiceConsentRecordHandler, voiceConsentRevokeHandler } from './voice-consent.ts';
