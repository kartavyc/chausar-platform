import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, rename, rm, unlink } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { ChausarError, check, newId } from '../contracts.ts';

/** Background mode keeps the engine running jobs while the window is closed.
 * Every mechanism is per-user: no elevation, no system-wide unit, no admin prompt. */
export type ServicePlatform = 'win32' | 'darwin' | 'linux';
export type ServiceMechanism = 'windows-task-scheduler' | 'macos-launchd-agent' | 'linux-systemd-user';
export type ServiceCommand = { command: string; args: string[] };
export type ServiceCommandResult = { code: number | null; stdout: string; stderr: string };
export type ServiceRunner = (command: string, args: string[], options: { timeoutMs: number }) => Promise<ServiceCommandResult>;
export type BackgroundServiceOptions = {
  /** Trusted host composition only: the installed app executable and its data directory. */
  executable: string; dataDirectory: string;
  platform?: NodeJS.Platform; homeDirectory?: string; uid?: number;
  /** Windows `DOMAIN\user` for the logon trigger; defaults to the current account. */
  windowsUser?: string; systemRoot?: string; temporaryDirectory?: string;
  runner?: ServiceRunner; timeoutMs?: number;
};
export type BackgroundServicePlan = {
  platform: ServicePlatform; mechanism: ServiceMechanism; unitPath: string; elevation: 'none';
  files: { path: string; content: string }[];
  install: ServiceCommand[]; uninstall: ServiceCommand[]; status: ServiceCommand[];
  command: { executable: string; args: string[] };
};
export type BackgroundServiceStatus = {
  platform: ServicePlatform; mechanism: ServiceMechanism; installed: boolean; running: boolean | null; unitPath: string;
};

export const SERVICE_LABEL = 'in.chausar.background';
export const SERVICE_TASK_NAME = 'Chausar\\Background';
export const SERVICE_UNIT_NAME = 'chausar-background.service';
const MAX_OUTPUT = 64 * 1024;
const mechanisms: Record<ServicePlatform, ServiceMechanism> = {
  win32: 'windows-task-scheduler', darwin: 'macos-launchd-agent', linux: 'linux-systemd-user',
};

/** Spawn without a shell, hidden on Windows, with bounded output and a hard deadline. */
export const defaultServiceRunner: ServiceRunner = (command, args, { timeoutMs }) => new Promise((accept, reject) => {
  const child = spawn(command, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { stdout: '', stderr: '' };
  let done = false;
  const collect = (name: 'stdout' | 'stderr') => (chunk: Buffer) => {
    if (output[name].length < MAX_OUTPUT) output[name] = (output[name] + chunk.toString('utf8')).slice(0, MAX_OUTPUT);
  };
  child.stdout.on('data', collect('stdout'));
  child.stderr.on('data', collect('stderr'));
  const deadline = setTimeout(() => {
    if (done) return; done = true;
    try { child.kill('SIGKILL'); } catch {}
    reject(new ChausarError('SERVICE_COMMAND_TIMEOUT', 'The background service command did not finish in time.'));
  }, timeoutMs);
  child.once('error', () => {
    if (done) return; done = true; clearTimeout(deadline);
    reject(new ChausarError('SERVICE_COMMAND_FAILED', 'The background service command could not start.'));
  });
  child.once('close', code => { if (done) return; done = true; clearTimeout(deadline); accept({ code, ...output }); });
});

function validPath(platform: ServicePlatform, value: unknown): value is string {
  if (typeof value !== 'string' || !value.length || value.length > 1024 || /[\x00-\x1f\x7f]/.test(value)) return false;
  if (platform === 'win32') return /^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+)/.test(value) && win32.isAbsolute(value)
    && win32.normalize(value) === value && !/["%<>|?*]/.test(value.slice(2));
  return posix.isAbsolute(value) && posix.normalize(value) === value;
}

/** XML 1.0 text and attribute escaping (task XML and launchd plist). */
export function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}
/** One systemd command-line/list word: double-quoted, with backslash, quote,
 * specifier (%) and environment ($) characters escaped per systemd.syntax/systemd.service. */
export function quoteSystemd(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/%/g, '%%').replace(/\$/g, '$$$$')}"`;
}
/** One CommandLineToArgvW argument. Validated Windows paths never contain quotes. */
function quoteWindows(value: string): string {
  return `"${value.replace(/(\\+)$/, '$1$1')}"`;
}

export function windowsTaskXml(input: { executable: string; args: string[]; user: string }): string {
  const argumentsText = input.args.map(value => value.startsWith('--') ? value : quoteWindows(value)).join(' ');
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Chausar keeps running approved jobs while its window is closed.</Description>
    <URI>\\${escapeXml(SERVICE_TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
      <UserId>${escapeXml(input.user)}</UserId>
    </LogonTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>${escapeXml(input.user)}</UserId>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>3</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(quoteWindows(input.executable))}</Command>
      <Arguments>${escapeXml(argumentsText)}</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

export function launchdPlist(input: { executable: string; args: string[] }): string {
  const strings = [input.executable, ...input.args].map(value => `    <string>${escapeXml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <dict>
    <key>Crashed</key>
    <true/>
  </dict>
  <key>ProcessType</key>
  <string>Background</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
  <key>ThrottleInterval</key>
  <integer>30</integer>
</dict>
</plist>
`;
}

export function systemdUserUnit(input: { executable: string; args: string[]; dataDirectory: string }): string {
  return `[Unit]
Description=Chausar background engine (keeps approved jobs running while the window is closed)

[Service]
Type=simple
ExecStart=${[input.executable, ...input.args].map(quoteSystemd).join(' ')}
Restart=on-failure
RestartSec=30
NoNewPrivileges=yes
PrivateTmp=yes
ProtectSystem=strict
ReadWritePaths=${quoteSystemd(input.dataDirectory)}

[Install]
WantedBy=default.target
`;
}

async function writeFileAtomically(path: string, content: Buffer, directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o755 });
  const directoryInfo = await lstat(directory);
  check(directoryInfo.isDirectory() && !directoryInfo.isSymbolicLink(), 'SERVICE_PATH_UNSAFE', 'The service folder must be a real folder.');
  try {
    const existing = await lstat(path);
    check(existing.isFile() && !existing.isSymbolicLink(), 'SERVICE_PATH_UNSAFE', 'The service file must be a regular file.');
  } catch (error: any) { if (error?.code !== 'ENOENT') throw error; }
  const temporary = join(directory, `.${newId('service')}.tmp`);
  const file = await open(temporary, 'wx', 0o644);
  try { await file.writeFile(content); await file.sync(); await file.close(); await rename(temporary, path); }
  catch (error) { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); throw error; }
}
async function regularFileExists(path: string): Promise<boolean> {
  try { const info = await lstat(path); return info.isFile() && !info.isSymbolicLink(); }
  catch (error: any) { if (error?.code === 'ENOENT') return false; throw error; }
}

export class BackgroundService {
  readonly platform: ServicePlatform;
  #executable: string; #dataDirectory: string; #home: string; #uid: number | undefined; #user: string;
  #systemRoot: string; #temporary: string; #runner: ServiceRunner; #timeoutMs: number;
  constructor(options: BackgroundServiceOptions) {
    const platform = options.platform ?? process.platform;
    check(platform === 'win32' || platform === 'darwin' || platform === 'linux', 'SERVICE_UNSUPPORTED', 'Background mode is available on Windows, macOS and Linux only.');
    this.platform = platform;
    check(validPath(platform, options.executable), 'SERVICE_PATH_INVALID', 'The app executable must be an absolute path without control characters.');
    check(validPath(platform, options.dataDirectory), 'SERVICE_PATH_INVALID', 'The app data folder must be an absolute path without control characters.');
    this.#executable = options.executable; this.#dataDirectory = options.dataDirectory;
    this.#home = options.homeDirectory ?? homedir();
    if (platform !== 'win32') check(validPath(platform, this.#home), 'SERVICE_PATH_INVALID', 'The home folder must be an absolute path.');
    this.#uid = options.uid ?? process.getuid?.();
    if (platform === 'darwin') check(Number.isSafeInteger(this.#uid) && this.#uid! >= 0, 'SERVICE_USER_INVALID', 'The current user id is required for a launch agent.');
    this.#user = options.windowsUser ?? (platform === 'win32'
      ? `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ''}${userInfo().username}` : '');
    if (platform === 'win32') check(/^[^\x00-\x1f\x7f"<>]{1,256}$/.test(this.#user), 'SERVICE_USER_INVALID', 'The Windows account name is invalid.');
    this.#systemRoot = options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
    if (platform === 'win32') check(validPath('win32', this.#systemRoot), 'SERVICE_PATH_INVALID', 'The Windows system folder must be an absolute path.');
    this.#temporary = options.temporaryDirectory ?? tmpdir();
    this.#runner = options.runner ?? defaultServiceRunner;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    check(Number.isSafeInteger(this.#timeoutMs) && this.#timeoutMs > 0 && this.#timeoutMs <= 300_000, 'SERVICE_OPTIONS_INVALID', 'The command timeout is out of range.');
  }

  get #args(): string[] { return ['--background', '--data-dir', this.#dataDirectory]; }
  get #tool(): string {
    if (this.platform === 'win32') return win32.join(this.#systemRoot, 'System32', 'schtasks.exe');
    if (this.platform === 'darwin') return '/bin/launchctl';
    return existsSync('/usr/bin/systemctl') || !existsSync('/bin/systemctl') ? '/usr/bin/systemctl' : '/bin/systemctl';
  }
  get #unitPath(): string {
    if (this.platform === 'win32') return `Task Scheduler\\${SERVICE_TASK_NAME}`;
    if (this.platform === 'darwin') return posix.join(this.#home, 'Library', 'LaunchAgents', `${SERVICE_LABEL}.plist`);
    return posix.join(this.#home, '.config', 'systemd', 'user', SERVICE_UNIT_NAME);
  }
  #content(): string {
    const input = { executable: this.#executable, args: this.#args, dataDirectory: this.#dataDirectory };
    if (this.platform === 'win32') return windowsTaskXml({ ...input, user: this.#user });
    if (this.platform === 'darwin') return launchdPlist(input);
    return systemdUserUnit(input);
  }

  /** What would be written and run, for the approval sheet. Performs no I/O. */
  plan(taskFile = '<temporary task file>'): BackgroundServicePlan {
    const tool = this.#tool, unitPath = this.#unitPath, content = this.#content();
    const run = (...args: string[]): ServiceCommand => ({ command: tool, args });
    const domain = `gui/${this.#uid}`, target = `${domain}/${SERVICE_LABEL}`;
    const commands = this.platform === 'win32' ? {
      install: [run('/Create', '/TN', SERVICE_TASK_NAME, '/XML', taskFile, '/F')],
      uninstall: [run('/Delete', '/TN', SERVICE_TASK_NAME, '/F')],
      status: [run('/Query', '/TN', SERVICE_TASK_NAME, '/XML'), run('/Query', '/TN', SERVICE_TASK_NAME, '/FO', 'CSV', '/NH')],
    } : this.platform === 'darwin' ? {
      install: [run('bootstrap', domain, unitPath)],
      uninstall: [run('bootout', target)],
      status: [run('print', target)],
    } : {
      install: [run('--user', 'daemon-reload'), run('--user', 'enable', '--now', SERVICE_UNIT_NAME)],
      uninstall: [run('--user', 'disable', '--now', SERVICE_UNIT_NAME), run('--user', 'daemon-reload')],
      status: [run('--user', 'is-active', SERVICE_UNIT_NAME)],
    };
    return {
      platform: this.platform, mechanism: mechanisms[this.platform], unitPath, elevation: 'none',
      files: [{ path: this.platform === 'win32' ? taskFile : unitPath, content }],
      ...commands, command: { executable: this.#executable, args: this.#args },
    };
  }

  async #run(command: ServiceCommand, allowFailure = false): Promise<ServiceCommandResult> {
    const result = await this.#runner(command.command, command.args, { timeoutMs: this.#timeoutMs });
    check(allowFailure || result.code === 0, 'SERVICE_COMMAND_FAILED', 'The operating system refused the background service command.');
    return result;
  }

  async install(input: { confirmed?: boolean } = {}): Promise<BackgroundServiceStatus> {
    check(input?.confirmed === true, 'CONFIRMATION_REQUIRED', 'Installing background mode needs a person to confirm it first.');
    if (this.platform === 'win32') {
      const directory = await mkdtemp(join(this.#temporary, 'chausar-task-'));
      const taskFile = join(directory, 'background-task.xml');
      try {
        const plan = this.plan(taskFile);
        // Task Scheduler reliably accepts UTF-16 LE with a byte-order mark.
        await writeFileAtomically(taskFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(plan.files[0].content, 'utf16le')]), directory);
        for (const command of plan.install) await this.#run(command);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else {
      const plan = this.plan();
      await writeFileAtomically(plan.unitPath, Buffer.from(plan.files[0].content, 'utf8'), posix.dirname(plan.unitPath));
      // Replace a previously loaded agent so launchd reads the new definition.
      if (this.platform === 'darwin') await this.#run(plan.uninstall[0], true);
      for (const command of plan.install) await this.#run(command);
    }
    return this.status();
  }

  async uninstall(input: { confirmed?: boolean } = {}): Promise<BackgroundServiceStatus> {
    check(input?.confirmed === true, 'CONFIRMATION_REQUIRED', 'Removing background mode needs a person to confirm it first.');
    const plan = this.plan();
    if (this.platform === 'win32') {
      if ((await this.status()).installed) await this.#run(plan.uninstall[0]);
    } else if (this.platform === 'darwin') {
      await this.#run(plan.uninstall[0], true);
      await rm(plan.unitPath, { force: true });
    } else {
      if (await regularFileExists(plan.unitPath)) await this.#run(plan.uninstall[0], true);
      await rm(plan.unitPath, { force: true });
      await this.#run(plan.uninstall[1]);
    }
    return this.status();
  }

  async status(): Promise<BackgroundServiceStatus> {
    const plan = this.plan(), base = { platform: this.platform, mechanism: plan.mechanism, unitPath: plan.unitPath };
    if (this.platform === 'win32') {
      const query = await this.#run(plan.status[0], true);
      const installed = query.code === 0 && query.stdout.includes('<Task');
      if (!installed) return { ...base, installed: false, running: false };
      const row = await this.#run(plan.status[1], true);
      // Status text is localized; only the English words are interpreted.
      const state = /"(Running|Ready|Disabled|Queued)"/.exec(row.stdout)?.[1];
      return { ...base, installed: true, running: state === undefined ? null : state === 'Running' };
    }
    const installed = await regularFileExists(plan.unitPath);
    if (this.platform === 'darwin') {
      const printed = await this.#run(plan.status[0], true);
      if (printed.code !== 0) return { ...base, installed, running: installed ? false : null };
      return { ...base, installed, running: /\bstate = running\b/.test(printed.stdout) };
    }
    const active = await this.#run(plan.status[0], true);
    return { ...base, installed, running: active.stdout.trim() === 'active' };
  }
}
