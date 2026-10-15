import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { homedir, tmpdir, userInfo } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { check } from '../contracts.ts';
import { defaultServiceRunner, escapeXml, quoteSystemd, type ServiceCommand, type ServiceCommandResult, type ServiceRunner } from './background-service.ts';
import { confirmedPayload, osPlatform, plainPayload, quoteWindowsArgument, readOsFile, removeOsFile, validOsPath, writeOsFileAtomically, type OsPlatform } from './os-integration.ts';

/** Wake this computer for jobs (SH-07, experimental). One pending wake at a time, per user:
 * Windows Task Scheduler (WakeToRun, no elevation), macOS `pmset schedule wake` (needs root,
 * so an ordinary user is refused, never prompted), Linux systemd user timer with WakeSystem
 * (needs CAP_WAKE_ALARM for the user manager, refused when it is missing). */
export type WakeMechanism = 'windows-task-scheduler' | 'macos-pmset' | 'linux-systemd-user-timer';
export type WakeTimerOptions = {
  /** Trusted host composition only: the installed app executable the wake launches with --background. */
  executable: string;
  platform?: NodeJS.Platform; homeDirectory?: string; uid?: number; windowsUser?: string; systemRoot?: string;
  temporaryDirectory?: string; runner?: ServiceRunner; timeoutMs?: number; now?: () => Date;
  /** Linux: the RTC wake alarm whose presence means the hardware can wake. */
  rtcWakeAlarmPath?: string;
};
export type WakeTimerStatus = {
  platform: OsPlatform; mechanism: WakeMechanism; available: boolean; reason?: 'WAKE_TIMER_NEEDS_ADMIN' | 'WAKE_TIMER_UNAVAILABLE';
  nextWakeAt: string | null; experimental: true;
};
export type WakeTimerPlan = {
  platform: OsPlatform; mechanism: WakeMechanism; at: string; elevation: 'none' | 'admin'; unitPath: string;
  files: { path: string; content: string }[]; install: ServiceCommand[]; uninstall: ServiceCommand[];
  /** The exact command lines, for the approval sheet (and for a person to run as admin on macOS). */
  display: string[];
  command: { executable: string; args: string[] } | null;
};

export const WAKE_TASK_NAME = 'Chausar\\Wake';
export const WAKE_TIMER_UNIT = 'chausar-wake.timer';
export const WAKE_SERVICE_UNIT = 'chausar-wake.service';
export const WAKE_PMSET_OWNER = 'Chausar';
export const WAKE_MAX_AHEAD_MS = 7 * 24 * 60 * 60 * 1000;
const MINUTE = 60_000;
const CAP_WAKE_ALARM = 'cap_wake_alarm';
const mechanisms: Record<OsPlatform, WakeMechanism> = { win32: 'windows-task-scheduler', darwin: 'macos-pmset', linux: 'linux-systemd-user-timer' };

/** Validate an ISO time with an explicit offset, round it down to the minute, and require it
 * to be at least a minute ahead and no more than seven days ahead. Returns UTC. */
export function wakeTime(value: unknown, now: Date): Date {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value),
    'WAKE_TIME_INVALID', 'Give the wake time as an ISO time with its offset, such as 2026-10-16T07:00+05:30.');
  const parsed = new Date(value);
  check(Number.isFinite(parsed.getTime()), 'WAKE_TIME_INVALID', 'The wake time is not a real date.');
  const rounded = new Date(Math.floor(parsed.getTime() / MINUTE) * MINUTE);
  check(rounded.getTime() - now.getTime() >= MINUTE, 'WAKE_TIME_PAST', 'The wake time must be at least a minute from now.');
  check(rounded.getTime() - now.getTime() <= WAKE_MAX_AHEAD_MS, 'WAKE_TIME_TOO_FAR', 'The wake time can be at most seven days ahead.');
  return rounded;
}
const isoUtc = (date: Date) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');
const pad = (value: number) => String(value).padStart(2, '0');
/** `pmset` takes local wall-clock time only ("MM/dd/yyyy HH:mm:ss"); it has no offset syntax. */
export function pmsetTime(date: Date): string {
  return `${pad(date.getMonth() + 1)}/${pad(date.getDate())}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
/** systemd calendar time, always in UTC. */
export function systemdUtc(date: Date): string { return isoUtc(date).replace('T', ' ').replace('Z', ' UTC'); }

export function windowsWakeTaskXml(input: { executable: string; user: string; at: Date }): string {
  const end = new Date(input.at.getTime() + 60 * MINUTE);
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Chausar wakes this computer once so approved jobs can run.</Description>
    <URI>\\${escapeXml(WAKE_TASK_NAME)}</URI>
  </RegistrationInfo>
  <Triggers>
    <TimeTrigger>
      <StartBoundary>${isoUtc(input.at)}</StartBoundary>
      <EndBoundary>${isoUtc(end)}</EndBoundary>
      <Enabled>true</Enabled>
    </TimeTrigger>
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
    <StartWhenAvailable>false</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>true</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${escapeXml(quoteWindowsArgument(input.executable))}</Command>
      <Arguments>--background</Arguments>
    </Exec>
  </Actions>
</Task>
`;
}

export function systemdWakeTimer(at: Date): string {
  return `[Unit]
Description=Chausar wake timer (wakes this computer once for approved jobs)

[Timer]
OnCalendar=${systemdUtc(at)}
WakeSystem=true
Persistent=false
AccuracySec=1s
RemainAfterElapse=false
Unit=${WAKE_SERVICE_UNIT}

[Install]
WantedBy=timers.target
`;
}
export function systemdWakeService(executable: string): string {
  return `[Unit]
Description=Chausar started by its wake timer

[Service]
Type=simple
ExecStart=${[executable, '--background'].map(quoteSystemd).join(' ')}
NoNewPrivileges=yes
`;
}

/** One command line for display: arguments with spaces or quotes are double-quoted. */
function displayCommand(command: ServiceCommand): string {
  return [command.command, ...command.args].map(value => /^[\w@%+=:,./\\-]+$/.test(value) ? value : `"${value.replace(/(["\\$`])/g, '\\$1')}"`).join(' ');
}

export class WakeTimer {
  readonly platform: OsPlatform;
  #executable: string; #home: string; #uid: number | undefined; #user: string; #systemRoot: string; #temporary: string;
  #runner: ServiceRunner; #timeoutMs: number; #now: () => Date; #rtc: string;
  constructor(options: WakeTimerOptions) {
    this.platform = osPlatform(options.platform ?? process.platform, 'WAKE_TIMER_UNSUPPORTED', 'Waking this computer is available on Windows, macOS and Linux only.');
    const platform = this.platform;
    check(validOsPath(platform, options.executable), 'WAKE_TIMER_PATH_INVALID', 'The app executable must be an absolute path without control characters.');
    this.#executable = options.executable;
    this.#home = options.homeDirectory ?? homedir();
    if (platform === 'linux') check(validOsPath(platform, this.#home), 'WAKE_TIMER_PATH_INVALID', 'The home folder must be an absolute path.');
    this.#uid = options.uid ?? process.getuid?.();
    if (platform !== 'win32') check(Number.isSafeInteger(this.#uid) && this.#uid! >= 0, 'WAKE_TIMER_USER_INVALID', 'The current user id is required.');
    this.#user = options.windowsUser ?? (platform === 'win32' ? `${process.env.USERDOMAIN ? `${process.env.USERDOMAIN}\\` : ''}${userInfo().username}` : '');
    if (platform === 'win32') check(/^[^\x00-\x1f\x7f"<>]{1,256}$/.test(this.#user), 'WAKE_TIMER_USER_INVALID', 'The Windows account name is invalid.');
    this.#systemRoot = options.systemRoot ?? process.env.SystemRoot ?? 'C:\\Windows';
    if (platform === 'win32') check(validOsPath('win32', this.#systemRoot), 'WAKE_TIMER_PATH_INVALID', 'The Windows system folder must be an absolute path.');
    this.#temporary = options.temporaryDirectory ?? tmpdir();
    this.#runner = options.runner ?? defaultServiceRunner;
    this.#timeoutMs = options.timeoutMs ?? 30_000;
    check(Number.isSafeInteger(this.#timeoutMs) && this.#timeoutMs > 0 && this.#timeoutMs <= 300_000, 'WAKE_TIMER_OPTIONS_INVALID', 'The command timeout is out of range.');
    this.#now = options.now ?? (() => new Date());
    this.#rtc = options.rtcWakeAlarmPath ?? '/sys/class/rtc/rtc0/wakealarm';
  }

  get #tool(): string {
    if (this.platform === 'win32') return win32.join(this.#systemRoot, 'System32', 'schtasks.exe');
    if (this.platform === 'darwin') return '/usr/bin/pmset';
    return existsSync('/usr/bin/systemctl') || !existsSync('/bin/systemctl') ? '/usr/bin/systemctl' : '/bin/systemctl';
  }
  get #unitDirectory(): string { return posix.join(this.#home, '.config', 'systemd', 'user'); }
  get #unitPath(): string {
    if (this.platform === 'win32') return `Task Scheduler\\${WAKE_TASK_NAME}`;
    if (this.platform === 'darwin') return 'pmset schedule';
    return posix.join(this.#unitDirectory, WAKE_TIMER_UNIT);
  }
  #run(...args: string[]): ServiceCommand { return { command: this.#tool, args }; }

  /** What would be written and run for a wake at `at`, for the approval sheet. Performs no I/O. */
  plan(at: unknown, taskFile = '<temporary task file>', current: string | null = null): WakeTimerPlan {
    const time = wakeTime(at, this.#now());
    const base = { platform: this.platform, mechanism: mechanisms[this.platform], at: isoUtc(time), unitPath: this.#unitPath };
    let plan: Omit<WakeTimerPlan, 'display'>;
    if (this.platform === 'win32') {
      plan = { ...base, elevation: 'none', files: [{ path: taskFile, content: windowsWakeTaskXml({ executable: this.#executable, user: this.#user, at: time }) }],
        install: [this.#run('/Create', '/TN', WAKE_TASK_NAME, '/XML', taskFile, '/F')], uninstall: [this.#run('/Delete', '/TN', WAKE_TASK_NAME, '/F')],
        command: { executable: this.#executable, args: ['--background'] } };
    } else if (this.platform === 'darwin') {
      // pmset wakes the computer only; scheduled jobs then run if Chausar is running or its background agent is installed.
      plan = { ...base, elevation: 'admin', files: [],
        install: [...(current ? [this.#run('schedule', 'cancel', 'wake', current, WAKE_PMSET_OWNER)] : []), this.#run('schedule', 'wake', pmsetTime(time), WAKE_PMSET_OWNER)],
        uninstall: current ? [this.#run('schedule', 'cancel', 'wake', current, WAKE_PMSET_OWNER)] : [], command: null };
    } else {
      const directory = this.#unitDirectory;
      plan = { ...base, elevation: 'none',
        files: [{ path: posix.join(directory, WAKE_SERVICE_UNIT), content: systemdWakeService(this.#executable) }, { path: posix.join(directory, WAKE_TIMER_UNIT), content: systemdWakeTimer(time) }],
        install: [this.#run('--user', 'daemon-reload'), this.#run('--user', 'enable', WAKE_TIMER_UNIT), this.#run('--user', 'restart', WAKE_TIMER_UNIT)],
        uninstall: [this.#run('--user', 'disable', '--now', WAKE_TIMER_UNIT), this.#run('--user', 'daemon-reload')],
        command: { executable: this.#executable, args: ['--background'] } };
    }
    return { ...plan, display: plan.install.map(displayCommand) };
  }

  async #exec(command: ServiceCommand, allowFailure = false): Promise<ServiceCommandResult> {
    const result = await this.#runner(command.command, command.args, { timeoutMs: this.#timeoutMs });
    check(allowFailure || result.code === 0, 'WAKE_TIMER_COMMAND_FAILED', 'The operating system refused the wake timer command.');
    return result;
  }

  /** Whether this user can set a wake here, and the pending wake (UTC), if any. */
  async status(): Promise<WakeTimerStatus> {
    const base = { platform: this.platform, mechanism: mechanisms[this.platform], experimental: true as const };
    const future = (value: string | null) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isFinite(date.getTime()) && date.getTime() > this.#now().getTime() ? isoUtc(date) : null;
    };
    if (this.platform === 'win32') {
      const query = await this.#exec(this.#run('/Query', '/TN', WAKE_TASK_NAME, '/XML'), true);
      const boundary = query.code === 0 ? /<StartBoundary>([^<]{1,64})<\/StartBoundary>/.exec(query.stdout)?.[1] ?? null : null;
      return { ...base, available: true, nextWakeAt: future(boundary) };
    }
    if (this.platform === 'darwin') {
      const scheduled = await this.#pmsetScheduled();
      const nextWakeAt = future(scheduled ? this.#fromPmset(scheduled)?.toISOString() ?? null : null);
      return this.#uid === 0 ? { ...base, available: true, nextWakeAt } : { ...base, available: false, reason: 'WAKE_TIMER_NEEDS_ADMIN', nextWakeAt };
    }
    const timer = await readOsFile(posix.join(this.#unitDirectory, WAKE_TIMER_UNIT), 'WAKE_TIMER_PATH_UNSAFE');
    const calendar = timer ? /^OnCalendar=(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) UTC$/m.exec(timer) : null;
    const nextWakeAt = future(calendar ? `${calendar[1]}T${calendar[2]}Z` : null);
    const availability = await this.#linuxAvailability();
    return availability ? { ...base, available: false, reason: availability, nextWakeAt } : { ...base, available: true, nextWakeAt };
  }

  /** The hardware must have an RTC wake alarm, and the user manager must hold CAP_WAKE_ALARM
   * (root's does; an ordinary user's only through an admin's AmbientCapabilities drop-in). */
  async #linuxAvailability(): Promise<WakeTimerStatus['reason'] | null> {
    if (!existsSync(this.#rtc)) return 'WAKE_TIMER_UNAVAILABLE';
    if (this.#uid === 0) return null;
    const shown = await this.#exec(this.#run('show', `user@${this.#uid}.service`, '-p', 'AmbientCapabilities', '--value'), true);
    if (shown.code !== 0) return 'WAKE_TIMER_UNAVAILABLE';
    return shown.stdout.toLowerCase().split(/\s+/).includes(CAP_WAKE_ALARM) ? null : 'WAKE_TIMER_NEEDS_ADMIN';
  }

  /** `pmset -g sched` lists e.g. " [0]  wake at 10/16/2026 07:00:00 by 'Chausar'". */
  async #pmsetScheduled(): Promise<string | null> {
    const listed = await this.#exec(this.#run('-g', 'sched'), true);
    if (listed.code !== 0) return null;
    const match = new RegExp(`\\bwake at (\\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2}) by '${WAKE_PMSET_OWNER}'`).exec(listed.stdout);
    return match?.[1] ?? null;
  }
  #fromPmset(value: string): Date | null {
    const m = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}):(\d{2})$/.exec(value);
    if (!m) return null;
    const date = new Date(Number(m[3]), Number(m[1]) - 1, Number(m[2]), Number(m[4]), Number(m[5]), Number(m[6]));
    return Number.isFinite(date.getTime()) ? date : null;
  }

  async #refuseUnavailable(): Promise<void> {
    const status = await this.status();
    check(status.reason !== 'WAKE_TIMER_NEEDS_ADMIN', 'WAKE_TIMER_NEEDS_ADMIN', 'Waking this computer needs an administrator to allow it; Chausar will not ask for a password.');
    check(status.available, 'WAKE_TIMER_UNAVAILABLE', 'This computer cannot be woken by a timer.');
  }

  /** Replace the pending wake with one at `at` (rounded down to the minute). */
  async set(input: { at?: unknown; confirmed?: boolean } = {}): Promise<WakeTimerStatus> {
    check(input?.confirmed === true, 'CONFIRMATION_REQUIRED', 'Waking this computer for jobs needs a person to confirm it first.');
    wakeTime(input.at, this.#now());
    await this.#refuseUnavailable();
    if (this.platform === 'win32') {
      const directory = await mkdtemp(join(this.#temporary, 'chausar-wake-'));
      const taskFile = join(directory, 'wake-task.xml');
      try {
        const plan = this.plan(input.at, taskFile);
        // Task Scheduler reliably accepts UTF-16 LE with a byte-order mark.
        await writeOsFileAtomically(taskFile, directory, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(plan.files[0].content, 'utf16le')]), 'WAKE_TIMER_PATH_UNSAFE');
        for (const command of plan.install) await this.#exec(command);
      } finally { await rm(directory, { recursive: true, force: true }); }
    } else if (this.platform === 'darwin') {
      const plan = this.plan(input.at, undefined, await this.#pmsetScheduled());
      for (const [index, command] of plan.install.entries()) await this.#exec(command, index < plan.install.length - 1);
    } else {
      const plan = this.plan(input.at);
      for (const file of plan.files) await writeOsFileAtomically(file.path, this.#unitDirectory, Buffer.from(file.content, 'utf8'), 'WAKE_TIMER_PATH_UNSAFE');
      for (const command of plan.install) await this.#exec(command);
    }
    return this.status();
  }

  /** Remove the pending wake, if any. */
  async clear(input: { confirmed?: boolean } = {}): Promise<WakeTimerStatus> {
    check(input?.confirmed === true, 'CONFIRMATION_REQUIRED', 'Removing the wake timer needs a person to confirm it first.');
    if (this.platform === 'win32') {
      const query = await this.#exec(this.#run('/Query', '/TN', WAKE_TASK_NAME, '/XML'), true);
      if (query.code === 0 && query.stdout.includes('<Task')) await this.#exec(this.#run('/Delete', '/TN', WAKE_TASK_NAME, '/F'));
    } else if (this.platform === 'darwin') {
      const current = await this.#pmsetScheduled();
      if (current) {
        check(this.#uid === 0, 'WAKE_TIMER_NEEDS_ADMIN', 'Removing this wake needs an administrator; Chausar will not ask for a password.');
        await this.#exec(this.#run('schedule', 'cancel', 'wake', current, WAKE_PMSET_OWNER));
      }
    } else {
      const timer = posix.join(this.#unitDirectory, WAKE_TIMER_UNIT), service = posix.join(this.#unitDirectory, WAKE_SERVICE_UNIT);
      const present = (await readOsFile(timer, 'WAKE_TIMER_PATH_UNSAFE')) !== null;
      if (present) await this.#exec(this.#run('--user', 'disable', '--now', WAKE_TIMER_UNIT), true);
      await removeOsFile(timer, 'WAKE_TIMER_PATH_UNSAFE'); await removeOsFile(service, 'WAKE_TIMER_PATH_UNSAFE');
      if (present) await this.#exec(this.#run('--user', 'daemon-reload'));
    }
    return this.status();
  }
}

/** Handler-ready engine methods (registered by the release module). */
export async function nativeWakeStatus(timer: WakeTimer): Promise<WakeTimerStatus> { return timer.status(); }
export function nativeWakePlan(timer: WakeTimer, payload: unknown): WakeTimerPlan { return timer.plan(plainPayload(payload).at); }
export async function nativeWakeSet(timer: WakeTimer, payload: unknown): Promise<WakeTimerStatus> {
  const p = plainPayload(payload); confirmedPayload(p, 'Waking this computer for jobs');
  return timer.set({ at: p.at, confirmed: true });
}
export async function nativeWakeClear(timer: WakeTimer, payload: unknown): Promise<WakeTimerStatus> {
  const p = plainPayload(payload); confirmedPayload(p, 'Removing the wake timer');
  return timer.clear({ confirmed: true });
}
