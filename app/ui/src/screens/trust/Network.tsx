/**
 * TR-09 Network: every call that left this computer, newest first, filtered by kind and
 * by plugin. A waiting row opens a sheet with the exact content that would have gone,
 * shown as text. The canary: planted or not, plant one, and the alert row.
 */
import { useRef, useState } from 'react';
import type { Mark, RowItem } from '../../app/presentation.ts';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice } from '../../parts/Choice';
import { RowList } from '../../parts/RowList';
import { Sheet } from '../../parts/Sheet';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Screen } from './kit/Screen';
import { AskTwice, Outcome, Refusal, bytesText, dayText, powers, useClose, type P } from './common';
import { NET_KINDS, validateApproval, validateNetwork, validatePlanted, type NetItem, type NetKind, type Network } from './validate.ts';
import { COMMON, NETWORK, fill } from './words.ts';
import s from './Trust.module.css';

const MARKS: Readonly<Record<NetItem['outcome'], Mark>> = { allowed: 'cha', stopped: 'off', waiting: 'wait' };

export function NetworkScreen(p: P) {
  const c = words(COMMON, p.language), w = words(NETWORK, p.language);
  const [kind, setKind] = useState<'all' | NetKind>('all');
  const [plugin, setPlugin] = useState<string>('all');
  const payload: Record<string, unknown> = {};
  if (kind !== 'all') payload['kind'] = kind;
  if (plugin !== 'all') payload['pluginId'] = plugin;
  const { state, reload } = useEngine(p.rpc, 'trustx.network', payload, validateNetwork);
  const plugins = useRef(new Set<string>());
  if (state.kind === 'ready') for (const item of state.value.items) if (item.pluginId !== null) plugins.current.add(item.pluginId);
  const open = state.kind === 'ready' && p.address.sheet !== undefined ? state.value.items.find((x) => x.id === p.address.sheet) : undefined;
  return (
    <>
      <Screen where={c.whereNetwork} title={c.network} loaded={state}>
        {(net) => (
          <>
            <div className={s.stack}>
              <Choice label={w.filterKind} options={[{ value: 'all', label: w.all }, ...NET_KINDS.map((value) => ({ value, label: w[`kind.${value}`] }))]}
                value={kind} onChange={(v) => setKind(v)} />
              {plugins.current.size > 0 && (
                <Choice label={w.filterPlugin} options={[{ value: 'all', label: w.all }, ...[...plugins.current].map((value) => ({ value, label: value }))]}
                  value={plugin} onChange={setPlugin} />
              )}
            </div>
            <Calls p={p} net={net} />
            <Canary p={p} net={net} reload={reload} />
          </>
        )}
      </Screen>
      {open !== undefined && <WaitingSheet p={p} item={open} />}
    </>
  );
}

function Calls({ p, net }: { p: P; net: Network }) {
  const w = words(NETWORK, p.language);
  if (net.items.length === 0) return <Group title={w.callsTitle}><p className={s.quiet}>{w.none}</p></Group>;
  const rows: RowItem[] = net.items.map((x) => ({
    id: x.id, mark: MARKS[x.outcome], what: x.destination,
    note: [x.why, bytesText(x.bytes, p.language), w[`outcome.${x.outcome}`], dayText(x.at, p.language), ...(p.view === 'books' ? [x.at, w[`kind.${x.kind}`], x.pluginId ?? ''] : [])]
      .filter((part) => part.length > 0).join(' · '),
  }));
  const waiting = new Set(net.items.filter((x) => x.outcome === 'waiting').map((x) => x.id));
  return (
    <Group title={w.callsTitle}>
      <RowList rows={rows} onReceipt={p.openReceipt} opens={(row) => waiting.has(row.id)} selectedId={p.address.sheet}
        onOpen={(id) => p.navigate(withSheet(p.address, id))} />
    </Group>
  );
}

function Canary({ p, net, reload }: { p: P; net: Network; reload: () => void }) {
  const w = words(NETWORK, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validatePlanted);
  const plant = async () => { if (await send('trustx.plantCanary', {}) !== null && p.live(p.address)) reload(); };
  const a = net.canary.alert;
  return (
    <Group title={w.canaryTitle} note={w.canaryNote}>
      {a !== null && <p className={s.problem} role="alert">{fill(w.alert, { call: a.callId, date: dayText(a.at, p.language) })}</p>}
      <p className={s.text}>{net.canary.planted ? w.planted : w.notPlanted}</p>
      {admin && <span><Button variant="quiet" onClick={() => void plant()} disabled={sent.kind === 'sending'}>{w.plant}</Button></span>}
      <Outcome sent={sent} language={p.language} />
    </Group>
  );
}

function WaitingSheet({ p, item }: { p: P; item: NetItem }) {
  const c = words(COMMON, p.language), w = words(NETWORK, p.language);
  const close = useClose(p);
  return (
    <Sheet kind={c.sheetDetail} title={w.waitingTitle} onClose={close} origin={null}>
      <div className={s.stack}>
        <p className={s.text}>{item.destination}</p>
        <p className={s.quiet}>{item.why}</p>
        <p className={s.quiet}>{w.waitingNote}</p>
        {item.waitingContent === null ? <p className={s.quiet}>{w.noContent}</p> : <pre className={s.pre} data-waiting-content="">{item.waitingContent}</pre>}
        {item.outcome === 'waiting' && (item.kind === 'model' ? <Release p={p} item={item} /> : (
          <>
            <p className={s.text}>{w.approveElsewhere}</p>
            <span><Button variant="link" onClick={() => p.navigate({ place: 'work', sub: 'approvals' })}>{w.openApprovals}</Button></span>
          </>
        ))}
      </div>
    </Sheet>
  );
}

/** A waiting model call: Release is core `models.approve { id }` on its preview; there is no discard method, so the sheet says it expires. */
function Release({ p, item }: { p: P; item: NetItem }) {
  const w = words(NETWORK, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateApproval);
  return (
    <div className={s.stack}>
      {admin && sent.kind !== 'done' && (
        <span><AskTwice label={w.release} ask={fill(w.releaseAsk, { destination: item.destination })} confirmLabel={w.release}
          onConfirm={() => void send('models.approve', { id: item.id })} language={p.language} disabled={sent.kind === 'sending'} /></span>
      )}
      {!admin && <p className={s.quiet}>{w.releaseAdmin}</p>}
      {sent.kind === 'done' && <p className={s.status} role="status">{w.released}</p>}
      {sent.kind === 'refused' && <Refusal code={sent.code} language={p.language} />}
      {sent.kind === 'sending' && <Outcome sent={sent} language={p.language} />}
      <p className={s.quiet}>{w.discard}</p>
    </div>
  );
}
