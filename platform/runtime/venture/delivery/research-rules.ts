// Chausar delivery (Ink v2 wave 4, package 4J16, catalogue Q19): research evidence rules, in code, for any work that
// reads the web (a brief on a person, a market look, a fact check). No model decides what a source supports.
// - No source, no finding: a claim with nothing behind it is dropped, and the result says so.
// - A search result only points: until its page is read, nothing rests on it.
// - Pages from one site (www and subdomains fold together; two-part endings such as co.in are kept) make a claim
//   "single source"; two sites that agree make it corroborated; pages that give different values make it
//   conflicting, and a conflicting claim is not kept. A failed search says the search failed.
// - A number carries the time its page was read and its status. A sentinel (-1, empty, N/A, NaN) is never a number:
//   it is unknown, never zero.
// - The result says what it can support and what it cannot establish, with its coverage counted.
// Ideas taken, code written here: ultron layer3-grounding.ts and verifier.ts (ideas only), loamwright
// cross_reference_check.py, nexscope amazon-price-series.md, korean-tax-agent fact-check.md.
import type { IsoTime } from '../contracts.ts';

export type ResearchSource = { url: string; kind: 'page' | 'search-result'; readAt: IsoTime | null; value?: unknown };
export type ResearchClaim = { claim: string; sources: readonly ResearchSource[]; value?: unknown };
export type ResearchStatus = 'corroborated' | 'single-source' | 'conflicting' | 'pointer-only' | 'no-source' | 'search-failed';
export type JudgedClaim = {
  claim: string; status: ResearchStatus; kept: boolean; domains: string[];
  /** When the newest page behind it was read; null when no page was read. */
  readAt: IsoTime | null;
  /** The number the claim states, read by code; null when it states none or it is a sentinel. */
  value: string | null;
  line: string;
};

/** Endings under which a site's own name is the label before them (acme.co.in, not co.in). */
const TWO_PART = new Set(['co.in', 'gov.in', 'org.in', 'net.in', 'ac.in', 'edu.in', 'nic.in', 'res.in', 'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'com.sg', 'com.br', 'co.jp']);

/** The site a page belongs to, or null for an address that is not a web address. */
export function domainOf(url: string): string | null {
  let host: string;
  try { host = new URL(url).hostname.toLowerCase().replace(/\.$/, ''); } catch { return null; }
  const labels = host.replace(/^www\./, '').split('.').filter(Boolean);
  if (labels.length < 2) return null;
  const ending = labels.slice(-2).join('.');
  // Under a two-part ending the site is the label before it, so each department's site is its own (incometax.gov.in).
  if (TWO_PART.has(ending)) return labels.length >= 3 ? labels.slice(-3).join('.') : null;
  return labels.slice(-2).join('.');
}

const SENTINELS = new Set(['', '-1', 'n/a', 'na', '--', '-', 'none', 'null', 'unknown', 'nan', 'tbd']);

/** A value as a number in plain digits, or null when it is a sentinel or not a number at all. */
export function numberOf(raw: unknown): string | null {
  if (typeof raw === 'number') return Number.isFinite(raw) && raw !== -1 ? String(raw) : null;
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase();
  if (SENTINELS.has(text)) return null;
  // Read as digits, never as a float: leading zeros and trailing decimal zeros dropped.
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.replace(/,/g, ''));
  if (!match) return null;
  const whole = match[2].replace(/^0+(?=\d)/, ''), fraction = (match[3] ?? '').replace(/0+$/, '');
  const value = `${whole === '0' && !fraction ? '' : match[1]}${whole}${fraction ? `.${fraction}` : ''}`;
  return value === '-1' ? null : value;
}

const quoteClaim = (claim: string) => claim.trim().replace(/\s+/g, ' ').slice(0, 200);

/** One claim judged by the rules: its status, whether it is kept as a finding, and the line that says why. */
export function judgeClaim(claim: ResearchClaim, options: { searchFailed?: boolean } = {}): JudgedClaim {
  const words = quoteClaim(claim.claim);
  const pages = claim.sources.filter(source => source.kind === 'page' && domainOf(source.url) !== null);
  const domains = [...new Set(pages.map(source => domainOf(source.url)!))];
  const readTimes = pages.map(source => source.readAt).filter((at): at is IsoTime => typeof at === 'string').sort();
  const readAt = readTimes.at(-1) ?? null;
  const states = claim.value !== undefined;
  const value = states ? numberOf(claim.value) : null;
  const out = (status: ResearchStatus, kept: boolean, line: string): JudgedClaim => ({ claim: words, status, kept, domains, readAt, value, line: `${words} ${line}` });
  if (!claim.sources.length) return options.searchFailed ? out('search-failed', false, 'The search failed, so nothing backs this.') : out('no-source', false, 'No source, no finding.');
  if (!pages.length) {
    return claim.sources.some(source => source.kind === 'search-result')
      ? out('pointer-only', false, 'A search result only points; the page must be read before anything rests on it.')
      : out('no-source', false, 'No source, no finding: no page behind it could be read as a web address.');
  }
  const status: ResearchStatus = domains.length >= 2 ? 'corroborated' : 'single-source';
  if (states) {
    if (value === null) return out(status, false, 'The value is unknown (-1 or empty is not a number), so no figure is kept.');
    const given = pages.filter(source => source.value !== undefined).map(source => ({ value: numberOf(source.value), site: domainOf(source.url)!, readAt: source.readAt }));
    if (given.some(item => item.readAt === null) || pages.some(source => source.readAt === null)) return out(status, false, 'A number needs the time it was read; a page behind it has none.');
    const values = [...new Set(given.map(item => item.value ?? 'unknown'))];
    if (values.length > 1 || (values.length === 1 && values[0] !== value)) {
      return out('conflicting', false, `The pages disagree: ${given.map(item => `${item.value ?? 'unknown'} (${item.site})`).join(', ')}.`);
    }
  }
  return status === 'corroborated'
    ? out(status, true, `(corroborated by ${domains.length} sites: ${domains.join(', ')}${readAt ? `; read ${readAt.slice(0, 10)}` : ''})`)
    : out(status, true, `(single source: ${domains[0]}${readAt ? `; read ${readAt.slice(0, 10)}` : ''})`);
}

export type ResearchResult = {
  status: 'found' | 'nothing-found' | 'search-failed';
  findings: JudgedClaim[];
  dropped: JudgedClaim[];
  /** What the result can support, one line per kept finding, with its status. */
  supports: string[];
  /** What it cannot establish, one line per claim not kept, with why. */
  cannotEstablish: string[];
  coverage: { claims: number; kept: number; corroborated: number; singleSource: number; conflicting: number; dropped: number };
};

/** Every claim judged, the kept ones as findings, with what they support and cannot establish and the coverage. */
export function researchFindings(claims: readonly ResearchClaim[], options: { searchFailed?: boolean } = {}): ResearchResult {
  const judged = claims.map(claim => judgeClaim(claim, options));
  const findings = judged.filter(item => item.kept), dropped = judged.filter(item => !item.kept);
  return {
    status: findings.length ? 'found' : options.searchFailed ? 'search-failed' : 'nothing-found',
    findings, dropped,
    supports: findings.map(item => item.line),
    cannotEstablish: dropped.map(item => item.line),
    coverage: {
      claims: judged.length, kept: findings.length,
      corroborated: findings.filter(item => item.status === 'corroborated').length,
      singleSource: findings.filter(item => item.status === 'single-source').length,
      conflicting: judged.filter(item => item.status === 'conflicting').length,
      dropped: dropped.length,
    },
  };
}
