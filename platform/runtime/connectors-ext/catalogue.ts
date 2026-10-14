import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { APPROVED_CONNECTOR_GROUPS } from '../connectors.ts';
import type { SourceRecipe } from './recipe.ts';
import type { Depth, OperationStatus, Road } from './types.ts';

/**
 * The coverage board: every approved group, each operation with its depth (import, read, full),
 * its road in, its status and its evidence. A claim is per operation and per system, never per logo.
 * Synthetic fixtures are the only evidence in this build, so nothing here is labelled supported:
 * supported needs the bench and a hidden business, which a person must run.
 */
export type CatalogueOperation = {
  id: string; label: string; depth: Depth; road: Road; status: OperationStatus; owner: 'connectors-ext' | 'core' | 'writeback';
  recipes: string[]; evidence: { synthetic: number; madeToOrder: number; realWithConsent: number };
  tier: 'supported' | 'experimental' | 'planned'; limitation: string;
};
export type CatalogueGroup = {
  id: string; name: string; family: string; products: readonly string[]; scope: string;
  depth: Depth | null; operations: CatalogueOperation[]; liveVerified: false;
};
export type ReadOperation = { group: string; id: string; label: string; recipe: string; live: boolean; limitation: string };
export type WriteRow = { system: string; action: string; status: string };

const FIXTURES = fileURLToPath(new URL('../../../fixtures/connectors/', import.meta.url));
/** Synthetic evidence: fixture files kept for each group. Real-with-consent and made-to-order cases are counted by a person, never here. */
function syntheticCases(group: string): number {
  const folder = `${FIXTURES}${group}`;
  try { return existsSync(folder) ? readdirSync(folder).filter(name => !name.startsWith('.')).length : 0; } catch { return 0; }
}

/** Core operations that predate this lane and stay in the core importer and connector service. */
const CORE: Record<string, CatalogueOperation[]> = {
  tally: [op('day-book-xml', 'Day Book through Tally\'s XML interface on this computer', 'read', 'interface', 'tested', 'core', [], 'Loopback port 9000 only. Tally on another computer is experimental.'),
    op('tally-xml-file', 'Exported Tally XML file', 'import', 'file', 'tested', 'core', [], 'Needs every ledger classified before totals count.')],
  'zoho-books': [op('invoices-api', 'Invoices through Zoho Books\' own interface', 'read', 'interface', 'tested', 'core', [], 'Sign-in through the engine credential broker; a real organisation is not yet verified.'),
    op('zoho-json-file', 'Exported Zoho Books invoices JSON', 'import', 'file', 'tested', 'core', [], 'Net subtotal only; gross totals never stand in for revenue.')],
  'gst-downloads': [op('gstr-2b-core', 'GSTR-2B B2B section (core importer)', 'import', 'file', 'tested', 'core', [], 'Superseded by the connector-factory GSTR-2B recipe with the portal summary check.')],
  shopify: [op('orders-json-file', 'Exported Shopify orders JSON', 'import', 'file', 'tested', 'core', [], 'Original orders are billed claims only.')],
};
/** Groups whose only road needs something a person must arrange. */
const BLOCKED: Record<string, string> = {
  'gst-provider': 'A live e-invoice or e-way bill read needs a licensed GST service provider. Files you download are read today.',
  'whatsapp-business': 'Message history cannot be read through the WhatsApp Business Platform; sending templates belongs to the write catalogue.',
  'quick-commerce': 'Seller panels have no public interface. Exported reports are read through recipes.',
  'restaurant-partners': 'Partner panels have no public interface. Exported payout reports are read through recipes.',
};
function op(id: string, label: string, depth: Depth, road: Road, status: OperationStatus, owner: CatalogueOperation['owner'], recipes: string[], limitation: string): CatalogueOperation {
  return { id, label, depth, road, status, owner, recipes, evidence: { synthetic: 0, madeToOrder: 0, realWithConsent: 0 }, tier: status === 'planned' || status === 'not-possible' ? 'planned' : 'experimental', limitation };
}
const rank: Record<Depth, number> = { import: 1, read: 2, full: 3 };

export function buildCatalogue(recipes: Iterable<SourceRecipe>, reads: readonly ReadOperation[], writes: readonly WriteRow[] | null): CatalogueGroup[] {
  const byGroup = new Map<string, SourceRecipe[]>();
  for (const recipe of recipes) byGroup.set(recipe.group, [...(byGroup.get(recipe.group) ?? []), recipe]);
  return APPROVED_CONNECTOR_GROUPS.map(group => {
    const synthetic = syntheticCases(group.id);
    const operations: CatalogueOperation[] = (CORE[group.id] ?? []).map(item => ({ ...item, evidence: { ...item.evidence } }));
    for (const recipe of byGroup.get(group.id) ?? []) {
      if (recipe.decoder === 'api-records') continue;
      operations.push({ ...op(recipe.id, recipe.title, 'import', 'file', 'tested', 'connectors-ext', [recipe.id],
        recipe.totals.kind === 'report' ? 'The export carries no total of its own; the person enters the total from the system\'s report.' : 'Checked against the export\'s own totals.'), evidence: { synthetic, madeToOrder: 0, realWithConsent: 0 } });
    }
    for (const read of reads.filter(item => item.group === group.id))
      operations.push({ ...op(read.id, read.label, 'read', 'interface', read.live ? 'tested' : 'experimental', 'connectors-ext', [read.recipe], read.limitation), evidence: { synthetic, madeToOrder: 0, realWithConsent: 0 } });
    if (writes === null) {
      if (['tally', 'zoho-books', 'razorpay', 'shopify', 'google-workspace', 'whatsapp-business'].includes(group.id))
        operations.push(op('write', 'Write with exact approval and read-back', 'full', 'interface', 'planned', 'writeback', [], 'The write catalogue is not installed in this build.'));
    } else for (const row of writes.filter(item => item.system === group.id))
      operations.push(op(`write:${row.action}`, `Write: ${row.action}`, 'full', 'interface', row.status === 'tested' ? 'tested' : row.status === 'planned' ? 'planned' : 'experimental', 'writeback', [], 'Every write waits for exact approval and is read back.'));
    if (!operations.length) operations.push(op('none', 'No road in yet', 'import', 'file', 'planned', 'connectors-ext', [], BLOCKED[group.id] ?? 'No recipe or interface has been built for this group yet.'));
    else if (BLOCKED[group.id]) operations.push(op('blocked', 'Live interface', 'read', 'interface', 'not-possible', 'connectors-ext', [], BLOCKED[group.id]));
    const reached = operations.filter(item => item.status === 'tested' || item.status === 'experimental').map(item => item.depth);
    const depth = reached.length ? reached.reduce((a, b) => rank[b] > rank[a] ? b : a) : null;
    return { id: group.id, name: group.name, family: group.family, products: [...group.products], scope: group.scope, depth, operations, liveVerified: false };
  });
}
/** The four counts the coverage board shows, plus the blocked list. */
export function boardCounts(groups: readonly CatalogueGroup[]) {
  const ops = groups.flatMap(group => group.operations);
  return {
    systems: groups.length, systemsWithARoad: groups.filter(group => group.depth !== null).length,
    operations: { tested: ops.filter(o => o.status === 'tested').length, experimental: ops.filter(o => o.status === 'experimental').length, planned: ops.filter(o => o.status === 'planned').length, notPossible: ops.filter(o => o.status === 'not-possible').length },
    byDepth: { import: groups.filter(g => g.depth === 'import').length, read: groups.filter(g => g.depth === 'read').length, full: groups.filter(g => g.depth === 'full').length },
    blocked: groups.flatMap(group => group.operations.filter(o => o.status === 'not-possible' || (o.status === 'planned' && o.owner !== 'writeback')).map(o => ({ group: group.id, operation: o.id, reason: o.limitation }))),
  };
}
