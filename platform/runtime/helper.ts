import { spawn, type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from 'node:child_process';
import { lstat, readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { ChausarError, check, hash, newId, now } from './contracts.ts';

export type HelperOperation = 'pdf.extract' | 'pdf.ocr' | 'pdf.status' | 'forecast' | 'allocation.optimize';
export type HelperSpawn = (executable: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
export type HelperOptions = { executable?: string; timeoutMs?: number; maxInputBytes?: number; maxOutputBytes?: number; spawnProcess?: HelperSpawn };
export type HelperReceipt = { id: string; operation: HelperOperation; inputHash: string; outputHash: string; implementationHash: string; startedAt: string; finishedAt: string; engine: 'python' | 'injected-process'; pythonVersion: string; resourceLimits: boolean; status: 'completed'; sourceTainted: boolean };
export type HelperResponse = { result: any; receipt: HelperReceipt };
const FILE = fileURLToPath(new URL('../helpers/analytics.py',import.meta.url));
const OPERATIONS = new Set(['pdf.extract','pdf.ocr','pdf.status','forecast','allocation.optimize']);
const ERROR_CODES = new Set(['INVALID_HELPER_INPUT','FORECAST_HISTORY_REQUIRED','FORECAST_GAP','OPTIMIZATION_LIMIT','INVALID_PDF','PDF_DEPENDENCY_UNAVAILABLE','PDF_PAGE_LIMIT','PDF_TEXT_LIMIT','PDF_EXTRACT_FAILED','OCR_DEPENDENCY_UNAVAILABLE','PASSWORD_REQUIRED','WRONG_PASSWORD','DUPLICATE_JSON_KEY','HELPER_INPUT_LIMIT','HELPER_OUTPUT_LIMIT','HELPER_OPERATION_UNSUPPORTED','HELPER_EXECUTION_FAILED']);
function jsonData(value: unknown, depth = 0): void {
  check(depth <= 12,'INVALID_HELPER_INPUT','Helper input nesting is too deep.');
  check(value === null || ['string','number','boolean','object'].includes(typeof value),'INVALID_HELPER_INPUT','Helper inputs are JSON data, never programs.');
  if (typeof value === 'number') check(Number.isSafeInteger(value),'INVALID_HELPER_INPUT','Helper numeric metadata must be safe integers; money uses minor-unit strings.');
  if (value && typeof value === 'object') {
    check(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype,'INVALID_HELPER_INPUT','Helper inputs use plain data objects.');
    check(Object.keys(value).length <= 500,'INVALID_HELPER_INPUT','Helper input has too many fields.');
    for (const [key,item] of Object.entries(value)) { check(!['__proto__','constructor','prototype'].includes(key),'INVALID_HELPER_INPUT','Reserved input fields are refused.'); jsonData(item,depth+1); }
  }
}
/** A PDF password reaches the helper process once; it never enters a receipt hash. */
function withoutPassword(input: unknown): unknown { if (!input || typeof input !== 'object' || Array.isArray(input)) return input; const { password: _password, ...rest } = input as Record<string, unknown>; return rest; }
function validateInput(operation: HelperOperation, input: unknown) {
  check(OPERATIONS.has(operation),'HELPER_OPERATION_UNSUPPORTED','Only registered analytical helpers can run.');
  jsonData(input); check(input && typeof input === 'object' && !Array.isArray(input),'INVALID_HELPER_INPUT','Provide an analytical input object.');
  const allowed = operation === 'pdf.extract' ? ['pdfBase64','maxPages','password'] : operation === 'pdf.ocr' ? ['pdfBase64','maxPages','language','password'] : operation === 'pdf.status' ? [] : operation === 'forecast' ? ['months','currency'] : ['budgetMinor','currency','items'];
  check(Object.keys(input).every(key => allowed.includes(key)),'INVALID_HELPER_INPUT','Arbitrary paths, code and shell options are not analytical inputs.');
}

/** Runs an installed trusted Python helper, never user code or an executable from PATH. */
export class AnalyticalHelper {
  options: HelperOptions & { timeoutMs: number; maxInputBytes: number; maxOutputBytes: number };
  constructor(options: HelperOptions = {}) {
    this.options = { ...options, timeoutMs: options.timeoutMs ?? 15000, maxInputBytes: options.maxInputBytes ?? 6*1024*1024, maxOutputBytes: options.maxOutputBytes ?? 1024*1024 };
    check(Number.isInteger(this.options.timeoutMs) && this.options.timeoutMs >= 50 && this.options.timeoutMs <= 30000 && Number.isInteger(this.options.maxInputBytes) && this.options.maxInputBytes > 0 && this.options.maxInputBytes <= 6*1024*1024 && Number.isInteger(this.options.maxOutputBytes) && this.options.maxOutputBytes > 0 && this.options.maxOutputBytes <= 1024*1024,'HELPER_LIMIT_INVALID','Set bounded helper input, output and process limits.');
  }
  async run(operation: HelperOperation, input: unknown): Promise<HelperResponse> {
    validateInput(operation,input);
    const executable = this.options.executable;
    check(typeof executable === 'string' && isAbsolute(executable),'PYTHON_UNAVAILABLE','Configure an explicit trusted Python executable to use analytical helpers.');
    try { const file = await lstat(executable); check(file.isFile() && !file.isSymbolicLink(),'PYTHON_UNAVAILABLE','The configured helper executable must be a regular trusted file.'); }
    catch { throw new ChausarError('PYTHON_UNAVAILABLE','The configured trusted Python executable is unavailable.'); }
    const payload = JSON.stringify({ operation,input }); check(Buffer.byteLength(payload) <= this.options.maxInputBytes,'HELPER_INPUT_LIMIT','The helper request exceeds its transfer budget.');
    const implementationHash = createHash('sha256').update(await readFile(FILE)).digest('hex');
    const startedAt = now(); const directory = await mkdtemp(join(tmpdir(),'chausar-helper-'));
    try {
      const output: any = await new Promise((accept,reject) => {
        const spawnProcess = this.options.spawnProcess ?? ((exe,args,options) => spawn(exe,args,{...options,stdio:['pipe','pipe','pipe']}) as ChildProcessWithoutNullStreams);
        const child = spawnProcess(executable,['-I','-B',FILE],{cwd:directory,shell:false,windowsHide:true,env: process.platform === 'win32' ? {SystemRoot:process.env.SystemRoot ?? 'C:\\Windows',TEMP:directory,TMP:directory} : {TMPDIR:directory}});
        let bytes = 0; const chunks: Buffer[] = []; let settled = false; let failure: ChausarError | undefined;
        const finish = (error?:Error,result?:unknown) => { if (settled) return; settled = true; clearTimeout(timer); if (error) reject(error); else accept(result); };
        const timer = setTimeout(() => { failure = new ChausarError('HELPER_TIMEOUT','The analytical helper exceeded its process deadline.'); child.kill('SIGKILL'); },this.options.timeoutMs);
        child.on('error',() => finish(new ChausarError('PYTHON_UNAVAILABLE','The analytical helper could not start.')));
        child.stdout.on('data',chunk => { const data = Buffer.from(chunk); bytes += data.length; if (bytes > this.options.maxOutputBytes) { failure = new ChausarError('HELPER_OUTPUT_LIMIT','The helper exceeded its result budget.'); child.kill('SIGKILL'); } else chunks.push(data); });
        child.stderr.on('data',() => {}); // Do not echo library traces, source content or local paths.
        child.stdin.on('error',() => {});
        child.on('close',code => {
          if (failure) return finish(failure);
          try { const response = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (response.ok !== true) throw new ChausarError(ERROR_CODES.has(response.error?.code) ? response.error.code : 'HELPER_EXECUTION_FAILED','The analytical helper refused this input.'); check(code === 0 && response.operation === operation && response.result && typeof response.result === 'object' && !Array.isArray(response.result) && typeof response.runtime?.python === 'string' && /^\d+\.\d+\.\d+$/.test(response.runtime.python) && typeof response.runtime.resourceLimits === 'boolean','HELPER_PROTOCOL_INVALID','The analytical helper returned an invalid result.'); jsonData(response.result); finish(undefined,response); }
          catch (error) { finish(error instanceof ChausarError ? error : new ChausarError('HELPER_PROTOCOL_INVALID','The analytical helper returned an invalid result.')); }
        });
        child.stdin.end(payload);
      });
      return {result:output.result,receipt:{id:newId('helper'),operation,inputHash:hash(JSON.stringify({ operation, input: withoutPassword(input) })),outputHash:hash(output.result),implementationHash,startedAt,finishedAt:now(),engine:this.options.spawnProcess ? 'injected-process' : 'python',pythonVersion:output.runtime.python,resourceLimits:output.runtime.resourceLimits,status:'completed',sourceTainted:operation === 'pdf.extract' || operation === 'pdf.ocr'}};
    } finally { check(dirname(resolve(directory)) === resolve(tmpdir()) && directory.split(/[\\/]/).at(-1)!.startsWith('chausar-helper-'),'HELPER_PATH_INVALID','The helper directory left its temporary root.'); await rm(directory,{recursive:true,force:true}); }
  }
}
export { AnalyticalHelper as PythonHelper };
