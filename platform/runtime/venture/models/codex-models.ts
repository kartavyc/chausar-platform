// A2: the models Codex offers this account, read from Codex itself (`codex debug models`, Codex 0.166.0), and the ones
// Chausar uses from them. The route (text calls) and quick agent work use gpt-6-luna; the agent's main work uses
// gpt-6.1-terra. When the list says the account does not offer one, the first model the list shows stands in; the
// fixed ids are used only when the list cannot be read. Only the model ids are kept: the catalogue's instructions,
// descriptions and every other field are dropped at once.
import type { ModelProcessResponse } from '../contracts.ts';

/** The fixed ids, used as they are only when Codex's own list cannot be read. */
export const CODEX_MODEL_DEFAULTS = Object.freeze({ route: 'gpt-6-luna', quick: 'gpt-6-luna', main: 'gpt-6.1-terra' });
export type CodexModels = { route: string; quick: string; main: string; listed: string[] | null; source: 'codex' | 'fallback' };
const MODEL_ID = /^[a-z0-9][a-z0-9._:-]{0,99}$/;
const MAX_MODELS = 200;

/** The model ids `codex debug models` shows for choosing (visibility "list"), in Codex's own priority order. */
export function parseCodexModels(stdout: string): string[] | null {
  let data: unknown;
  try { data = JSON.parse(stdout); } catch { return null; }
  const models = data && typeof data === 'object' && !Array.isArray(data) ? (data as { models?: unknown }).models : null;
  if (!Array.isArray(models)) return null;
  const listed: { slug: string; priority: number; at: number }[] = [];
  models.slice(0, MAX_MODELS).forEach((model, at) => {
    if (!model || typeof model !== 'object') return;
    const row = model as { slug?: unknown; visibility?: unknown; priority?: unknown };
    if (typeof row.slug !== 'string' || !MODEL_ID.test(row.slug) || row.visibility !== 'list') return;
    listed.push({ slug: row.slug, priority: typeof row.priority === 'number' && Number.isFinite(row.priority) ? row.priority : Number.MAX_SAFE_INTEGER, at });
  });
  if (!listed.length) return null;
  return [...new Set(listed.sort((a, b) => a.priority - b.priority || a.at - b.at).map(row => row.slug))];
}

/**
 * The models Chausar uses: each default when the list offers it; else, for the route and quick work, the closest small
 * model the list shows (its first -luna id), and for main work the list's first; the defaults without a list.
 */
export function pickCodexModels(listed: string[] | null): CodexModels {
  if (!listed || !listed.length) return { ...CODEX_MODEL_DEFAULTS, listed: null, source: 'fallback' };
  const small = listed.find(model => /-luna$/.test(model)) ?? listed[0]!;
  const pick = (wanted: string, otherwise: string) => (listed.includes(wanted) ? wanted : otherwise);
  return { route: pick(CODEX_MODEL_DEFAULTS.route, small), quick: pick(CODEX_MODEL_DEFAULTS.quick, small), main: pick(CODEX_MODEL_DEFAULTS.main, listed[0]!), listed: [...listed], source: 'codex' };
}

/** The list from one `codex debug models` answer: null unless it exited cleanly with the catalogue's shape. */
export function codexModelsFrom(response: ModelProcessResponse | null | undefined): CodexModels {
  return pickCodexModels(response && response.exitCode === 0 && typeof response.stdout === 'string' ? parseCodexModels(response.stdout) : null);
}
