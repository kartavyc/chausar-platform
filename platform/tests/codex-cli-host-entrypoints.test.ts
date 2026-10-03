import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));

// These spawn Node entrypoints with intentionally incomplete synthetic settings.
// They never execute Codex, read a native binary, contact a provider or open a vault.
for (const entrypoint of ['server', 'worker'] as const) {
  test(`synthetic host refusal reaches the actual ${entrypoint} entrypoint before ready/listen`, async () => {
    const child = spawn(process.execPath, [`platform/runtime/${entrypoint}.ts`, '--production'], {
      cwd: root, windowsHide: true, shell: false,
      env: {
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        CHAUSAR_DEMO: '0',
        CHAUSAR_CODEX_CLI_EVIDENCE_FILE: resolve(root, 'synthetic-missing-evidence', 'codex-cli-host.json'),
        // Deliberately no SHA256 pin: the loader must refuse before any file read.
      },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    });
    const messages: unknown[] = []; let stdout = ''; let stderr = '';
    child.on('message', value => messages.push(value));
    child.stdout?.on('data', bytes => { stdout += bytes.toString(); });
    child.stderr?.on('data', bytes => { stderr += bytes.toString(); });
    const deadline = setTimeout(() => child.kill(), 10000);
    try {
      const code = await new Promise<number | null>((resolveExit, reject) => {
        child.once('error', reject); child.once('close', resolveExit);
      });
      assert.equal(code, 1);
      assert.match(stderr, /CLI_HOST_EVIDENCE_INVALID/);
      assert.doesNotMatch(stdout, /owner pairing link/);
      assert.deepEqual(messages, [], 'worker must not announce readiness before evidence verification');
    } finally { clearTimeout(deadline); if (child.exitCode === null) child.kill(); }
  });
}
