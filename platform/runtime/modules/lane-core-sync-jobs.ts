import type { EngineModule } from './types.ts';
import { deviceMethods } from '../core-sync-jobs/devices.ts';
import { jobMethods } from '../core-sync-jobs/jobs-methods.ts';
import { eventMethods } from '../core-sync-jobs/events-methods.ts';

/** The core-sync-jobs lane: devices, sync set-up, live events and core job gaps. New RPC methods for core work live here, so core lanes never
 *  edit the engine's request switch at the same time. Only the owning lane edits this file. */
export const coreSyncJobsModule: EngineModule = { id: 'core-sync-jobs', methods: { ...deviceMethods, ...jobMethods, ...eventMethods } };
