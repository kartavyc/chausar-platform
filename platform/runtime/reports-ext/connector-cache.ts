/**
 * Connector pages kept between requests, so drawing the packs list again with nothing changed does not
 * recalculate them. A page is kept under what it depends on: the workspace, the facts (their identity,
 * correction and deletion), imports, conflicts and merges, the dictionary, members and policy, the other
 * parts' namespaces (connector imports among them) and this lane's trust settings (markings, seats); and
 * under the caller's seat, the page, the period and the language. Calculation receipts, answers and the
 * activity log are left out of the key, because drawing a page adds to them. A kept page is used only while
 * every receipt it points to is still in the workspace. Any change to what it depends on builds it afresh.
 */
import { createHash } from 'node:crypto';
import type { Context, State } from '../contracts.ts';
import { LANE_ID } from '../trust-ext/lane-state.ts';
import type { Language, Period } from './common.ts';
import type { ConnectorPage, ConnectorPageId } from './connector-pages.ts';

const MAX_WORKSPACES = 8, MAX_PAGES = 64;
type Kept = { fingerprint: string; pages: Map<string, Promise<ConnectorPage>> };
const kept = new Map<string, Kept>();
/** How many connector pages were built and how many were taken from the cache, for tests and diagnostics. */
export const connectorCacheStats = { builds: 0, hits: 0 };

/** A digest of everything a connector page reads from the workspace, without the records drawing a page adds. */
export function dependencyFingerprint(state: State): string {
  const hash = createHash('sha256');
  const part = (name: string, value: unknown) => { hash.update(name); hash.update('\u0000'); hash.update(JSON.stringify(value ?? null)); hash.update('\u0001'); };
  part('workspace', state.workspace.id);
  hash.update(`facts\u0000${state.facts.length}\u0000`);
  for (const fact of state.facts) hash.update(`${fact.id}\u0000${fact.sourceId}\u0000${fact.learnedAt}\u0000${fact.supersededAt ?? ''}\u0000${fact.deletedAt ?? ''}\u0000${fact.branch ?? ''}\n`);
  for (const key of ['imports', 'conflicts', 'merges', 'tombstones', 'sourceRules', 'ontology', 'members', 'policy'] as const) part(key, state[key]);
  for (const [name, value] of Object.entries(state.extensions ?? {}).sort(([a], [b]) => a.localeCompare(b))) {
    // This lane's reports and tools records change as pages are drawn and exported; its trust settings decide what a seat sees.
    part(`extension:${name}`, name === LANE_ID ? (value as { trust?: unknown } | undefined)?.trust : value);
  }
  return hash.digest('hex');
}

/** The kept page, or a newly built one kept for the next draw. A build that fails is not kept. */
export function keptConnectorPage(state: State, ctx: Context, id: ConnectorPageId, period: Period, lang: Language, build: () => Promise<ConnectorPage>): Promise<ConnectorPage> {
  const workspace = state.workspace.id, fingerprint = dependencyFingerprint(state);
  let entry = kept.get(workspace);
  if (!entry || entry.fingerprint !== fingerprint) {
    entry = { fingerprint, pages: new Map() }; kept.delete(workspace); kept.set(workspace, entry);
    while (kept.size > MAX_WORKSPACES) kept.delete(kept.keys().next().value!);
  }
  const key = JSON.stringify([ctx.memberId, ctx.role, ctx.epoch, ctx.channel ?? null, id, period.from, period.to, lang]);
  const found = entry.pages.get(key);
  if (found) {
    const receipts = new Set(state.receipts.map(receipt => receipt?.id));
    return found.then(page => {
      if (page.receipts.every(receipt => receipts.has(receipt.id))) { connectorCacheStats.hits++; return structuredClone(page); }
      entry.pages.delete(key);
      return keptConnectorPage(state, ctx, id, period, lang, build);
    });
  }
  connectorCacheStats.builds++;
  const built = build();
  const pages = entry.pages;
  pages.set(key, built);
  while (pages.size > MAX_PAGES) pages.delete(pages.keys().next().value!);
  built.catch(() => { if (pages.get(key) === built) pages.delete(key); });
  return built.then(page => structuredClone(page));
}
