/**
 * Exchange rates (BK-19): dated, sourced and entered by the owner; never fetched. A rate is an
 * exact fraction of two integer strings (`units` of the workspace currency per `per` units of
 * the foreign currency), never a float. This file converts nothing: it lists the rates and
 * counts the facts in another currency that have no rate for their date ("not counted").
 */
import { check, now, type State } from '../contracts.ts';
import { canSeeFact } from '../memory.ts';
import type { MethodSpec } from '../modules/types.ts';
import { input, isoDay, member, text, writeBooks, type BooksState } from './books-common.ts';
import { peekSection } from './state.ts';

export type RateEntry = { currency: string; on: string; units: string; per: string; source: string; enteredBy: string; memberId: string; at: string };
const CURRENCY = /^[A-Z]{3}$/;
const POSITIVE = /^[1-9]\d{0,17}$/;
const MAX_RATES = 5000;

/** The rate list inside the Books section (kept beside the shared lists, created on first write). */
function ratesOf(books: BooksState): RateEntry[] {
  const holder = books as unknown as Record<string, unknown>;
  if (!Array.isArray(holder.rates)) holder.rates = [];
  return holder.rates as RateEntry[];
}
export function peekRates(state: State): RateEntry[] {
  const list = peekSection<Record<string, unknown>>(state, 'books')?.rates;
  return Array.isArray(list) ? list as RateEntry[] : [];
}
const view = (r: RateEntry) => ({ currency: r.currency, on: r.on, rate: { units: r.units, per: r.per }, source: r.source, enteredBy: r.enteredBy, at: r.at });

export const rateMethods: Record<string, MethodSpec> = {
  'books.rates': { permission: 'read', handler(ctx, payload, host) {
    input(payload, []); const state = host.store.read(); const rates = peekRates(state); const home = state.workspace.currency;
    const known = new Set(rates.map(r => `${r.currency} ${r.on}`)); const missing = new Map<string, number>();
    for (const fact of state.facts) {
      if (fact.deletedAt || !canSeeFact(host.store, ctx, fact)) continue;
      const currency = fact.fields.currency;
      // Rows converted when they were read carry their own rate and are counted already.
      if (typeof currency !== 'string' || currency === home || fact.fields._fx) continue;
      if (!known.has(`${currency} ${fact.validFrom.slice(0, 10)}`)) missing.set(currency, (missing.get(currency) ?? 0) + 1);
    }
    return {
      rates: [...rates].sort((a, b) => b.on.localeCompare(a.on) || a.currency.localeCompare(b.currency)).map(view),
      notCounted: [...missing.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([currency, rows]) => ({ currency, rows })),
    };
  } },
  'books.setRate': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['currency', 'on', 'rate', 'source'], ['currency', 'on', 'rate', 'source']);
    const rate = request.rate as Record<string, unknown> | null;
    check(typeof request.currency === 'string' && CURRENCY.test(request.currency) && isoDay(request.on) && text(request.source, 300)
      && !!rate && typeof rate === 'object' && !Array.isArray(rate) && Object.keys(rate).sort().join() === 'per,units' && POSITIVE.test(String(rate.units)) && POSITIVE.test(String(rate.per))
      && typeof rate.units === 'string' && typeof rate.per === 'string', 'INVALID_BOOKS_REQUEST', 'Give a three-letter currency, the date, the rate as two whole numbers and where it came from.');
    check(request.currency !== host.store.read().workspace.currency, 'INVALID_BOOKS_REQUEST', 'The home currency needs no rate.');
    check(request.on <= now().slice(0, 10), 'INVALID_BOOKS_REQUEST', 'A rate cannot be dated in the future.');
    const who = member(host.store.read(), ctx);
    const entry: RateEntry = { currency: request.currency, on: request.on, units: rate.units as string, per: rate.per as string, source: request.source.trim(), enteredBy: who.name, memberId: who.id, at: now() };
    await writeBooks(host.store, ctx, 'admin', books => {
      const rates = ratesOf(books); const index = rates.findIndex(r => r.currency === entry.currency && r.on === entry.on);
      if (index >= 0) rates.splice(index, 1); check(rates.length < MAX_RATES, 'RATE_LIST_FULL', 'The rate table is full.'); rates.push(entry);
    });
    return view(entry);
  } },
  'books.removeRate': { permission: 'admin', async handler(ctx, payload, host) {
    const request = input(payload, ['currency', 'on'], ['currency', 'on']);
    check(typeof request.currency === 'string' && CURRENCY.test(request.currency) && isoDay(request.on), 'INVALID_BOOKS_REQUEST', 'Name the currency and the date.');
    await writeBooks(host.store, ctx, 'admin', books => {
      const rates = ratesOf(books); const index = rates.findIndex(r => r.currency === request.currency && r.on === request.on);
      check(index >= 0, 'RATE_NOT_FOUND', 'There is no rate for this currency on this date.'); rates.splice(index, 1);
    });
    return { currency: request.currency as string, on: request.on as string, removed: true as const };
  } },
};
