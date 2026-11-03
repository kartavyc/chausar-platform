// A2: the AI provider's own status page, read when a tool's test or last task failed, so the owner can tell "Claude is
// having problems right now, not you" from a problem on their side. It is one GET of the provider's public status JSON
// through the network guard and the fetch policy (politeFetch: Chausar's own user agent, nothing of the owner's sent),
// kept for two minutes, and shown with its source and the time it was read. Only the page's indicator is read; its text
// is never shown. Any failure to read it says nothing rather than guess.
import { politeFetch, type PoliteNet } from '../build/fetch-policy.ts';
import type { DelegateCli } from '../contracts.ts';

export type ProviderId = 'claude' | 'openai';
export type ProviderStatusView = { provider: ProviderId; label: string; state: 'ok' | 'problems' | 'unknown'; line: string | null; source: string; readAt: string };

/** The providers' public status pages (Atlassian Statuspage's summary JSON). */
export const STATUS_PAGES: Readonly<Record<ProviderId, { label: string; url: string }>> = Object.freeze({
  claude: Object.freeze({ label: 'Claude', url: 'https://status.claude.com/api/v2/status.json' }),
  openai: Object.freeze({ label: 'OpenAI', url: 'https://status.openai.com/api/v2/status.json' }),
});
/** Which provider's page a tool's trouble is read from. */
export const PROVIDER_OF: Readonly<Record<DelegateCli, ProviderId>> = Object.freeze({ 'claude-code': 'claude', codex: 'openai' });
export const STATUS_KEEP_MS = 2 * 60_000;
const READ_LIMIT = 65_536;
const PROBLEMS = new Set(['minor', 'major', 'critical', 'maintenance']);

export const STATUS_WORDS = Object.freeze({
  problems: (label: string) => `${label} is having problems right now, not you.`,
});

/** One provider's status from its summary JSON; unknown for any other shape. */
export function statusFromPage(provider: ProviderId, body: string, readAt: string): ProviderStatusView {
  const { label, url } = STATUS_PAGES[provider];
  const base = { provider, label, source: new URL(url).hostname, readAt };
  let indicator: unknown;
  try { indicator = (JSON.parse(body) as { status?: { indicator?: unknown } })?.status?.indicator; } catch { indicator = undefined; }
  if (indicator === 'none') return { ...base, state: 'ok', line: null };
  if (typeof indicator === 'string' && PROBLEMS.has(indicator)) return { ...base, state: 'problems', line: STATUS_WORDS.problems(label) };
  return { ...base, state: 'unknown', line: null };
}

/** A2: a tool's provider trouble for the screens: only when its status page says it has problems, else null. */
export async function providerTrouble(reader: ProviderStatusReader, cli: DelegateCli): Promise<{ line: string; source: string; readAt: string } | null> {
  const view = await reader.read(PROVIDER_OF[cli]);
  return view.state === 'problems' && view.line ? { line: view.line, source: view.source, readAt: view.readAt } : null;
}

/** Reads providers' status pages through the guard, each kept for two minutes. */
export class ProviderStatusReader {
  readonly #net: PoliteNet;
  readonly #now: () => Date;
  readonly #kept = new Map<ProviderId, { at: number; view: ProviderStatusView }>();

  constructor(options: { net?: PoliteNet; now?: () => Date } = {}) {
    this.#net = options.net ?? {};
    this.#now = options.now ?? (() => new Date());
  }

  /** A2 review: a read under way, which every other asker joins. */
  readonly #inflight = new Map<ProviderId, Promise<ProviderStatusView>>();

  async read(provider: ProviderId): Promise<ProviderStatusView> {
    const now = this.#now();
    const kept = this.#kept.get(provider);
    if (kept && now.getTime() - kept.at < STATUS_KEEP_MS) return structuredClone(kept.view);
    let flight = this.#inflight.get(provider);
    if (!flight) {
      flight = this.#fetch(provider, now).finally(() => { this.#inflight.delete(provider); });
      this.#inflight.set(provider, flight);
    }
    return structuredClone(await flight);
  }

  async #fetch(provider: ProviderId, now: Date): Promise<ProviderStatusView> {
    let view: ProviderStatusView;
    try {
      // A2 review: the provider's own page only; a redirect elsewhere is never followed.
      const answer = await politeFetch({ url: STATUS_PAGES[provider].url, headers: { accept: 'application/json' }, timeoutMs: 8_000, maxBytes: READ_LIMIT, maxRedirects: 0 }, this.#net);
      view = answer.status === 200 ? statusFromPage(provider, answer.body.toString('utf8'), now.toISOString()) : statusFromPage(provider, '', now.toISOString());
    } catch {
      view = statusFromPage(provider, '', now.toISOString());
    }
    this.#kept.set(provider, { at: now.getTime(), view });
    return view;
  }
}
