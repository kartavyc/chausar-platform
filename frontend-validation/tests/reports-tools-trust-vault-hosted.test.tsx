// TR-07 Machines and sync, TR-12 "This computer" and hosted backup, TR-14 the plan and always-on job agreement,
// and Trust · Keys, driven through the Trust place modules with a fake `rpc`. Replies follow the engine code of
// hosted-link, jobs-ext and connectors-ext; release's shell.startAtLogin, jobs-ext's working jobsx.setWake and
// core-sync-jobs' devices.* / sync.setup follow the contracts this lane assumes. All data is synthetic.
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TextProvider } from '../../app/ui/src/app/text';
import type { Address, Language, View } from '../../app/ui/src/app/presentation';
import type { PlaceRenderProps } from '../../app/ui/src/places/types';
import { trustPlaces } from '../../app/ui/src/screens/trust/index';
import { subPlaces } from '../../app/ui/src/places/subplaces/reports-tools-trust';
import { words as laneWords } from '../../app/ui/src/text/lanes/reports-tools-trust';
import { validateCredentialStatus, validateHostedRestore, validateExportedKey, validateWorkerStatus } from '../../app/ui/src/screens/trust/validate-hosted';
import { SHARING } from '../../app/ui/src/screens/trust/words';

afterEach(cleanup);

const AT = '2026-10-14T09:00:00Z';
const EN = laneWords.en, HI = laneWords.hi;
const BK1 = `bk_${'a'.repeat(32)}`, BK2 = `bk_${'b'.repeat(32)}`;
const KEY = `${'Q'.repeat(43)}=`;

const VAULT = {
  backups: [{ file: 'backup-1.chausar', at: AT, bytes: 1048576, testRestore: 'passed', testedAt: AT }],
  lock: { idleMinutes: 10, deviceCheck: true }, disk: null, limit: 'A program running as you on this computer can read what you can read.',
  recoveryContact: { name: null, experimental: true }, version: '0.1.0-preview.1',
};
const BACKGROUND = {
  backgroundMode: false, asked: false, lifecycle: null, jobs: [],
  rules: ['Scheduled jobs on the free app run only while this computer is awake.'],
  wake: { available: false, code: 'WAKE_TIMER_UNAVAILABLE', experimental: true }, alwaysOn: { available: false, note: 'n' },
};
const PAIRED = {
  configured: true, paired: true, demo: false,
  pairing: { accountId: 'acct_1', deviceId: 'dev_1', pairedAt: AT, phoneMasked: '+91******3210', sessionExpiresAt: AT },
  account: { plan: 'paid', entitlements: { plan: 'paid', relay: true, backup: true, backupQuotaBytes: 1048576, backupKeep: 5, allowance: false, allowanceMonthlyPaise: '0', worker: true, monthlyMessages: 30 }, deviceCount: 1, refreshedAt: AT },
  labels: { backup: 'b', worker: 'w', relay: 'r' },
};
const BACKUPS = {
  backups: [{ backupId: BK1, sizeBytes: 2048, sha256: 'c'.repeat(64), createdAt: AT, madeHere: true }, { backupId: BK2, sizeBytes: 4096, sha256: 'd'.repeat(64), createdAt: AT, madeHere: false }],
  quotaBytes: 1048576, usedBytes: 6144, keep: 5, keyHeldHere: true, label: 'Encrypted on this computer before upload.',
};
const WORKER = {
  endToEndEncrypted: false, label: 'Not end-to-end encrypted. <b>server label</b>', desktopLabel: 'd',
  jobs: [{ type: 'due-date-reminder', title: 'A due date is near', enabled: false, consentAt: null, uses: 'Due dates only, no amounts or names' },
    { type: 'brief', title: 'Morning brief', enabled: true, consentAt: AT, uses: 'Headlines' }],
};
const DRIVE_OFF = { connected: false, folderId: null, headFileId: null, connectedAt: null, created: null, workspaceId: null, connectionId: null, attachment: 'not-connected', signIn: 'available', sync: { enabled: false, transport: null, deviceId: 'd1' }, demo: false, experimental: true, scope: 'https://www.googleapis.com/auth/drive.file' };
const DRIVE_ON = { ...DRIVE_OFF, connected: true, folderId: 'folder_synthetic_123', headFileId: 'head_synthetic_123', connectedAt: AT, created: true, workspaceId: 'w1', connectionId: 'c1', attachment: 'attached' };
const CONNECTIONS = [
  { id: 'conn_zoho', group: 'zoho-books', road: 'interface', label: 'Zoho Books (synthetic)', company: 'Synthetic', branch: 'main', sourceId: 'src_zoho', settings: {}, status: 'active', createdAt: AT, createdBy: 'owner-1' },
  { id: 'conn_db', group: 'postgres', road: 'database', label: 'Shop database', company: 'Synthetic', branch: 'main', sourceId: 'src_db', settings: {}, status: 'paused', createdAt: AT, createdBy: 'owner-1' },
];

type Reply = unknown | ((payload: Record<string, unknown>) => unknown);
function refusal(code: string) { return Object.assign(new Error(code), { code }); }
function fakeRpc(replies: Record<string, Reply> = {}) {
  const calls: { method: string; payload: Record<string, unknown> }[] = [];
  const request = vi.fn(async (method: string, payload: Record<string, unknown>) => {
    calls.push({ method, payload: structuredClone(payload) });
    if (!(method in replies)) throw refusal('UNKNOWN_METHOD');
    const r = replies[method];
    const value = typeof r === 'function' ? (r as (p: Record<string, unknown>) => unknown)(payload) : r;
    if (value instanceof Error) throw value;
    return structuredClone(value);
  });
  return { request, calls, of: (method: string) => calls.filter((c) => c.method === method) };
}
type Fake = ReturnType<typeof fakeRpc>;

function draw(address: Address, o: { rpc?: Fake; language?: Language; view?: View; role?: string; viewer?: boolean } = {}) {
  const rpc = o.rpc ?? fakeRpc();
  const mod = trustPlaces.find((m) => m.handles(address));
  if (!mod) throw new Error('no module');
  const navigate = vi.fn();
  const props: PlaceRenderProps = {
    address, language: o.language ?? 'en', view: o.view ?? 'guided', member: { id: 'owner-1', role: o.role ?? 'owner' },
    viewer: o.viewer ?? false, rpc, live: () => true, openReceipt: vi.fn(), navigate,
  };
  const view = render(<TextProvider language={props.language}>{mod.render(props)}</TextProvider>);
  return { ...view, rpc, navigate, user: userEvent.setup() };
}
const at = (sub: string, sheet?: string): Address => (sheet === undefined ? { place: 'trust', sub } : { place: 'trust', sub, sheet });
const group = async (title: string) => (await screen.findByRole('heading', { name: title })).closest('section') as HTMLElement;

describe('sub-places', () => {
  test('keys, devices and hosted are rail sub-places drawn by Trust, named in both languages', () => {
    expect(subPlaces.map((x) => `${x.place}/${x.id}`)).toEqual(expect.arrayContaining(['trust/keys', 'trust/devices', 'trust/hosted']));
    for (const id of ['keys', 'devices', 'hosted']) {
      expect(trustPlaces.some((m) => m.handles({ place: 'trust', sub: id }))).toBe(true);
      expect(EN[`SH-01.sub.trust.${id}`]).toBeTruthy(); expect(HI[`SH-01.sub.trust.${id}`]).toBeTruthy();
    }
    expect(Object.keys(HI).sort()).toEqual(Object.keys(EN).sort());
  });
});

describe('TR-12 This computer', () => {
  test('start at login and background mode are not built yet without their methods; the wake timer says it is not installed', async () => {
    draw(at('vault'), { rpc: fakeRpc({ 'trustx.vault': VAULT }) });
    expect(await within(await group(EN['RTT.vault.loginTitle']!)).findByText(EN['RTT.vault.loginNotBuilt']!)).toBeTruthy();
    expect(await within(await group(EN['RTT.vault.backgroundTitle']!)).findByText(EN['RTT.vault.backgroundNotBuilt']!)).toBeTruthy();
    const wake = await group(EN['RTT.vault.wakeTitle']!);
    expect(await within(wake).findByText(EN['RTT.vault.wakeUnavailable']!)).toBeTruthy();
    expect(within(wake).queryByRole('button')).toBeNull();
    // Restore from the lock screen names the newest backup file.
    expect(screen.getByText('Backup file: backup-1.chausar')).toBeTruthy();
  });

  test('start at login reads shell.startAtLogin and sets through shell.setStartAtLogin after asking once more', async () => {
    let on = false;
    const login = () => ({ platform: 'linux', mechanism: 'linux-xdg-autostart', enabled: on, path: '/home/synthetic/.config/autostart/in.chausar.desktop', matches: on ? true : null });
    const rpc = fakeRpc({ 'trustx.vault': VAULT, 'shell.startAtLogin': login,
      'shell.setStartAtLogin': (p: Record<string, unknown>) => { on = p['enabled'] === true; return login(); } });
    const { user } = draw(at('vault'), { rpc });
    const g = await group(EN['RTT.vault.loginTitle']!);
    expect(await within(g).findByText(EN['RTT.vault.loginOff']!)).toBeTruthy();
    await user.click(within(g).getByRole('button', { name: EN['RTT.vault.turnOnLogin']! }));
    expect(rpc.of('shell.setStartAtLogin')).toEqual([]);
    const ask = within(g).getByRole('group', { name: EN['RTT.vault.loginAskOn']! });
    await user.click(within(ask).getByRole('button', { name: EN['RTT.vault.turnOnLogin']! }));
    await waitFor(() => expect(rpc.of('shell.setStartAtLogin').map((c) => c.payload)).toEqual([{ enabled: true, confirmed: true }]));
    expect(await within(g).findByRole('button', { name: EN['RTT.vault.turnOffLogin']! })).toBeTruthy();
    cleanup();
    draw(at('vault'), { rpc: fakeRpc({ 'trustx.vault': VAULT, 'shell.startAtLogin': refusal('SERVICE_UNAVAILABLE') }) });
    expect(await within(await group(EN['RTT.vault.loginTitle']!)).findByText(EN['RTT.vault.loginDesktop']!)).toBeTruthy();
    cleanup();
    draw(at('vault'), { rpc: fakeRpc({ 'trustx.vault': VAULT, 'shell.startAtLogin': refusal('UNKNOWN_METHOD') }) });
    const g2 = await group(EN['RTT.vault.loginTitle']!);
    expect(await within(g2).findByText(EN['RTT.vault.loginNotBuilt']!)).toBeTruthy();
    expect(within(g2).queryByRole('button')).toBeNull();
    cleanup();
    on = true;
    draw(at('vault'), { rpc: fakeRpc({ 'trustx.vault': VAULT, 'shell.startAtLogin': { ...login(), matches: false }, 'shell.setStartAtLogin': refusal('START_AT_LOGIN_UNSUPPORTED') }) });
    const g3 = await group(EN['RTT.vault.loginTitle']!);
    expect(await within(g3).findByText(EN['RTT.vault.loginOtherCopy']!)).toBeTruthy();
  });

  test('background mode switches over jobsx.setBackground; wake for jobs over jobsx.setWake once the timer exists', async () => {
    let mode = false, wake = false;
    const rpc = fakeRpc({
      'trustx.vault': VAULT,
      'jobsx.background': () => ({ ...BACKGROUND, backgroundMode: mode, wake: { available: true, experimental: true, on: wake } }),
      'jobsx.setBackground': (p: Record<string, unknown>) => { mode = p['enabled'] === true; return { backgroundMode: mode, asked: true }; },
      'jobsx.setWake': (p: Record<string, unknown>) => { wake = p['enabled'] === true; return { enabled: wake }; },
    });
    const { user } = draw(at('vault'), { rpc });
    const bg = await group(EN['RTT.vault.backgroundTitle']!);
    expect(await within(bg).findByText(EN['RTT.vault.backgroundOff']!)).toBeTruthy();
    expect(within(bg).getByText(EN['RTT.vault.autoLock']!)).toBeTruthy();
    expect(within(bg).getByText(EN['RTT.vault.awake']!)).toBeTruthy();
    await user.click(within(bg).getByRole('button', { name: EN['RTT.vault.backgroundTurnOn']! }));
    await waitFor(() => expect(rpc.of('jobsx.setBackground').map((c) => c.payload)).toEqual([{ enabled: true }]));
    const wg = await group(EN['RTT.vault.wakeTitle']!);
    await user.click(await within(wg).findByRole('button', { name: EN['RTT.vault.wakeTurnOn']! }));
    await waitFor(() => expect(rpc.of('jobsx.setWake').map((c) => c.payload)).toEqual([{ enabled: true }]));
    expect(await within(wg).findByRole('button', { name: EN['RTT.vault.wakeTurnOff']! })).toBeTruthy();
  });

  test('a refused wake reads as the timer sentence, in Hindi too', async () => {
    const rpc = fakeRpc({ 'trustx.vault': VAULT, 'jobsx.background': { ...BACKGROUND, wake: { available: true, experimental: true } }, 'jobsx.setWake': refusal('WAKE_TIMER_UNAVAILABLE') });
    const { user } = draw(at('vault'), { rpc, language: 'hi' });
    const wg = await group(HI['RTT.vault.wakeTitle']!);
    await user.click(await within(wg).findByRole('button', { name: HI['RTT.vault.wakeTurnOn']! }));
    expect(await within(wg).findByText(HI['RTT.vault.wakeUnavailable']!)).toBeTruthy();
  });

  test('a seat other than owner or cofounder sees no switch', async () => {
    draw(at('vault'), { rpc: fakeRpc({ 'trustx.vault': VAULT, 'jobsx.background': BACKGROUND, 'shell.startAtLogin': { platform: 'linux', mechanism: 'linux-xdg-autostart', enabled: true, path: null, matches: null } }), role: 'accountant' });
    await screen.findByText('0.1.0-preview.1');
    expect(screen.queryByRole('heading', { name: EN['RTT.vault.loginTitle']! })).toBeNull();
  });
});

describe('TR-12 hosted backup and TR-14 always-on jobs', () => {
  test('not set up, demo and not paired are plain states', async () => {
    draw(at('hosted'), { rpc: fakeRpc({ 'hosted.status': { ...PAIRED, configured: false, paired: false, account: null } }) });
    expect(await screen.findByText(EN['RTT.hosted.notConfigured']!)).toBeTruthy();
    cleanup();
    draw(at('hosted'), { rpc: fakeRpc({ 'hosted.status': { ...PAIRED, demo: true } }) });
    expect(await screen.findByText(EN['RTT.hosted.demo']!)).toBeTruthy();
    cleanup();
    const { user, navigate } = draw(at('hosted'), { rpc: fakeRpc({ 'hosted.status': { ...PAIRED, paired: false, account: null } }) });
    expect(await screen.findByText(EN['RTT.hosted.notPaired']!)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: EN['RTT.hosted.openPhone']! }));
    expect(navigate).toHaveBeenCalledWith({ place: 'tools', sub: 'phone' });
    cleanup();
    draw(at('hosted'));
    expect(await screen.findByText('Not built yet.')).toBeTruthy();
  });

  test('upload, a lost reply read as unknown and the list read again; restore clears the key and names the file for the lock screen', async () => {
    let uploads = 0;
    const rpc = fakeRpc({
      'hosted.status': PAIRED, 'hosted.backup.list': BACKUPS, 'hosted.worker.status': WORKER,
      'hosted.backup.upload': () => (++uploads === 1 ? { backupId: BK1, sizeBytes: 2048, sha256: 'c'.repeat(64), createdAt: AT, localBackupFile: 'x.backup', label: 'l' } : refusal('HOSTED_UNREACHABLE')),
      'hosted.backup.restore': { backupFile: `chausar-hosted-${BK2}.backup`, restoreWith: 'workspace.restore', needs: 'The vault passphrase.' },
    });
    const { user } = draw(at('hosted'), { rpc });
    const g = await group(EN['RTT.hosted.backupTitle']!);
    expect(await within(g).findByText(EN['RTT.hosted.madeElsewhere']!)).toBeTruthy();
    expect(screen.getByText(/^Your plan is active\. Plan as read on .+\.$/)).toBeTruthy();
    await user.click(within(g).getByRole('button', { name: EN['RTT.hosted.upload']! }));
    expect(await within(g).findByText(EN['RTT.hosted.uploaded']!)).toBeTruthy();
    expect(rpc.of('hosted.backup.upload').map((c) => c.payload)).toEqual([{}]);
    await user.click(within(g).getByRole('button', { name: EN['RTT.hosted.upload']! }));
    expect(await within(g).findByText(EN['RTT.hosted.uploadUnknown']!)).toBeTruthy();
    await waitFor(() => expect(rpc.of('hosted.backup.list').length).toBe(3));
    // The backup made elsewhere asks for the key, in a password field emptied before the request.
    const row = g.querySelector(`[data-backup="${BK2}"]`) as HTMLElement;
    await user.click(within(row).getByRole('button', { name: EN['RTT.hosted.restore']! }));
    const field = within(row).getByLabelText(EN['RTT.hosted.keyField']!) as HTMLInputElement;
    expect(field.type).toBe('password');
    await user.type(field, KEY);
    await user.click(within(row).getByRole('button', { name: EN['RTT.hosted.restore']! }));
    expect(await within(row).findByText(`Backup file: chausar-hosted-${BK2}.backup`)).toBeTruthy();
    expect(within(row).getByText(EN['RTT.vault.lockRestoreSteps']!)).toBeTruthy();
    expect(field.value).toBe('');
    expect(rpc.of('hosted.backup.restore').map((c) => c.payload)).toEqual([{ backupId: BK2, backupKey: KEY }]);
    expect(document.body.textContent).not.toContain(KEY);
  });

  test('the backup key is shown once after asking; refusals are plain words', async () => {
    const rpc = fakeRpc({ 'hosted.status': PAIRED, 'hosted.backup.list': refusal('HOSTED_UNREACHABLE'), 'hosted.worker.status': refusal('PLAN_REQUIRED'),
      'hosted.backup.exportKey': { backupKey: KEY, secret: true, label: 'Secret.' } });
    const { user } = draw(at('hosted'), { rpc });
    const g = await group(EN['RTT.hosted.backupTitle']!);
    expect(await within(g).findByText(EN['RTT.hosted.unreachable']!)).toBeTruthy();
    expect(within(await group(EN['RTT.hosted.workerTitle']!)).getByText(EN['RTT.hosted.planRequired']!)).toBeTruthy();
    await user.click(within(g).getByRole('button', { name: EN['RTT.hosted.exportKey']! }));
    expect(rpc.of('hosted.backup.exportKey')).toHaveLength(0);
    await user.click(within(g).getAllByRole('button', { name: EN['RTT.hosted.exportKey']! }).at(-1)!);
    expect(await within(g).findByText(KEY)).toBeTruthy();
    expect(within(g).getByText(EN['RTT.hosted.keyShown']!)).toBeTruthy();
    expect(within(g).queryByRole('button', { name: EN['RTT.hosted.exportKey']! })).toBeNull();
  });

  test('always-on jobs: the server label is text; turning one on goes through the agreement sheet; off is direct', async () => {
    const rpc = fakeRpc({ 'hosted.status': PAIRED, 'hosted.backup.list': BACKUPS, 'hosted.worker.status': WORKER,
      'hosted.worker.set': (p: Record<string, unknown>) => ({ ...WORKER.jobs[p['type'] === 'brief' ? 1 : 0], enabled: p['enabled'], consentAt: p['enabled'] ? AT : null, label: 'l' }) });
    const { user, navigate } = draw(at('hosted'), { rpc });
    const g = await group(EN['RTT.hosted.workerTitle']!);
    expect(await within(g).findByText('Not end-to-end encrypted. <b>server label</b>')).toBeTruthy();
    expect(g.querySelector('b')).toBeNull();
    expect(within(g).getByText(EN['RTT.hosted.notBlind']!)).toBeTruthy();
    const reminder = g.querySelector('[data-job="due-date-reminder"]') as HTMLElement;
    await user.click(within(reminder).getByRole('button', { name: EN['RTT.hosted.jobTurnOn']! }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'hosted', sheet: 'always-on.due-date-reminder' });
    expect(rpc.of('hosted.worker.set')).toHaveLength(0);
    const brief = g.querySelector('[data-job="brief"]') as HTMLElement;
    await user.click(within(brief).getByRole('button', { name: EN['RTT.hosted.jobTurnOff']! }));
    await waitFor(() => expect(rpc.of('hosted.worker.set').map((c) => c.payload)).toEqual([{ type: 'brief', enabled: false }]));
  });

  test('the agreement sheet sends consent only after the tick, exactly once', async () => {
    const rpc = fakeRpc({ 'hosted.status': PAIRED, 'hosted.backup.list': BACKUPS, 'hosted.worker.status': WORKER,
      'hosted.worker.set': { ...WORKER.jobs[0], enabled: true, consentAt: AT, label: 'l' } });
    const { user, navigate } = draw(at('hosted', 'always-on.due-date-reminder'), { rpc });
    const sheet = await waitFor(() => { const el = document.querySelector('[data-region="sheet"]'); if (el === null) throw new Error('no sheet'); return el as HTMLElement; });
    expect(await within(sheet).findByText(EN['RTT.hosted.consentBody']!)).toBeTruthy();
    expect(within(sheet).getByText('Job: A due date is near')).toBeTruthy();
    await user.click(within(sheet).getByRole('button', { name: EN['RTT.hosted.consentConfirm']! }));
    expect(await within(sheet).findByText(EN['RTT.hosted.consentNeeded']!)).toBeTruthy();
    expect(rpc.of('hosted.worker.set')).toHaveLength(0);
    await user.click(within(sheet).getByRole('checkbox'));
    await user.click(within(sheet).getByRole('button', { name: EN['RTT.hosted.consentConfirm']! }));
    await waitFor(() => expect(rpc.of('hosted.worker.set').map((c) => c.payload)).toEqual([{ type: 'due-date-reminder', enabled: true, consent: true }]));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'hosted' }));
    cleanup();
    draw(at('hosted', 'always-on.gone-job'), { rpc: fakeRpc({ 'hosted.status': PAIRED, 'hosted.backup.list': BACKUPS, 'hosted.worker.status': WORKER }), language: 'hi' });
    expect(await screen.findByText(HI['RTT.hosted.consentGone']!)).toBeTruthy();
  });

  test('TR-14 on the Sharing page: paid and ended read from trustx.hosted', async () => {
    const base = { blind: 'Blind.', notBlind: 'Not blind.', jobs: [{ id: 'hosted-brief', name: 'Morning brief', on: false }], keeps: 'Kept a year.', hosted: { state: 'paired', refreshedAt: AT, entitlements: null } };
    const sharing = { on: false, intake: { open: false, words: 'Closed.' }, preview: null, batches: [], totals: { events: 0, names: 0, amounts: 0 }, withdrawnAt: null };
    const replies = { 'trustx.sharing': sharing, 'trustx.agreements': { notice: { version: '1', en: 'E', hi: 'H' }, items: [] },
      'learningx.intakeStatus': { open: false, mode: 'closed', sharingSwitch: false, label: 'Sharing is not open yet. Nothing is sent.', boxes: [] } };
    const { user, navigate } = draw(at('sharing'), { rpc: fakeRpc({ ...replies, 'trustx.hosted': { ...base, plan: 'paid' } }) });
    expect(await screen.findByText(EN['RTT.hosted.planPaid']!)).toBeTruthy();
    expect(screen.queryByText(SHARING.en.planned)).toBeNull();
    await user.click(screen.getByRole('button', { name: EN['RTT.hosted.openPage']! }));
    expect(navigate).toHaveBeenCalledWith({ place: 'trust', sub: 'hosted' });
    cleanup();
    draw(at('sharing'), { rpc: fakeRpc({ ...replies, 'trustx.hosted': { ...base, plan: 'ended' } }) });
    expect(await screen.findByText(SHARING.en.planEnded)).toBeTruthy();
    expect(screen.getByText(EN['RTT.hosted.planEndedNote']!)).toBeTruthy();
  });
});

describe('TR-07 Machines and sync', () => {
  test('without core-sync-jobs the machines say not built yet; Drive connects with a folder name', async () => {
    const rpc = fakeRpc({ 'hosted.drive.status': DRIVE_OFF, 'hosted.drive.connect': { ...DRIVE_ON, attachment: 'attached' } });
    const { user } = draw(at('devices'), { rpc });
    expect(within(await group(EN['RTT.devices.machinesTitle']!)).getByText(EN['RTT.devices.notBuilt']!)).toBeTruthy();
    const drive = await group(EN['RTT.devices.driveTitle']!);
    expect(await within(drive).findByText(EN['RTT.devices.driveNotConnected']!)).toBeTruthy();
    expect(within(drive).getByText(EN['RTT.devices.driveAccess']!)).toBeTruthy();
    expect(within(drive).getByText(EN['RTT.devices.driveKeeps']!)).toBeTruthy();
    expect(within(drive).getByText('experimental')).toBeTruthy();
    await user.type(within(drive).getByLabelText(EN['RTT.devices.folderName']!), 'Chausar sync');
    await user.click(within(drive).getByRole('button', { name: EN['RTT.devices.connect']! }));
    await waitFor(() => expect(rpc.of('hosted.drive.connect').map((c) => c.payload)).toEqual([{ folderName: 'Chausar sync' }]));
    expect(await within(drive).findByText(EN['RTT.devices.attachment.attached']!)).toBeTruthy();
    // sync.setup is not built yet either.
    const setup = await group(EN['RTT.devices.setupTitle']!);
    await user.type(within(setup).getByLabelText(EN['RTT.devices.folderPath']!), '/srv/share/chausar');
    await user.click(within(setup).getByRole('button', { name: EN['RTT.devices.setUp']! }));
    expect(await within(setup).findByText(EN['RTT.devices.notBuilt']!)).toBeTruthy();
    expect(rpc.of('sync.setup').map((c) => c.payload)).toEqual([{ kind: 'folder', path: '/srv/share/chausar' }]);
  });

  test('a connected folder disconnects after asking; sign-in and demo are words', async () => {
    const rpc = fakeRpc({ 'hosted.drive.status': DRIVE_ON, 'hosted.drive.disconnect': { disconnected: true, folderId: 'folder_synthetic_123', attachment: 'not-connected', filesKept: true, note: 'n' } });
    const { user } = draw(at('devices'), { rpc, view: 'books' });
    const drive = await group(EN['RTT.devices.driveTitle']!);
    expect(await within(drive).findByText('Folder id: folder_synthetic_123')).toBeTruthy();
    await user.click(within(drive).getByRole('button', { name: EN['RTT.devices.disconnect']! }));
    expect(rpc.of('hosted.drive.disconnect')).toHaveLength(0);
    await user.click(within(drive).getAllByRole('button', { name: EN['RTT.devices.disconnect']! }).at(-1)!);
    expect(await within(drive).findByText(EN['RTT.devices.disconnected']!)).toBeTruthy();
    cleanup();
    draw(at('devices'), { rpc: fakeRpc({ 'hosted.drive.status': { ...DRIVE_OFF, signIn: 'required' } }) });
    expect(await screen.findByText(EN['RTT.devices.signInRequired']!)).toBeTruthy();
    cleanup();
    draw(at('devices'), { rpc: fakeRpc({ 'hosted.drive.status': { ...DRIVE_OFF, demo: true, signIn: 'unavailable', attachment: 'unavailable' } }), language: 'hi' });
    expect(await screen.findByText(HI['RTT.devices.driveDemo']!)).toBeTruthy();
  });

  test('machines and the pen: rows, hand over and remove each ask once more; a reader is read only', async () => {
    const devices = { devices: [
      { id: 'dev-a', name: 'Shop laptop', kind: 'computer', holdsPen: true, thisComputer: true, lastReadAt: AT },
      { id: 'dev-b', name: 'Laptop 2', kind: 'computer', holdsPen: false, thisComputer: false, lastReadAt: AT },
      { id: 'dev-c', name: 'Phone', kind: 'phone', holdsPen: false, thisComputer: false, lastReadAt: null },
    ] };
    const rpc = fakeRpc({ 'devices.list': devices, 'devices.pen': { deviceId: 'dev-a', thisComputer: true, readOnly: false },
      'devices.handOver': { deviceId: 'dev-b', state: 'waiting' }, 'devices.remove': { removed: true, keyChanged: true }, 'hosted.drive.status': DRIVE_OFF });
    const { user } = draw(at('devices'), { rpc });
    const g = await group(EN['RTT.devices.machinesTitle']!);
    const b = await within(g).findByText('Laptop 2');
    const row = b.closest('li') as HTMLElement;
    expect(within(g).getByText(EN['RTT.devices.neverRead']!)).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: EN['RTT.devices.handOver']! }));
    await user.click(within(row).getAllByRole('button', { name: EN['RTT.devices.handOver']! }).at(-1)!);
    await waitFor(() => expect(rpc.of('devices.handOver').map((c) => c.payload)).toEqual([{ deviceId: 'dev-b' }]));
    expect(await within(g).findByText('Waiting for Laptop 2 to take the pen.')).toBeTruthy();
    await user.click(within(row).getByRole('button', { name: EN['RTT.devices.remove']! }));
    expect(within(row).getByText(/Removing a machine changes the key/)).toBeTruthy();
    await user.click(within(row).getAllByRole('button', { name: EN['RTT.devices.remove']! }).at(-1)!);
    await waitFor(() => expect(rpc.of('devices.remove').map((c) => c.payload)).toEqual([{ deviceId: 'dev-b' }]));
    // This computer has no Remove; the phone cannot take the pen.
    const mine = within(g).getByText('Shop laptop').closest('li') as HTMLElement;
    expect(within(mine).queryByRole('button')).toBeNull();
    const phone = within(g).getAllByText('Phone')[0]!.closest('li') as HTMLElement;
    expect(within(phone).queryByRole('button', { name: EN['RTT.devices.handOver']! })).toBeNull();
    cleanup();
    draw(at('devices'), { rpc: fakeRpc({ 'devices.list': devices, 'devices.pen': { deviceId: 'dev-b', thisComputer: false, readOnly: true }, 'hosted.drive.status': DRIVE_OFF }) });
    expect(await screen.findByText(EN['RTT.devices.readOnly']!)).toBeTruthy();
    expect(screen.queryByRole('button', { name: EN['RTT.devices.handOver']! })).toBeNull();
  });
});

describe('Trust · Keys', () => {
  test('a key is typed into a password field, emptied before the request, and never shown back', async () => {
    let stored = false;
    const rpc = fakeRpc({
      'connectorsx.connections': CONNECTIONS,
      'connectorsx.credentials.status': (p: Record<string, unknown>) => p['connectionId'] === 'conn_zoho' && stored
        ? { available: true, present: true, kind: 'key', storedAt: AT } : { available: true, present: false, kind: null, storedAt: null },
      'connectorsx.credentials.set': () => { stored = true; return { stored: true, connectionId: 'conn_zoho' }; },
      'connectorsx.credentials.remove': () => { stored = false; return { removed: true }; },
    });
    const { user } = draw(at('keys'), { rpc });
    const row = (await screen.findByText('Zoho Books (synthetic)')).closest('li') as HTMLElement;
    expect(await within(row).findByText(EN['RTT.keys.absent']!)).toBeTruthy();
    const db = screen.getByText('Shop database').closest('li') as HTMLElement;
    expect(within(db).getByText(EN['RTT.keys.paused']!)).toBeTruthy();
    const field = within(row).getByLabelText(EN['RTT.keys.field']!) as HTMLInputElement;
    expect(field.type).toBe('password');
    await user.click(within(row).getByRole('button', { name: EN['RTT.keys.save']! }));
    expect(await within(row).findByText(EN['RTT.keys.needKey']!)).toBeTruthy();
    expect(rpc.of('connectorsx.credentials.set')).toHaveLength(0);
    await user.type(field, 'synthetic-secret-key-1234');
    await user.click(within(row).getByRole('button', { name: EN['RTT.keys.save']! }));
    await waitFor(() => expect(rpc.of('connectorsx.credentials.set').map((c) => c.payload)).toEqual([{ connectionId: 'conn_zoho', secret: 'synthetic-secret-key-1234' }]));
    expect(field.value).toBe('');
    expect(await within(row).findByText(EN['RTT.keys.saved']!)).toBeTruthy();
    expect(await within(row).findByText(/A key is stored, since/)).toBeTruthy();
    expect(document.body.textContent).not.toContain('synthetic-secret-key-1234');
    await user.click(within(row).getByRole('button', { name: EN['RTT.keys.remove']! }));
    expect(rpc.of('connectorsx.credentials.remove')).toHaveLength(0);
    await user.click(within(row).getAllByRole('button', { name: EN['RTT.keys.remove']! }).at(-1)!);
    await waitFor(() => expect(rpc.of('connectorsx.credentials.remove').map((c) => c.payload)).toEqual([{ connectionId: 'conn_zoho' }]));
    expect(await within(row).findByText(EN['RTT.keys.removed']!)).toBeTruthy();
  });

  test('no key store, a refused key, a viewer and Hindi', async () => {
    const rpc = fakeRpc({ 'connectorsx.connections': CONNECTIONS.slice(0, 1), 'connectorsx.credentials.status': { available: true, present: false, kind: null, storedAt: null },
      'connectorsx.credentials.set': refusal('CREDENTIAL_INVALID') });
    const { user } = draw(at('keys'), { rpc, language: 'hi' });
    const row = (await screen.findByText('Zoho Books (synthetic)')).closest('li') as HTMLElement;
    await user.type(await within(row).findByLabelText(HI['RTT.keys.field']!), 'abcd1234');
    await user.click(within(row).getByRole('button', { name: HI['RTT.keys.save']! }));
    expect(await within(row).findByText(HI['RTT.keys.badKey']!)).toBeTruthy();
    cleanup();
    draw(at('keys'), { rpc: fakeRpc({ 'connectorsx.connections': CONNECTIONS.slice(0, 1), 'connectorsx.credentials.status': { available: false, present: false, kind: null, storedAt: null } }) });
    expect(await screen.findByText(EN['RTT.keys.storeOff']!)).toBeTruthy();
    expect(screen.queryByLabelText(EN['RTT.keys.field']!)).toBeNull();
    cleanup();
    draw(at('keys'), { rpc: fakeRpc({ 'connectorsx.connections': CONNECTIONS.slice(0, 1), 'connectorsx.credentials.status': { available: true, present: true, kind: 'oauth', storedAt: null } }), viewer: true });
    expect(await screen.findByText(EN['RTT.keys.presentNoDate']!)).toBeTruthy();
    expect(screen.getByText(EN['RTT.keys.adminOnly']!)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    cleanup();
    draw(at('keys'), { rpc: fakeRpc({ 'connectorsx.connections': [] }) });
    expect(await screen.findByText(EN['RTT.keys.none']!)).toBeTruthy();
  });
});

describe('reply checks', () => {
  test('a credential status that carries anything more, a restore outside a plain file name, a labelled-encrypted worker and a bad key are refused', () => {
    expect(() => validateCredentialStatus({ available: true, present: true, kind: 'key', storedAt: AT, secret: 'x' })).toThrow();
    expect(() => validateCredentialStatus({ available: true, present: true, kind: null, storedAt: AT })).toThrow();
    expect(validateCredentialStatus({ available: true, present: false, kind: null, storedAt: null }).present).toBe(false);
    expect(() => validateHostedRestore({ backupFile: '../escape.backup', restoreWith: 'workspace.restore' })).toThrow();
    expect(() => validateHostedRestore({ backupFile: 'ok.backup', restoreWith: 'other' })).toThrow();
    expect(() => validateWorkerStatus({ ...WORKER, endToEndEncrypted: true })).toThrow();
    expect(() => validateExportedKey({ backupKey: KEY, secret: false })).toThrow();
    expect(() => validateExportedKey({ backupKey: 'short', secret: true })).toThrow();
  });
});
