// Chausar venture launcher: reads the host environment into plain data.
// Owned by package P0. server.ts and worker.ts import only this file from the venture folder, never
// host.ts, so a half-written venture package can never stop the web server or the desktop worker.
import type { VentureHostOptions } from './contracts.ts';

/**
 * Replay files are honoured only in demo mode AND with their own switch (CHAUSAR_VENTURE_REPLAY=1 or the
 * --replay argument), so a leftover variable can never replace a real provider or GitHub for a real user.
 */
export function ventureHostEnv(env: NodeJS.ProcessEnv, mode: { demo: boolean; host: 'desktop' | 'local-web'; args?: readonly string[] }): VentureHostOptions {
  const options: VentureHostOptions = { host: mode.host };
  const replay = mode.demo && (env.CHAUSAR_VENTURE_REPLAY === '1' || (mode.args ?? []).includes('--replay'));
  if (replay && env.CHAUSAR_VENTURE_MODEL_REPLAY) options.modelReplayPath = env.CHAUSAR_VENTURE_MODEL_REPLAY;
  if (replay && env.CHAUSAR_VENTURE_GITHUB_REPLAY) options.githubReplayPath = env.CHAUSAR_VENTURE_GITHUB_REPLAY;
  return options;
}
