import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';

// One-shot A7: the founder's logo (a #070809 tile, a #e8ebee square top left, a #46f09b square bottom right) is the
// app icon, the tray icon, the window icon and the favicon. Its green is the logo's own, not the app's Jade.
const repo = new URL('../../', import.meta.url);
const read = (path: string) => readFile(new URL(path, repo));
const json = async (path: string) => JSON.parse((await read(path)).toString('utf8'));
const modulePath = '../../scripts/desktop-package.mjs';
const { validateIconConfig, validateBetaConfig, ICON_FILES } = await import(modulePath);

const ICO = 'app/desktop/icons/icon.ico', ICNS = 'app/desktop/icons/icon.icns', LINUX = 'app/desktop/icons/png';
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const TILE = [0x07, 0x08, 0x09], GREY = [0xe8, 0xeb, 0xee], GREEN = [0x46, 0xf0, 0x9b];

/** sha256 of each file as the founder gave it in outputs/logo (copied, never redrawn). */
const GIVEN: Record<string, string> = {
  [ICO]: '2379f86020b225f435126ed6d8ae7e089c83f8e4bf036bd46c3519522bdf157e',
  [ICNS]: 'e836b056fa5356101898e86ac8f9d0ec2479642ab610f5135fbb94a47a3a4c47',
  [`${LINUX}/16x16.png`]: '9c830d0b4793b64e16993d3b1d52e8782bc99d9f31b78685414666b56d7211d0',
  [`${LINUX}/24x24.png`]: 'f384d8fe025abe8406fb6b9bc594c89104a05c634df12049224d010fe5c32e89',
  [`${LINUX}/32x32.png`]: 'd1b2811e55f5660cfe404fe8afe9ea4da1e6f67670af0b5b4ca1445882375c12',
  [`${LINUX}/48x48.png`]: '4be7cff58cfcdbb6859e6837ae1fbf7caa2b1937c7b71b416813e3b2cb281680',
  [`${LINUX}/64x64.png`]: 'd9720cda66ae23f8e0575a491d5db249066808ddcbda296830c36780ba9a9845',
  [`${LINUX}/128x128.png`]: '58d575d105ceb068d8d6c2b2fd703b12a6479367c5dbc7539d7e8815a0fe422a',
  [`${LINUX}/256x256.png`]: '2c3d494bbff90d81dc1d52e293eb0a1c9aae8de869b9326a72b8b4b1a8666773',
  [`${LINUX}/512x512.png`]: '71667079ebf6a997cd3d6d14390de2de3e0034ede94a2c890664308c62e3a9b4',
};
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

/** A PNG's size and pixels as RGBA, any colour type this repo uses (RGB, RGBA) and any row filter. */
function decodePng(data: Buffer, name = 'png') {
  assert.deepEqual([...data.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${name} is a PNG`);
  let at = 8, width = 0, height = 0, colour = -1;
  const chunks: Buffer[] = [];
  while (at < data.length) {
    const length = data.readUInt32BE(at), kind = data.subarray(at + 4, at + 8).toString('latin1'), body = data.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') { width = body.readUInt32BE(0); height = body.readUInt32BE(4); colour = body[9]!; assert.equal(body[8], 8, `${name}: 8 bits`); assert.equal(body[12], 0, `${name}: not interlaced`); }
    if (kind === 'IDAT') chunks.push(body);
    at += 12 + length;
  }
  assert.ok(colour === 2 || colour === 6, `${name}: RGB or RGBA`);
  const channels = colour === 6 ? 4 : 3, stride = width * channels;
  const raw = inflateSync(Buffer.concat(chunks)), out = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!, row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels]! : 0, b = y > 0 ? out[(y - 1) * stride + x]! : 0, c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels]! : 0;
      const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
      const predict = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      assert.notEqual(predict, undefined, `${name}: filter ${filter}`);
      out[y * stride + x] = (row[x]! + predict!) & 0xff;
    }
  }
  const pixel = (x: number, y: number) => { const i = y * stride + x * channels; return [out[i]!, out[i + 1]!, out[i + 2]!, channels === 4 ? out[i + 3]! : 255]; };
  return { width, height, colour, pixel };
}

/** The logo at any size: tile at the edges' middles, grey in the top left square, green in the bottom right one, the
 * tile between them, and the rounded corners clear. The squares sit at 112 to 256 and 264 to 408 of 520. */
function assertLogo(png: ReturnType<typeof decodePng>, name: string) {
  const at = (unit: number) => Math.min(png.width - 1, Math.floor((unit / 520) * png.width));
  const alpha = (x: number, y: number) => png.pixel(x, y)[3];
  // At 16 px a square is 4.4 pixels wide, so even its middle pixel is a little blended with the tile.
  const near = (x: number, y: number, colour: number[]) => png.pixel(x, y).slice(0, 3).every((value, i) => Math.abs(value - colour[i]!) <= 16) && alpha(x, y) === 255;
  assert.ok(near(at(184), at(184), GREY), `${name}: the top left square is grey`);
  assert.ok(near(at(336), at(336), GREEN), `${name}: the bottom right square is green`);
  for (const [x, y] of [[at(336), at(184)], [at(184), at(336)], [at(260), at(40)], [at(40), at(260)]]) assert.deepEqual(png.pixel(x!, y!), [...TILE, 255], `${name}: (${x}, ${y}) is the tile`);
  assert.equal(alpha(at(260), 0), 255, `${name}: the tile reaches the edge`);
  assert.ok(alpha(0, 0) < 255, `${name}: the corners are rounded and clear`);
}

test('every builder config names the logo for Windows, macOS and Linux, and the installer and uninstaller (A7)', async () => {
  for (const file of ['builder.beta.json', 'builder.preview.json', 'builder.json']) {
    const config = await json(`app/desktop/${file}`);
    assert.equal(config.win?.icon, ICO, `${file}: Windows`);
    assert.equal(config.linux?.icon, LINUX, `${file}: Linux (deb and AppImage), a folder of sized PNGs`);
    if (config.mac) assert.equal(config.mac.icon, ICNS, `${file}: macOS`);
    if (config.nsis) assert.deepEqual([config.nsis.installerIcon, config.nsis.uninstallerIcon], [ICO, ICO], `${file}: installer and uninstaller`);
    // Only electron-builder reads the icns; the running app never does, so it is left out of the package.
    assert.ok(config.files.includes(`!${ICNS}`), `${file}: the icns stays out of the app archive`);
    assert.doesNotThrow(() => validateIconConfig(config), file);
  }
  validateBetaConfig(await json('app/desktop/builder.beta.json'));
});

test('the package checks refuse a config without the logo, or with another file', async () => {
  const beta = await json('app/desktop/builder.beta.json');
  const without = { ...beta, win: { ...beta.win, icon: undefined } };
  assert.throws(() => validateIconConfig(without), /icon/);
  assert.throws(() => validateBetaConfig(without), /icon/);
  assert.throws(() => validateIconConfig({ ...beta, linux: { ...beta.linux, icon: 'app/desktop/icon.png' } }), /icon/);
  assert.throws(() => validateIconConfig({ ...beta, nsis: { ...beta.nsis, uninstallerIcon: undefined } }), /icon/);
  assert.throws(() => validateIconConfig({ ...beta, mac: { icon: 'app/desktop/icons/icon.png' } }), /icon/);
  assert.throws(() => validateIconConfig({ ...beta, files: beta.files.filter((entry: unknown) => entry !== `!${ICNS}`) }), /icns/);
  assert.deepEqual([...ICON_FILES].sort(), [ICO, ICNS, ...LINUX_SIZES.map(size => `${LINUX}/${size}x${size}.png`)].sort());
});

test('the icon files are the founder\'s own, byte for byte', async () => {
  for (const [path, hash] of Object.entries(GIVEN)) assert.equal(sha(await read(path)), hash, path);
});

test('the Windows icon holds PNGs of 16, 24, 32, 48, 64, 128 and 256, each its own size', async () => {
  const ico = await read(ICO);
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'an icon file');
  const sizes: number[] = [];
  for (let i = 0; i < ico.readUInt16LE(4); i++) {
    const entry = 6 + i * 16, size = ico[entry] || 256, length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12);
    assert.equal(ico[entry + 1] || 256, size);
    const png = decodePng(ico.subarray(offset, offset + length), `ico ${size}`);
    assert.deepEqual([png.width, png.height, png.colour], [size, size, 6]);
    if (size >= 48) assertLogo(png, `ico ${size}`);
    sizes.push(size);
  }
  assert.deepEqual(sizes, [16, 24, 32, 48, 64, 128, 256], '256 is the size Windows and electron-builder need');
});

test('the macOS icon is an icns with the retina sizes up to 1024', async () => {
  const icns = await read(ICNS);
  assert.equal(icns.subarray(0, 4).toString('latin1'), 'icns');
  assert.equal(icns.readUInt32BE(4), icns.length);
  const types: string[] = [];
  for (let at = 8; at < icns.length; at += icns.readUInt32BE(at + 4)) types.push(icns.subarray(at, at + 4).toString('latin1'));
  for (const type of ['ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14']) assert.ok(types.includes(type), type);
});

test('the Linux icon folder holds one PNG per size, each named by its size, for the deb and the AppImage', async () => {
  for (const size of LINUX_SIZES) {
    const png = decodePng(await read(`${LINUX}/${size}x${size}.png`), `${size}`);
    assert.deepEqual([png.width, png.height, png.colour], [size, size, 6]);
    if (size >= 48) assertLogo(png, `${size}x${size}`);
  }
});

test('the tray icon is the founder\'s tray PNGs as given: the logo at 16, 24 and 32 (1x, 1.5x and 2x), names kept', async () => {
  // nativeImage finds icon@1.5x.png and icon@2x.png beside icon.png by these names, for screens scaled above 100%.
  const TRAY: [string, number, string][] = [
    ['icon.png', 16, '9c830d0b4793b64e16993d3b1d52e8782bc99d9f31b78685414666b56d7211d0'],
    ['icon@1.5x.png', 24, 'f384d8fe025abe8406fb6b9bc594c89104a05c634df12049224d010fe5c32e89'],
    ['icon@2x.png', 32, 'd1b2811e55f5660cfe404fe8afe9ea4da1e6f67670af0b5b4ca1445882375c12'],
  ];
  for (const [name, size, hash] of TRAY) {
    const bytes = await read(`app/desktop/${name}`);
    assert.equal(sha(bytes), hash, `${name} is the founder's file`);
    const png = decodePng(bytes, name);
    assert.deepEqual([png.width, png.height, png.colour], [size, size, 6], name);
    assertLogo(png, name);
  }
  const main = (await read('app/desktop/main.cjs')).toString('utf8');
  assert.match(main, /nativeImage\.createFromPath\(join\(__dirname, 'icon\.png'\)\)/, 'the tray reads icon.png');
});
