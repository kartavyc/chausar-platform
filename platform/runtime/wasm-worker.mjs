// Trusted worker. Untrusted bytes are WebAssembly, never JavaScript or a path to code.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1500000) throw new Error('INPUT_LIMIT');
}
const request = JSON.parse(input);
const module = await WebAssembly.compile(Buffer.from(request.moduleBase64, 'base64'));
const functions = Object.create(null);
for (const imported of WebAssembly.Module.imports(module)) {
  if (imported.module !== 'chausar' || imported.kind !== 'function' || !Object.hasOwn(request.values, imported.name)) throw new Error('UNAPPROVED_IMPORT');
  functions[imported.name] = (...args) => {
    if (args.length !== 0) throw new Error('HOST_ABI_ONLY_ZERO_ARGUMENT_SCALARS');
    return request.values[imported.name];
  };
}
const instance = await WebAssembly.instantiate(module, { chausar: functions });
if (typeof instance.exports.run !== 'function') throw new Error('MISSING_RUN_EXPORT');
const result = instance.exports.run();
if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('INVALID_SCALAR_RESULT');
let memoryPages = 0;
for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) memoryPages += value.buffer.byteLength / 65536;
if (memoryPages > request.maxMemoryPages) throw new Error('MEMORY_LIMIT');
process.stdout.write(JSON.stringify({ result, memoryPages }));
