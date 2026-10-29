import type { RunScopeView, Posture } from '../engine/types';
import type { Language, T } from '../text';

// Exact native views/runs.ts wording. A custom or changed engine sentence is not guessed at.
const POSTURE: Readonly<Record<Posture,string>> = {
  rehearsal: 'in rehearsal', shadow: 'in shadow', 'approve-each': 'at approve each', 'auto-spot-check': 'at auto with spot checks',
};
const MONTH = '(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)';
const DATE = `(?:\\d{2} ${MONTH} \\d{4}|${MONTH} \\d{2}, \\d{4}|\\d{4}-\\d{2}-\\d{2})`;
const RATE = new RegExp(`^(₹\\d[\\d,]*\\.\\d{2,4}) per (\\$1) \\(your rate, set (${DATE})\\)$`);

/** Translate known labels only. Monetary values and the engine's chosen date format are opaque strings. */
export function runScopeWords(scope: RunScopeView, language: Language, t: T): {line:string;rupees:string|null} {
  const rupees = scope.capRupees && scope.capRate ? `${scope.capRupees} at ${scope.capRate}` : null;
  if (language !== 'hi' || !Object.hasOwn(POSTURE,scope.posture)) return {line:scope.line,rupees};
  const tools=scope.tools.length,actions=scope.actions.length;
  const prefix=`Set when it started: ${tools} ${tools===1?'tool':'tools'}, ${actions} ${actions===1?'outside action':'outside actions'} it may propose for your approval, a spend cap of ${scope.cap}, `;
  const native=prefix+POSTURE[scope.posture]+'.';
  const sample=scope.posture==='approve-each'&&scope.line===prefix+'approve each step.';
  if(scope.line!==native&&!sample)return {line:scope.line,rupees};
  const rate=scope.capRate?.match(RATE);
  return {
    line:t('runsheet.scope.line',{tools:t('runsheet.scope.toolCount',{count:tools}),actions:t('runsheet.scope.actionCount',{count:actions}),cap:scope.cap,posture:t('team.posture.'+scope.posture)}),
    rupees:scope.capRupees&&rate?t('runsheet.scope.rupeeRate',{amount:scope.capRupees,rate:rate[1]!,unit:rate[2]!,date:rate[3]!}):rupees,
  };
}
