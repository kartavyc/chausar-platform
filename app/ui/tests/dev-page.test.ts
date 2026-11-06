import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The parts page (app/ui/parts.html with specimens/, w3 3I) is for the dev server and the screenshot walk only: its
 * sample props never enter src/, the build never makes it, and nothing in the app links to it.
 */

const app = join(import.meta.dirname, '..');
const files = (dir: string): string[] => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path) : [path];
});

describe('the dev-only parts page', () => {
  it('lives beside index.html, with its specimens outside src/', () => {
    expect(existsSync(join(app, 'parts.html'))).toBe(true);
    expect(readFileSync(join(app, 'parts.html'), 'utf8')).toContain('src="./specimens/index.tsx"');
    expect(existsSync(join(app, 'src/specimens'))).toBe(false);
  });

  it('is never built: the build has one input, index.html, and names no other page', () => {
    const config = readFileSync(join(app, 'vite.config.ts'), 'utf8');
    expect(config).not.toMatch(/rollupOptions|rolldownOptions|parts\.html|specimens/);
    // Build for real into a folder of its own (never app/ui/dist, which the servers serve), and look at what came out.
    const out = mkdtempSync(join(tmpdir(), 'ink-dev-page-'));
    try {
      const vite = join(app, '../../node_modules/vite/bin/vite.js');
      execFileSync(process.execPath, [vite, 'build', '--config', join(app, 'vite.config.ts'), '--outDir', out, '--emptyOutDir', '--logLevel', 'error'], { stdio: 'pipe' });
      expect(existsSync(join(out, 'index.html')), 'the build made no index.html').toBe(true);
      expect(existsSync(join(out, 'parts.html'))).toBe(false);
      expect(files(out).some((f) => /specimens/i.test(f))).toBe(false);
    } finally {
      rmSync(out, { recursive: true, force: true });
    }
  }, 60_000);

  it('nothing in the app links to it or imports from it', () => {
    for (const file of [...files(join(app, 'src')), join(app, 'index.html')]) {
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/parts\.html|specimens\//);
    }
  });

  it('only draws on the dev server', () => {
    expect(readFileSync(join(app, 'specimens/index.tsx'), 'utf8')).toMatch(/if \(!import\.meta\.env\.DEV\)/);
  });
});
