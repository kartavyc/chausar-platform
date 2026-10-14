import type { EngineModule, MethodSpec } from '../modules/types.ts';

/** One independently built slice of the models-ext module: its methods and its purge share. */
export interface ModulePart {
  readonly methods: Readonly<Record<string, MethodSpec>>;
  purge?: EngineModule['purge'];
}

export const MODULE_ID = 'models-ext';
