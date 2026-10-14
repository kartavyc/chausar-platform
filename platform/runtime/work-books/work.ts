import type { MethodSpec, EngineModule } from '../modules/types.ts';

/** work methods of the work-books lane. */
export const workMethods: Readonly<Record<string, MethodSpec>> = {};

export const workPurge: NonNullable<EngineModule['purge']> = () => 0;
