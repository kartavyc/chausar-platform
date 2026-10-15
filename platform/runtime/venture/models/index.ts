// P2 replaces this stub. Exports must keep these names.
import { ChausarError } from '../../contracts.ts';
import type { ModelPort, ModelPortOptions, ModelReplayFixture, ModelTransport, VentureHandlerTable } from '../contracts.ts';

export const handlers: VentureHandlerTable = {};
const notBuilt = () => new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
export function createModelPort(_options: ModelPortOptions): ModelPort { throw notBuilt(); }
export function defaultModelTransport(_options: { hostProcess?: (request: any) => Promise<any> } = {}): ModelTransport { throw notBuilt(); }
export function createReplayTransport(_fixture: ModelReplayFixture): ModelTransport { throw notBuilt(); }
