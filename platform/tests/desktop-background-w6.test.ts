import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, win32 } from 'node:path';

// Wave 6, package 6J1 (D3, D36): start at login and keep running in the tray, owner settings with defaults. Only the
// installed beta (release channel "beta") ever registers a login item; previews and development runs never do.
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
function fakeApp() {
  const logins: any[] = [];
  return { logins, setLoginItemSettings: (settings: any) => { logins.push(JSON.parse(JSON.stringify(settings))); } };
}
const base = (over: any = {}) => ({ platform: 'win32', directory: 'C:/Users/owner/AppData/Roaming/Chausar', home: 'C:/Users/owner', env: {}, execPath: 'C:/Users/owner/AppData/Local/Programs/Chausar/Chausar.exe', beta: true, ...over });

test('the installed beta starts at login and keeps running in the tray by default; previews keep neither (6J1)', async () => {
  const fs = memoryFs(), app = fakeApp();
  const beta = createBackground({ ...base(), app, fs });
  assert.deepEqual(await beta.settings(), { startAtLogin: true, keepRunning: true });
  const preview = createBackground({ ...base({ beta: false }), app, fs });
  assert.deepEqual(await preview.settings(), { startAtLogin: false, keepRunning: false });
});

test('a damaged or foreign settings file falls back to the defaults instead of failing the start (6J1)', async () => {
  const path = join('C:/Users/owner/AppData/Roaming/Chausar', BACKGROUND_FILE);
  for (const text of ['not json', '[]', '{"startAtLogin":"yes","keepRunning":true}', '{"startAtLogin":true}']) {
    const background = createBackground({ ...base(), app: fakeApp(), fs: memoryFs({ [path]: text }) });
    assert.deepEqual(await background.settings(), { startAtLogin: true, keepRunning: true }, text);
  }
  const saved = createBackground({ ...base(), app: fakeApp(), fs: memoryFs({ [path]: '{"startAtLogin":false,"keepRunning":true}' }) });
  assert.deepEqual(await saved.settings(), { startAtLogin: false, keepRunning: true });
});

test('on Windows the beta registers one login item that starts hidden in the tray, and removes the same one (6J1)', async () => {
  const fs = memoryFs(), app = fakeApp();
  const background = createBackground({ ...base(), app, fs });
  await background.apply();
  assert.deepEqual(LOGIN_ARGS, ['--background', '--hidden']);
  assert.deepEqual(app.logins, [{ openAtLogin: true, path: base().execPath, args: ['--background', '--hidden'], name: 'Chausar' }]);
  const saved = await background.change({ startAtLogin: false });
  assert.deepEqual(saved, { startAtLogin: false, keepRunning: true });
  assert.deepEqual(app.logins.at(-1), { openAtLogin: false, path: base().execPath, args: ['--background', '--hidden'], name: 'Chausar' });
  const path = join('C:/Users/owner/AppData/Roaming/Chausar', BACKGROUND_FILE);
  assert.deepEqual(JSON.parse(fs.files.get(path)!), { startAtLogin: false, keepRunning: true });
  assert.equal(fs.modes.get(path), 0o600);
});

test('on Linux the beta writes an XDG autostart file for the AppImage (or the unpacked app) and deletes it when turned off (6J1)', async () => {
  const fs = memoryFs(), app = fakeApp();
  const env = { APPIMAGE: '/home/owner/Apps/Chausar Beta.AppImage' };
  const background = createBackground({ ...base({ platform: 'linux', home: '/home/owner', directory: '/home/owner/.config/Chausar', execPath: '/tmp/.mount_x/chausar', env }), app, fs });
  await background.apply();
  const file = '/home/owner/.config/autostart/chausar.desktop';
  const text = fs.files.get(file)!;
  assert.match(text, /^\[Desktop Entry\]\n/);
  assert.match(text, /\nType=Application\n/);
  assert.match(text, /\nName=Chausar\n/);
  assert.match(text, /\nExec="\/home\/owner\/Apps\/Chausar Beta\.AppImage" --background --hidden\n/);
  assert.match(text, /\nX-GNOME-Autostart-enabled=true\n/);
  assert.equal(text.includes('\u2014'), false);
  assert.deepEqual(app.logins, [], 'Electron has no Linux login items; the file is the login item');
  await background.change({ startAtLogin: false });
  assert.equal(fs.files.has(file), false);
  assert.ok(fs.removed.includes(file));
  const unpacked = memoryFs();
  await createBackground({ ...base({ platform: 'linux', home: '/home/owner', directory: '/home/owner/.config/Chausar', execPath: '/opt/chausar/chausar', env: { XDG_CONFIG_HOME: '/home/owner/cfg' } }), app, fs: unpacked }).apply();
  assert.match(unpacked.files.get('/home/owner/cfg/autostart/chausar.desktop')!, /\nExec="\/opt\/chausar\/chausar" --background --hidden\n/);
});

test('previews, development runs and Mac never register a login item, whatever the settings file says (6J1)', async () => {
  const path = join('C:/Users/owner/AppData/Roaming/Chausar', BACKGROUND_FILE);
  for (const options of [base({ beta: false }), base({ platform: 'darwin' })]) {
    const fs = memoryFs({ [path]: '{"startAtLogin":true,"keepRunning":true}' }), app = fakeApp();
    const background = createBackground({ ...options, app, fs });
    await background.apply();
    assert.deepEqual(app.logins, []);
    assert.equal([...fs.files.keys()].some(name => name.includes('autostart')), false);
  }
  assert.equal(createBackground({ ...base({ beta: false }), app: fakeApp(), fs: memoryFs() }).menuItems({ startAtLogin: false, keepRunning: false }, () => {}).length, 0);
});

test('the tray menu shows both owner settings as ticks with plain labels, and a tick saves the change (6J1)', async () => {
  const fs = memoryFs(), app = fakeApp(), changes: any[] = [];
  const background = createBackground({ ...base(), app, fs });
  const items = background.menuItems({ startAtLogin: true, keepRunning: false }, (change: any) => changes.push(change));
  assert.deepEqual(items.map((item: any) => [item.label, item.type, item.checked]), [['Start at login', 'checkbox', true], ['Keep running in the tray', 'checkbox', false]]);
  items[0].click({ checked: false }); items[1].click({ checked: true });
  assert.deepEqual(changes, [{ startAtLogin: false }, { keepRunning: true }]);
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
});
