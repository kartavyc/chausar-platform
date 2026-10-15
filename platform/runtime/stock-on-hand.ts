import { check, type Fact } from './contracts.ts';
import type { Definition } from './ontology.ts';

/**
 * Stock on hand from a published quantity definition (jobs-ext's stock check). Pure: no state, no money.
 *
 * `balance: 'movements'`: each row is a signed movement (in positive, out negative); stock on a date is the
 * sum of an item's movements dated on or before it. `balance: 'snapshots'`: each row is a count taken on its
 * date (connector inventory reports); stock is, for each item and location, the latest count on or before the
 * date, added over locations. Two different counts for one item and location on that latest day cannot be
 * told apart, so neither is counted. An item whose rows name different units is not counted: units are never
 * converted. Quantities are exact whole numbers (BigInt), never floats.
 */
export type StockItem = { item: string; unit: string; quantity: bigint; rowIds: string[] };
export type StockResult = { items: StockItem[]; counted: Fact[]; excluded: { rowId: string; reason: string }[]; missing: Set<string> };
const SKIPPED = ['cancelled', 'void', 'draft', 'bounced'];
const ITEM = /^[^\u0000-\u001f]{1,120}$/;

export function quantityOf(value: unknown): bigint | null {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? BigInt(value) : null;
  return typeof value === 'string' && /^-?\d{1,18}$/.test(value) ? BigInt(value) : null;
}

/** `rows` are the visible, version-resolved facts of the definition's kind dated on or before the stock date. */
export function stockOnHand(rows: readonly Fact[], d: Definition): StockResult {
  check(d.measure === 'quantity' && typeof d.unit === 'string' && typeof d.item === 'string' && (d.balance === 'movements' || d.balance === 'snapshots'), 'INVALID_DEFINITION', 'Stock on hand needs a published quantity definition.');
  const excluded: StockResult['excluded'] = [], missing = new Set<string>(), usable: { fact: Fact; item: string; unit: string; quantity: bigint; place: string }[] = [];
  for (const row of rows.filter(f => f.kind === d.kind)) {
    const status = String(row.fields.status ?? '');
    if (SKIPPED.includes(status)) { excluded.push({ rowId: row.id, reason: `Status ${status} is excluded by the published counting rule.` }); continue; }
    const raw = row.fields[d.field];
    if (raw === undefined || raw === null) { check(d.nulls !== 'reject', 'MISSING_MEASURE_VALUE', `A ${d.name} fact is missing its required quantity.`); missing.add(row.id); excluded.push({ rowId: row.id, reason: 'A missing quantity is explicitly excluded by the dictionary.' }); continue; }
    const quantity = quantityOf(raw); check(quantity !== null, 'INVALID_QUANTITY', 'Stock calculations require exact whole-number quantities.');
    const item = row.fields[d.item], unit = row.fields[d.unit];
    if (typeof item !== 'string' || !ITEM.test(item)) { excluded.push({ rowId: row.id, reason: 'The row names no usable item, so its quantity is not counted.' }); continue; }
    if (typeof unit !== 'string' || unit.trim().length === 0 || unit.length > 40) { excluded.push({ rowId: row.id, reason: 'The row names no unit, so its quantity is not counted.' }); continue; }
    const place = d.location === undefined ? '' : typeof row.fields[d.location] === 'string' ? String(row.fields[d.location]) : '';
    usable.push({ fact: row, item, unit: unit.trim(), quantity: quantity!, place });
  }
  let chosen = usable;
  if (d.balance === 'snapshots') {
    const latest = new Map<string, typeof usable>();
    for (const row of usable) {
      const key = JSON.stringify([row.item, row.place]), day = row.fact.validFrom.slice(0, 10), held = latest.get(key), heldDay = held?.[0].fact.validFrom.slice(0, 10);
      if (!held || day > heldDay!) { for (const old of held ?? []) excluded.push({ rowId: old.fact.id, reason: 'A later count of the same item and location replaces this one.' }); latest.set(key, [row]); }
      else if (day === heldDay) held.push(row);
      else excluded.push({ rowId: row.fact.id, reason: 'A later count of the same item and location replaces this one.' });
    }
    chosen = [];
    for (const group of latest.values()) {
      if (group.length === 1) chosen.push(group[0]);
      else for (const row of group) excluded.push({ rowId: row.fact.id, reason: 'Two counts of the same item and location on the same day cannot be told apart, so neither is counted.' });
    }
  }
  const byItem = new Map<string, typeof usable>();
  for (const row of chosen) { const list = byItem.get(row.item); if (list) list.push(row); else byItem.set(row.item, [row]); }
  const items: StockItem[] = [], counted: Fact[] = [];
  for (const [item, list] of [...byItem.entries()].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) {
    if (new Set(list.map(row => row.unit)).size > 1) { for (const row of list) excluded.push({ rowId: row.fact.id, reason: 'This item has rows in different units, which cannot be added.' }); continue; }
    items.push({ item, unit: list[0].unit, quantity: list.reduce((sum, row) => sum + row.quantity, 0n), rowIds: list.map(row => row.fact.id) });
    counted.push(...list.map(row => row.fact));
  }
  return { items, counted, excluded, missing };
}
