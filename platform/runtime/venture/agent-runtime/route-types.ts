import type { ModelPresetId } from '../contracts.ts';
import type { AgentDriver, AgentDriverCredentials, AgentDriverSettings } from './driver-types.ts';

/** Host composition only. Shared driver events and settings remain independent of the engine graph. */
/** presetId (W6 6G5): the preset the route serves, for the run's model receipt; a host may leave it out. */
export type AgentRoute = { driver: AgentDriver; settings: AgentDriverSettings; credentials?: AgentDriverCredentials; billing?: { connectionId: string; presetId: ModelPresetId; model: string }; presetId?: ModelPresetId };
