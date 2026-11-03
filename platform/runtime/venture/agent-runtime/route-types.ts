import type { ModelPresetId } from '../contracts.ts';
import type { AgentDriver, AgentDriverCredentials, AgentDriverSettings } from './driver-types.ts';

/** Host composition only. Shared driver events and settings remain independent of the engine graph. */
/** presetId (W6 6G5): the preset the route serves, for the run's model receipt; a host may leave it out. */
/**
 * watchdog (A2): how long a job may stay quiet before it is asked to stop, and how long the tool then has before a hard
 * close; A2 second review: how long one tool step may hold the clock (toolMs) and the job's own time limit (jobMs).
 */
export type AgentRoute = { driver: AgentDriver; settings: AgentDriverSettings; credentials?: AgentDriverCredentials; billing?: { connectionId: string; presetId: ModelPresetId; model: string }; presetId?: ModelPresetId; watchdog?: { idleMs: number; hardCloseMs: number; toolMs?: number; jobMs?: number } };
