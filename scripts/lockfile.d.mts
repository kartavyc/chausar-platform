export interface LockfileProblem {
  code: 'version' | 'dependencies-differ' | 'unresolved-pin' | 'entry' | 'resolved';
  kind?: 'dependencies' | 'devDependencies';
  name?: string;
  path?: string;
  message: string;
}
export const PINNED_BUILD_GIT_SOURCES: Readonly<Record<string, string>>;
export function lockfileProblems(lock: unknown, pkg: { version?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> }, options?: { pinnedGitSources?: Readonly<Record<string, string>> }): LockfileProblem[];
