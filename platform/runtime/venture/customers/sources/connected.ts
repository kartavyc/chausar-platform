// Chausar lead sources, shared by every business: what the answer of a tool the owner connected (an MCP server) may
// become. Pure: the call itself is made by agent-runtime/business-mcp.ts, after the owner approved exactly that call.
// - The answer is data, never instructions. A row becomes a prospect only when it holds a name and a web page; the
//   page is where the lead says it was found. An email is kept only when the row itself holds one that reads as an
//   email address. Nothing is repaired, completed or guessed.
// - Some calls are refused whatever the owner approves (the founder's rules): anything that names LinkedIn (copy and
//   open only), and anything that says it gets round a site's blocks, CAPTCHAs or robots rules. This reads only the
//   tool's own name, description and inputs, so it is a floor, not proof that a tool's data is allowed: the owner's
//   card says the tool's own terms apply.
import { check } from '../../../portable.ts';
import type { Prospect } from './prospect.ts';

/** The licence line every lead from a connected tool carries. */
export const connectedLicence = (server: string): string => `From ${server}, a tool you connected. Its own terms apply.`;

const MAX_ROWS = 100;
const NAME_KEYS = ['name', 'title', 'company', 'company_name', 'companyName', 'business_name', 'businessName', 'organization'];
const SITE_KEYS = ['website', 'homepage', 'site', 'domain'];
const PAGE_KEYS = ['url', 'link', 'source_url', 'sourceUrl', 'profile_url', 'profileUrl'];
const LIST_KEYS = ['results', 'items', 'data', 'leads', 'companies', 'places', 'businesses', 'records', 'rows'];
const EMAIL = /^[^\s@<>()",;:]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;
const DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

const isObject = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value);
const line = (value: unknown, max: number): string => (typeof value === 'string' && !/[\u0000-\u001F\u007F]/.test(value.trim()) ? value.trim().slice(0, max) : '');
const first = (row: Record<string, unknown>, keys: readonly string[], max: number): string => {
  for (const key of keys) { const text = line(row[key], max); if (text) return text; }
  return '';
};
function pageOf(value: string): string | null {
  const text = DOMAIN.test(value.toLowerCase()) ? `https://${value.toLowerCase()}/` : value;
  try { const url = new URL(text); return (url.protocol === 'https:' || url.protocol === 'http:') && !url.username && !url.password ? url.href : null; } catch { return null; }
}

/** The list of rows inside an answer: the answer itself, or the list under one well-known key, at most two levels down. */
function rowsIn(value: unknown, depth = 0): unknown[] {
  if (Array.isArray(value)) return value;
  if (!isObject(value) || depth > 2) return [];
  for (const key of LIST_KEYS) if (Array.isArray(value[key])) return value[key] as unknown[];
  for (const key of LIST_KEYS) { const rows = rowsIn(value[key], depth + 1); if (rows.length) return rows; }
  return [];
}

/** An MCP tool result's data: its structured content, else the JSON in its text parts. A result marked as an error holds none. */
function dataOf(result: unknown): unknown[] {
  if (Array.isArray(result)) return result;
  if (!isObject(result) || result.isError === true) return [];
  if (result.structuredContent !== undefined) return rowsIn(result.structuredContent);
  if (Array.isArray(result.content)) {
    for (const part of result.content) {
      if (!isObject(part) || part.type !== 'text' || typeof part.text !== 'string') continue;
      try { const rows = rowsIn(JSON.parse(part.text)); if (rows.length) return rows; } catch { /* words, not data */ }
    }
    return [];
  }
  return rowsIn(result);
}

/**
 * The prospects a connected tool's answer holds, at most a hundred. Each needs a name and a web page; a row without
 * either is left out, as is anything that is not a plain row. Never throws: an answer nobody can read is no prospects,
 * so a call that was charged still ends with what it gave.
 */
export function prospectsFromTool(result: unknown, source: { server: string }): Prospect[] {
  const licence = connectedLicence(source.server);
  const prospects: Prospect[] = [];
  for (const row of dataOf(result).slice(0, MAX_ROWS)) {
    if (!isObject(row)) continue;
    const name = first(row, NAME_KEYS, 120);
    const site = pageOf(first(row, SITE_KEYS, 500)), page = pageOf(first(row, PAGE_KEYS, 500));
    if (!name || !(site ?? page)) continue;
    const listed = line(row.email, 254) || (Array.isArray(row.emails) ? line(row.emails[0], 254) : '');
    const email = listed.toLowerCase();
    const id = typeof row.id === 'string' || typeof row.id === 'number' ? String(row.id).slice(0, 100) : '';
    prospects.push({
      osmId: null, ...(id ? { placeId: `${source.server}:${id}` } : {}), name, address: line(row.address, 400) || line(row.location, 400),
      website: site, sourceUrl: page ?? site!, licence, emails: EMAIL.test(email) ? [email] : [],
    });
  }
  return prospects;
}

const LINKEDIN = /linkedin|lnkd\.in/i;
const EVASION = /captcha|prox(?:y|ies)|stealth|anti[-_ ]?detect|undetect|bypass|evad|unblock|spoof/i;

/**
 * Refuses (LEAD_SOURCE_FORBIDDEN) a connected lead call the founder's rules never allow, read from the tool's own
 * name, description and the exact inputs: LinkedIn in any form, or getting round a site's blocks.
 */
export function refuseForbiddenLeadCall(tool: { name: string; description?: string }, input: unknown): void {
  const words = `${tool.name} ${tool.description ?? ''} ${JSON.stringify(input ?? null)}`;
  check(!LINKEDIN.test(words), 'LEAD_SOURCE_FORBIDDEN', 'Chausar never searches or reads LinkedIn through a tool. LinkedIn is copy and open only.');
  check(!EVASION.test(words), 'LEAD_SOURCE_FORBIDDEN', 'Chausar never uses a tool that gets round a site\'s blocks, CAPTCHAs or robots rules.');
}
