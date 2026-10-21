// Chausar venture launcher, delivery package (P5): the check lists a playbook's writing and checking steps run. Kept
// apart from playbook.ts so the flagship playbooks (venture/playbooks/<id>/) can name them without loading the delivery
// package, which loads the flagship steps in turn (playbooks/steps.ts).
import { CHECK_IDS } from '../contracts.ts';
import type { CheckId } from '../contracts.ts';

/**
 * Checks the verify step runs on every draft reply: all of them except the ones that only make sense in a rehearsal.
 * rules-judge is one: on a real order the judge's call would carry the client's words, which needs the owner's approval.
 */
export const VERIFY_CHECKS: readonly CheckId[] = CHECK_IDS.filter(id => id !== 'questions-raised' && id !== 'turn-limit' && id !== 'rules-judge');
export const DRAFT_CHECKS: readonly CheckId[] = ['no-numeric-prose', 'figures-resolve', 'required-sections', 'house-style', 'length-bounds', 'no-done-claims'];
