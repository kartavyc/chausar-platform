// C5 tasks 31, 33: what updates.status answers, browser safe, so the window and the fake read the engine's own shape.
export type UpdateState = 'not-set-up' | 'idle' | 'checking' | 'up-to-date' | 'downloading' | 'ready' | 'needs-signing' | 'publisher-mismatch' | 'manual' | 'data-newer' | 'failed';
export type UpdatesView = {
  configured: boolean; version: string; installMode: 'manual-native-installer-required';
  channel: 'beta' | 'stable'; daily: boolean; state: UpdateState;
  target: { version: string; bytes: number } | null; downloadedBytes: number | null;
  reason: string | null; lastCheckedAt: string | null;
  /** D12 task 9: Chausar went back to an earlier version; said once, on the next read, then gone. */
  rolledBack?: { from: string; to: string; at: string; reason: 'failed-start' | 'failed-migration' };
};
