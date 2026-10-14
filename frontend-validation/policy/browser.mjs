// Find Playwright and its Chromium without installing anything. Never runs `playwright install`.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const GLOBAL_PLAYWRIGHT = ['/opt/node22/lib/node_modules/playwright/index.mjs', '/usr/local/lib/node_modules/playwright/index.mjs', '/usr/lib/node_modules/playwright/index.mjs'];

export async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* not a local dependency: use the provisioned global copy */ }
  const candidates = [process.env.PLAYWRIGHT_MODULE, ...GLOBAL_PLAYWRIGHT].filter(Boolean);
  for (const candidate of candidates) if (existsSync(candidate)) return import(pathToFileURL(candidate).href);
  throw new Error(`Playwright was not found. Looked in the local packages and ${candidates.join(', ')}.`);
}

/** The Chromium executable under PLAYWRIGHT_BROWSERS_PATH (default /opt/pw-browsers), newest revision first. */
export function chromiumExecutable() {
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  const revisions = readdirSync(root).filter(name => /^chromium(?:_headless_shell)?-\d+$/.test(name))
    .sort((a, b) => Number(b.split('-').pop()) - Number(a.split('-').pop()) || (a.includes('headless') ? -1 : 1));
  for (const name of revisions) {
    for (const binary of ['chrome-linux/headless_shell', 'chrome-linux/chrome', 'chrome-win/chrome.exe', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const path = join(root, name, binary);
      if (existsSync(path)) return path;
    }
  }
  return undefined;
}

export async function launchChromium() {
  const { chromium } = await loadPlaywright();
  const executablePath = chromiumExecutable();
  return chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
}
