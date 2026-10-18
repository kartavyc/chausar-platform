// Chausar delivery harness: the row language agents write for the light sandbox.
// A program runs once per row of a table and makes new text columns: categories, match keys, flags.
// It has no numbers, no loops and no input or output, so it can't do arithmetic on money and always finishes.
// Totals stay with the calculator. The compiler in sandbox-wasm.ts turns a checked program into WebAssembly.
import { ChausarError } from '../../../contracts.ts';

export type RowType = 'text' | 'bool';
export type RowExpr =
  | { kind: 'text'; value: string }
  | { kind: 'bool'; value: boolean }
  | { kind: 'name'; name: string }
  | { kind: 'column'; column: string }
  | { kind: 'call'; fn: RowFunction; args: RowExpr[] }
  | { kind: 'if'; test: RowExpr; then: RowExpr; else: RowExpr }
  | { kind: 'and' | 'or'; left: RowExpr; right: RowExpr }
  | { kind: 'not'; value: RowExpr };
export type RowStatement = { kind: 'let' | 'out'; name: string; expr: RowExpr; type: RowType };
export type RowProgram = { statements: RowStatement[]; outputs: { name: string; type: RowType }[]; columns: string[] };

export const ROW_FUNCTIONS = {
  lower: { args: ['text'], returns: 'text' },
  upper: { args: ['text'], returns: 'text' },
  trim: { args: ['text'], returns: 'text' },
  before: { args: ['text', 'text'], returns: 'text' },
  after: { args: ['text', 'text'], returns: 'text' },
  replace: { args: ['text', 'text', 'text'], returns: 'text' },
  concat: { args: 'texts', returns: 'text' },
  contains: { args: ['text', 'text'], returns: 'bool' },
  starts: { args: ['text', 'text'], returns: 'bool' },
  ends: { args: ['text', 'text'], returns: 'bool' },
  equals: { args: ['text', 'text'], returns: 'bool' },
  empty: { args: ['text'], returns: 'bool' },
} as const satisfies Record<string, { args: readonly RowType[] | 'texts'; returns: RowType }>;
export type RowFunction = keyof typeof ROW_FUNCTIONS;

export const ROW_LIMITS = Object.freeze({ programChars: 4000, statements: 40, outputs: 12, depth: 32, literalBytes: 200, concatArgs: 8 });
const KEYWORDS = new Set(['let', 'out', 'if', 'then', 'else', 'and', 'or', 'not', 'true', 'false', 'col']);
const NAME = /^[a-z][a-z0-9_]{0,30}$/;

/** The short guide every agent gets. Plain words, so a cheap model can write a working program. */
export const ROW_LANGUAGE_GUIDE = [
  'A row program runs once for each row of one table and makes new text columns. One statement per line:',
  'let name = expression   (a value you reuse)   and   out name = expression   (a new column).',
  'col("Header") is the cell text of that column in the row. Text goes in double quotes.',
  'Text functions: lower(t), upper(t), trim(t), before(t, sep), after(t, sep), replace(t, from, to), concat(a, b, ...).',
  'Yes or no tests: contains(t, part), starts(t, part), ends(t, part), equals(a, b), empty(t), joined with and, or, not.',
  'Choices: if test then a else b, and chain them with else if.',
  'There are no numbers and no sums: totals always come from the calculator. Names are lower case letters, digits and _.',
].join('\n');

type Token = { kind: 'word' | 'string' | 'punct'; value: string; at: number };

function refuse(message: string): never {
  throw new ChausarError('PROGRAM_INVALID', message);
}

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (c === '#') { while (i < source.length && source[i] !== '\n') i += 1; continue; }
    if (/\s/.test(c)) { i += 1; continue; }
    if (c === '"') {
      let value = '';
      let j = i + 1;
      for (; j < source.length && source[j] !== '"'; j += 1) {
        if (source[j] === '\n') refuse('A text in quotes runs past the end of its line.');
        if (source[j] === '\\') {
          const next = source[j + 1];
          if (next === '"' || next === '\\') { value += next; j += 1; continue; }
          refuse('Only \\" and \\\\ may follow a backslash in quoted text.');
        }
        value += source[j];
      }
      if (j >= source.length) refuse('A text in quotes is missing its closing quote.');
      if (Buffer.byteLength(value, 'utf8') > ROW_LIMITS.literalBytes) refuse(`Quoted text is limited to ${ROW_LIMITS.literalBytes} bytes.`);
      tokens.push({ kind: 'string', value, at: i });
      i = j + 1;
      continue;
    }
    if ('(),='.includes(c)) { tokens.push({ kind: 'punct', value: c, at: i }); i += 1; continue; }
    const word = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(i));
    if (word) { tokens.push({ kind: 'word', value: word[0], at: i }); i += word[0].length; continue; }
    if (/\d/.test(c)) refuse('Row programs have no numbers. Put digits inside quotes when you match text, and leave totals to the calculator.');
    refuse(`The character ${JSON.stringify(c)} is not part of the row language.`);
  }
  return tokens;
}

class Parser {
  tokens: Token[];
  index = 0;
  constructor(tokens: Token[]) { this.tokens = tokens; }
  peek(): Token | undefined { return this.tokens[this.index]; }
  next(): Token { const token = this.tokens[this.index]; if (!token) refuse('The program ends in the middle of a statement.'); this.index += 1; return token; }
  isWord(value: string): boolean { const token = this.peek(); return !!token && token.kind === 'word' && token.value === value; }
  isPunct(value: string): boolean { const token = this.peek(); return !!token && token.kind === 'punct' && token.value === value; }
  expectWord(value: string) { const token = this.next(); if (token.kind !== 'word' || token.value !== value) refuse(`Expected ${value} but found ${JSON.stringify(token.value)}.`); }
  expectPunct(value: string) { const token = this.next(); if (token.kind !== 'punct' || token.value !== value) refuse(`Expected ${value} but found ${JSON.stringify(token.value)}.`); }

  statement(): { kind: 'let' | 'out'; name: string; expr: RowExpr } {
    const head = this.next();
    if (head.kind !== 'word' || (head.value !== 'let' && head.value !== 'out')) refuse(`Each statement starts with let or out, not ${JSON.stringify(head.value)}.`);
    const name = this.next();
    if (name.kind !== 'word' || !NAME.test(name.value) || KEYWORDS.has(name.value)) refuse(`${JSON.stringify(name.value)} can't be a name. Use lower case letters, digits and _.`);
    this.expectPunct('=');
    return { kind: head.value as 'let' | 'out', name: name.value, expr: this.expr(0) };
  }

  expr(depth: number): RowExpr {
    if (depth > ROW_LIMITS.depth) refuse('The program nests too deeply.');
    if (this.isWord('if')) {
      this.next();
      const test = this.expr(depth + 1);
      this.expectWord('then');
      const then = this.expr(depth + 1);
      this.expectWord('else');
      return { kind: 'if', test, then, else: this.expr(depth + 1) };
    }
    return this.or(depth);
  }

  or(depth: number): RowExpr {
    let left = this.and(depth);
    while (this.isWord('or')) { this.next(); left = { kind: 'or', left, right: this.and(depth + 1) }; }
    return left;
  }

  and(depth: number): RowExpr {
    let left = this.not(depth);
    while (this.isWord('and')) { this.next(); left = { kind: 'and', left, right: this.not(depth + 1) }; }
    return left;
  }

  not(depth: number): RowExpr {
    if (depth > ROW_LIMITS.depth) refuse('The program nests too deeply.');
    if (this.isWord('not')) { this.next(); return { kind: 'not', value: this.not(depth + 1) }; }
    return this.primary(depth);
  }

  primary(depth: number): RowExpr {
    const token = this.next();
    if (token.kind === 'string') return { kind: 'text', value: token.value };
    if (token.kind === 'punct') {
      if (token.value !== '(') refuse(`Unexpected ${JSON.stringify(token.value)}.`);
      const inner = this.expr(depth + 1);
      this.expectPunct(')');
      return inner;
    }
    if (token.value === 'true' || token.value === 'false') return { kind: 'bool', value: token.value === 'true' };
    if (token.value === 'col') {
      this.expectPunct('(');
      const name = this.next();
      if (name.kind !== 'string') refuse('col needs a column header in quotes, like col("Description").');
      this.expectPunct(')');
      return { kind: 'column', column: name.value };
    }
    if (KEYWORDS.has(token.value)) refuse(`${JSON.stringify(token.value)} can't start a value here.`);
    if (this.isPunct('(')) {
      if (!Object.hasOwn(ROW_FUNCTIONS, token.value)) refuse(`There is no function called ${token.value}.`);
      this.next();
      const args: RowExpr[] = [];
      if (!this.isPunct(')')) {
        args.push(this.expr(depth + 1));
        while (this.isPunct(',')) { this.next(); args.push(this.expr(depth + 1)); }
      }
      this.expectPunct(')');
      return { kind: 'call', fn: token.value as RowFunction, args };
    }
    if (!NAME.test(token.value)) refuse(`${JSON.stringify(token.value)} is not a name this program made.`);
    return { kind: 'name', name: token.value };
  }
}

function typeOf(expr: RowExpr, names: Map<string, RowType>, columns: readonly string[]): RowType {
  switch (expr.kind) {
    case 'text': return 'text';
    case 'bool': return 'bool';
    case 'name': {
      const type = names.get(expr.name);
      if (!type) refuse(`${expr.name} is used before a let gives it a value.`);
      return type;
    }
    case 'column':
      if (!columns.includes(expr.column)) refuse(`The table has no column ${JSON.stringify(expr.column)}. Its columns are: ${columns.join(', ')}.`);
      return 'text';
    case 'call': {
      const spec = ROW_FUNCTIONS[expr.fn];
      if (spec.args === 'texts') {
        if (expr.args.length < 2 || expr.args.length > ROW_LIMITS.concatArgs) refuse(`concat joins from two to ${ROW_LIMITS.concatArgs} texts.`);
        for (const arg of expr.args) if (typeOf(arg, names, columns) !== 'text') refuse('concat joins texts only.');
      } else {
        if (expr.args.length !== spec.args.length) refuse(`${expr.fn} takes ${spec.args.length === 1 ? 'one value' : `${spec.args.length === 2 ? 'two' : 'three'} values`}.`);
        expr.args.forEach((arg, index) => { if (typeOf(arg, names, columns) !== spec.args[index]) refuse(`${expr.fn} needs text, not a yes or no value.`); });
      }
      return spec.returns;
    }
    case 'if': {
      if (typeOf(expr.test, names, columns) !== 'bool') refuse('if needs a yes or no test, like contains(t, "x").');
      const a = typeOf(expr.then, names, columns), b = typeOf(expr.else, names, columns);
      if (a !== b) refuse('Both sides of an if must give the same kind of value.');
      return a;
    }
    case 'and': case 'or':
      if (typeOf(expr.left, names, columns) !== 'bool' || typeOf(expr.right, names, columns) !== 'bool') refuse(`${expr.kind} joins yes or no tests.`);
      return 'bool';
    case 'not':
      if (typeOf(expr.value, names, columns) !== 'bool') refuse('not needs a yes or no test.');
      return 'bool';
  }
}

/** Parses and checks a row program against a table's columns. Throws PROGRAM_INVALID with a plain reason. */
export function parseRowProgram(source: unknown, columns: readonly string[]): RowProgram {
  if (typeof source !== 'string' || !source.trim()) refuse('Send the row program as text.');
  if (source.length > ROW_LIMITS.programChars) refuse(`A row program is limited to ${ROW_LIMITS.programChars} characters.`);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(source)) refuse('The program holds control characters.');
  const parser = new Parser(tokenize(source.replace(/\r\n?/g, '\n')));
  const parsed: { kind: 'let' | 'out'; name: string; expr: RowExpr }[] = [];
  while (parser.peek()) {
    parsed.push(parser.statement());
    if (parsed.length > ROW_LIMITS.statements) refuse(`A row program is limited to ${ROW_LIMITS.statements} statements.`);
  }
  const names = new Map<string, RowType>();
  const outputs: { name: string; type: RowType }[] = [];
  const statements: RowStatement[] = [];
  for (const statement of parsed) {
    if (names.has(statement.name) || outputs.some(out => out.name === statement.name)) refuse(`${statement.name} is given a value twice.`);
    const type = typeOf(statement.expr, names, columns);
    if (statement.kind === 'let') names.set(statement.name, type);
    else outputs.push({ name: statement.name, type });
    statements.push({ ...statement, type });
  }
  if (!outputs.length) refuse('The program makes no column. Add at least one out statement.');
  if (outputs.length > ROW_LIMITS.outputs) refuse(`A row program makes at most ${ROW_LIMITS.outputs} columns.`);
  return { statements, outputs, columns: [...columns] };
}

/** Runs a checked program in plain TypeScript. Tests compare it with the WebAssembly result; the sandbox never uses it. */
export function interpretRow(program: RowProgram, cells: Record<string, string>): Record<string, string> {
  const values = new Map<string, string | boolean>();
  const ascii = (text: string, upper: boolean) => text.replace(upper ? /[a-z]/g : /[A-Z]/g, c => upper ? c.toUpperCase() : c.toLowerCase());
  const space = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
  const trim = (t: string) => { let a = 0, b = t.length; while (a < b && space(t[a])) a += 1; while (b > a && space(t[b - 1])) b -= 1; return t.slice(a, b); };
  const evaluate = (expr: RowExpr): string | boolean => {
    switch (expr.kind) {
      case 'text': return expr.value;
      case 'bool': return expr.value;
      case 'name': return values.get(expr.name)!;
      case 'column': return cells[expr.column] ?? '';
      case 'if': return evaluate(expr.test) ? evaluate(expr.then) : evaluate(expr.else);
      case 'and': return evaluate(expr.left) === true && evaluate(expr.right) === true;
      case 'or': return evaluate(expr.left) === true || evaluate(expr.right) === true;
      case 'not': return evaluate(expr.value) !== true;
      case 'call': {
        const a = expr.args.map(evaluate) as string[];
        switch (expr.fn) {
          case 'lower': return ascii(a[0], false);
          case 'upper': return ascii(a[0], true);
          case 'trim': return trim(a[0]);
          case 'before': { const i = a[0].indexOf(a[1]); return i < 0 ? a[0] : a[0].slice(0, i); }
          case 'after': { const i = a[0].indexOf(a[1]); return i < 0 ? '' : a[0].slice(i + a[1].length); }
          case 'replace': return a[1] === '' ? a[0] : a[0].split(a[1]).join(a[2]);
          case 'concat': return a.join('');
          case 'contains': return a[0].includes(a[1]);
          case 'starts': return a[0].startsWith(a[1]);
          case 'ends': return a[0].endsWith(a[1]);
          case 'equals': return a[0] === a[1];
          case 'empty': return a[0].length === 0;
        }
      }
    }
  };
  const out: Record<string, string> = {};
  for (const statement of program.statements) {
    const value = evaluate(statement.expr);
    if (statement.kind === 'let') values.set(statement.name, value);
    else out[statement.name] = typeof value === 'boolean' ? (value ? 'true' : 'false') : value;
  }
  return out;
}
