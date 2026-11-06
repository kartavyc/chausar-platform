// D5: the installer trim, one rule all three builder files meet (desktop-package.mjs validateTrim) and every packaged
// build is read against (package-contents.mjs). Chromium's languages: English (US and UK) and Hindi, which C5 brings
// back as a pack (the app never picks money or dates from them). No Claude Code program file: Chausar always runs the
// owner's own Claude Code (agent-runtime/route.ts) and never the Agent SDK's bundled one, so the founder dropped it from
// every installer (5 Nov); the SDK itself still ships. Its own module, so neither script imports the other.
export const TRIM = Object.freeze({
  electronLanguages: Object.freeze(['en-US', 'en-GB', 'hi']),
  claudeBinary: 'none',
  claudeBinaryExclusion: '!node_modules/@anthropic-ai/claude-agent-sdk-*/**',
});
