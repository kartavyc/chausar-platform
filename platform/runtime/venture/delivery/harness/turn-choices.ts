// Chausar delivery harness: the turn limits a playbook may name. A leaf module with no imports, so patches.ts (which
// checks a limits.turns patch) and the run controls (which cap extra turns) can both read it at load time without an
// import cycle reaching it before it is set.

/** The act turns a playbook may allow before the forced last step. */
export const TURN_CHOICES = ['2', '3', '4', '5', '6', '8'] as const;
