'use strict';
const { lstat, readFile } = require('node:fs/promises');
const { join } = require('node:path');
// The new UI is the default renderer. The legacy renderer stays reachable only behind an
// explicit flag; its availability is told to the shell by which host document is served.
const legacyDocument = Object.freeze(['app/ui/host/index-legacy.html', 'text/html; charset=utf-8', 16000]);
const definitions = Object.freeze({
  '/ui/index.html': ['app/ui/host/index.html', 'text/html; charset=utf-8', 16000],
  '/ui/shell.js': ['app/ui/host/shell.js', 'text/javascript; charset=utf-8', 32000],
  '/ui/host.js': ['app/ui/public/host.js', 'text/javascript; charset=utf-8', 2000000],
  '/ui/host.css': ['app/ui/public/host.css', 'text/css; charset=utf-8', 200000],
  // TL tools (reports-tools-trust): the fixed renderer of the small-app frame, a classic script the
  // sandboxed srcdoc frame loads from the app's origin under the app's script-src 'self'.
  '/ui/smallapp-frame.js': ['app/ui/public/smallapp-frame.js', 'text/javascript; charset=utf-8', 64000],
  ...Object.fromEntries(['InstrumentSans-400', 'InstrumentSans-500', 'InstrumentSans-600',
    'DMMono-400', 'DMMono-500', 'IBMPlexMono-500',
    'NotoSansDevanagari-400', 'NotoSansDevanagari-500'].flatMap(name =>
    // The flat host CSS resolves its relative font URLs beside /ui/host.css.
    [`/assets/fonts/${name}.woff2`, `/ui/${name}.woff2`].map(pathname =>
      [pathname, [`app/ui/assets/fonts/${name}.woff2`, 'font/woff2', 600000]]))),
});
async function readUiAsset(root, pathname, enabled, legacyAvailable = false) {
  const definition = enabled !== true ? undefined
    : pathname === '/ui/index.html' && legacyAvailable === true ? legacyDocument : definitions[pathname];
  if (!definition) return null;
  const [relative, mime, limit] = definition, path = join(root, relative);
  try {
    // Every ancestor and final entry must be an ordinary packaged file path.
    const pieces = relative.split('/'); let parent = root;
    for (let i = 0; i < pieces.length; i++) {
      parent = join(parent, pieces[i]); const stat = await lstat(parent);
      if (stat.isSymbolicLink() || (i === pieces.length - 1 ? !stat.isFile() || stat.size > limit : !stat.isDirectory())) return null;
    }
    const body = await readFile(path); if (body.length > limit) return null;
    return { body, mime };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
module.exports = Object.freeze({ readUiAsset });
