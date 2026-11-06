// Chausar playbook kit: the dated rule types (moved from kit/define.ts in wave 6, 6C5). This file imports nothing, so a
// rule register typed with it can be read by the fake engine in the browser without pulling in the engine's contracts.
/** A calendar date like 2026-10-21 (contracts.ts IsoDate). */
export type IsoDate = string;

/** How a dated rule was read: an official source, a secondary one, Chausar's own house rule, or not confirmed. */
export type RuleRead = 'official' | 'secondary' | 'house' | 'unconfirmed';

/** One dated rule (P1's register, generalised by 5A3): what it says, where it came from, when it was checked, who uses it. */
export type DatedRule = {
  id: string;
  scope: string;
  topic: string;
  /** The rule in plain words. */
  rule: string;
  /** A limit's value and unit, as data (never computed by a model). */
  value?: string;
  unit?: string;
  sources: readonly { title: string; url: string }[];
  checkedOn: IsoDate;
  read: RuleRead;
  how: string;
  /** The step and check ids that rest on this rule. */
  usedBy: readonly string[];
  limitations: string;
  /** Default 90. */
  recheckAfterDays?: number;
  /**
   * Who must confirm the rule before a client's work rests on it (5A3): 'ca', 'lawyer', or null for a rule that needs
   * no one. Never left out, so a tax or legal rule cannot fail open (validateRules refuses a rule without it).
   */
  needs: 'ca' | 'lawyer' | null;
  /**
   * Present exactly when needs is not null: who confirmed it and when, or null until then (practice runs only). A rule
   * that needs no one carries none.
   */
  confirmedBy?: { name: string; on: IsoDate } | null;
};
