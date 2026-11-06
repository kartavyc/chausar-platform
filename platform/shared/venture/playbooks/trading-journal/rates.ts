// Chausar playbook: trading journal (wave 6, 6E7 / D49). The charge rates as versioned data, each with its source, the
// day it took effect and how it was checked. Rates are parts per billion of the traded value (or of the premium for
// options), so code multiplies BigInt minor units and never a float. 'official' was read on the issuer's own page
// (exchange notice, broker charge page); 'secondary' was read where a broker quotes the issuer; 'unchecked' was not
// confirmed. Read on 1 November 2026. Brokerage pages show no start day, so a broker's rates carry the day they were
// read and are applied to every checked day; older trades may have been charged differently. Pure data. Written for Chausar.

export type RateRead = 'official' | 'secondary' | 'unchecked';
export type RateSource = { title: string; url: string; read: RateRead; checkedOn: string };
export type LegKind = 'intraday' | 'delivery' | 'futures' | 'options';
export type Exchange = 'NSE' | 'BSE';
/** Parts per billion: 0.1% is 1,000,000; 0.00297% is 29,700; Rs 10 a crore is 1,000. */
export type Ppb = number;

export const RATES_READ_ON = '2026-11-01';
/** Trades before this day have no checked statutory rates here, so they are refused rather than guessed. */
export const RATES_FROM = '2024-10-01';

export type SttPeriod = { from: string; to: string | null; buy: Record<LegKind, Ppb>; sell: Record<LegKind, Ppb>; source: RateSource };
export const STT_PERIODS: readonly SttPeriod[] = Object.freeze([
  { from: '2024-10-01', to: '2026-03-31',
    buy: { delivery: 1_000_000, intraday: 0, futures: 0, options: 0 },
    sell: { delivery: 1_000_000, intraday: 250_000, futures: 200_000, options: 1_000_000 },
    source: { title: 'BSE notice 20260331-7 (rates in force from 1 October 2024 until 31 March 2026)', url: 'https://www.kotakneo.com/uploads/20260331_7_c3867dfe94.pdf', read: 'official', checkedOn: RATES_READ_ON } },
  { from: '2026-04-01', to: null,
    buy: { delivery: 1_000_000, intraday: 0, futures: 0, options: 0 },
    sell: { delivery: 1_000_000, intraday: 250_000, futures: 500_000, options: 1_500_000 },
    source: { title: 'BSE notice 20260331-7, as per the Finance Act 2026 (NSE circular NSE/FATAX/73524 not read)', url: 'https://www.kotakneo.com/uploads/20260331_7_c3867dfe94.pdf', read: 'official', checkedOn: RATES_READ_ON } },
]);

export type ExchangePeriod = { from: string; to: string | null; rate: Record<Exchange, Record<LegKind, Ppb>>; ipft: Record<Exchange, Record<LegKind, Ppb>>; source: RateSource };
export const EXCHANGE_PERIODS: readonly ExchangePeriod[] = Object.freeze([
  { from: '2024-10-01', to: '2026-02-28',
    rate: { NSE: { intraday: 29_700, delivery: 29_700, futures: 17_300, options: 350_300 }, BSE: { intraday: 37_500, delivery: 37_500, futures: 0, options: 325_000 } },
    ipft: { NSE: { intraday: 1_000, delivery: 1_000, futures: 1_000, options: 5_000 }, BSE: { intraday: 0, delivery: 0, futures: 0, options: 0 } },
    source: { title: 'NSE circular NSE/FA/64232 and BSE notice 20240927-37, as quoted by Zerodha', url: 'https://zerodha.com/marketintel/bulletin/391488', read: 'secondary', checkedOn: RATES_READ_ON } },
  { from: '2026-03-01', to: null,
    rate: { NSE: { intraday: 30_700, delivery: 30_700, futures: 18_300, options: 355_300 }, BSE: { intraday: 37_500, delivery: 37_500, futures: 0, options: 325_000 } },
    ipft: { NSE: { intraday: 0, delivery: 0, futures: 0, options: 0 }, BSE: { intraday: 0, delivery: 0, futures: 0, options: 0 } },
    source: { title: 'NSE circular NSE/FA/73061 (investor protection charge folded in), as quoted by Upstox and Zerodha', url: 'https://zerodha.com/charges', read: 'secondary', checkedOn: RATES_READ_ON } },
]);
/** BSE cash rates are for groups A and B; other groups differ and are not read from a tradebook. */
export const BSE_GROUP_NOTE = 'BSE cash trades use the group A and B rate; other groups are charged differently.';

export const SEBI_FEE: { readonly ppb: Ppb; readonly source: RateSource } = Object.freeze({ ppb: 1_000 as Ppb,
  source: { title: 'SEBI turnover fee, Rs 10 a crore (notification SEBI/LAD-NRO/GN/2019/03), as quoted by brokers', url: 'https://zerodha.com/charges', read: 'secondary' as RateRead, checkedOn: RATES_READ_ON } });

export const STAMP_DUTY: { buy: Record<LegKind, Ppb>; source: RateSource } = Object.freeze({
  buy: { delivery: 150_000, intraday: 30_000, futures: 20_000, options: 30_000 },
  source: { title: 'Indian Stamp Act rates from 1 July 2020, buy side, as quoted by brokers (statute not read)', url: 'https://zerodha.com/charges', read: 'secondary' as RateRead, checkedOn: RATES_READ_ON } });

/** GST in basis points on brokerage, exchange charges, the SEBI fee, the investor protection charge and DP charges. */
export const GST: { readonly bps: number; readonly source: RateSource } = Object.freeze({ bps: 1800 as number,
  source: { title: 'GST at 18% on broker services, as stated on broker charge pages (CBIC notification not read)', url: 'https://zerodha.com/charges', read: 'secondary' as RateRead, checkedOn: RATES_READ_ON } });

/** One brokerage rule: a share of the order value capped (and floored) in paise, or a flat fee per executed order. */
export type BrokerageRule = { kind: 'zero' } | { kind: 'flat'; minor: string } | { kind: 'percent-cap'; ppb: Ppb; capMinor: string; minMinor?: string };
export type BrokerRates = {
  broker: BrokerId; name: string;
  brokerage: Record<LegKind, BrokerageRule>;
  /** DP charge per scrip per delivery sell day, before GST; freeBelowMinor waives it under that sale value. */
  dp: { minor: string; freeBelowMinor?: string };
  source: RateSource;
};
export type BrokerId = 'zerodha' | 'groww' | 'upstox' | 'dhan';
export const BROKER_IDS: readonly BrokerId[] = Object.freeze(['zerodha', 'groww', 'upstox', 'dhan']);

export const BROKER_RATES: Readonly<Record<BrokerId, BrokerRates>> = Object.freeze({
  zerodha: { broker: 'zerodha', name: 'Zerodha',
    brokerage: { delivery: { kind: 'zero' }, intraday: { kind: 'percent-cap', ppb: 300_000, capMinor: '2000' }, futures: { kind: 'percent-cap', ppb: 300_000, capMinor: '2000' }, options: { kind: 'flat', minor: '2000' } },
    dp: { minor: '1300' }, source: { title: 'Zerodha charges page', url: 'https://zerodha.com/charges', read: 'official', checkedOn: RATES_READ_ON } },
  groww: { broker: 'groww', name: 'Groww',
    brokerage: { delivery: { kind: 'percent-cap', ppb: 1_000_000, capMinor: '2000', minMinor: '500' }, intraday: { kind: 'percent-cap', ppb: 1_000_000, capMinor: '2000', minMinor: '500' }, futures: { kind: 'flat', minor: '2000' }, options: { kind: 'flat', minor: '2000' } },
    dp: { minor: '2000', freeBelowMinor: '10000' }, source: { title: 'Groww pricing pages (stocks, futures and options)', url: 'https://groww.in/pricing', read: 'official', checkedOn: RATES_READ_ON } },
  upstox: { broker: 'upstox', name: 'Upstox',
    brokerage: { delivery: { kind: 'flat', minor: '2000' }, intraday: { kind: 'percent-cap', ppb: 1_000_000, capMinor: '2000' }, futures: { kind: 'percent-cap', ppb: 500_000, capMinor: '2000' }, options: { kind: 'flat', minor: '2000' } },
    dp: { minor: '2000' }, source: { title: 'Upstox brokerage charges page', url: 'https://upstox.com/brokerage-charges/', read: 'official', checkedOn: RATES_READ_ON } },
  dhan: { broker: 'dhan', name: 'Dhan',
    brokerage: { delivery: { kind: 'zero' }, intraday: { kind: 'percent-cap', ppb: 300_000, capMinor: '2000' }, futures: { kind: 'flat', minor: '2000' }, options: { kind: 'flat', minor: '2000' } },
    dp: { minor: '1250' }, source: { title: 'Dhan pricing page (DP charge per ISIN; whether it applies to sells only is not stated)', url: 'https://dhan.co/pricing/', read: 'official', checkedOn: RATES_READ_ON } },
});

export function periodOn<T extends { from: string; to: string | null }>(periods: readonly T[], day: string): T | null {
  return periods.find(period => day >= period.from && (period.to === null || day <= period.to)) ?? null;
}

/** Every source this journal's charges rest on, for the receipt and the desk's source list. */
export function rateSources(broker: BrokerId): RateSource[] {
  return [...STT_PERIODS.map(p => p.source), ...EXCHANGE_PERIODS.map(p => p.source), SEBI_FEE.source, STAMP_DUTY.source, GST.source, BROKER_RATES[broker].source];
}
