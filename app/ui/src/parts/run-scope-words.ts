import type { RunScopeView } from '../engine/types';
import type { Language, T } from '../text';

/** Engine-computed figures stay opaque display strings. */
export function runScopeWords(scope: RunScopeView, _language: Language, _t: T): {line:string;rupees:string|null} {
  return { line: scope.line, rupees: scope.capRupees && scope.capRate ? `${scope.capRupees} at ${scope.capRate}` : null };
}
