// P1 replaces this stub. Exports must keep these names.
import { ChausarError } from '../../contracts.ts';
import type { CountryProfile, PlanPreview, VentureHandlerTable } from '../contracts.ts';

export const handlers: VentureHandlerTable = {};
const notBuilt = () => new ChausarError('NOT_BUILT_YET', 'This part of Chausar is not built yet.');
export function listCountries(): CountryProfile[] { throw notBuilt(); }
export function previewPlan(_payload: unknown): PlanPreview { throw notBuilt(); }
