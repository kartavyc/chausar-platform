// P4 replaces this stub. Exports must keep these names and signatures.
import { ChausarError } from '../../contracts.ts';
import type { GitHubFixture, GitHubTransport, VentureHandlerTable } from '../contracts.ts';

export const handlers: VentureHandlerTable = {};
const notBuilt = () => new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
export function defaultGitHubTransport(): GitHubTransport { throw notBuilt(); }
export function createFixtureGitHubTransport(_fixture: GitHubFixture, _vars?: () => Record<string, string>): GitHubTransport { throw notBuilt(); }
