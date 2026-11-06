// Original Chausar slot rules, catalogue S5. richworks content planning is learn-only; no text copied.
export type SocialSlotKind = { id: string; kind: 'value' | 'sell'; goals: string[]; actions: string[] };
export type SlotFinding = { check: 'selling-share' | 'one-goal'; slotId: string | null; line: string };
/** Integer counts decide the selling share; each draft carries one explicit goal and reader action. */
export function socialSlots(slots: readonly SocialSlotKind[], capPercent = 20): { passed: boolean; selling: number; total: number; capPercent: number; findings: SlotFinding[] } {
  if (!Array.isArray(slots) || slots.length === 0 || slots.length > 155 || new Set(slots.map(slot => slot.id)).size !== slots.length || !Number.isInteger(capPercent) || capPercent < 0 || capPercent > 100 || slots.some(slot => typeof slot.id !== 'string' || !slot.id || !['sell', 'value'].includes(slot.kind) || !Array.isArray(slot.goals) || !Array.isArray(slot.actions) || [...slot.goals, ...slot.actions].some(value => typeof value !== 'string' || !value.trim() || value.length > 200))) {
    throw Object.assign(new Error('Use distinct slots, value or sell, and a whole selling cap from zero to one hundred.'), { code: 'SOCIAL_INPUT_INVALID' });
  }
  const findings: SlotFinding[] = slots.filter(slot => slot.goals.length !== 1 || slot.actions.length !== 1).map(slot => ({ check: 'one-goal', slotId: slot.id, line: 'Give this draft one goal and one audience action.' }));
  const selling = slots.filter(slot => slot.kind === 'sell').length;
  if (selling * 100 > slots.length * capPercent) findings.push({ check: 'selling-share', slotId: null, line: 'The selling share is above the cap you chose.' });
  return { passed: findings.length === 0, selling, total: slots.length, capPercent, findings };
}
