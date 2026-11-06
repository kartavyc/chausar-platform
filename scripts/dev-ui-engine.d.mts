import type { Engine } from '../platform/runtime/engine.ts';
export function createDevSample(options: { directory: string; port?: number }): Promise<{ engine: Engine; origin: string; token: string; close(): Promise<void> }>;
export function startDevUi(): Promise<{ directory: string; launchFile: string; close(): Promise<void> }>;
