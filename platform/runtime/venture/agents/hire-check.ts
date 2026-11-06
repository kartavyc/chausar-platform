// C7 task 13: the code checks on one more agent the owner hires, with what the engine knows: its departments and the
// floor's words (policy/effects.ts). The checks themselves are in hire-check-core.ts, which the fake engine shares.
import { DEPARTMENT_IDS, type DepartmentId } from '../contracts.ts';
import { DESTRUCTIVE_WORDS } from '../policy/effects.ts';
import { checkHireWith, HIRE_LIMITS, HIRE_READS, type HireRead, type HireRole as CoreRole } from './hire-check-core.ts';

export { HIRE_LIMITS, HIRE_READS, type HireRead };
export type HireRole = Omit<CoreRole, 'department'> & { department: DepartmentId };

const RULES = Object.freeze({ departments: DEPARTMENT_IDS, floorWords: [...DESTRUCTIVE_WORDS.send, ...DESTRUCTIVE_WORDS.moneyOut, ...DESTRUCTIVE_WORDS.delete] });

/** The role, trimmed, when every check passes; otherwise a ChausarError with plain words. */
export function checkHire(role: HireRole, context: { agentNames: readonly string[] }): HireRole {
  return checkHireWith(RULES, role, context) as HireRole;
}
