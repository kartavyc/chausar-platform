// Trusted worker. Untrusted bytes are WebAssembly, never JavaScript or a path to code.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1900000) throw new Error('INPUT_LIMIT');
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
// Optional bounded input bytes (arguments and fetched responses as data): alloc(len) -> ptr, then run(ptr, len).
let result;
if (typeof request.input === 'string') {
  const bytes = Buffer.from(request.input, 'base64');
  if (bytes.length > 262144) throw new Error('INPUT_LIMIT');
  const memory = instance.exports.memory;
  if (!(memory instanceof WebAssembly.Memory) || typeof instance.exports.alloc !== 'function' || instance.exports.run.length !== 2) throw new Error('INPUT_ABI_REQUIRES_MEMORY_ALLOC_AND_RUN_PTR_LEN');
  const pointer = instance.exports.alloc(bytes.length);
  if (!Number.isInteger(pointer) || pointer < 0 || pointer + bytes.length > memory.buffer.byteLength) throw new Error('INPUT_OUT_OF_BOUNDS');
  new Uint8Array(memory.buffer, pointer, bytes.length).set(bytes);
  result = instance.exports.run(pointer, bytes.length);
} else result = instance.exports.run();
if (typeof result !== 'number' || !Number.isFinite(result)) throw new Error('INVALID_SCALAR_RESULT');
let memoryPages = 0;
for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) memoryPages += value.buffer.byteLength / 65536;
if (memoryPages > request.maxMemoryPages) throw new Error('MEMORY_LIMIT');
process.stdout.write(JSON.stringify({ result, memoryPages }));
