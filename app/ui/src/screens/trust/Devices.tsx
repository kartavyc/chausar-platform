/**
 * TR-07 Machines and the pen, at `trust/devices`: the machines that hold this workspace and which one writes,
 * over core-sync-jobs' `devices.list`, `devices.handOver`, `devices.remove` and `sync.setup` (until they answer,
 * the page says so in words), and sync through Google Drive
 * over hosted-link's `hosted.drive.connect`, `hosted.drive.status` and `hosted.drive.disconnect`. Removing a
 * machine and disconnecting Drive ask once more. Folder ids from Drive are shown as text only.
 */
import { useState, type FormEvent } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { State } from '../../patterns/States';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Screen, screenState } from './kit/Screen';
import { AskTwice, Tag, dayText, powers, type P } from './common';
import { rtt } from './rtt.ts';
import { RttRefusal, Said } from './rtt-parts';
import {
  validateDevices, validateDriveConnected, validateDriveDisconnected, validateDriveStatus, validateHandOver, validateRemoved, validateSyncSetup,
  type Device, type DevicesView, type DriveStatus,
} from './validate-hosted.ts';
import { COMMON } from './words.ts';
import s from './Trust.module.css';

export function DevicesScreen(p: P) {
  const say = rtt(p.language);
  return (
    <Screen where={say('RTT.devices.where')} title={say('RTT.devices.title')} loaded={{ kind: 'ready', value: null }}>
      {() => (
        <>
          <MachinesGroup p={p} />
          <DriveGroup p={p} />
          <FolderSetup p={p} />
        </>
      )}
    </Screen>
  );
}

// ---------- Machines and the pen (core-sync-jobs) ----------
function MachinesGroup({ p }: { p: P }) {
  const say = rtt(p.language);
  const list = useEngine(p.rpc, 'devices.list', {}, validateDevices);
  const body = list.state.kind === 'not-built' ? <p className={s.quiet} data-devices="not-built">{say('RTT.devices.notBuilt')}</p>
    : list.state.kind === 'failed' ? <RttRefusal code={list.state.code} language={p.language} />
      : list.state.kind !== 'ready' ? <State state={screenState(list.state)} />
        : <Machines p={p} view={list.state.value} reload={list.reload} />;
  return <Group title={say('RTT.devices.machinesTitle')} note={say('RTT.devices.rule')}>{body}</Group>;
}

function Machines({ p, view, reload }: { p: P; view: DevicesView; reload: () => void }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  const hand = useSend(p.rpc, validateHandOver);
  const remove = useSend(p.rpc, validateRemoved);
  const toggle = useSend(p.rpc, validateSyncSetup);
  const [handedTo, setHandedTo] = useState<string>('');
  const handOver = async (d: Device) => { setHandedTo(d.name); if (await hand.send('devices.handOver', { toDeviceId: d.id, confirm: true }) !== null && p.live(p.address)) reload(); };
  const removeOne = async (d: Device) => { if (await remove.send('devices.remove', { deviceId: d.id, confirm: true }) !== null && p.live(p.address)) reload(); };
  const setSync = async (on: boolean) => { if (await toggle.send('sync.setup', { on }) !== null && p.live(p.address)) reload(); };
  const mayHand = admin && view.pen.thisComputerHolds && !view.readOnly;
  const devices = view.devices;
  if (!view.configured) return <p className={s.quiet} data-devices="not-configured">{say('RTT.devices.notConfigured')}</p>;
  return (
    <div className={s.stack}>
      <p className={s.text} data-sync={view.syncOn ? 'on' : 'off'}>{say(view.syncOn ? 'RTT.devices.syncOn' : 'RTT.devices.syncOff')}</p>
      {admin && <span><Button variant="quiet" disabled={toggle.sent.kind === 'sending'} onClick={() => void setSync(!view.syncOn)}>{say(view.syncOn ? 'RTT.devices.turnSyncOff' : 'RTT.devices.turnSyncOn')}</Button></span>}
      {view.readOnly && <p className={s.status} data-read-only="">{say('RTT.devices.readOnly')}</p>}
      {devices.length === 0 ? <p className={s.quiet}>{say('RTT.devices.none')}</p> : (
        <ul className={s.list}>
          {devices.map((d) => (
            <li key={d.id} className={s.item} data-device={d.id}>
              <span className={s.itemHead}>
                <span className={s.name}>{d.name}</span>
                {d.thisComputer && <Tag>{say('RTT.devices.thisComputer')}</Tag>}
                <span className={s.quiet}>{d.removed ? say('RTT.devices.removedOn', { date: d.removedAt === null ? '' : dayText(d.removedAt, p.language) }) : say(d.holdsPen ? 'RTT.devices.holdsPen' : 'RTT.devices.reads')}</span>
              </span>
              {!d.removed && <span className={s.quiet}>{d.lastReadAt === null ? say('RTT.devices.neverRead') : say('RTT.devices.lastRead', { date: dayText(d.lastReadAt, p.language) })}</span>}
              {!d.removed && (
                <span className={s.line}>
                  {mayHand && !d.holdsPen && (
                    <AskTwice label={say('RTT.devices.handOver')} ask={say('RTT.devices.handOverAsk', { name: d.name })} confirmLabel={say('RTT.devices.handOver')}
                      onConfirm={() => void handOver(d)} language={p.language} disabled={hand.sent.kind === 'sending'} />
                  )}
                  {admin && !d.thisComputer && (
                    <AskTwice label={say('RTT.devices.remove')} ask={say('RTT.devices.removeAsk', { name: d.name })} confirmLabel={say('RTT.devices.remove')}
                      onConfirm={() => void removeOne(d)} language={p.language} disabled={remove.sent.kind === 'sending'} />
                  )}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Said sent={hand.sent} done={(x) => x.published ? say('RTT.devices.handedOver') : say('RTT.devices.handOverWaiting', { name: handedTo })} language={p.language} />
      <Said sent={remove.sent} done={() => say('RTT.devices.removed')} language={p.language} />
      <Said sent={toggle.sent} done={(x) => say(x.syncOn ? 'RTT.devices.syncOn' : 'RTT.devices.syncOff')} language={p.language} />
    </div>
  );
}

// ---------- Sync through Google Drive (hosted-link) ----------
const FOLDER_NAME = /^[A-Za-z0-9 ._-]{1,100}$/;
const FOLDER_ID = /^[A-Za-z0-9_-]{10,200}$/;

function DriveGroup({ p }: { p: P }) {
  const say = rtt(p.language);
  const { state, reload } = useEngine(p.rpc, 'hosted.drive.status', {}, validateDriveStatus);
  return (
    <Group title={say('RTT.devices.driveTitle')} note={say('RTT.devices.driveAccess')}>
      <p className={s.text}><Tag>{words(COMMON, p.language).experimental}</Tag></p>
      <p className={s.quiet}>{say('RTT.devices.driveBlind')}</p>
      <p className={s.quiet}>{say('RTT.devices.driveKeeps')}</p>
      {state.kind === 'failed' ? <RttRefusal code={state.code} language={p.language} />
        : state.kind !== 'ready' ? <State state={screenState(state)} /> : <DriveBody p={p} d={state.value} reload={reload} />}
    </Group>
  );
}

function DriveBody({ p, d, reload }: { p: P; d: DriveStatus; reload: () => void }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  const disconnect = useSend(p.rpc, validateDriveDisconnected);
  const drop = async () => { if (await disconnect.send('hosted.drive.disconnect', {}) !== null && p.live(p.address)) reload(); };
  if (d.demo) return <p className={s.quiet} data-drive="demo">{say('RTT.devices.driveDemo')}</p>;
  return (
    <div className={s.stack}>
      {d.connected && d.folderId !== null ? (
        <>
          <p className={s.text} data-drive="connected">
            {d.connectedAt === null ? '' : `${say('RTT.devices.driveConnected', { date: dayText(d.connectedAt, p.language) })} `}
            {d.created === null ? '' : say(d.created ? 'RTT.devices.driveCreated' : 'RTT.devices.driveAdopted')}
          </p>
          {p.view === 'books' && <p className={s.mono}>{say('RTT.devices.driveFolder', { id: d.folderId })}</p>}
        </>
      ) : <p className={s.text} data-drive="not-connected">{say('RTT.devices.driveNotConnected')}</p>}
      <p className={s.quiet} data-attachment={d.attachment}>{say(`RTT.devices.attachment.${d.attachment}`)}</p>
      {d.syncEnabled !== null && <p className={s.quiet}>{say(d.syncEnabled ? 'RTT.devices.syncOn' : 'RTT.devices.syncOff')}</p>}
      {!d.connected && d.signIn === 'required' && <p className={s.status}>{say('RTT.devices.signInRequired')}</p>}
      {admin && !d.connected && d.signIn !== 'unavailable' && <DriveConnect p={p} reload={reload} />}
      {admin && d.connected && (
        <span><AskTwice label={say('RTT.devices.disconnect')} ask={say('RTT.devices.disconnectAsk')} confirmLabel={say('RTT.devices.disconnect')}
          onConfirm={() => void drop()} language={p.language} disabled={disconnect.sent.kind === 'sending'} /></span>
      )}
      <Said sent={disconnect.sent} done={() => say('RTT.devices.disconnected')} language={p.language} />
    </div>
  );
}

function DriveConnect({ p, reload }: { p: P; reload: () => void }) {
  const say = rtt(p.language);
  const [name, setName] = useState('');
  const [folderId, setFolderId] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateDriveConnected);
  const create = async (e: FormEvent) => {
    e.preventDefault();
    const typed = name.trim();
    if (typed.length > 0 && !FOLDER_NAME.test(typed)) { setProblem(say('RTT.devices.badFolder')); return; }
    setProblem(undefined);
    if (await send('hosted.drive.connect', typed.length > 0 ? { folderName: typed } : {}) !== null && p.live(p.address)) reload();
  };
  const adopt = async (e: FormEvent) => {
    e.preventDefault();
    const typed = folderId.trim();
    if (!FOLDER_ID.test(typed)) { setProblem(say('RTT.devices.folderNotFound')); return; }
    setProblem(undefined);
    if (await send('hosted.drive.connect', { folderId: typed }) !== null && p.live(p.address)) reload();
  };
  return (
    <div className={s.stack}>
      <form className={s.form} onSubmit={(e) => void create(e)}>
        <Field label={say('RTT.devices.folderName')} value={name} onChange={(e) => setName(e.currentTarget.value)} />
        <Button submit disabled={sent.kind === 'sending'}>{say('RTT.devices.connect')}</Button>
      </form>
      <form className={s.form} onSubmit={(e) => void adopt(e)}>
        <Field label={say('RTT.devices.adoptId')} value={folderId} onChange={(e) => setFolderId(e.currentTarget.value)} autoComplete="off" />
        <Button submit variant="quiet" disabled={sent.kind === 'sending'}>{say('RTT.devices.adopt')}</Button>
      </form>
      {problem !== undefined && <p className={s.problem} role="status">{problem}</p>}
      <Said sent={sent} done={(x) => say(`RTT.devices.attachment.${x.attachment}`)} language={p.language} />
    </div>
  );
}

// ---------- Sync set-up: a folder on this network (core-sync-jobs) ----------
function FolderSetup({ p }: { p: P }) {
  const say = rtt(p.language);
  const { admin } = powers(p);
  const [path, setPath] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, validateSyncSetup);
  if (!admin) return null;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = path.trim();
    if (typed.length === 0 || typed.length > 1000) { setProblem(say('RTT.devices.folderNeeded')); return; }
    setProblem(undefined);
    await send('sync.setup', { transport: 'folder', folder: typed });
  };
  return (
    <Group title={say('RTT.devices.setupTitle')} note={say('RTT.devices.setupNote')}>
      <form className={s.form} onSubmit={(e) => void submit(e)}>
        <Field label={say('RTT.devices.folderPath')} value={path} onChange={(e) => setPath(e.currentTarget.value)} problem={problem} autoComplete="off" />
        <Button submit disabled={sent.kind === 'sending'}>{say('RTT.devices.setUp')}</Button>
      </form>
      {sent.kind === 'refused' && (sent.code === 'UNKNOWN_METHOD' || sent.code === 'METHOD_UNAVAILABLE')
        ? <p className={s.quiet} data-setup="not-built">{say('RTT.devices.notBuilt')}</p>
        : <Said sent={sent} done={(x) => [say('RTT.devices.setupDone'), say(x.syncOn ? 'RTT.devices.syncOn' : 'RTT.devices.syncOff'), x.restartRequired ? say('RTT.devices.restart') : ''].filter(Boolean).join(' ')} language={p.language} />}
    </Group>
  );
}
