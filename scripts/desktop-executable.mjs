import { lstat, open } from 'node:fs/promises';
const platforms = new Set(['win32', 'darwin', 'linux']);
const architectures = new Set(['x64', 'arm64']);
async function regular(path) {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('requires a regular local file');
  return info;
}

/** Read only executable headers. This never starts the executable or asserts vendor qualification. */
export async function validateElectronExecutable(path, platform, architecture) {
  if (!platforms.has(platform) || !architectures.has(architecture)) throw new Error('invalid executable target');
  const info = await regular(path);
  if (info.size < 4096 || platform !== 'win32' && !(info.mode & 0o111)) throw new Error('Electron requires a native executable distribution with correct permissions');
  const handle = await open(path, 'r');
  const read = async (size, offset = 0) => {
    const bytes = Buffer.alloc(size);
    if ((await handle.read(bytes, 0, size, offset)).bytesRead !== size) throw new Error('Electron executable header is truncated');
    return bytes;
  };
  try {
    const header = await read(64), magic = header.subarray(0, 4).toString('hex');
    if (platform === 'win32') {
      if (header.subarray(0, 2).toString() !== 'MZ') throw new Error('Electron must be a Windows PE executable');
      const offset = header.readUInt32LE(60);
      if (offset < 64 || offset > 4_194_304 || offset + 6 > info.size) throw new Error('Electron PE header location is invalid');
      const pe = await read(6, offset);
      if (pe.subarray(0, 4).toString('hex') !== '50450000' || pe.readUInt16LE(4) !== (architecture === 'x64' ? 0x8664 : 0xaa64)) throw new Error('Electron Windows architecture differs from the package target');
    } else if (platform === 'linux') {
      if (magic !== '7f454c46' || header[4] !== 2 || ![1, 2].includes(header[5])) throw new Error('Electron must be a 64-bit Linux ELF executable');
      const machine = header[5] === 1 ? header.readUInt16LE(18) : header.readUInt16BE(18);
      if (machine !== (architecture === 'x64' ? 62 : 183)) throw new Error('Electron Linux architecture differs from the package target');
    } else {
      const machine = architecture === 'x64' ? 0x01000007 : 0x0100000c;
      if (['cffaedfe', 'feedfacf'].includes(magic)) {
        if ((magic === 'cffaedfe' ? header.readUInt32LE(4) : header.readUInt32BE(4)) !== machine) throw new Error('Electron macOS architecture differs from the package target');
      } else if (['cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(magic)) {
        const little = ['bebafeca', 'bfbafeca'].includes(magic), uint32 = (bytes, offset) => little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
        const count = uint32(header, 4), width = ['cafebabf', 'bfbafeca'].includes(magic) ? 32 : 20;
        if (!count || count > 64 || 8 + count * width > info.size) throw new Error('Electron universal header is invalid');
        const table = await read(count * width, 8);
        if (!Array.from({ length: count }, (_, index) => uint32(table, index * width)).includes(machine)) throw new Error('Electron universal executable lacks the package architecture');
      } else throw new Error('Electron must be a macOS Mach-O executable');
    }
  } finally { await handle.close(); }
}
