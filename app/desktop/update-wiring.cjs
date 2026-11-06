'use strict';
// Chausar desktop (one-shot C5 tasks 31, 32): main's side of auto-update, kept here so main.cjs only calls it. Reads the
// build's metadata (chausarUpdatePublicKey, chausarUpdateFeed, chausarWindowsPublisher in package.json), so a packaged app
// needs no environment variable. Empty or absent until the founder gives them: the owner then reads a plain state, and
// nothing here touches the disk. Previews and development runs never take part.
const { join } = require('node:path');

/** The build's update keys, or null when this run has none: a preview, a development run, or a build with no key yet. */
function updateMetadata(metadata, { packaged }) {
  const text = value => (typeof value === 'string' && value.trim() !== '' ? value : null);
  if (!packaged || metadata?.chausarPreview === true) return null;
  const publicKey = text(metadata?.chausarUpdatePublicKey);
  return publicKey ? { publicKey, feedUrl: text(metadata?.chausarUpdateFeed), windowsPublisher: text(metadata?.chausarWindowsPublisher) } : null;
}

/** What the worker needs for the daily check. The folder is always named, so the owner's row reads a plain state. */
function updateEnvironment(metadata, { userData, packaged }) {
  const keys = updateMetadata(metadata, { packaged });
  return {
    CHAUSAR_UPDATES_DIRECTORY: join(userData, 'updates'),
    CHAUSAR_UPDATE_CHANNEL: metadata?.chausarReleaseChannel === 'beta' ? 'beta' : 'stable',
    CHAUSAR_UPDATE_PUBLIC_KEY: keys?.publicKey ?? '',
    CHAUSAR_UPDATE_FEED: keys?.feedUrl ?? '',
    CHAUSAR_WINDOWS_PUBLISHER: keys?.windowsPublisher ?? '',
  };
}

module.exports = Object.freeze({ updateMetadata, updateEnvironment });
