// D5: the installer trim, one rule all three builder files meet (desktop-package.mjs validateTrim) and every packaged
// build is read against (package-contents.mjs). Chromium's languages: English (US and UK) and Hindi, which C5 brings
// back as a pack (the app never picks money or dates from them). No Claude Code program file: Chausar always runs the
// owner's own Claude Code (agent-runtime/route.ts) and never the Agent SDK's bundled one, so the founder dropped it from
// every installer (5 Nov); the SDK itself still ships. Its own module, so neither script imports the other.
// The Mac build (14 Nov 2026): macOS spells the same three its own way. An app there keeps one empty marker folder for
// each language (en.lproj, en_GB.lproj, hi.lproj in Contents/Resources), so each builder file names these for its Mac
// target (mac.electronLanguages). The first real build showed how they get there: electron-builder copies the local
// Electron folder (electronDist) with a copy that never makes empty folders, so none of Electron's 55 marker folders
// reaches the app, and its own trim finds nothing to trim. The pack hook (desktop-after-pack.cjs) puts back exactly the
// three named here, and package-contents.mjs refuses a build without them. Without them a Mac set to English (India)
// got the app in US English; with them, UK English. The language files inside Electron's own framework are not trimmed
// on macOS.
export const TRIM = Object.freeze({
  electronLanguages: Object.freeze(['en-US', 'en-GB', 'hi']),
  macElectronLanguages: Object.freeze(['en', 'en_GB', 'hi']),
  claudeBinary: 'none',
  claudeBinaryExclusion: '!node_modules/@anthropic-ai/claude-agent-sdk-*/**',
});
