import type { MethodSpec, EngineModule } from '../modules/types.ts';

/** books methods of the work-books lane. */
export const booksMethods: Readonly<Record<string, MethodSpec>> = {};

export const booksPurge: NonNullable<EngineModule['purge']> = () => 0;
