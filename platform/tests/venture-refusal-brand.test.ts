// A1 final check: every coded plain error a venture module throws is branded where it is thrown (refusal-brand.ts), so
// refusals.ts converts Chausar's own refusals and never a library's error of the same shape. New ones cannot slip in.
// A2: the scan reads each file whole, so a code set on any name, through defineProperty, several lines down a class,
// or an Object.assign split over lines is caught too.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { CodexError } from '../runtime/venture/agent-runtime/codex-rpc.ts';
import { asRefusal } from '../runtime/venture/refusals.ts';

const ROOT = new URL('../runtime/venture/', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => { const path = join(dir, name); return statSync(path).isDirectory() ? files(path) : name.endsWith('.ts') ? [path] : []; });
}

/** The body of a class from its opening brace to the matching closing one (strings and comments are not special). */
function classBody(text: string, from: number): string {
  const open = text.indexOf('{', from);
  if (open < 0) return text.slice(from);
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === '{') depth++;
    else if (text[index] === '}' && --depth === 0) return text.slice(from, index + 1);
  }
  return text.slice(from);
}

const lineOf = (text: string, index: number) => text.slice(0, index).split('\n').length;

/** Every unbranded coded error in one source file, as "line what". */
export function scan(text: string): string[] {
  const found: string[] = [];
  for (const match of text.matchAll(/Object\.assign\(\s*new (?:Type|Range)?Error\(/g)) found.push(`${lineOf(text, match.index!)} Object.assign(new Error(...)) without refusalError`);
  for (const match of text.matchAll(/class\s+\w+\s+extends\s+Error\b/g)) {
    const body = classBody(text, match.index!);
    const coded = /\bthis\.code\s*=|\breadonly\s+code\b|\bcode\s*[:=]/.test(body) || /Object\.defineProperty\(\s*this\s*,\s*['"]code['"]/.test(body);
    if (coded && !body.includes('markRefusal(')) found.push(`${lineOf(text, match.index!)} a coded error class without markRefusal`);
  }
  for (const match of text.matchAll(/\b[A-Za-z_$][\w$]*\.code\s*=\s*(?!=)['"`A-Z]/g)) {
    if (/^this\./.test(match[0])) continue;
    found.push(`${lineOf(text, match.index!)} a code set on a plain error`);
  }
  for (const match of text.matchAll(/Object\.defineProperty\(\s*(?!this\b)[A-Za-z_$][\w$]*\s*,\s*['"]code['"]/g)) found.push(`${lineOf(text, match.index!)} a code defined on a plain error`);
  return found;
}

test('the scan itself finds each shape, across lines and on any name', () => {
  const samples: Record<string, string> = {
    anyName: "const failed = new Error('no');\nfailed.code = 'NO_SITE';\nthrow failed;",
    define: "const e = new Error('no');\nObject.defineProperty(e, 'code', { value: 'NO_SITE' });",
    classLater: "class SiteError extends Error {\n  constructor(message: string) {\n    super(message);\n    this.name = 'SiteError';\n    this.code = 'NO_SITE';\n  }\n}",
    assignSplit: "throw Object.assign(\n  new Error('no'),\n  { code: 'NO_SITE' },\n);",
  };
  for (const [name, text] of Object.entries(samples)) assert.equal(scan(text).length, 1, `${name}: ${scan(text).join('; ')}`);
  // A branded class, a code compared rather than set, and an object literal's code pass.
  assert.deepEqual(scan("class SiteError extends Error {\n  constructor(m: string) {\n    super(m);\n    this.code = 'NO_SITE';\n    markRefusal(this);\n  }\n}"), []);
  assert.deepEqual(scan("if (error.code === 'NO_SITE') return;\nconst row = { code: 'NO_SITE' };"), []);
});

test('no unbranded coded plain error in the venture modules, playbooks and kit included', () => {
  const found: string[] = [];
  for (const path of files(ROOT)) {
    const name = relative(ROOT, path).split(sep).join('/');
    for (const row of scan(readFileSync(path, 'utf8'))) found.push(`${name}:${row}`);
  }
  assert.deepEqual(found, []);
});

test('A2: a CodexError that tells the owner what to do is branded; protocol, timeout and exit codes are not', () => {
  for (const code of ['CODEX_NOT_INSTALLED', 'CODEX_POLICY_UNSUPPORTED', 'AGENT_ABORTED', 'AGENT_TURN_BUSY', 'AGENT_PROMPT_INVALID', 'AGENT_SHELL_UNAVAILABLE']) {
    const refusal = asRefusal(new CodexError(code, 'Install Codex on this computer first.'));
    assert.ok(refusal, code);
    assert.equal(refusal!.code, code);
  }
  for (const code of ['CODEX_PROTOCOL_INVALID', 'CODEX_RPC_TIMEOUT', 'CODEX_PROCESS_EXITED', 'CODEX_RPC_REFUSED', 'CODEX_SESSION_CLOSED', 'CODEX_STOP_TIMEOUT', 'CODEX_TOOL_REFUSED']) {
    assert.equal(asRefusal(new CodexError(code, 'Codex stopped.')), null, code);
  }
});
