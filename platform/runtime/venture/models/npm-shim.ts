// Chausar venture launcher, package P2 (models), Ink v2 wave 4 (4H1): an npm-installed command-line tool on Windows,
// run without a shell. npm puts a command script (a .cmd and a .ps1 "shim") on the search path; a program started
// without a shell cannot run one, and Chausar never starts a shell for a tool. This reads the shim as text, accepts only
// npm's own standard form (its cmd-shim templates) naming the one entry script the caller expects (Codex's
// node_modules/@openai/codex/bin/codex.js), checks that the script is a file under the shim's own node_modules with no
// link leading out of it, and returns what the shim itself would run: node (npm's node.exe beside the shim, else node on
// the search path; on Windows only an absolute .exe) and that script. The caller runs `node <script> <args>` with an
// argument array. Anything else is refused (null), and the tool stays a command script Chausar does not start.
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';
import { startableProgram } from './cli-look.ts';

/** What a standard npm shim runs: an absolute node program and the package's entry script under node_modules. */
export type NpmShimRun = { program: string; script: string };

/** The shim files npm writes on Windows. */
export const NPM_SHIM_FILE = /\.(?:cmd|ps1)$/i;
/** The only script a Codex shim may name: the entry script of npm's @openai/codex package. */
export const CODEX_NPM_ENTRY: readonly string[] = Object.freeze(['node_modules', '@openai', 'codex', 'bin', 'codex.js']);
/** npm's shims are a few hundred bytes; anything far larger is not one. */
const MAX_SHIM_BYTES = 4096;
const SCRIPT = '{script}';

/** npm's cmd-shim .cmd template, line by line, with {script} where the package's entry script goes. */
const CMD_TEMPLATE = [
  '@ECHO off', 'GOTO start', ':find_dp0', 'SET dp0=%~dp0', 'EXIT /b', ':start', `SETLOCAL`, 'CALL :find_dp0', '',
  'IF EXIST "%dp0%\\node.exe" (', '  SET "_prog=%dp0%\\node.exe"', ') ELSE (', '  SET "_prog=node"', '  SET PATHEXT=%PATHEXT:;.JS;=;%', ')', '',
  `endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\${SCRIPT}" %*`,
].join('\n');

/** npm's cmd-shim .ps1 template; the script appears four times and must be the same each time. */
const PS1_TEMPLATE = [
  '#!/usr/bin/env pwsh', '$basedir=Split-Path $MyInvocation.MyCommand.Definition -Parent', '', '$exe=""',
  'if ($PSVersionTable.PSVersion -lt "6.0" -or $IsWindows) {', '  # Fix case when both the Windows and Linux builds of Node',
  '  # are installed in the same directory', '  $exe=".exe"', '}', '$ret=0', 'if (Test-Path "$basedir/node$exe") {', '  # Support pipeline input',
  '  if ($MyInvocation.ExpectingInput) {', `    $input | & "$basedir/node$exe"  "$basedir/${SCRIPT}" $args`, '  } else {',
  `    & "$basedir/node$exe"  "$basedir/${SCRIPT}" $args`, '  }', '  $ret=$LASTEXITCODE', '} else {', '  # Support pipeline input',
  '  if ($MyInvocation.ExpectingInput) {', `    $input | & "node$exe"  "$basedir/${SCRIPT}" $args`, '  } else {', `    & "node$exe"  "$basedir/${SCRIPT}" $args`,
  '  }', '  $ret=$LASTEXITCODE', '}', 'exit $ret',
].join('\n');

/** Where each template names the script, to read it back before the whole text is compared. */
const FORMS = [
  { file: /\.cmd$/i, template: CMD_TEMPLATE, named: /"%dp0%\\([^"\r\n]*)" %\*\s*$/, separator: '\\' },
  { file: /\.ps1$/i, template: PS1_TEMPLATE, named: /"\$basedir\/([^"\r\n]*)" \$args$/m, separator: '/' },
] as const;

const isFile = (path: string): boolean => { try { return statSync(path).isFile(); } catch { return false; } };

/**
 * What a standard npm shim runs, or null. Refuses: a file that is not .cmd or .ps1, larger than npm writes, or whose
 * text differs from npm's template in anything but the script path; a script path other than `entry` (segment by
 * segment, exactly); a script that is not a file under the shim's own node_modules once every link is followed (a
 * package folder or a node_modules that is a link or junction out is refused); and no node to run it with. On Windows
 * node must be an absolute .exe: a node.cmd or a bare name would need a shell. Reads only the shim and checks files
 * exist; runs nothing.
 */
export function resolveNpmShim(
  shimPath: string, locate: (command: string) => string | null, entry: readonly string[], platform: NodeJS.Platform = process.platform,
): NpmShimRun | null {
  const form = FORMS.find(item => item.file.test(shimPath));
  if (!form || !isAbsolute(shimPath)) return null;
  let text: string;
  try {
    if (statSync(shimPath).size > MAX_SHIM_BYTES) return null;
    text = readFileSync(shimPath, 'utf8');
  } catch {
    return null;
  }
  const normalised = text.replace(/\r\n/g, '\n').replace(/\n+$/, '');
  const raw = form.named.exec(normalised)?.[1];
  if (raw === undefined) return null;
  const segments = raw.split(form.separator);
  // Only the one script the caller names, and the whole shim exactly npm's template around it.
  if (segments.length !== entry.length || segments.some((segment, index) => segment !== entry[index])) return null;
  if (normalised !== form.template.split(SCRIPT).join(raw)) return null;

  const folder = join(shimPath, '..');
  const script = join(folder, ...segments);
  try {
    if (!isFile(script)) return null;
    // Measured from the shim's real folder, so neither node_modules nor any folder in the package may be a link out.
    const modules = join(realpathSync(folder), 'node_modules');
    const inside = relative(modules, realpathSync(script));
    if (!inside || inside.startsWith('..') || isAbsolute(inside)) return null;
  } catch {
    return null;
  }
  // The shim's own choice: npm's node beside it, else node on the search path. Only a program started without a shell.
  const beside = (platform === 'win32' ? [join(folder, 'node.exe')] : [join(folder, 'node.exe'), join(folder, 'node')]).find(isFile);
  let program: string | null = beside ?? null;
  if (!program) { try { program = locate('node'); } catch { program = null; } }
  return program && startableProgram(program, platform) ? { program, script } : null;
}
