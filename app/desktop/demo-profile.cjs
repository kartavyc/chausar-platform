'use strict';
const { mkdirSync, realpathSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { tmpdir } = require('node:os');
const { dirname, isAbsolute, join, relative, resolve, sep } = require('node:path');

function overlaps(left, right) {
  const child = relative(left, right);
  return child === '' || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
}

/** First profile configuration: claim a fresh root before Electron's instance lock. */
function bindDemoProfile(app, environment = process.env) {
  const temporary = realpathSync(tmpdir());
  const requested = environment.CHAUSAR_DEMO_PROFILE_ROOT ?? join(temporary, `chausar-demo-${randomUUID()}`);
  if (typeof requested !== 'string' || !isAbsolute(requested) || /[\0\r\n]/.test(requested)) throw new Error('Use an absolute fresh temporary demo profile root.');
  const root = resolve(requested);
  // Only a direct child of the physical temporary directory can be claimed.
  // Never follow a caller-selected parent into a real application profile.
  if (resolve(dirname(root)) !== temporary) throw new Error('The demo profile root must be a direct child of the temporary directory.');
  // getPath(userData/sessionData) can create the default profile or fail before
  // our override. Inspect its label without accessing that profile instead.
  if (app.commandLine.hasSwitch('user-data-dir')) throw new Error('Do not supply an Electron user-data-dir for an isolated demo.');
  const name = app.getName();
  if (typeof name !== 'string' || !name || name === '.' || name === '..' || /[\\/:\0\r\n]/.test(name)) throw new Error('Electron returned an invalid application name.');
  let applicationData; let defaultUnavailable = false;
  try { applicationData = app.getPath('appData'); }
  catch (error) { if (error?.message !== "Failed to get 'appData' path") throw error; defaultUnavailable = true; }
  // An unavailable OS default is unnecessary for explicit path overrides.
  // No real-user path is substituted; all bound paths come from the fresh root.
  if (!defaultUnavailable) {
    if (typeof applicationData !== 'string' || !isAbsolute(applicationData) || /[\0\r\n]/.test(applicationData)) throw new Error('Electron returned an invalid application data path.');
    const existing = resolve(applicationData, name); // sessionData defaults to userData.
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
    const bound = app.getPath(name);
    if (typeof bound !== 'string' || !isAbsolute(bound) || /[\0\r\n]/.test(bound) || resolve(bound) !== profile[name]) throw new Error('Electron did not retain the isolated demo profile binding.');
  }
}

module.exports = { bindDemoProfile, assertDemoProfile };
