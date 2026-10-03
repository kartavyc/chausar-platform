'use strict';
const { mkdirSync, realpathSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');

function overlaps(left, right) {
  const child = relative(left, right);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

/** Claim a fresh temporary profile before Electron takes its instance lock. */
function bindDemoProfile(app, environment = process.env) {
  const temporary = realpathSync(tmpdir());
  const requested = environment.CHAUSAR_DEMO_PROFILE_ROOT ?? join(temporary, `chausar-demo-${randomUUID()}`);
  if (typeof requested !== 'string' || !isAbsolute(requested) || /[\0\r\n]/.test(requested)) throw new Error('Use an absolute fresh temporary demo profile root.');
  const root = resolve(requested);
  // Only a direct child of the physical temporary directory can be claimed.
  // Never follow a caller-selected parent into a real application profile.
  if (resolve(dirname(root)) !== temporary) throw new Error('The demo profile root must be a direct child of the temporary directory.');
  for (const name of ['userData', 'sessionData']) {
    const existing = resolve(app.getPath(name));
    if (overlaps(existing, root) || overlaps(root, existing)) throw new Error('The demo profile must be separate from the existing Electron profile.');
  }
  mkdirSync(root, { mode: 0o700 }); // EEXIST refuses directories, files and links alike.
  const profile = Object.freeze({ root, userData: join(root, 'userData'), sessionData: join(root, 'sessionData'), vaults: join(root, 'userData', 'vaults') });
  mkdirSync(profile.userData, { mode: 0o700 });
  mkdirSync(profile.sessionData, { mode: 0o700 });
  app.setPath('userData', profile.userData);
  app.setPath('sessionData', profile.sessionData);
  assertDemoProfile(app, profile);
  return profile;
}

function assertDemoProfile(app, profile) {
  for (const name of ['userData', 'sessionData']) {
    if (resolve(app.getPath(name)) !== profile[name]) throw new Error('Electron did not retain the isolated demo profile binding.');
  }
}

module.exports = { bindDemoProfile, assertDemoProfile };
