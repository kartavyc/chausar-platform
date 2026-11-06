import { spawnSync } from 'node:child_process';
import { statSync, writeFileSync } from 'node:fs';
import { cpus, platform, arch } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const samples = {};
for (const name of ['engine', 'server']) {
  samples[name] = [];
  for (let i = 0; i < 5; i++) {
    const source = `import { registerHooks } from 'node:module'; import { statSync } from 'node:fs'; const loaded = new Set(); registerHooks({resolve(specifier, context, next) { const result = next(specifier, context); if (result.url.startsWith('file:')) loaded.add(result.url); return result; }}); const start = performance.now(); await import(${JSON.stringify(pathToFileURL(resolve('platform/runtime/'+name+'.ts')).href)}); const elapsedMs = performance.now()-start; console.log(JSON.stringify({elapsedMs,modules:loaded.size,bytes:[...loaded].reduce((sum,url)=>sum+statSync(new URL(url)).size,0)}));`;
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', timeout: 60000, windowsHide: true });
    if (child.status !== 0) throw new Error(child.stderr || child.stdout);
    samples[name].push(JSON.parse(child.stdout.trim()));
  }
}
const median = values => [...values].sort((a,b)=>a-b)[2];
const receipt = { node: process.version, platform: platform(), arch: arch(), cpu: cpus()[0]?.model, runs: 5, samples, medians: Object.fromEntries(Object.entries(samples).map(([name,rows])=>[name,{elapsedMs:median(rows.map(row=>row.elapsedMs)),modules:rows[0].modules,bytes:rows[0].bytes}])) };
writeFileSync(process.argv[2], JSON.stringify(receipt,null,2)+'\n'); console.log(JSON.stringify(receipt));
