import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';
import { check } from '../contracts.ts';
import { defaultServiceRunner, escapeXml, type ServiceCommand, type ServiceRunner } from './background-service.ts';
import { confirmedPayload, osPlatform, plainPayload, quoteWindowsArgument, readOsFile, removeOsFile, validOsPath, writeOsFileAtomically, type OsPlatform } from './os-integration.ts';

/** Start Chausar hidden in the tray when the person signs in (SH-07, off by default).
 * Per-user only: HKCU Run value (reg.exe, no PowerShell), a LaunchAgent distinct from the
 * background agent, or an XDG autostart entry. The app gets `--start-at-login` and nothing else. */
export type LoginMechanism = 'windows-run-key' | 'macos-launch-agent' | 'linux-xdg-autostart';
export type StartAtLoginOptions = {
  /** Trusted host composition only: the installed app executable (or its launcher). */
  executable: string;
  platform?: NodeJS.Platform; homeDirectory?: string; configDirectory?: string; systemRoot?: string;
  runner?: ServiceRunner; timeoutMs?: number;
};
export type StartAtLoginStatus = {
  platform: OsPlatform; mechanism: LoginMechanism; enabled: boolean; path: string;
  /** Whether the entry starts this executable; null when there is no entry. */
  matches: boolean | null;
};

export const LOGIN_ARGUMENT = '--start-at-login';
export const LOGIN_RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run';
export const LOGIN_RUN_VALUE = 'Chausar';
export const LOGIN_AGENT_LABEL = 'in.chausar.login';
export const LOGIN_DESKTOP_FILE = 'in.chausar.desktop';
const mechanisms: Record<OsPlatform, LoginMechanism> = { win32: 'windows-run-key', darwin: 'macos-launch-agent', linux: 'linux-xdg-autostart' };

/** One Exec argument per the Desktop Entry spec: always double-quoted, with `"`, `` ` ``, `$`
 * and `\` backslash-escaped; then the string-level escape doubles every backslash, and `%` becomes `%%`. */
export function quoteDesktopExec(value: string): string {
  const quoted = `"${value.replace(/[\\"`$]/g, character => `\\${character}`)}"`;
  return quoted.replace(/\\/g, '\\\\').replace(/%/g, '%%');
}

export function xdgAutostartEntry(executable: string): string {
  return `[Desktop Entry]
Type=Application
Version=1.0
Name=Chausar
Comment=Starts Chausar in the tray when you sign in
Exec=${quoteDesktopExec(executable)} ${LOGIN_ARGUMENT}
Terminal=false
X-GNOME-Autostart-enabled=true
`;
}
export function loginAgentPlist(executable: string): string {
  const strings = [executable, LOGIN_ARGUMENT].map(value => `    <string>${escapeXml(value)}</string>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LOGIN_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${strings}
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>LimitLoadToSessionType</key>
  <string>Aqua</string>
</dict>
</plist>
`;
}
export function windowsRunValue(executable: string): string { return `${quoteWindowsArgument(executable)} ${LOGIN_ARGUMENT}`; }

export class StartAtLogin {
  readonly platform: OsPlatform;
  #executable: string; #config: string; #home: string; #systemRoot: string; #runner: ServiceRunner; #timeoutMs: number;
  constructor(options: StartAtLoginOptions) {
    this.platform = osPlatform(options.platform ?? process.platform, 'START_AT_LOGIN_UNSUPPORTED', 'Starting at sign-in is available on Windows, macOS and Linux only.');
    const platform = this.platform;
    check(validOsPath(platform, options.executable), 'START_AT_LOGIN_PATH_INVALID', 'The app executable must be an absolute path without control characters.');
    this.#executable = options.executable;
    this.#home = options.homeDirectory ?? homedir();
    // An explicit home folder (tests, trusted hosts) wins over the process's XDG_CONFIG_HOME.
    const xdg = process.env.XDG_CONFIG_HOME;
    this.#config = options.configDirectory ?? (options.homeDirectory === undefined && xdg && posix.isAbsolute(xdg) ? posix.normalize(xdg) : posix.join(this.#home, '.config'));
    if (platform !== 'win32') {
      check(validOsPath(platform, this.#home), 'START_AT_LOGIN_PATH_INVALID', 'The home folder must be an absolute path.');
      check(validOsPath(platform, this.#config), 'START_AT_LOGIN_PATH_INVALID', 'The settings folder must be an absolute path.');
    }
    this.#systemRoot = options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
    if (platform === 'win32') check(validOsPath('win32', this.#systemRoot), 'START_AT_LOGIN_PATH_INVALID', 'The Windows system folder must be an absolute path.');
    this.#runner = options.runner ?? defaultServiceRunner;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    check(Number.isSafeInteger(this.#timeoutMs) && this.#timeoutMs > 0 && this.#timeoutMs <= 300_000, 'START_AT_LOGIN_OPTIONS_INVALID', 'The command timeout is out of range.');
  }

  get path(): string {
    if (this.platform === 'win32') return `${LOGIN_RUN_KEY}\\${LOGIN_RUN_VALUE}`;
    if (this.platform === 'darwin') return posix.join(this.#home, 'Library', 'LaunchAgents', `${LOGIN_AGENT_LABEL}.plist`);
    return posix.join(this.#config, 'autostart', LOGIN_DESKTOP_FILE);
  }
  /** The entry this app writes: a registry value or a file's content. */
  get entry(): string {
    if (this.platform === 'win32') return windowsRunValue(this.#executable);
    if (this.platform === 'darwin') return loginAgentPlist(this.#executable);
    return xdgAutostartEntry(this.#executable);
  }
  #reg(...args: string[]): ServiceCommand { return { command: win32.join(this.#systemRoot, 'System32', 'reg.exe'), args }; }
  /** Windows commands, for tests and the approval sheet. */
  get commands(): { add: ServiceCommand; remove: ServiceCommand; query: ServiceCommand } {
    return {
      add: this.#reg('add', LOGIN_RUN_KEY, '/v', LOGIN_RUN_VALUE, '/t', 'REG_SZ', '/d', windowsRunValue(this.#executable), '/f'),
      remove: this.#reg('delete', LOGIN_RUN_KEY, '/v', LOGIN_RUN_VALUE, '/f'),
      query: this.#reg('query', LOGIN_RUN_KEY, '/v', LOGIN_RUN_VALUE),
    };
  }
  async #exec(command: ServiceCommand, allowFailure = false) {
    const result = await this.#runner(command.command, command.args, { timeoutMs: this.#timeoutMs });
    check(allowFailure || result.code === 0, 'START_AT_LOGIN_COMMAND_FAILED', 'The operating system refused the start-at-sign-in change.');
    return result;
  }

  async status(): Promise<StartAtLoginStatus> {
    const base = { platform: this.platform, mechanism: mechanisms[this.platform], path: this.path };
    if (this.platform === 'win32') {
      const query = await this.#exec(this.commands.query, true);
      // "    Chausar    REG_SZ    "C:\...\Chausar.exe" --start-at-login"
      const value = query.code === 0 ? new RegExp(`^\\s*${LOGIN_RUN_VALUE}\\s+REG_(?:EXPAND_)?SZ\\s+(.*?)\\s*$`, 'm').exec(query.stdout)?.[1] : undefined;
      return value === undefined ? { ...base, enabled: false, matches: null } : { ...base, enabled: true, matches: value === this.entry };
    }
    const content = await readOsFile(this.path, 'START_AT_LOGIN_PATH_UNSAFE');
    if (content === null) return { ...base, enabled: false, matches: null };
    // A desktop entry someone turned off in their session settings is present but disabled.
    const enabled = this.platform !== 'linux' || !/^(?:Hidden=true|X-GNOME-Autostart-enabled=false)\s*$/m.test(content);
    return { ...base, enabled, matches: content === this.entry };
  }

  async set(input: { enabled?: unknown; confirmed?: boolean } = {}): Promise<StartAtLoginStatus> {
    check(typeof input?.enabled === 'boolean', 'INVALID_REQUEST', 'Say whether Chausar starts when you sign in.');
    check(input.confirmed === true, 'CONFIRMATION_REQUIRED', 'Changing whether Chausar starts at sign-in needs a person to confirm it first.');
    if (this.platform === 'win32') {
      if (input.enabled) await this.#exec(this.commands.add);
      else if ((await this.status()).enabled) await this.#exec(this.commands.remove);
    } else if (input.enabled) {
      // macOS: the agent is not loaded now (RunAtLoad would start a second copy); launchd loads it at the next sign-in.
      await writeOsFileAtomically(this.path, posix.dirname(this.path), Buffer.from(this.entry, 'utf8'), 'START_AT_LOGIN_PATH_UNSAFE');
    } else {
      // Never `launchctl bootout` here: it would stop the running app the agent started.
      await removeOsFile(this.path, 'START_AT_LOGIN_PATH_UNSAFE');
    }
    return this.status();
  }
}

/** Handler-ready engine methods (registered by the release module). */
export async function shellStartAtLogin(login: StartAtLogin): Promise<StartAtLoginStatus> { return login.status(); }
export async function shellSetStartAtLogin(login: StartAtLogin, payload: unknown): Promise<StartAtLoginStatus> {
  const p = plainPayload(payload);
  check(typeof p.enabled === 'boolean', 'INVALID_REQUEST', 'Say whether Chausar starts when you sign in.');
  confirmedPayload(p, 'Changing whether Chausar starts at sign-in');
  return login.set({ enabled: p.enabled, confirmed: true });
}
