// D7 task 2: the engine's lazy loads, made visible to the bundler. Eight engine files load a local file only when a
// function runs (createRequire(import.meta.url)('./x.ts')), because a static import would change the order modules are
// set up in and read a constant before it exists (tried in D7: the bookkeeping, newsletter and kit modules failed with
// "Cannot access ... before initialization"). The source keeps them as they are; the bundle turns each into a plain
// require('./x.ts'), which rolldown follows and wraps so the module still runs on first use. Packages loaded by name
// are left alone.
const LOADER = /(?:const|let|var)\s+(\w+)\s*=\s*createRequire\(\s*import\.meta\.url\s*\)/g;
const INLINE = /createRequire\(\s*import\.meta\.url\s*\)\(\s*(['"])(\.{1,2}\/[^'"]+)\1\s*\)/g;

/** The code with every relative lazy load as require('<path>'), and how many were rewritten. */
export function rewriteLazyLoads(code) {
  let count = 0;
  let out = code.replace(INLINE, (_whole, quote, target) => { count += 1; return `require(${quote}${target}${quote})`; });
  for (const name of new Set([...out.matchAll(LOADER)].map(match => match[1]))) {
    const call = new RegExp(String.raw`(?<![\w$])(?<![^.]\.)${name}\(\s*(['"])(\.{1,2}/[^'"]+)\1\s*\)`, 'g');
    out = out.replace(call, (_whole, quote, target) => { count += 1; return `require(${quote}${target}${quote})`; });
  }
  return { code: out, count };
}

/** The rolldown plugin: rewrites the engine's own files only. */
export function lazyRequirePlugin() {
  return {
    name: 'chausar-engine-lazy-require',
    transform(code, id) {
      if (!/[\/]platform[\/]runtime[\/].*\.ts$/.test(id) || !code.includes('createRequire')) return null;
      const { code: rewritten, count } = rewriteLazyLoads(code);
      return count ? { code: rewritten, map: null } : null;
    },
  };
}
