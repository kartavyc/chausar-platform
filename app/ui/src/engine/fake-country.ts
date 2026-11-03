import { EngineError, type CountryLite, type ModelStatusLite } from './types';

/** Synthetic owner-location examples for rehearsal. The real handler asks the owner's selected AI. */
export function fakeCountrySuggestion(p: Record<string, unknown>, status: ModelStatusLite, hosted: boolean, countries: readonly CountryLite[]) {
  if (hosted) throw new EngineError('HOSTED_NOT_AVAILABLE', 'Country suggestions use your AI in the desktop app.');
  if (p === null || typeof p !== 'object' || Array.isArray(p) || ![Object.prototype, null].includes(Object.getPrototypeOf(p))) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send one request object.');
  if (Object.keys(p).some(key => key !== 'text') || !Object.hasOwn(p, 'text')) throw new EngineError('INVALID_VENTURE_REQUEST', 'Send the required fields and nothing else.');
  if (typeof p.text !== 'string') throw new EngineError('INVALID_VENTURE_REQUEST', 'What you want to do must be text.');
  const text = p.text.replace(/\r\n/g, '\n').trim();
  if (text.length < 10 || text.length > 2000) throw new EngineError('INVALID_VENTURE_REQUEST', 'What you want to do must be between 10 and 2000 characters.');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(text)) throw new EngineError('INVALID_VENTURE_REQUEST', 'What you want to do contains characters Chausar cannot keep.');
  if (status.tiers.fast.presetId === 'built-in-templates') return { country: null, evidence: null, source: 'not-connected' as const };
  if (!status.tiers.fast.usable) throw new EngineError('TIER_UNAVAILABLE', status.tiers.fast.reason);
  const matches = countries.filter(country => country.code !== 'XX').flatMap(country => {
    const phrase = new RegExp(`\\bI (?:live|am based|work) in (?:the )?${country.name}\\b`, 'i').exec(text)?.[0];
    return phrase ? [{ country, evidence: phrase }] : [];
  });
  return matches.length === 1 ? { country: structuredClone(matches[0]!.country), evidence: matches[0]!.evidence, source: 'ai' as const }
    : { country: null, evidence: null, source: 'ai' as const };
}
