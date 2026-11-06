// Canonical browser-safe types, shared by the engine and renderer.


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

export type IsoDate = string;

export type RuleRead = 'official' | 'secondary' | 'house' | 'unconfirmed';
