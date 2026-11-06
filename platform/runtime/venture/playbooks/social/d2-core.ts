// Original Chausar social input boundaries. Browser-safe so the owner desk and fake share refusals.
export const SOCIAL_D2_KEYS=['reel-from-clips','hook-variations','local-instagram','reply-inbox','post-diagnosis','video-ads','cross-posting'] as const;
export function requireSocial(ok: unknown, code = 'SOCIAL_INPUT_INVALID', words = 'Check the social inputs and try again.'): asserts ok { if (!ok) throw Object.assign(new Error(words), { code }); }
export function socialText(value: unknown, max = 5000): value is string { return typeof value === 'string' && value.trim().length > 0 && value.length <= max; }
export function socialNumber(value: unknown, max = 1_000_000_000): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= max; }
export function socialDay(value: unknown): value is string { return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0,10) === value; }
/** Only own client media is a cross-post source. A licence alone is not ownership. */
export function requireClipRights(value: unknown): void { const rights = value as { basis?: string; holder?: string } | null; requireSocial(rights?.basis === 'own-footage' && socialText(rights.holder,200),'RIGHTS_REQUIRED','Record the client ownership of these clips at intake.'); }
