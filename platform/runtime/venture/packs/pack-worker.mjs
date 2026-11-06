// W6 6F2 trusted worker for pack calculators. Untrusted bytes are WebAssembly, never JavaScript or a path to code.
// The module imports nothing; run(...i64) returns one i64. The parent kills this process at its deadline.
let input = '';
for await (const chunk of process.stdin) { input += chunk; if (input.length > 200000) throw new Error('INPUT_LIMIT'); }
const request = JSON.parse(input);
const module = await WebAssembly.compile(Buffer.from(request.moduleBase64, 'base64'));
if (WebAssembly.Module.imports(module).length !== 0) throw new Error('UNAPPROVED_IMPORT');
const instance = await WebAssembly.instantiate(module, {});
const run = instance.exports.run;
if (typeof run !== 'function') throw new Error('MISSING_RUN_EXPORT');
const result = run(...request.args.map(value => BigInt(value)));
if (typeof result !== 'bigint') throw new Error('INVALID_RESULT');
let pages = 0;
for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) pages += value.buffer.byteLength / 65536;
if (pages > request.maxMemoryPages) throw new Error('MEMORY_LIMIT');
process.stdout.write(JSON.stringify({ result: result.toString() }));
