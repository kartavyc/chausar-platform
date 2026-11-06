'use strict';
// Chausar desktop (one-shot D7 task 5): where the engine is. The packaged app runs the bundle (scripts/bundle-engine.mjs)
// from app.asar.unpacked; a development run stays on the source. Main takes every engine path from here, and the one other
// engine file it reads is the credential contract the package keeps inside its archive.
const { join } = require('node:path');

function enginePaths({ packaged, resourcesPath, root }) {
  const runtimeRoot = packaged ? join(resourcesPath, 'app.asar.unpacked', 'app', 'engine', 'dist', 'runtime') : join(root, 'platform', 'runtime');
  const ending = packaged ? '.js' : '.ts';
  return Object.freeze({
    runtimeRoot,
    worker: join(runtimeRoot, `worker${ending}`),
    extractWorker: join(runtimeRoot, 'venture', 'network', `extract-worker${ending}`),
    projectFolder: join(runtimeRoot, 'venture', 'playbooks', 'youtube', `project-folder${ending}`),
  });
}

module.exports = Object.freeze({ enginePaths });
