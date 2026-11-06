// Read-only brand resolution. No delivery or handler imports, so publishing can recheck current rules safely.
import type { State } from '../../../contracts.ts';
import type { BrandKitRecord, VentureRecord, VoiceRecord } from '../../contracts.ts';
import { BANNED_WORDS, listRecords } from '../../records.ts';
import type { BrandKitField, KitSource, ResolvedKit } from './records-media.ts';
export const BRAND_KIT_FIELDS: readonly BrandKitField[] = Object.freeze(['colours', 'fonts', 'logoFileId', 'voice', 'samples', 'bannedWords', 'bannedTopics', 'competitors', 'claims']);
export function currentKit(state: State, venture: VentureRecord, clientId: string): BrandKitRecord | null { return listRecords(state, 'venture-brand-kit', venture.id).filter(item => item.clientId === clientId).sort((a, b) => b.version - a.version)[0] ?? null; }
const given = (value: unknown) => Array.isArray(value) ? value.length > 0 : value !== null && value !== undefined;
export function resolveKit(state: State, venture: VentureRecord, clientId: string): ResolvedKit {
    const kit = currentKit(state, venture, clientId);
    // Equivalent to voicesInUse's latest-per-key rule, restricted to the one key used by brand fallback.
    const voice = listRecords(state, 'venture-voice', venture.id).filter(item => !item.draft && item.language === 'en' && item.channel === null).reduce<VoiceRecord | null>((latest, item) => !latest || item.version >= latest.version ? item : latest, null);
    const active = voice?.on ? voice : null;
    const fallback: Partial<Record<BrandKitField, {
        value: unknown;
        source: KitSource;
    }>> = { ...(active?.sections.howITalk.length ? { voice: { value: [...active.sections.howITalk], source: 'business-voice' } } : {}), bannedWords: active?.sections.neverUse.length ? { value: [...active.sections.neverUse], source: 'business-voice' } : { value: [...BANNED_WORDS], source: 'house-style' } };
    return Object.fromEntries(BRAND_KIT_FIELDS.map(field => { if (kit && given(kit[field]))
        return [field, { value: structuredClone(kit[field]), source: 'client-kit' }]; if (fallback[field])
        return [field, fallback[field]]; return [field, { value: field === 'logoFileId' ? null : [], source: 'default' }]; })) as ResolvedKit;
}
