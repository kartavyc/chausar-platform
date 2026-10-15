/**
 * Round 4 fixtures for the fake engine (synthetic only): SH-08 updates over a fake release lane,
 * SH-09 route states in the shape the frame expects from core-gateway-auth's `models.probe`
 * (fixture-only until that lane serves it), and the SH-11 send refusal.
 */
import type { RouteProbeReply, UpdateStepReply, UpdatesReply } from '../todayx-contract.ts';
import { DEMO_ROUTE } from './shop.ts';
import type { FakeScenarioName } from './todayx.ts';

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

export function routeProbeReply(scenario: FakeScenarioName, date: string): RouteProbeReply {
  const checkedAt = `${date}T06:00:00.000Z`;
  if (scenario !== 'populated') return { routes: [], checkedAt };
  return { checkedAt, routes: [
    { routeId: DEMO_ROUTE.id, label: DEMO_ROUTE.label, kind: DEMO_ROUTE.kind, state: 'ready', send: null, resumesAt: null },
    { routeId: 'route_cli_demo', label: 'Codex tool', kind: 'codex-cli', state: 'signed-out', send: null, resumesAt: `${date}T09:30:00.000Z` },
    { routeId: 'route_cloud_demo', label: 'Cloud demo model', kind: 'openai', state: 'skipped-send', send: { route: 'samples', yours: 'shape' }, resumesAt: null },
  ] };
}
