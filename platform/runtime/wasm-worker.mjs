// Trusted worker. Untrusted bytes are WebAssembly, never JavaScript or a path to code.
// Two modes. Scalar (plugins): approved zero-argument chausar imports, one finite number back.
// Table (delivery row programs): no imports at all; run() fills an output table of packed text values in memory,
// and the worker reads it back with bounds checks.
let input = '';
for await (const chunk of process.stdin) {
  input += chunk;
  if (input.length > 1500000) throw new Error('INPUT_LIMIT');
}
const request = JSON.parse(input);
const module = await WebAssembly.compile(Buffer.from(request.moduleBase64, 'base64'));

function memoryPagesOf(instance) {
  let pages = 0;
  for (const value of Object.values(instance.exports)) if (value instanceof WebAssembly.Memory) pages += value.buffer.byteLength / 65536;
  return pages;
}

if (request.mode === 'table') {
  if (WebAssembly.Module.imports(module).length !== 0) throw new Error('UNAPPROVED_IMPORT');
  const instance = await WebAssembly.instantiate(module, {});
  const { run, memory, out_table: outTable, rows, outs } = instance.exports;
  if (typeof run !== 'function' || !(memory instanceof WebAssembly.Memory)) throw new Error('MISSING_RUN_EXPORT');
  if (![outTable, rows, outs].every(value => value instanceof WebAssembly.Global && Number.isInteger(value.value) && value.value >= 0)) throw new Error('MISSING_TABLE_EXPORT');
  if (run() !== 0) throw new Error('ROW_PROGRAM_FAILED');
  const memoryPages = memoryPagesOf(instance);
  if (memoryPages > request.maxMemoryPages) throw new Error('MEMORY_LIMIT');
  const rowCount = rows.value, outCount = outs.value;
  if (rowCount > 5000 || outCount > 16) throw new Error('TABLE_LIMIT');
  const view = new DataView(memory.buffer);
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const result = [];
  let bytes = 0;
  for (let row = 0; row < rowCount; row += 1) {
    const cells = [];
    for (let out = 0; out < outCount; out += 1) {
      const at = outTable.value + (row * outCount + out) * 8;
      if (at + 8 > memory.buffer.byteLength) throw new Error('OUTPUT_BOUNDS');
      const packed = view.getBigUint64(at, true);
      const ptr = Number(packed & 0xffffffffn), length = Number(packed >> 32n);
      if (length > request.maxCellBytes || ptr + length > memory.buffer.byteLength) throw new Error('CELL_LIMIT');
      bytes += length;
      if (bytes > 1000000) throw new Error('OUTPUT_LIMIT');
      cells.push(decoder.decode(new Uint8Array(memory.buffer, ptr, length)));
    }
    result.push(cells);
  }
  process.stdout.write(JSON.stringify({ mode: 'table', rows: result, memoryPages }));
} else {
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
  const memoryPages = memoryPagesOf(instance);
  if (memoryPages > request.maxMemoryPages) throw new Error('MEMORY_LIMIT');
  process.stdout.write(JSON.stringify({ result, memoryPages }));
}
