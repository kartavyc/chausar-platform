// Chausar playbook: trading journal (wave 6, 6E7 / D49). Reads a broker's tradebook CSV into exact trade rows. The
// Zerodha Console tradebook columns were checked against public sample files (the paisa discussion and the
// bsteps/zerodha-fno-trade-journal sample). Groww, Upstox and Dhan publish no column list; their formats here follow
// public descriptions and are marked unchecked, and every refusal names the columns expected so the owner can rename a
// header. Money is BigInt: value4 is ten-thousandths of a rupee, so a price with up to four decimals stays exact.
// Pure and browser-safe. Written for Chausar; no broker code or sample data is copied.
import { check } from '../../../portable.ts';
import { csvRows } from '../../../csv.ts';
import type { BrokerId, Exchange } from './rates.ts';

export type Instrument = 'equity' | 'future' | 'option';
export type TradeRow = {
  broker: BrokerId; line: number; tradeId: string; orderId: string; date: string; time: string | null;
  symbol: string; isin: string | null; exchange: Exchange; instrument: Instrument; side: 'buy' | 'sell';
  quantity: string; value4: string; expiry: string | null;
};
export type BrokerFormat = { broker: BrokerId; name: string; checked: boolean; source: string; required: readonly string[]; optional: readonly string[]; note: string };

export const BROKER_FORMATS: Readonly<Record<BrokerId, BrokerFormat>> = Object.freeze({
  zerodha: { broker: 'zerodha', name: 'Zerodha Console tradebook', checked: true, source: 'https://github.com/bsteps/zerodha-fno-trade-journal',
    required: ['symbol', 'isin', 'trade_date', 'exchange', 'segment', 'trade_type', 'quantity', 'price', 'trade_id', 'order_id', 'order_execution_time'], optional: ['series', 'auction', 'expiry_date'],
    note: 'Checked against public sample tradebooks. One row per fill; fills of one order share an order id.' },
  groww: { broker: 'groww', name: 'Groww order history', checked: false, source: 'https://tradesviz.com/how-to-export-trades/groww/',
    required: ['symbol', 'isin', 'type', 'quantity', 'value', 'exchange', 'exchange order id', 'execution date and time', 'order status'], optional: ['stock name'],
    note: 'Not checked against a real export. Save the order history sheet as CSV. Stocks only; one row per order.' },
  upstox: { broker: 'upstox', name: 'Upstox trade report', checked: false, source: 'https://upstox.com/',
    required: ['date', 'company', 'exchange', 'segment', 'instrument type', 'expiry', 'trade num', 'side', 'quantity', 'price'], optional: ['amount', 'scrip code', 'strike price', 'trade time', 'order num', 'isin'],
    note: 'Not checked against a real export. Without an order number each trade counts as its own order for brokerage.' },
  dhan: { broker: 'dhan', name: 'Dhan trade history', checked: false, source: 'https://dhan.co/support/',
    required: ['date', 'symbol', 'buy/sell', 'exchange', 'segment', 'quantity', 'trade price', 'order id', 'trade id'], optional: ['time', 'name', 'isin', 'instrument', 'expiry', 'trade value'],
    note: 'Not checked against a real export.' },
});

export const MAX_TRADEBOOK_CHARS = 2 * 1024 * 1024;
export const MAX_TRADES = 20000;
const BAD = 'TRADEBOOK_INVALID';
const norm = (cell: string) => cell.replace(/^﻿/, '').trim().toLowerCase().replace(/\s+/g, ' ');

/** A decimal text as ten-thousandths, refusing more precision than four places (zeros after that are fine). */
export function tenThousandths(text: string, what: string, line: number): bigint {
  const clean = text.trim().replace(/,/g, '');
  const match = /^(\d{1,15})(?:\.(\d{1,8}))?$/.exec(clean);
  check(match, BAD, `Row ${line}: the ${what} "${text.slice(0, 30)}" is not a plain number.`);
  const frac = (match[2] ?? '').padEnd(8, '0');
  check(/^0*$/.test(frac.slice(4)), BAD, `Row ${line}: the ${what} has more than four decimal places.`);
  return BigInt(match[1]!) * 10000n + BigInt(frac.slice(0, 4));
}
function wholeQuantity(text: string, line: number): bigint {
  const units = tenThousandths(text, 'quantity', line);
  check(units > 0n && units % 10000n === 0n, BAD, `Row ${line}: the quantity must be a whole number above zero.`);
  return units / 10000n;
}
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
/** YYYY-MM-DD, DD-MM-YYYY, DD/MM/YYYY or DD-Mon-YYYY, with an optional time after it. */
export function tradeDate(text: string, line: number): { date: string; time: string | null } {
  const raw = text.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?))?/.exec(raw);
  let date: string | null = null, time: string | null = null;
  if (m) { date = `${m[1]}-${m[2]}-${m[3]}`; time = m[4] ?? null; }
  else if ((m = /^(\d{2})[-/](\d{2})[-/](\d{4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?)?/.exec(raw))) {
    date = `${m[3]}-${m[2]}-${m[1]}`;
    if (m[4]) { let hour = Number(m[4]); if (m[7]) { const pm = m[7].toLowerCase() === 'pm'; hour = hour % 12 + (pm ? 12 : 0); } time = `${String(hour).padStart(2, '0')}:${m[5]}${m[6] ? ':' + m[6] : ''}`; }
  } else if ((m = /^(\d{2})-([A-Za-z]{3})-(\d{4})/.exec(raw)) && MONTHS[m[2]!.toLowerCase()]) date = `${m[3]}-${MONTHS[m[2]!.toLowerCase()]}-${m[1]}`;
  check(date && !Number.isNaN(Date.parse(date + 'T00:00:00Z')) && new Date(date + 'T00:00:00Z').toISOString().slice(0, 10) === date, BAD, `Row ${line}: "${raw.slice(0, 30)}" is not a date Chausar reads.`);
  return { date, time };
}
function exchangeOf(text: string, line: number): Exchange {
  const value = text.trim().toUpperCase();
  if (['NSE', 'NFO', 'NSE_EQ', 'NSE_FO', 'NSE-EQ', 'NSE-FO'].includes(value)) return 'NSE';
  if (['BSE', 'BFO', 'BSE_EQ', 'BSE_FO', 'BSE-EQ', 'BSE-FO'].includes(value)) return 'BSE';
  check(false, BAD, `Row ${line}: only NSE and BSE trades are read; "${text.slice(0, 20)}" is not one.`);
}
function sideOf(text: string, line: number): 'buy' | 'sell' {
  const value = text.trim().toLowerCase();
  if (['buy', 'b', 'bought'].includes(value)) return 'buy';
  if (['sell', 's', 'sold'].includes(value)) return 'sell';
  check(false, BAD, `Row ${line}: "${text.slice(0, 20)}" is neither buy nor sell.`);
}
/** Equity, or a future or option told by its segment, instrument type or symbol ending. */
function instrumentOf(segment: string, symbol: string, type: string, line: number): Instrument {
  const seg = segment.trim().toUpperCase(), kind = type.trim().toUpperCase(), sym = symbol.trim().toUpperCase();
  if (/^OPT/.test(kind) || /(?:CE|PE)$/.test(sym) && /FO|F&O|DERIV|NFO|BFO/.test(seg)) return 'option';
  if (/^FUT/.test(kind) || /FUT$/.test(sym) && /FO|F&O|DERIV|NFO|BFO/.test(seg)) return 'future';
  if (/FO|F&O|DERIV|NFO|BFO/.test(seg)) check(false, BAD, `Row ${line}: the contract ${sym.slice(0, 40)} is neither a future nor an option Chausar can tell.`);
  check(seg === '' || /^(?:EQ|EQUITY|CASH|NSE_EQ|BSE_EQ|BE|SM)$/.test(seg) || /EQ/.test(seg), BAD, `Row ${line}: the segment "${segment.slice(0, 20)}" is not equity, futures or options.`);
  check(kind === '' || /^(?:EQ|EQUITY|STOCK|STK)$/.test(kind), BAD, `Row ${line}: the instrument type "${type.slice(0, 20)}" is not one Chausar reads.`);
  return 'equity';
}
function text(value: string | undefined, max: number, what: string, line: number, required = true): string {
  const clean = (value ?? '').trim();
  check(!required || clean.length > 0, BAD, `Row ${line}: the ${what} is empty.`);
  check(clean.length <= max && !/[\u0000-\u001f\u007f]/.test(clean), BAD, `Row ${line}: the ${what} is too long or holds hidden characters.`);
  return clean;
}

/** Find the header row (some exports put a few lines above it) and the format whose columns it holds. */
function headerOf(rows: string[][], broker: BrokerId | null): { format: BrokerFormat; index: number; columns: Map<string, number> } {
  const formats = broker ? [BROKER_FORMATS[broker]] : Object.values(BROKER_FORMATS);
  for (let index = 0; index < Math.min(rows.length, 25); index += 1) {
    const cells = rows[index]!.map(norm);
    for (const format of formats) {
      if (format.required.every(name => cells.includes(name))) return { format, index, columns: new Map(cells.map((name, at) => [name, at] as const)) };
    }
  }
  const expected = broker ? BROKER_FORMATS[broker].required.join(', ') : 'a Zerodha, Groww, Upstox or Dhan tradebook';
  check(false, BAD, `Chausar could not find the tradebook columns. Expected ${expected}.`);
}

/** Read one tradebook. broker: the owner's choice, or null to tell it from the columns. */
export function readTradebook(csv: string, broker: BrokerId | null = null): { broker: BrokerId; format: BrokerFormat; trades: TradeRow[] } {
  check(typeof csv === 'string' && csv.length > 0 && csv.length <= MAX_TRADEBOOK_CHARS, BAD, 'Add a tradebook CSV of at most 2 MB.');
  let rows: string[][];
  try { rows = csvRows(csv); } catch (error) { check(false, BAD, `The CSV could not be read: ${(error as Error).message}`); }
  const { format, index, columns } = headerOf(rows, broker);
  const cell = (cells: string[], name: string) => { const at = columns.get(name); return at === undefined ? '' : (cells[at] ?? ''); };
  const trades: TradeRow[] = [];
  const keys = new Set<string>();
  for (let at = index + 1; at < rows.length; at += 1) {
    const cells = rows[at]!, line = at + 1;
    if (cells.every(value => !value.trim())) continue;
    let trade: TradeRow;
    if (format.broker === 'zerodha') {
      const quantity = wholeQuantity(cell(cells, 'quantity'), line), price = tenThousandths(cell(cells, 'price'), 'price', line);
      const when = tradeDate(cell(cells, 'order_execution_time') || cell(cells, 'trade_date'), line);
      const day = tradeDate(cell(cells, 'trade_date'), line).date;
      const symbol = text(cell(cells, 'symbol'), 60, 'symbol', line), expiry = cell(cells, 'expiry_date').trim();
      trade = { broker: 'zerodha', line, tradeId: text(cell(cells, 'trade_id'), 60, 'trade id', line), orderId: text(cell(cells, 'order_id'), 60, 'order id', line), date: day, time: when.time,
        symbol, isin: text(cell(cells, 'isin'), 20, 'ISIN', line, false) || null, exchange: exchangeOf(cell(cells, 'exchange'), line), instrument: instrumentOf(cell(cells, 'segment'), symbol, '', line),
        side: sideOf(cell(cells, 'trade_type'), line), quantity: String(quantity), value4: String(quantity * price), expiry: expiry ? tradeDate(expiry, line).date : null };
    } else if (format.broker === 'groww') {
      const status = cell(cells, 'order status').trim().toLowerCase();
      if (status && !['executed', 'complete', 'completed', 'traded'].includes(status)) continue;
      const quantity = wholeQuantity(cell(cells, 'quantity'), line), value = tenThousandths(cell(cells, 'value'), 'value', line);
      const when = tradeDate(cell(cells, 'execution date and time'), line), order = text(cell(cells, 'exchange order id'), 60, 'order id', line);
      trade = { broker: 'groww', line, tradeId: order, orderId: order, date: when.date, time: when.time, symbol: text(cell(cells, 'symbol'), 60, 'symbol', line),
        isin: text(cell(cells, 'isin'), 20, 'ISIN', line, false) || null, exchange: exchangeOf(cell(cells, 'exchange'), line), instrument: 'equity',
        side: sideOf(cell(cells, 'type'), line), quantity: String(quantity), value4: String(value), expiry: null };
    } else if (format.broker === 'upstox') {
      const quantity = wholeQuantity(cell(cells, 'quantity'), line), price = tenThousandths(cell(cells, 'price'), 'price', line);
      const when = tradeDate(cell(cells, 'date') + (cell(cells, 'trade time') ? ' ' + cell(cells, 'trade time') : ''), line);
      const symbol = text(cell(cells, 'scrip code') || cell(cells, 'company'), 60, 'company', line), number = text(cell(cells, 'trade num'), 60, 'trade number', line), expiry = cell(cells, 'expiry').trim();
      trade = { broker: 'upstox', line, tradeId: number, orderId: cell(cells, 'order num').trim() || number, date: when.date, time: when.time, symbol,
        isin: text(cell(cells, 'isin'), 20, 'ISIN', line, false) || null, exchange: exchangeOf(cell(cells, 'exchange'), line), instrument: instrumentOf(cell(cells, 'segment'), symbol, cell(cells, 'instrument type'), line),
        side: sideOf(cell(cells, 'side'), line), quantity: String(quantity), value4: String(quantity * price), expiry: expiry && expiry !== '-' ? tradeDate(expiry, line).date : null };
    } else {
      const quantity = wholeQuantity(cell(cells, 'quantity'), line), price = tenThousandths(cell(cells, 'trade price'), 'trade price', line);
      const when = tradeDate(cell(cells, 'date') + (cell(cells, 'time') ? ' ' + cell(cells, 'time') : ''), line);
      const symbol = text(cell(cells, 'symbol'), 60, 'symbol', line), expiry = cell(cells, 'expiry').trim();
      trade = { broker: 'dhan', line, tradeId: text(cell(cells, 'trade id'), 60, 'trade id', line), orderId: text(cell(cells, 'order id'), 60, 'order id', line), date: when.date, time: when.time, symbol,
        isin: text(cell(cells, 'isin'), 20, 'ISIN', line, false) || null, exchange: exchangeOf(cell(cells, 'exchange'), line), instrument: instrumentOf(cell(cells, 'segment'), symbol, cell(cells, 'instrument'), line),
        side: sideOf(cell(cells, 'buy/sell'), line), quantity: String(quantity), value4: String(quantity * price), expiry: expiry && expiry !== '-' ? tradeDate(expiry, line).date : null };
    }
    const key = tradeKey(trade);
    check(!keys.has(key), BAD, `Row ${line}: trade ${trade.tradeId} on ${trade.date} is listed twice.`);
    keys.add(key); trades.push(trade);
    check(trades.length <= MAX_TRADES, BAD, `A tradebook holds at most ${MAX_TRADES} trades. Split it by month.`);
  }
  check(trades.length > 0, BAD, 'The tradebook has no executed trades.');
  return { broker: format.broker, format, trades };
}

/** A trade's identity across imports: trade ids can repeat on other days, so the day and contract are part of it. */
export function tradeKey(trade: Pick<TradeRow, 'broker' | 'tradeId' | 'date' | 'symbol' | 'side'>): string {
  return `${trade.broker}|${trade.date}|${trade.symbol}|${trade.side}|${trade.tradeId}`;
}
