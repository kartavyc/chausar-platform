/**
 * Round 4 fixtures for the fake engine (synthetic only): SH-08 updates over a fake release lane,
 * and the SH-11 send refusal. SH-09's `models.probe` fixture is in `fixtures/r4.ts`.
 */
import type { UpdateStepReply, UpdatesReply } from '../todayx-contract.ts';

export const FAKE_VERSION = '0.1.0-preview.1';
export const FAKE_CANDIDATE = '0.1.0-preview.2';

/** The fake release lane's memory: whether a candidate is ready (a preview option), then the run's steps. */
export interface FakeUpdates { ready: boolean; staged: boolean; applied: boolean }

export function updatesReply(state: FakeUpdates, date: string, canUpdate: boolean): UpdatesReply {
  const base = { version: FAKE_VERSION, channel: 'preview' as const, expiresAt: `${date.slice(0, 7)}-28`, candidate: null, platform: 'windows' as const, canUpdate };
  if (state.applied) return { ...base, state: 'restart' };
  return state.ready ? { ...base, state: 'ready', candidate: FAKE_CANDIDATE } : { ...base, state: 'current' };
}

export function stageReply(): UpdateStepReply { return { step: 'checked', version: FAKE_CANDIDATE }; }
export function applyReply(): UpdateStepReply { return { step: 'restart', version: FAKE_CANDIDATE }; }
