// Chausar playbook: trading journal (wave 6, 6E7 / D49). Its dated rules for the kit register, made from the versioned
// rate and tax data (rates.ts, tax-rules.ts). Words carry no numbers (figures are data); section numbers sit in each
// source's title. The securities guard is a house rule that never unlocks. Tax rules need a CA to confirm them before a
// client's work rests on them; this desk keeps only the owner's own journal. Written for Chausar.
import type { DatedRule, RuleRead } from '../kit/rule-type.ts';
import { STT_PERIODS, EXCHANGE_PERIODS, SEBI_FEE, STAMP_DUTY, GST, BROKER_RATES, BROKER_IDS, RATES_READ_ON, type RateRead } from './rates.ts';
import { TAX_YEARS, TAX_RULES_READ_ON } from './tax-rules.ts';

const read = (value: RateRead): RuleRead => value === 'unchecked' ? 'unconfirmed' : value;
const how = (value: RateRead) => value === 'official' ? "Read on the issuer's own page." : value === 'secondary' ? 'Read where a broker quotes the issuer.' : 'Not confirmed on an official page.';
const SECTION_PAGES = "Read on the income tax department's section pages.";

export const TRADING_JOURNAL_RULES: readonly DatedRule[] = Object.freeze([
  { id: 'securities-guard', scope: 'house', topic: 'No trades, tips or advice', rule: 'Chausar never places, suggests or automates a trade, never gives buy, sell or hold advice, tips, target prices or promised returns, and never connects to a broker that can place orders.',
    sources: [], checkedOn: RATES_READ_ON, read: 'house', how: 'Enforced in code on every model text, chat answer, offer and outside tool server.', usedBy: ['notes', 'no-securities-advice'], limitations: 'A back office for SEBI registered advisers or analysts is not built yet.', needs: null },
  { id: 'securities-transaction-tax', scope: 'charges', topic: 'Securities transaction tax', rule: 'Securities transaction tax is worked per contract note line from the dated rates for delivery, intraday, futures and options.',
    sources: STT_PERIODS.map(p => ({ title: p.source.title, url: p.source.url })), checkedOn: RATES_READ_ON, read: read(STT_PERIODS[STT_PERIODS.length - 1].source.read), how: how(STT_PERIODS[STT_PERIODS.length - 1].source.read), usedBy: ['charges'], limitations: 'Options exercised at expiry are charged differently and are not read from a tradebook.', needs: null },
  { id: 'exchange-charges', scope: 'charges', topic: 'Exchange transaction charges', rule: 'Exchange charges and the investor protection charge are worked from the dated exchange rates; the protection charge is folded into the exchange rate from March.',
    sources: EXCHANGE_PERIODS.map(p => ({ title: p.source.title, url: p.source.url })), checkedOn: RATES_READ_ON, read: read(EXCHANGE_PERIODS[0].source.read), how: how(EXCHANGE_PERIODS[0].source.read), usedBy: ['charges'], limitations: 'BSE cash uses the rate for its main groups only.', needs: null },
  { id: 'fees-stamp-gst', scope: 'charges', topic: 'SEBI fee, stamp duty and GST', rule: 'The SEBI turnover fee, stamp duty on the buy side and GST on broker services are worked from their published rates.',
    sources: [SEBI_FEE.source, STAMP_DUTY.source, GST.source].map(s => ({ title: s.title, url: s.url })), checkedOn: RATES_READ_ON, read: 'secondary', how: how('secondary'), usedBy: ['charges'], limitations: 'Brokers may round stamp duty and the transaction tax to the rupee.', needs: null },
  { id: 'brokerage-dp', scope: 'charges', topic: 'Brokerage and DP charges', rule: "Brokerage is worked per executed order and DP charges per scrip on each delivery sell day, from each broker's own charges page.",
    sources: BROKER_IDS.map(id => ({ title: BROKER_RATES[id].source.title, url: BROKER_RATES[id].source.url })), checkedOn: RATES_READ_ON, read: 'official', how: "Read on each broker's own charges page; the pages show no start day.", usedBy: ['charges'], limitations: 'Older trades may have been charged at older brokerage.', needs: null },
  { id: 'speculative-intraday', scope: 'tax', topic: 'Intraday is speculative', rule: 'Equity bought and sold on the same day without delivery is a speculative transaction, kept apart from other business.',
    sources: TAX_YEARS.map(y => ({ title: `${y.act}, section ${y.speculative.section}`, url: y.speculative.source })), checkedOn: TAX_RULES_READ_ON, read: 'official', how: SECTION_PAGES, usedBy: ['pack'], limitations: 'Your CA decides how losses are set off and carried forward.', needs: 'ca', confirmedBy: null },
  { id: 'fno-business', scope: 'tax', topic: 'Futures and options are business income', rule: 'Futures and options traded on a recognised exchange are not speculative; their profit or loss is business income, and turnover is counted without sign.',
    sources: TAX_YEARS.map(y => ({ title: `${y.act}, section ${y.nonSpeculative.section}`, url: y.nonSpeculative.source })), checkedOn: TAX_RULES_READ_ON, read: 'official', how: `${SECTION_PAGES} The turnover method follows the ICAI guidance note, not read in full.`, usedBy: ['pack'], limitations: 'Whether a tax audit applies is for your CA.', needs: 'ca', confirmedBy: null },
  { id: 'capital-gains', scope: 'tax', topic: 'Short and long term gains on listed equity', rule: 'Listed equity held for more than twelve months is long term; long-term gains above the yearly limit and short-term gains each have their own rate.',
    sources: TAX_YEARS.flatMap(y => [{ title: `${y.act}, section ${y.stcg.section}`, url: y.stcg.source }, { title: `${y.act}, section ${y.ltcg.section}`, url: y.ltcg.source }]), checkedOn: TAX_RULES_READ_ON, read: 'official', how: SECTION_PAGES, usedBy: ['pack'], limitations: "Chausar shows the rule's rate and never works out a tax to pay.", needs: 'ca', confirmedBy: null },
  { id: 'grandfathering', scope: 'tax', topic: 'Shares bought before the grandfathering day', rule: 'For shares bought before the grandfathering day, cost is the higher of the actual cost and the lower of the fair market value you enter and the sale value.',
    sources: TAX_YEARS.map(y => ({ title: `${y.act}, section ${y.grandfather.section}`, url: y.grandfather.source })), checkedOn: TAX_RULES_READ_ON, read: 'official', how: SECTION_PAGES, usedBy: ['pack'], limitations: 'Chausar does not bundle market prices; you enter the fair market value and its source.', needs: 'ca', confirmedBy: null },
]);
