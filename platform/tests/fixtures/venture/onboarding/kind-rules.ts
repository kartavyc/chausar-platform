// Deterministic open-box classifier for TESTS ONLY (onboarding spec, section 3). The product never classifies by
// keywords: with no AI connected, decide refuses NO_MODEL_CONNECTED and the screen offers a built-in plan instead.
// The renderer's fake engine and a recordings test import this; nothing under platform/runtime/ may.
import type { OpenBoxKind } from '../../../../runtime/venture/onboarding-contracts.ts';

const SKILL = ["i'm good at", 'i am good at', 'i can', 'i know how'];
const PROBLEM = ['lose', 'struggle', "can't", 'hard to', 'problem', 'waste'];
const PERSONAL = ['my landlord', 'my boss', 'my neighbour'];

/** skill when it says "I'm good at", "I can" or "I know how"; problem for words like lose or struggle, unless it is
 *  about the person's own landlord, boss or neighbour (not-a-service); else idea. */
export function kindByRules(text: string): OpenBoxKind {
  const lower = text.toLowerCase().replace(/\u2019/g, "'");
  if (SKILL.some(phrase => lower.includes(phrase))) return 'skill';
  if (PERSONAL.some(phrase => lower.includes(phrase))) return 'not-a-service';
  if (PROBLEM.some(word => new RegExp(`(^|[^a-z'])${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(lower))) return 'problem';
  return 'idea';
}
