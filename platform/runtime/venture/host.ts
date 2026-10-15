// P6 replaces this stub. The engine reaches it only through a dynamic import at request time.
// Exports must keep these names and signatures.
import { ChausarError, type Context, type StateStore } from '../contracts.ts';
import type { CountryProfile, PlanPreview, VentureEngineServices, VentureHostOptions, VentureStorage } from './contracts.ts';

const notBuilt = () => new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
export async function ventureCountries(): Promise<CountryProfile[]> { throw notBuilt(); }
export async function venturePreview(_payload: unknown): Promise<PlanPreview> { throw notBuilt(); }
export class VentureHost {
  constructor(_store: StateStore, _services: VentureEngineServices, _options: VentureHostOptions & { demo: boolean; storage: VentureStorage }) {}
  async request(_ctx: Context, _method: string, _payload: unknown): Promise<unknown> { throw notBuilt(); }
  close(): void {}
}
