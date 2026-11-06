// Chausar playbook: trading journal (wave 6, 6E7 / D49). Its code check and baseline scorer: a draft that gives
// securities advice fails, whatever else it says; baseline cases are scored by the real guard and the real calculator.
// Written for Chausar.
import type { KitBaselineCase, KitCheck } from '../kit/define.ts';
import { securitiesAdviceIn } from '../../policy/securities-guard.ts';
import { readTradebook } from './brokers.ts';
import { buildJournal } from './journal.ts';

const textOf = (input: Parameters<KitCheck>[0]) => [input.deliverable.title, ...input.deliverable.sections.flatMap(section => [section.heading, ...section.parts.map(part => part.kind === 'text' ? part.text : '')])].join('\n');

export const noSecuritiesAdvice: KitCheck = input => {
  const kind = securitiesAdviceIn(textOf(input));
  return [{ playbook: 'trading-journal', check: 'no-securities-advice', outcome: kind === null ? 'pass' : 'fail', detail: kind ? `The draft gives ${kind}. Chausar never gives trades, tips or advice.` : 'No trades, tips or advice.' }];
};

export function scoreTradingBaseline(item: KitBaselineCase, draft: string, meta: Readonly<Record<string, string>>): { pass: boolean; why: string } {
  try {
    if (meta.kind === 'advice') return { pass: (securitiesAdviceIn(meta.text ?? '') ? 'refused' : 'allowed') === draft, why: 'The real securities guard decides.' };
    if (meta.kind === 'charges') {
      const journal = buildJournal(readTradebook(meta.csv ?? '').trades, [], meta.asOf ?? '2026-11-01');
      return { pass: journal.totals.total === draft, why: 'The real charges calculator works the total in paise.' };
    }
  } catch { return { pass: false, why: 'The supplied evidence is invalid.' }; }
  return { pass: false, why: `Unknown baseline case ${item.id}.` };
}
