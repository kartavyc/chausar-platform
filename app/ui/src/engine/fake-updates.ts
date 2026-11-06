import { EngineError, type UpdatesView } from './types';

const METHODS = new Set(['updates.status', 'updates.settings', 'updates.check']);

/**
 * The fake engine's updates (C5 task 33), in the shapes and codes of platform/runtime/update-service.ts. The rehearsal is a
 * build with no release key, so it reads as one: not set up, and a check does nothing.
 */
export class FakeUpdates {
  private daily = true;
  private channel: UpdatesView['channel'] = 'stable';
  handles(method: string): boolean { return METHODS.has(method); }
  request(method: string, p: Record<string, unknown>): UpdatesView {
    if (method === 'updates.settings') {
      const keys = p && typeof p === 'object' ? Object.keys(p) : [];
      if (keys.length === 0 || !keys.every((key) => (key === 'daily' && typeof p[key] === 'boolean') || (key === 'channel' && (p[key] === 'beta' || p[key] === 'stable')))) throw new EngineError('INVALID_UPDATE_SETTINGS', 'Change Check daily or the channel.');
      if (keys.includes('daily')) this.daily = p.daily as boolean;
      if (keys.includes('channel')) this.channel = p.channel as UpdatesView['channel'];
    }
    return { configured: false, version: '0.1.0-preview.1', installMode: 'manual-native-installer-required', channel: this.channel, daily: this.daily, state: 'not-set-up', target: null, downloadedBytes: null, reason: null, lastCheckedAt: null };
  }
}
