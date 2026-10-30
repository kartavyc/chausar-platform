// Chausar venture launcher: reads the host environment into plain data.
// Owned by package P0. server.ts and worker.ts import only this file from the venture folder, never
// host.ts, so a half-written venture package can never stop the web server or the desktop worker.
import { isAbsolute } from 'node:path';
import type { VentureHostOptions } from './contracts.ts';

/**
 * Replay files are honoured only in demo mode AND with their own switch (CHAUSAR_VENTURE_REPLAY=1 or the
 * --replay argument), so a leftover variable can never replace a real provider or GitHub for a real user.
 */
export function ventureHostEnv(env: NodeJS.ProcessEnv, mode: { demo: boolean; host: 'desktop' | 'local-web'; args?: readonly string[] }): VentureHostOptions {
  const options: VentureHostOptions = { host: mode.host };
  // Wave 6 D13 records acceptance. An explicit pending (or invalid override) still disables Claude Code.
  options.claudeCodeTerms = env.CHAUSAR_CLAUDE_CODE_TERMS === undefined || env.CHAUSAR_CLAUDE_CODE_TERMS === 'accepted' ? 'accepted' : 'pending';
  const replay = mode.demo && (env.CHAUSAR_VENTURE_REPLAY === '1' || (mode.args ?? []).includes('--replay'));
  if (replay && env.CHAUSAR_VENTURE_MODEL_REPLAY) options.modelReplayPath = env.CHAUSAR_VENTURE_MODEL_REPLAY;
  if (replay && env.CHAUSAR_VENTURE_GITHUB_REPLAY) options.githubReplayPath = env.CHAUSAR_VENTURE_GITHUB_REPLAY;
  // The website folder staged edits apply to: only a whole path on this computer, never one a request names.
  const site = env.CHAUSAR_SITE_FOLDER;
  if (site && isAbsolute(site)) options.siteFolder = site;
  return options;
}
