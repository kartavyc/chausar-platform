/**
 * A department's text key. The engine names departments in full (sales, marketing, production, money, operations:
 * its contracts' DEPARTMENT_IDS); the screens' own ids and the text keys are short (mkt, prod, ops: parts/icons.ts
 * DEPT_IDS). Seen on Windows (15 Nov 2026): a screen that built the key from the engine's id showed "dept.operations".
 * Every screen names a department through this one mapping, which takes either id. An id nobody knows reads as
 * Operations, where the engine itself puts an agent with no department (agents/team-proposal.ts TEAM_DEPARTMENT).
 */
const KEYS: Readonly<Record<string, string>> = Object.freeze({
  sales: 'dept.sales',
  marketing: 'dept.mkt', mkt: 'dept.mkt',
  production: 'dept.prod', prod: 'dept.prod',
  money: 'dept.money',
  operations: 'dept.ops', ops: 'dept.ops',
});

export function deptKey(id: string): string {
  return KEYS[id] ?? 'dept.ops';
}
