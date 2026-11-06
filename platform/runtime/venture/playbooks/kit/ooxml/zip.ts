// Original native ZIP transport. Shared directory validation is also used by the browser rehearsal.
import {deflateRawSync,inflateRawSync} from 'node:zlib';
import {ChausarError} from '../../../../portable.ts';
import {crc32,safeName,scanZip,verifiedEntry,unreadable,type ZipEntry} from './zip-core.ts';
export {crc32,UNZIP_LIMITS} from './zip-core.ts';
export type {ZipEntry} from './zip-core.ts';
const LOCAL=0x04034b50,CENTRAL=0x02014b50,END=0x06054b50,DOS_DATE=33,UTF8_NAMES=0x0800;
/**
 * The zip of these files, in this order, every entry deflated. The same files give the same bytes. A name that is not
 * a safe relative path refuses (OOXML_INVALID): code names the parts, never a person.
 */
export function zip(files: readonly ZipEntry[]): Uint8Array {
  const locals: Buffer[] = [], centrals: Buffer[] = [];
  let offset = 0;
  for (const file of files) {
    if (!safeName(file.name)) throw new ChausarError('OOXML_INVALID', 'A file inside the document has a name Chausar cannot use.');
    const name = Buffer.from(file.name, 'utf8');
    const data = Buffer.from(file.bytes);
    const packed = deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(UTF8_NAMES, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(UTF8_NAMES, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(0, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    centrals.push(central, name);
    offset += local.length + name.length + packed.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return new Uint8Array(Buffer.concat([...locals, directory, end]));
}

/** Read stored or deflated parts with the shared archive refusal policy. */
export function unzip(input:Uint8Array,limits:{maxEntries?:number;maxBytes?:number}={}):ZipEntry[]{return scanZip(input,limits).entries.map(entry=>{let bytes:Uint8Array;try{bytes=entry.method===0?entry.packed:inflateRawSync(entry.packed,{maxOutputLength:Math.max(1,entry.plainSize)});}catch{unreadable();}return verifiedEntry(entry,bytes);});}
