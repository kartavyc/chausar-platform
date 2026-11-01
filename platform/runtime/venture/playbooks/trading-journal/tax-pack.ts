// Chausar playbook: trading journal (wave 6, 6E7 / D49). The tax pack for the owner's CA: intraday (speculative),
// futures and options (non-speculative business) and capital gains (short and long term, with the 31 January 2018
// grandfathering where it applies), for one year's rules. Every figure is computed by code from the journal and names
// the rule, the Act and the year it rests on. Rates are shown as the rule's rate, never applied to give a tax to pay.
// Labelled "Check with your CA". Pure and browser-safe. Written for Chausar.
import { check } from '../../../portable.ts';
import { formatMinor } from '../../../currency.ts';
import type { Journal } from './journal.ts';
import { CHECK_WITH_CA, taxYearById, type TaxRule, type TaxYearRules } from './tax-rules.ts';

export type TaxFigure = { key: string; label: string; minor: string; display: string; unit: 'money' | 'percent' | 'count'; how: string; rule: TaxRule; act: string; year: string };
export type TaxPack = { yearId: TaxYearRules['id']; year: string; act: string; figures: TaxFigure[]; needsFmv: number; unmatched: number; openPositions: number; line: string };

const sum = (values: readonly string[]) => values.reduce((total, value) => total + BigInt(value), 0n);
const abs = (value: bigint) => value < 0n ? -value : value;

export function taxPack(journal: Journal, yearId: unknown): TaxPack {
  const year = taxYearById(yearId);
  check(year, 'TAX_YEAR_UNSUPPORTED', 'Choose financial year 2025-26 or tax year 2026-27. Chausar has checked rules for those years only.');
  const inYear = (day: string) => day >= year.from && day <= year.to;
  const lots = journal.realised.filter(lot => inYear(lot.closedOn));
  const notes = journal.notes.filter(note => inYear(note.date));
  const intraday = lots.filter(lot => lot.kind === 'intraday'), fno = lots.filter(lot => lot.kind === 'fno');
  const capital = lots.filter(lot => lot.kind === 'capital' && !lot.needsFmv);
  const stcg = capital.filter(lot => !lot.longTerm), ltcg = capital.filter(lot => lot.longTerm);
  const charges = (kinds: readonly string[]) => sum(notes.filter(note => kinds.includes(note.kind)).map(note => note.charges.total));
  const deliveryStt = sum(notes.filter(note => note.kind === 'delivery').map(note => note.charges.stt));
  const figures: TaxFigure[] = [];
  const money = (key: string, label: string, minor: bigint, how: string, rule: TaxRule) => figures.push({ key, label, minor: String(minor), display: formatMinor(minor, 'INR'), unit: 'money', how, rule, act: year.act, year: year.label });
  const percent = (key: string, label: string, bps: number, rule: TaxRule) => figures.push({ key, label, minor: String(bps), display: `${bps / 100}%`, unit: 'percent', how: 'The rate the rule states. Chausar does not work out a tax to pay.', rule, act: year.act, year: year.label });
  const count = (key: string, label: string, value: number, how: string, rule: TaxRule) => figures.push({ key, label, minor: String(value), display: String(value), unit: 'count', how, rule, act: year.act, year: year.label });

  const specPnl = sum(intraday.map(lot => lot.pnlMinor)), specCharges = charges(['intraday']);
  money('speculative-pnl', 'Intraday profit or loss before charges', specPnl, 'Sale value less cost for each same-day squared off trade, added up.', year.speculative);
  money('speculative-turnover', 'Intraday turnover', intraday.reduce((t, lot) => t + abs(BigInt(lot.pnlMinor)), 0n), 'Each trade\'s profit or loss without its sign, added up.', year.turnover);
  money('speculative-charges', 'Intraday charges', specCharges, 'Every charge on intraday contract note lines in this year.', year.speculative);
  money('speculative-net', 'Intraday profit or loss after charges', specPnl - specCharges, 'Profit or loss before charges less intraday charges.', year.speculative);

  const fnoPnl = sum(fno.map(lot => lot.pnlMinor)), fnoCharges = charges(['futures', 'options']);
  money('fno-pnl', 'Futures and options profit or loss before charges', fnoPnl, 'Sale value less cost for each closed or expired contract, added up.', year.nonSpeculative);
  money('fno-turnover', 'Futures and options turnover', fno.reduce((t, lot) => t + abs(BigInt(lot.pnlMinor)), 0n), 'Each trade\'s profit or loss without its sign, added up.', year.turnover);
  money('fno-charges', 'Futures and options charges', fnoCharges, 'Every charge on futures and options contract note lines in this year.', year.nonSpeculative);
  money('fno-net', 'Futures and options profit or loss after charges', fnoPnl - fnoCharges, 'Profit or loss before charges less futures and options charges.', year.nonSpeculative);

  const st = sum(stcg.map(lot => lot.pnlMinor)), lt = sum(ltcg.map(lot => lot.pnlMinor)), limit = BigInt(year.ltcg.exemptionMinor);
  money('stcg', 'Short-term capital gain or loss', st, 'Sale value less cost for listed equity held twelve months or less, added up.', year.stcg);
  percent('stcg-rate', 'Short-term rate under the rule', year.stcg.rateBps, year.stcg);
  money('ltcg', 'Long-term capital gain or loss', lt, 'Sale value less cost for listed equity held more than twelve months, added up; grandfathered cost where it applies.', year.ltcg);
  money('ltcg-limit', 'Yearly long-term limit under the rule', limit, 'The limit the rule states.', year.ltcg);
  money('ltcg-above-limit', 'Long-term gain above the limit, before any set-off', lt > limit ? lt - limit : 0n, 'Long-term gain less the yearly limit, or nothing when the gain is under it.', year.ltcg);
  percent('ltcg-rate', 'Long-term rate under the rule', year.ltcg.rateBps, year.ltcg);
  money('delivery-stt', 'Securities transaction tax on delivery trades', deliveryStt, 'Securities transaction tax on delivery contract note lines in this year.', year.stcg);
  money('delivery-other-charges', 'Other charges on delivery trades', charges(['delivery']) - deliveryStt, 'Every other charge on delivery contract note lines in this year, DP charges included.', year.stcg);
  count('grandfathered', 'Lots with grandfathered cost', ltcg.filter(lot => lot.grandfathered).length, 'Long-term lots bought before 1 February 2018 with a fair market value you entered.', year.grandfather);
  const needsFmv = lots.filter(lot => lot.needsFmv).length;
  count('needs-fmv', 'Lots waiting for a fair market value', needsFmv, 'Long-term lots bought before 1 February 2018 with no fair market value yet. They are left out of the gains above.', year.grandfather);

  return { yearId: year.id, year: year.label, act: year.act, figures, needsFmv, unmatched: journal.unmatched.filter(row => inYear(row.date)).length, openPositions: journal.open.length, line: CHECK_WITH_CA };
}
