// Chausar playbook: trading journal (wave 6, 6E7 / D49). From exact trade rows to legs, every charge and realised
// profit and loss, all in BigInt. Equity bought and sold on the same day is intraday up to the smaller side (bought and
// sold in time order); the rest is delivery. Charges are worked once per day, exchange and kind of leg (a contract note
// line), each rounded half up to the paisa; brokerage is worked per executed order. Delivery sells are matched to the
// oldest holdings first (opening holdings the owner entered, then delivery buys); futures and options are matched first
// in, first out per contract, and an open contract with a known expiry before the as-of day closes at zero on expiry.
// This journal never says what to trade. Pure and browser-safe. Written for Chausar.
import { check } from '../../../portable.ts';
import type { TradeRow } from './brokers.ts';
import { BROKER_RATES, EXCHANGE_PERIODS, GST, RATES_FROM, SEBI_FEE, STAMP_DUTY, STT_PERIODS, periodOn, type BrokerageRule, type BrokerId, type Exchange, type LegKind } from './rates.ts';

const BAD = 'TRADEBOOK_INVALID';
/** value4 (ten-thousandths of a rupee) times parts per billion, to paise: divide by 10^11. */
const PPB_TO_PAISE = 100_000_000_000n;

/** Round num/den half away from zero. */
export function roundDiv(num: bigint, den: bigint): bigint {
  const negative = num < 0n !== den < 0n, a = num < 0n ? -num : num, b = den < 0n ? -den : den;
  const q = (a * 2n + b) / (2n * b);
  return negative ? -q : q;
}
const paise4 = (value4: bigint) => roundDiv(value4, 100n);
const charge = (value4: bigint, ppb: number) => roundDiv(value4 * BigInt(ppb), PPB_TO_PAISE);

export type OpeningLot = { id: string; symbol: string; isin: string | null; boughtOn: string; quantity: string; costMinor: string; fmvMinor: string | null };
export type Leg = { tradeKey: string; broker: BrokerId; orderId: string; date: string; time: string | null; symbol: string; isin: string | null; exchange: Exchange; kind: LegKind; side: 'buy' | 'sell'; quantity: bigint; value4: bigint; expiry: string | null; seq: number };
export type ChargeLine = { brokerage: string; stt: string; exchange: string; sebi: string; ipft: string; stamp: string; dp: string; gst: string; total: string };
export type ContractNote = { broker: BrokerId; date: string; exchange: Exchange; kind: LegKind; buyMinor: string; sellMinor: string; orders: number; dpScrips: number; charges: ChargeLine };
export type RealisedLot = {
  kind: 'intraday' | 'fno' | 'capital'; symbol: string; isin: string | null; quantity: string; openedOn: string; closedOn: string;
  costMinor: string; saleMinor: string; pnlMinor: string; closedBy: 'trade' | 'expiry'; longTerm: boolean;
  grandfathered: { fmvMinor: string; costUsedMinor: string } | null; needsFmv: boolean;
};
export type OpenPosition = { symbol: string; kind: 'equity' | 'fno'; quantity: string; side: 'long' | 'short'; openedOn: string };
export type Unmatched = { symbol: string; date: string; quantity: string; line: string };
export type Journal = { legs: number; notes: ContractNote[]; realised: RealisedLot[]; open: OpenPosition[]; unmatched: Unmatched[]; totals: ChargeLine; brokers: BrokerId[] };

const keyOf = (t: { isin: string | null; symbol: string }) => t.isin || t.symbol.toUpperCase();
const order = (a: { date: string; time: string | null; seq: number }, b: { date: string; time: string | null; seq: number }) =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : (a.time ?? '') < (b.time ?? '') ? -1 : (a.time ?? '') > (b.time ?? '') ? 1 : a.seq - b.seq;

/** Split equity trades into intraday and delivery legs; futures and options are one leg each. */
export function legsOf(trades: readonly TradeRow[]): Leg[] {
  const sorted = trades.map((trade, seq) => ({ trade, seq })).sort((a, b) => order({ ...a.trade, seq: a.seq }, { ...b.trade, seq: b.seq }));
  for (const { trade } of sorted) check(trade.date >= RATES_FROM, BAD, `Row ${trade.line}: Chausar has checked charge rates only from ${RATES_FROM}. Add holdings bought earlier as opening holdings.`);
  const legs: Leg[] = [];
  const base = (trade: TradeRow, seq: number, kind: LegKind, quantity: bigint, value4: bigint): Leg => ({ tradeKey: `${trade.broker}|${trade.date}|${trade.symbol}|${trade.side}|${trade.tradeId}`, broker: trade.broker, orderId: trade.orderId,
    date: trade.date, time: trade.time, symbol: trade.symbol, isin: trade.isin, exchange: trade.exchange, kind, side: trade.side, quantity, value4, expiry: trade.expiry, seq });
  const groups = new Map<string, { trade: TradeRow; seq: number }[]>();
  for (const item of sorted) {
    if (item.trade.instrument !== 'equity') { legs.push(base(item.trade, item.seq, item.trade.instrument === 'option' ? 'options' : 'futures', BigInt(item.trade.quantity), BigInt(item.trade.value4))); continue; }
    const key = `${item.trade.broker}|${item.trade.date}|${keyOf(item.trade)}`;
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  for (const items of groups.values()) {
    const total = (side: 'buy' | 'sell') => items.filter(i => i.trade.side === side).reduce((sum, i) => sum + BigInt(i.trade.quantity), 0n);
    const left = { buy: total('buy') < total('sell') ? total('buy') : total('sell'), sell: 0n };
    left.sell = left.buy;
    for (const { trade, seq } of items) {
      const quantity = BigInt(trade.quantity), value = BigInt(trade.value4), side = trade.side;
      const intraday = left[side] < quantity ? left[side] : quantity;
      left[side] -= intraday;
      const intradayValue = intraday === quantity ? value : value * intraday / quantity;
      if (intraday > 0n) legs.push(base(trade, seq, 'intraday', intraday, intradayValue));
      if (quantity > intraday) legs.push(base(trade, seq, 'delivery', quantity - intraday, value - intradayValue));
    }
  }
  return legs.sort(order);
}

function brokerage(rule: BrokerageRule, value4: bigint): bigint {
  if (rule.kind === 'zero') return 0n;
  if (rule.kind === 'flat') return BigInt(rule.minor);
  let fee = charge(value4, rule.ppb);
  if (fee > BigInt(rule.capMinor)) fee = BigInt(rule.capMinor);
  if (rule.minMinor !== undefined && fee < BigInt(rule.minMinor)) fee = BigInt(rule.minMinor);
  return fee;
}
const line = (parts: Omit<ChargeLine, 'total'>): ChargeLine => ({ ...parts, total: String(Object.values(parts).reduce((sum, value) => sum + BigInt(value), 0n)) });
const zeroLine = (): ChargeLine => line({ brokerage: '0', stt: '0', exchange: '0', sebi: '0', ipft: '0', stamp: '0', dp: '0', gst: '0' });
export function addLines(a: ChargeLine, b: ChargeLine): ChargeLine {
  const sum = (key: keyof Omit<ChargeLine, 'total'>) => String(BigInt(a[key]) + BigInt(b[key]));
  return line({ brokerage: sum('brokerage'), stt: sum('stt'), exchange: sum('exchange'), sebi: sum('sebi'), ipft: sum('ipft'), stamp: sum('stamp'), dp: sum('dp'), gst: sum('gst') });
}

/** Every charge, per day, exchange and kind of leg. */
export function contractNotes(legs: readonly Leg[]): ContractNote[] {
  const groups = new Map<string, Leg[]>();
  for (const leg of legs) { const key = `${leg.broker}|${leg.date}|${leg.exchange}|${leg.kind}`; groups.set(key, [...(groups.get(key) ?? []), leg]); }
  const dpSeen = new Set<string>();
  const notes: ContractNote[] = [];
  for (const group of groups.values()) {
    const { broker, date, exchange, kind } = group[0]!;
    const stt = periodOn(STT_PERIODS, date), exch = periodOn(EXCHANGE_PERIODS, date);
    check(stt && exch, BAD, `No checked charge rates cover ${date}.`);
    const rates = BROKER_RATES[broker];
    const buy = group.filter(l => l.side === 'buy').reduce((s, l) => s + l.value4, 0n), sell = group.filter(l => l.side === 'sell').reduce((s, l) => s + l.value4, 0n);
    const orders = new Map<string, bigint>();
    for (const leg of group) orders.set(leg.orderId, (orders.get(leg.orderId) ?? 0n) + leg.value4);
    const brokerageMinor = [...orders.values()].reduce((sum, value) => sum + brokerage(rates.brokerage[kind], value), 0n);
    let dp = 0n, dpScrips = 0;
    if (kind === 'delivery') {
      const sold = new Map<string, bigint>();
      for (const leg of group) if (leg.side === 'sell') sold.set(keyOf(leg), (sold.get(keyOf(leg)) ?? 0n) + leg.value4);
      for (const [scrip, value] of sold) {
        const seen = `${broker}|${date}|${scrip}`;
        if (dpSeen.has(seen)) continue; dpSeen.add(seen);
        if (rates.dp.freeBelowMinor !== undefined && paise4(value) < BigInt(rates.dp.freeBelowMinor)) continue;
        dp += BigInt(rates.dp.minor); dpScrips += 1;
      }
    }
    const sttMinor = roundDiv(buy * BigInt(stt.buy[kind]) + sell * BigInt(stt.sell[kind]), PPB_TO_PAISE);
    const exchangeMinor = charge(buy + sell, exch.rate[exchange][kind]);
    const sebi = charge(buy + sell, SEBI_FEE.ppb), ipft = charge(buy + sell, exch.ipft[exchange][kind]);
    const stamp = charge(buy, STAMP_DUTY.buy[kind]);
    const gst = roundDiv((brokerageMinor + exchangeMinor + sebi + ipft + dp) * BigInt(GST.bps), 10000n);
    notes.push({ broker, date, exchange, kind, buyMinor: String(paise4(buy)), sellMinor: String(paise4(sell)), orders: orders.size, dpScrips,
      charges: line({ brokerage: String(brokerageMinor), stt: String(sttMinor), exchange: String(exchangeMinor), sebi: String(sebi), ipft: String(ipft), stamp: String(stamp), dp: String(dp), gst: String(gst) }) });
  }
  return notes.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.exchange < b.exchange ? -1 : 1);
}

/** Add calendar months to a day, holding the day of month (31 January plus one month is the last day of February). */
export function addMonths(day: string, months: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}
/** Listed equity is long term when held for more than twelve months. */
export const longTermOn = (boughtOn: string, soldOn: string) => soldOn > addMonths(boughtOn, 12);
export const GRANDFATHER_BEFORE = '2018-02-01';

type Lot = { quantity: bigint; value4: bigint; date: string; fmvMinor: string | null; opening: boolean; symbol?: string };
/** Take q units off the front of a lot, with their exact share of its value. */
function take(lot: Lot, quantity: bigint): bigint {
  const value = quantity === lot.quantity ? lot.value4 : lot.value4 * quantity / lot.quantity;
  lot.quantity -= quantity; lot.value4 -= value;
  return value;
}

/** Realised profit and loss, open positions and sells with no holding to match. asOf: the day expired contracts close. */
export function realise(legs: readonly Leg[], openings: readonly OpeningLot[], asOf: string): Pick<Journal, 'realised' | 'open' | 'unmatched'> {
  const realised: RealisedLot[] = [], open: OpenPosition[] = [], unmatched: Unmatched[] = [];
  const lot = (kind: RealisedLot['kind'], leg: { symbol: string; isin: string | null }, quantity: bigint, openedOn: string, closedOn: string, cost4: bigint, sale4: bigint, closedBy: RealisedLot['closedBy'], extra: Partial<RealisedLot> = {}) => {
    const cost = paise4(cost4), sale = paise4(sale4);
    realised.push({ kind, symbol: leg.symbol, isin: leg.isin, quantity: String(quantity), openedOn, closedOn, costMinor: String(cost), saleMinor: String(sale), pnlMinor: String(sale - cost), closedBy, longTerm: false, grandfathered: null, needsFmv: false, ...extra });
  };
  // Intraday and futures and options: first in, first out, either side may open.
  const positional = (kind: 'intraday' | 'fno', groupKey: (leg: Leg) => string) => {
    const books = new Map<string, { side: 'buy' | 'sell'; lots: (Lot & { leg: Leg })[] }>();
    for (const leg of legs.filter(l => kind === 'intraday' ? l.kind === 'intraday' : l.kind === 'futures' || l.kind === 'options')) {
      const key = groupKey(leg), book = books.get(key) ?? { side: leg.side, lots: [] };
      books.set(key, book);
      let quantity = leg.quantity, value = leg.value4;
      while (quantity > 0n && book.lots.length && book.side !== leg.side) {
        const head = book.lots[0]!, used = head.quantity < quantity ? head.quantity : quantity;
        const headValue = take(head, used), legValue = used === quantity ? value : value * used / quantity;
        quantity -= used; value -= legValue;
        const [cost, sale] = book.side === 'buy' ? [headValue, legValue] : [legValue, headValue];
        lot(kind, leg, used, head.date, leg.date, cost, sale, 'trade');
        if (head.quantity === 0n) book.lots.shift();
      }
      if (quantity > 0n) { if (!book.lots.length) book.side = leg.side; book.lots.push({ quantity, value4: value, date: leg.date, fmvMinor: null, opening: false, leg }); }
    }
    for (const book of books.values()) for (const rest of book.lots) {
      const expiry = rest.leg.expiry;
      if (kind === 'fno' && expiry && expiry < asOf) {
        const [cost, sale] = book.side === 'buy' ? [rest.value4, 0n] : [0n, rest.value4];
        lot('fno', rest.leg, rest.quantity, rest.date, expiry, cost, sale, 'expiry');
      } else open.push({ symbol: rest.leg.symbol, kind: kind === 'fno' ? 'fno' : 'equity', quantity: String(rest.quantity), side: book.side === 'buy' ? 'long' : 'short', openedOn: rest.date });
    }
  };
  positional('intraday', leg => `${leg.broker}|${leg.date}|${keyOf(leg)}`);
  positional('fno', leg => `${leg.broker}|${leg.symbol.toUpperCase()}|${leg.expiry ?? ''}`);
  // Delivery: holdings, oldest first; opening holdings come before any imported buy of the same scrip.
  const holdings = new Map<string, Lot[]>();
  for (const opening of [...openings].sort((a, b) => a.boughtOn < b.boughtOn ? -1 : a.boughtOn > b.boughtOn ? 1 : 0)) {
    const key = keyOf(opening);
    holdings.set(key, [...(holdings.get(key) ?? []), { quantity: BigInt(opening.quantity), value4: BigInt(opening.costMinor) * 100n, date: opening.boughtOn, fmvMinor: opening.fmvMinor, opening: true, symbol: opening.symbol }]);
  }
  for (const leg of legs.filter(l => l.kind === 'delivery')) {
    const key = keyOf(leg), lots = holdings.get(key) ?? [];
    holdings.set(key, lots);
    if (leg.side === 'buy') { lots.push({ quantity: leg.quantity, value4: leg.value4, date: leg.date, fmvMinor: null, opening: false, symbol: leg.symbol }); continue; }
    let quantity = leg.quantity, value = leg.value4;
    while (quantity > 0n && lots.length) {
      const head = lots[0]!, used = head.quantity < quantity ? head.quantity : quantity;
      const cost4 = take(head, used), sale4 = used === quantity ? value : value * used / quantity;
      quantity -= used; value -= sale4;
      const longTerm = longTermOn(head.date, leg.date);
      let extra: Partial<RealisedLot> = { longTerm };
      if (longTerm && head.date < GRANDFATHER_BEFORE) {
        if (head.fmvMinor === null) extra = { ...extra, needsFmv: true };
        else {
          // Cost is the higher of the actual cost and the lower of fair market value on 31 January 2018 and the sale value.
          const fmv4 = BigInt(head.fmvMinor) * 100n * used, lowerOf = fmv4 < sale4 ? fmv4 : sale4, used4 = cost4 > lowerOf ? cost4 : lowerOf;
          extra = { ...extra, grandfathered: { fmvMinor: String(paise4(fmv4)), costUsedMinor: String(paise4(used4)) } };
          lot('capital', leg, used, head.date, leg.date, used4, sale4, 'trade', extra);
          if (head.quantity === 0n) lots.shift();
          continue;
        }
      }
      lot('capital', leg, used, head.date, leg.date, cost4, sale4, 'trade', extra);
      if (head.quantity === 0n) lots.shift();
    }
    if (quantity > 0n) unmatched.push({ symbol: leg.symbol, date: leg.date, quantity: String(quantity), line: 'This sell has no earlier buy in the journal. Import the older tradebook, or add the holding as an opening holding.' });
  }
  for (const [, lots] of holdings) for (const rest of lots) if (rest.quantity > 0n) open.push({ symbol: rest.symbol ?? '', kind: 'equity', quantity: String(rest.quantity), side: 'long', openedOn: rest.date });
  return { realised, open, unmatched };
}

/** The whole journal from every imported trade (deduplicated across imports by trade identity) and opening holdings. */
export function buildJournal(trades: readonly TradeRow[], openings: readonly OpeningLot[], asOf: string): Journal {
  const seen = new Set<string>(), unique: TradeRow[] = [];
  for (const trade of trades) { const key = `${trade.broker}|${trade.date}|${trade.symbol}|${trade.side}|${trade.tradeId}`; if (seen.has(key)) continue; seen.add(key); unique.push(trade); }
  const legs = legsOf(unique), notes = contractNotes(legs);
  return { legs: legs.length, notes, ...realise(legs, openings, asOf), totals: notes.reduce((sum, note) => addLines(sum, note.charges), zeroLine()), brokers: [...new Set(unique.map(t => t.broker))] };
}
