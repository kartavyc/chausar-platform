import type { ModelPresetId } from '../contracts.ts';
import type { AgentDriver, AgentDriverCredentials, AgentDriverSettings } from './driver-types.ts';

/** Host composition only. Shared driver events and settings remain independent of the engine graph. */
export type AgentRoute = { driver: AgentDriver; settings: AgentDriverSettings; credentials?: AgentDriverCredentials; billing?: { connectionId: string; presetId: ModelPresetId; model: string } };
