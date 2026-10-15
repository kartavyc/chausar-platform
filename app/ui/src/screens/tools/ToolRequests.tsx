/**
 * TL-07 Requests from connected tools (tools/requests), over models-ext's `smallapps.pendingRequests`
 * (contract in docs/lanes/models-ext.md, "TL-07 pending requests"; until that method is in the
 * engine this page is the typed "not built yet" state). Each waiting request opens the request
 * sheet: the tool, its question as quoted outside data, and what it will receive. An owner or
 * cofounder approves exactly what was shown: the screen reads the request back first
 * (`smallapps.pluginRemotePreview`) and refuses if its digest changed, then calls the request's own
 * approve method, which must be on the allowlist, with exactly `{ previewId, digest }`. Nothing is
 * sent from here: the person who prepared the request sends it once from the network door page.
 */
import { useCallback, useState } from 'react';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { errorCode, useEngine, type Sent } from '../trust/kit/engine.ts';
import { Note, Screen } from '../trust/kit/Screen';
import { REMOTE, pending, remoteApproval, remotePreview, type PendingRequest } from './adapters/remote.ts';
import { LaneSent, laneSay, type Say } from './lane';
import { ToolRequestSheet } from './ToolRequestSheet';
import { Line, Lines, day, isAdmin, toolsWords, type Words } from './shared';
import s from './Lane.module.css';

function RequestSheet({ r, props, w, say, onDone, onClose }: { r: PendingRequest; props: PlaceRenderProps; w: Words; say: Say; onDone: () => void; onClose: () => void }) {
  const [sent, setSent] = useState<Sent<true>>({ kind: 'idle' });
  const admin = isAdmin(props);
  const approve = useCallback(async () => {
    if (sent.kind === 'sending' || !r.approveWith.allowed) return;
    setSent({ kind: 'sending' });
    try {
      // Read back: approve only the request exactly as shown.
      const back = remotePreview(await props.rpc.request(REMOTE.preview, { previewId: r.approveWith.previewId }), props.language);
      if (back.digest !== r.approveWith.digest || !back.approvable) { setSent({ kind: 'refused', code: 'PREVIEW_CHANGED' }); return; }
      remoteApproval(await props.rpc.request(r.approveWith.method, { previewId: r.approveWith.previewId, digest: r.approveWith.digest }));
      if (!props.live(props.address)) return;
      setSent({ kind: 'done', value: true }); onDone();
    } catch (error) { setSent({ kind: 'refused', code: errorCode(error) }); }
  }, [sent.kind, r, props, onDone]);
  const notes = (
    <div className={s.stack}>
      <p className={s.note}>{say('requests.from', { plugin: r.plugin, kind: say(`requests.kind.${r.kind}`) })}</p>
      {r.site !== null && <p className={s.note}>{say('requests.site', { site: r.site, method: r.method ?? '' })}</p>}
      <p className={s.note}>{r.expiresAt === null ? say('requests.prepared', { date: day(r.preparedAt, props.language) }) : say('requests.preparedUntil', { date: day(r.preparedAt, props.language), until: day(r.expiresAt, props.language) })}</p>
      {!admin && <p className={s.note}>{say('requests.adminApproves')}</p>}
      {admin && !r.approveWith.allowed && <p className={s.note}>{say('requests.approveElsewhere')}</p>}
      <LaneSent sent={sent} done={say('requests.approved')} say={say} w={w} />
    </div>
  );
  return (
    <ToolRequestSheet language={props.language} tool={r.tool} question={r.question} receives={r.receives} after={notes} onClose={onClose}
      approve={admin && r.approveWith.allowed && sent.kind !== 'done' ? { label: say('requests.approve'), onPress: () => { void approve(); }, disabled: sent.kind === 'sending' } : undefined} />
  );
}

export function ToolRequestsPlace(props: PlaceRenderProps) {
  const w = toolsWords(props.language), say = laneSay(props.language);
  const { state, reload } = useEngine(props.rpc, REMOTE.pending, {}, pending);
  const [chosen, setChosen] = useState<PendingRequest | null>(null);
  return (
    <div className={s.stack}>
      <Screen where={w.where} title={say('requests.title')} loaded={state}>
        {(list) => (
          <div className={s.stack}>
            <Note>{say('requests.note')}</Note>
            {list.length === 0 ? <p className={s.note}>{say('requests.none')}</p> : (
              <Lines label={say('requests.title')}>
                {list.map((r) => (
                  <Line key={r.id} title={say('requests.line', { tool: r.tool, plugin: r.plugin })} notes={[say(`requests.kind.${r.kind}`), say('requests.prepared', { date: day(r.preparedAt, props.language) })]}
                    after={<Button onClick={() => setChosen(r)}>{say('requests.open')}</Button>} />
                ))}
              </Lines>
            )}
          </div>
        )}
      </Screen>
      {state.kind === 'not-built' && <Note>{say('requests.notBuilt')}</Note>}
      {chosen !== null && <RequestSheet key={chosen.id} r={chosen} props={props} w={w} say={say} onDone={reload} onClose={() => setChosen(null)} />}
    </div>
  );
}
