// Independent shared transport review: oversized decompression and nonzero-offset inputs retain native refusal parity.
import test from 'node:test';import assert from 'node:assert/strict';
import {zip,unzip} from '../runtime/venture/playbooks/kit/ooxml/zip.ts';
import {unzipBrowser,storedZipBytes} from '../runtime/venture/playbooks/kit/ooxml/browser.ts';
test('browser refuses a compressed payload that expands beyond its claimed size',async()=>{
 const bytes=zip([{name:'facts.txt',bytes:new TextEncoder().encode('a'.repeat(100000))}]),view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);const end=bytes.length-22,central=view.getUint32(end+16,true);view.setUint32(central+24,1,true);
 assert.throws(()=>unzip(bytes),{code:'OOXML_UNREADABLE'});await assert.rejects(unzipBrowser(bytes),{code:'OOXML_UNREADABLE'});
});
test('browser and native transports agree on byte-offset input and binary content',async()=>{
 const parts=[{name:'binary.dat',bytes:new Uint8Array([0,127,255,128,13,10])}];
 for(const source of [zip(parts),storedZipBytes(parts)]){const surrounding=new Uint8Array(source.length+19);surrounding.fill(255);surrounding.set(source,7);const slice=surrounding.subarray(7,7+source.length);assert.deepEqual(unzip(slice),parts);assert.deepEqual(await unzipBrowser(slice),parts);}
});
