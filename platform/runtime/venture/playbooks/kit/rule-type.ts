import type { DatedRule, IsoDate, RuleRead } from '../../../../contract/venture/playbooks/kit/rule-type.ts';
export type { DatedRule, IsoDate, RuleRead } from '../../../../contract/venture/playbooks/kit/rule-type.ts';
// Chausar playbook kit: the dated rule types (moved from kit/define.ts in wave 6, 6C5). This file imports nothing, so a
// rule register typed with it can be read by the fake engine in the browser without pulling in the engine's contracts.
/** A calendar date like 2026-10-21 (contracts.ts IsoDate). */


/** How a dated rule was read: an official source, a secondary one, Chausar's own house rule, or not confirmed. */


/** One dated rule (P1's register, generalised by 5A3): what it says, where it came from, when it was checked, who uses it. */

