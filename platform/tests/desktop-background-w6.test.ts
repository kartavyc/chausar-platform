import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, win32 } from 'node:path';

// Wave 6, package 6J1 (D3, D36): start at login and keep running in the tray, owner settings with defaults. Only the
// installed beta (release channel "beta") ever registers a login item; previews and development runs never do.
// One-shot A5 (founder answer 5; hands-on rows 4, 88, 114, S12, bug 8): start at login is asked in onboarding, ticked
// by default, and nothing is registered until the owner answers. Its state is read back from the computer itself.
const require = createRequire(import.meta.url);
const { createBackground, bundledCodexEnvironment, LOGIN_ARGS, BACKGROUND_FILE } = require('../../app/desktop/background.cjs');

function memoryFs(initial: Record<string, string> = {}) {
  const files = new Map<string, string>(Object.entries(initial)), modes = new Map<string, number>(), folders: string[] = [], removed: string[] = [];
  return {
    files, modes, folders, removed,
    readFile: async (path: string) => { if (!files.has(path)) throw Object.assign(new Error('missing'), { code: 'ENOENT' }); return files.get(path)!; },
    writeFile: async (path: string, data: string, options: any) => { files.set(path, String(data)); modes.set(path, options?.mode); },
    mkdir: async (path: string) => { folders.push(path); },
    rm: async (path: string) => { removed.push(path); files.delete(path); },
  };
}
/**
 * Electron's login items as this computer keeps them. Windows: the current user's Run values by name, each with the
 * Task Manager switch (StartupApproved); getLoginItemSettings lists the values that start this program as launchItems.
 * macOS: one login item for the app, which System Settings may hold for approval.
 */
function fakeApp(platform = 'win32') {
  const logins: any[] = [];
  const run = new Map<string, { path: string; args: string[]; enabled: boolean }>();
  let mac: { openAtLogin: boolean; status: string } = { openAtLogin: false, status: 'not-registered' };
  return {
    logins, run,
    macStatus: (status: string) => { mac = { openAtLogin: status === 'enabled', status }; },
    setLoginItemSettings: (settings: any) => {
      logins.push(JSON.parse(JSON.stringify(settings)));
      if (platform === 'darwin') { mac = settings.openAtLogin ? { openAtLogin: true, status: 'enabled' } : { openAtLogin: false, status: 'not-registered' }; return; }
      if (settings.openAtLogin) run.set(settings.name, { path: settings.path, args: [...settings.args], enabled: settings.enabled !== false });
      else run.delete(settings.name);
    },
    getLoginItemSettings: (options: any = {}) => {
      if (platform === 'darwin') return { ...mac, wasOpenedAtLogin: false, executableWillLaunchAtLogin: false, launchItems: [] };
      const launchItems = [...run].filter(([, item]) => item.path === options.path).map(([name, item]) => ({ name, path: item.path, args: [...item.args], scope: 'user', enabled: item.enabled }));
      return { openAtLogin: false, wasOpenedAtLogin: false, status: 'not-registered', executableWillLaunchAtLogin: launchItems.some(item => item.enabled), launchItems };
    },
  };
}
const base = (over: any = {}) => ({ platform: 'win32', directory: 'C:/Users/owner/AppData/Roaming/Chausar', home: 'C:/Users/owner', env: {}, execPath: 'C:/Users/owner/AppData/Local/Programs/Chausar/Chausar.exe', beta: true, ...over });
const SAVED = join('C:/Users/owner/AppData/Roaming/Chausar', BACKGROUND_FILE);
const ITEM = { openAtLogin: true, path: base().execPath, args: ['--background', '--hidden'], name: 'Chausar' };
const OFF = { openAtLogin: false, path: base().execPath, args: ['--background', '--hidden'], name: 'Chausar' };

test('the installed beta suggests start at login and keeps running in the tray, unasked; previews keep neither (6J1, A5)', async () => {
  const fs = memoryFs(), app = fakeApp();
  const beta = createBackground({ ...base(), app, fs });
  assert.deepEqual(await beta.settings(), { startAtLogin: true, keepRunning: true, asked: false });
  const preview = createBackground({ ...base({ beta: false }), app, fs });
  assert.deepEqual(await preview.settings(), { startAtLogin: false, keepRunning: false, asked: false });
});

test('a damaged or foreign settings file counts as not asked, with the defaults, instead of failing the start (6J1, A5)', async () => {
  for (const text of ['not json', '[]', '{"startAtLogin":"yes","keepRunning":true}', '{"startAtLogin":true}']) {
    const app = fakeApp();
    const background = createBackground({ ...base(), app, fs: memoryFs({ [SAVED]: text }) });
    assert.deepEqual(await background.settings(), { startAtLogin: true, keepRunning: true, asked: false }, text);
    await background.apply();
    assert.deepEqual(app.logins, [], `${text}: nothing registered`);
  }
  const saved = createBackground({ ...base(), app: fakeApp(), fs: memoryFs({ [SAVED]: '{"startAtLogin":false,"keepRunning":true}' }) });
  assert.deepEqual(await saved.settings(), { startAtLogin: false, keepRunning: true, asked: true });
});

test('A5 (S12, bug 8): the first start registers nothing; the owner\'s yes registers one login item that starts hidden', async () => {
  const fs = memoryFs(), app = fakeApp();
  const background = createBackground({ ...base(), app, fs });
  await background.apply();
  assert.deepEqual(app.logins, [], 'no login item before the owner answers');
  assert.deepEqual(await background.state(), { supported: true, asked: false, startAtLogin: true, keepRunning: true, registered: false, systemOff: false });
  assert.deepEqual(LOGIN_ARGS, ['--background', '--hidden']);
  const yes = await background.change({ startAtLogin: true });
  assert.deepEqual(app.logins, [ITEM]);
  assert.deepEqual(yes, { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: true, systemOff: false });
  assert.deepEqual(JSON.parse(fs.files.get(SAVED)!), { startAtLogin: true, keepRunning: true });
  assert.equal(fs.modes.get(SAVED), 0o600);
  const no = await background.change({ startAtLogin: false });
  assert.deepEqual(app.logins.at(-1), OFF);
  assert.deepEqual(no, { supported: true, asked: true, startAtLogin: false, keepRunning: true, registered: false, systemOff: false });
});

test('A5: the state is the computer\'s own: a login item switched off in Task Manager reads off, and a start leaves it so', async () => {
  const fs = memoryFs({ [SAVED]: '{"startAtLogin":true,"keepRunning":true}' }), app = fakeApp();
  const background = createBackground({ ...base(), app, fs });
  // A saved yes with no login item at all (the program moved, say): the start registers it again.
  await background.apply();
  assert.deepEqual(app.logins, [ITEM]);
  // The owner turns it off in Task Manager: the value stays, its switch is off.
  app.run.get('Chausar')!.enabled = false;
  assert.deepEqual(await background.state(), { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: false, systemOff: true });
  await background.apply();
  assert.equal(app.logins.length, 1, 'the start never turns back on what the computer\'s own settings turned off');
  // Turning it on in Chausar is the owner's own act, and Electron turns the Task Manager switch back on with it.
  assert.equal((await background.change({ startAtLogin: true })).registered, true);
  // A login item another program wrote for this one, or one for another program, is not Chausar's.
  app.run.delete('Chausar');
  app.run.set('Other', { path: base().execPath, args: [], enabled: true });
  app.run.set('Chausar', { path: 'C:/elsewhere/Chausar.exe', args: [], enabled: true });
  assert.equal((await background.state()).registered, false);
});

test('A5: a saved no removes a login item left by an older start, at the next start', async () => {
  const app = fakeApp();
  app.run.set('Chausar', { path: base().execPath, args: [...LOGIN_ARGS], enabled: true });
  const background = createBackground({ ...base(), app, fs: memoryFs({ [SAVED]: '{"startAtLogin":false,"keepRunning":false}' }) });
  await background.apply();
  assert.deepEqual(app.logins, [OFF]);
  assert.equal((await background.state()).registered, false);
  // Unasked, an older beta's login item is left as it is and shown as it is: the owner decides in Settings.
  const older = fakeApp();
  older.run.set('Chausar', { path: base().execPath, args: [...LOGIN_ARGS], enabled: true });
  const unasked = createBackground({ ...base(), app: older, fs: memoryFs() });
  await unasked.apply();
  assert.deepEqual(older.logins, []);
  assert.equal((await unasked.state()).registered, true);
});

test('A5: changing only Keep running before start at login was answered saves what the computer does now', async () => {
  const fs = memoryFs(), app = fakeApp();
  const background = createBackground({ ...base(), app, fs });
  const state = await background.change({ keepRunning: false });
  assert.deepEqual(app.logins, []);
  assert.deepEqual(state, { supported: true, asked: true, startAtLogin: false, keepRunning: false, registered: false, systemOff: false });
});

test('on Linux the owner\'s yes writes an XDG autostart file for the AppImage (or the unpacked app), and no deletes it (6J1, A5)', async () => {
  const fs = memoryFs(), app = fakeApp('linux');
  const env = { APPIMAGE: '/home/owner/Apps/Chausar Beta.AppImage' };
  const background = createBackground({ ...base({ platform: 'linux', home: '/home/owner', directory: '/home/owner/.config/Chausar', execPath: '/tmp/.mount_x/chausar', env }), app, fs });
  const file = '/home/owner/.config/autostart/chausar.desktop';
  await background.apply();
  assert.equal(fs.files.has(file), false, 'nothing before the owner answers');
  assert.equal((await background.change({ startAtLogin: true })).registered, true);
  const text = fs.files.get(file)!;
  assert.match(text, /^\[Desktop Entry\]\n/);
  assert.match(text, /\nType=Application\n/);
  assert.match(text, /\nName=Chausar\n/);
  assert.match(text, /\nExec="\/home\/owner\/Apps\/Chausar Beta\.AppImage" --background --hidden\n/);
  // TryExec lets the desktop skip the entry once the program is gone: a deleted AppImage, or a deb removed with apt,
  // which cannot reach each owner's autostart folder (found on the VPS install, 2 Nov).
  assert.match(text, /\nTryExec=\/home\/owner\/Apps\/Chausar Beta\.AppImage\n/);
  assert.match(text, /\nX-GNOME-Autostart-enabled=true\n/);
  assert.equal(text.includes('\u2014'), false);
  assert.deepEqual(app.logins, [], 'Electron has no Linux login items; the file is the login item');
  // The desktop's own startup settings switch it off in the file: that reads off, and a start leaves it.
  fs.files.set(file, text.replace('X-GNOME-Autostart-enabled=true', 'X-GNOME-Autostart-enabled=false'));
  assert.deepEqual(await background.state(), { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: false, systemOff: true });
  await background.apply();
  assert.match(fs.files.get(file)!, /X-GNOME-Autostart-enabled=false/);
  assert.equal((await background.change({ startAtLogin: false })).registered, false);
  assert.equal(fs.files.has(file), false);
  assert.ok(fs.removed.includes(file));
  const unpacked = memoryFs();
  await createBackground({ ...base({ platform: 'linux', home: '/home/owner', directory: '/home/owner/.config/Chausar', execPath: '/opt/chausar/chausar', env: { XDG_CONFIG_HOME: '/home/owner/cfg' } }), app, fs: unpacked }).change({ startAtLogin: true });
  assert.match(unpacked.files.get('/home/owner/cfg/autostart/chausar.desktop')!, /\nExec="\/opt\/chausar\/chausar" --background --hidden\n/);
  assert.match(unpacked.files.get('/home/owner/cfg/autostart/chausar.desktop')!, /\nTryExec=\/opt\/chausar\/chausar\n/);
  const odd = memoryFs();
  await createBackground({ ...base({ platform: 'linux', home: '/home/owner', directory: '/home/owner/.config/Chausar', execPath: '/opt/a\\b\nName=x/chausar', env: {} }), app, fs: odd }).change({ startAtLogin: true });
  assert.ok(odd.files.get('/home/owner/.config/autostart/chausar.desktop')!.includes('\nTryExec=/opt/a\\\\bName=x/chausar\n'), 'a backslash or line break in the path cannot add a key');
});

test('A5: on macOS the owner\'s yes is Electron\'s login item, read back, and one waiting for approval reads off', async () => {
  const app = fakeApp('darwin');
  const background = createBackground({ ...base({ platform: 'darwin', home: '/Users/owner', directory: '/Users/owner/Library/Application Support/Chausar', execPath: '/Applications/Chausar.app/Contents/MacOS/Chausar' }), app, fs: memoryFs() });
  await background.apply();
  assert.deepEqual(app.logins, []);
  assert.equal((await background.change({ startAtLogin: true })).registered, true);
  assert.deepEqual(app.logins, [{ openAtLogin: true }]);
  app.macStatus('requires-approval');
  assert.deepEqual(await background.state(), { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: false, systemOff: true });
  assert.equal((await background.change({ startAtLogin: false })).registered, false);
  assert.deepEqual(app.logins.at(-1), { openAtLogin: false });
});

test('previews and development runs never register a login item, whatever the settings file says (6J1)', async () => {
  for (const platform of ['win32', 'linux', 'darwin']) {
    const fs = memoryFs({ [SAVED]: '{"startAtLogin":true,"keepRunning":true}' }), app = fakeApp(platform);
    const background = createBackground({ ...base({ beta: false, platform }), app, fs });
    await background.apply();
    await background.change({ startAtLogin: true });
    assert.deepEqual(app.logins, [], platform);
    assert.equal([...fs.files.keys()].some(name => name.includes('autostart')), false);
    assert.equal((await background.state()).supported, false);
    assert.equal((await background.state()).registered, false);
  }
  assert.equal(createBackground({ ...base({ beta: false }), app: fakeApp(), fs: memoryFs() }).menuItems({ startAtLogin: false, keepRunning: false, registered: false }, () => {}).length, 0);
});

test('the tray menu shows both owner settings as ticks with plain labels; Start at login shows the computer\'s state (6J1, A5)', async () => {
  const fs = memoryFs(), app = fakeApp(), changes: any[] = [];
  const background = createBackground({ ...base(), app, fs });
  const items = background.menuItems(await background.state(), (change: any) => changes.push(change));
  assert.deepEqual(items.map((item: any) => [item.label, item.type, item.checked]), [['Start at login', 'checkbox', false], ['Keep running in the tray', 'checkbox', true]]);
  items[0].click({ checked: true }); items[1].click({ checked: false });
  assert.deepEqual(changes, [{ startAtLogin: true }, { keepRunning: false }]);
  const on = background.menuItems(await background.change({ startAtLogin: true }), () => {});
  assert.equal(on[0].checked, true);
});

test('the bundled Codex goes last on the engine PATH, so an owner\'s own Codex still wins, and only when it is there (6J1, D12)', () => {
  const resources = 'C:/Users/owner/AppData/Local/Programs/Chausar/resources';
  const present = () => true, absent = () => false;
  const env = bundledCodexEnvironment({ Path: 'C:/Windows;C:/npm', OTHER: 'x' }, { resourcesPath: resources, platform: 'win32', exists: present });
  assert.equal(env.Path, `C:/Windows;C:/npm;${win32.join(resources, 'codex', 'bin')}`);
  assert.equal(env.OTHER, 'x');
  assert.deepEqual(bundledCodexEnvironment({ Path: 'C:/Windows' }, { resourcesPath: resources, platform: 'win32', exists: absent }), { Path: 'C:/Windows' });
  const twice = bundledCodexEnvironment(env, { resourcesPath: resources, platform: 'win32', exists: present });
  assert.equal(twice.Path, env.Path, 'never added twice');
  const linux = bundledCodexEnvironment({ PATH: '/usr/bin' }, { resourcesPath: '/opt/chausar/resources', platform: 'linux', exists: present });
  assert.equal(linux.PATH, '/usr/bin:/opt/chausar/resources/codex/bin');
  assert.equal(bundledCodexEnvironment({}, { resourcesPath: '/r', platform: 'linux', exists: present }).PATH, '/r/codex/bin');
  // A2: the engine is told where the bundle is, so it can load the setup recorded for it at build time.
  assert.equal(env.CHAUSAR_CODEX_BUNDLE_DIR, win32.join(resources, 'codex'));
  assert.equal(linux.CHAUSAR_CODEX_BUNDLE_DIR, '/opt/chausar/resources/codex');
  assert.equal('CHAUSAR_CODEX_BUNDLE_DIR' in bundledCodexEnvironment({ Path: 'C:/Windows' }, { resourcesPath: resources, platform: 'win32', exists: absent }), false);
});

// ---------------------------------------------------------------------------
// One-shot A5, fix round 1.
// ---------------------------------------------------------------------------
const LINUX = (over: any = {}) => base({ platform: 'linux', home: '/home/owner', directory: '/home/owner/.config/Chausar', execPath: '/tmp/.mount_x/chausar', ...over });
const LINUX_SAVED = join('/home/owner/.config/Chausar', BACKGROUND_FILE);
const AUTOSTART = '/home/owner/.config/autostart/chausar.desktop';
const entryFor = (program: string, enabled = 'true') => `[Desktop Entry]\nType=Application\nName=Chausar\nExec="${program}" --background --hidden\nTryExec=${program}\nX-GNOME-Autostart-enabled=${enabled}\n`;

test('A5 fix 1: a saved yes whose autostart file starts an older AppImage is rewritten for this one at the next start', async () => {
  const fs = memoryFs({ [LINUX_SAVED]: '{"startAtLogin":true,"keepRunning":true}', [AUTOSTART]: entryFor('/home/owner/Apps/Chausar-1.0.AppImage') });
  const background = createBackground({ ...LINUX({ env: { APPIMAGE: '/home/owner/Apps/Chausar-1.1.AppImage' } }), app: fakeApp('linux'), fs });
  await background.apply();
  const text = fs.files.get(AUTOSTART)!;
  assert.match(text, /\nExec="\/home\/owner\/Apps\/Chausar-1\.1\.AppImage" --background --hidden\n/);
  assert.match(text, /\nTryExec=\/home\/owner\/Apps\/Chausar-1\.1\.AppImage\n/);
  assert.equal((await background.state()).registered, true);
});

test('A5 fix 1: a stale autostart file the desktop switched off is rewritten for this program and stays off', async () => {
  const fs = memoryFs({ [LINUX_SAVED]: '{"startAtLogin":true,"keepRunning":true}', [AUTOSTART]: `${entryFor('/home/owner/Apps/Chausar-1.0.AppImage', 'false')}Hidden=true\n` });
  const background = createBackground({ ...LINUX({ env: { APPIMAGE: '/home/owner/Apps/Chausar-1.1.AppImage' } }), app: fakeApp('linux'), fs });
  await background.apply();
  const text = fs.files.get(AUTOSTART)!;
  assert.match(text, /\nTryExec=\/home\/owner\/Apps\/Chausar-1\.1\.AppImage\n/);
  assert.match(text, /\nX-GNOME-Autostart-enabled=false\n/);
  assert.match(text, /\nHidden=true\n/);
  assert.deepEqual(await background.state(), { supported: true, asked: true, startAtLogin: true, keepRunning: true, registered: false, systemOff: true });
  // An up to date file is left exactly as it is.
  const current = memoryFs({ [LINUX_SAVED]: '{"startAtLogin":true,"keepRunning":true}' });
  const same = createBackground({ ...LINUX({ env: { APPIMAGE: '/home/owner/Apps/Chausar-1.1.AppImage' } }), app: fakeApp('linux'), fs: current });
  await same.change({ startAtLogin: true });
  const written = current.files.get(AUTOSTART)!;
  let writes = 0;
  const counted = { ...current, writeFile: async (path: string, data: string, options: any) => { writes++; await current.writeFile(path, data, options); } };
  await createBackground({ ...LINUX({ env: { APPIMAGE: '/home/owner/Apps/Chausar-1.1.AppImage' } }), app: fakeApp('linux'), fs: counted }).apply();
  assert.equal(writes, 0);
  assert.equal(current.files.get(AUTOSTART), written);
});

test('A5 fix 3: two changes at once both land, in order: the saved file and the computer agree', async () => {
  const slow = memoryFs(), app = fakeApp();
  const later = (ms: number) => new Promise(accept => setTimeout(accept, ms));
  const fs = { ...slow, writeFile: async (path: string, data: string, options: any) => { await later(5); await slow.writeFile(path, data, options); }, mkdir: async (path: string) => { await later(5); await slow.mkdir(path); } };
  const background = createBackground({ ...base(), app, fs });
  const [first, second] = await Promise.all([background.change({ startAtLogin: true }), background.change({ keepRunning: false })]);
  assert.deepEqual(JSON.parse(slow.files.get(SAVED)!), { startAtLogin: true, keepRunning: false });
  assert.equal(app.run.has('Chausar'), true);
  assert.deepEqual([first.registered, second.registered, second.keepRunning], [true, true, false]);
  const next = createBackground({ ...base(), app, fs: slow });
  assert.deepEqual(await next.settings(), { startAtLogin: true, keepRunning: false, asked: true });
  // A change that fails does not stop the next one.
  const broken = { ...slow, writeFile: async () => { throw Object.assign(new Error('disk full'), { code: 'ENOSPC' }); } };
  const failing = createBackground({ ...base(), app: fakeApp(), fs: broken });
  await assert.rejects(failing.change({ startAtLogin: true }), { code: 'ENOSPC' });
  assert.equal((await failing.state()).supported, true);
});

test('A5 fix 9: Exec quotes the program as the desktop entry spec asks: %% for %, backslash escapes inside the quotes, then doubled', async () => {
  const fs = memoryFs();
  const bs = String.fromCharCode(92), tick = String.fromCharCode(96);
  const program = `/home/owner/My Apps/100% "ok"${bs}x$${tick}y/Chausar.AppImage`;
  await createBackground({ ...LINUX({ env: { APPIMAGE: program } }), app: fakeApp('linux'), fs }).change({ startAtLogin: true });
  const text = fs.files.get(AUTOSTART)!;
  const exec = /\nExec=(.*)\n/.exec(text)![1];
  // Inside the quotes: a backslash before each of " ` $ and backslash; then each backslash doubled for the string
  // value; and % (a field code) written %%.
  const two = bs + bs;
  assert.equal(exec, `"/home/owner/My Apps/100%% ${two}"ok${two}"${two}${two}x${two}$${two}${tick}y/Chausar.AppImage" --background --hidden`);
  assert.equal(/\nTryExec=(.*)\n/.exec(text)![1], `/home/owner/My Apps/100% "ok"${two}x$${tick}y/Chausar.AppImage`);
});

test('A5 fix round 1 (the founder): an older silent login item stays until the owner answers; yes keeps it, no removes it', async () => {
  for (const answer of [true, false]) {
    const app = fakeApp();
    app.run.set('Chausar', { path: base().execPath, args: [...LOGIN_ARGS], enabled: true });
    const fs = memoryFs();
    const background = createBackground({ ...base(), app, fs });
    await background.apply();
    assert.deepEqual(await background.state(), { supported: true, asked: false, startAtLogin: true, keepRunning: true, registered: true, systemOff: false });
    const after = await background.change({ startAtLogin: answer });
    assert.deepEqual([after.asked, after.registered, app.run.has('Chausar')], [true, answer, answer]);
    const next = createBackground({ ...base(), app, fs });
    await next.apply();
    assert.deepEqual([(await next.state()).asked, app.run.has('Chausar')], [true, answer], 'the answer sticks');
  }
});
