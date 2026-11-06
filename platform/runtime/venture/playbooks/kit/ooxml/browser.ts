// Original browser ZIP transport. Shared PKWARE validation matches native OOXML readers.
import {scanZip,verifiedEntry,unreadable,crc32,safeName,type ZipEntry} from './zip-core.ts';
import {ChausarError} from '../../../../portable.ts';
/** Decode one archive with bounded streaming output, refusing inflation beyond the declared size. */
export async function unzipBrowser(input:Uint8Array,limits:{maxEntries?:number;maxBytes?:number}={}):Promise<ZipEntry[]>{
 const directory=scanZip(input,limits),result:ZipEntry[]=[];
 for(const entry of directory.entries){
  if(entry.method===0){result.push(verifiedEntry(entry,entry.packed));continue;}
  const chunks:Uint8Array[]=[];let size=0;
  try{
   const stream=new Blob([new Uint8Array(entry.packed)]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
   const reader=stream.getReader();
   try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.length;if(size>entry.plainSize){await reader.cancel();unreadable();}chunks.push(next.value);}}finally{reader.releaseLock();}
  }catch{unreadable();}
  const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length;}result.push(verifiedEntry(entry,bytes));
 }
 return result;
}
type Field=readonly [number,number,2|4];
function header(size:number,fields:readonly Field[]){const view=new DataView(new ArrayBuffer(size));for(const [at,value,width] of fields)if(width===4)view.setUint32(at,value,true);else view.setUint16(at,value,true);return new Uint8Array(view.buffer);}
/** Store exact binary parts without compression. Untargeted issuer entry bytes are retained. */
export function storedZipBytes(files:readonly ZipEntry[]):Uint8Array{
 const locals:Uint8Array[]=[],central:Uint8Array[]=[];let offset=0;
 for(const file of files){if(!safeName(file.name))throw new ChausarError('OOXML_INVALID','A file inside the document has a name Chausar cannot use.');const name=new TextEncoder().encode(file.name),data=file.bytes,crc=crc32(data);
  locals.push(header(30,[[0,0x04034b50,4],[4,20,2],[6,0x0800,2],[12,33,2],[14,crc,4],[18,data.length,4],[22,data.length,4],[26,name.length,2]]),name,data);
  central.push(header(46,[[0,0x02014b50,4],[4,20,2],[6,20,2],[8,0x0800,2],[14,33,2],[16,crc,4],[20,data.length,4],[24,data.length,4],[28,name.length,2],[42,offset,4]]),name);offset+=30+name.length+data.length;
 }
 const size=central.reduce((n,p)=>n+p.length,0),parts=[...locals,...central,header(22,[[0,0x06054b50,4],[8,files.length,2],[10,files.length,2],[12,size,4],[16,offset,4]])];
 const bytes=new Uint8Array(parts.reduce((n,p)=>n+p.length,0));let at=0;for(const p of parts){bytes.set(p,at);at+=p.length;}return bytes;
}
