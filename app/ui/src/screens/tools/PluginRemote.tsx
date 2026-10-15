/**
 * The plugin network door (tools/remote), over models-ext's `smallapps.plugin*Remote` methods:
 * prepare → approve exactly this → send once → read back, and the Network ledger.
 *
 * 1. Prepare (`pluginPrepareRemote {id, tool, arguments}`): the exact URL, method, body and its
 *    digest, and whether Chausar will add a key (never the key). Nothing is sent. The arguments are
 *    the person's own data, typed as JSON and sent as typed.
 * 2. Approve exactly this (owner or cofounder, `pluginApproveRemote {previewId, digest}`): the screen
 *    reads the request back first (`pluginRemotePreview`) and approves only the digest it showed.
 *    The approval is single use and lasts five minutes.
 * 3. Send once (the person who prepared it, `pluginCallRemote {previewId, approvalId}`): one press,
 *    never repeated by the screen; then it reads the request back and shows what came back as quoted
 *    outside data (an answer to a request that carried a key is never shown).
 * 4. The Network ledger (`pluginLedger`): site, method, sizes and status of every request; no bodies,
 *    keys or paths are kept.
 */
import { useCallback, useMemo, useRef, useState, type FormEvent } from 'react';
import { count } from '../../format/index.ts';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { errorCode, useEngine, useSend, type Sent } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { REMOTE, ledger, plugins, remoteApproval, remotePreview, remoteResult, remoteTools, type RemoteApproval, type RemotePreview, type RemoteResult } from './adapters/remote.ts';
import { LaneSent, laneSay, type Say } from './lane';
import { Line, Lines, Part, Quoted, day, isAdmin, toolsWords, type Words } from './shared';
import s from './Lane.module.css';

function plainObject(text: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(text);
    return v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : null;
  } catch { return null; }
}

function RequestLines({ preview, say, books }: { preview: RemotePreview; say: Say; books: boolean }) {
  return (
    <Lines label={say('remote.requests')}>
      {preview.requests.map((r, i) => (
        <Line key={i} title={say('remote.request', { method: r.method, site: r.site })}
          notes={[r.credential ? say('remote.withKey') : say('remote.noKey'), r.body === null ? say('remote.noBody') : say('remote.bodyBytes', { n: count(String(r.bodyBytes)) })]}>
          <Quoted label={say('remote.outside')}>{r.url}</Quoted>
          {r.body !== null && <Quoted label={say('remote.outside')}>{r.body}</Quoted>}
          {books && r.bodyDigest !== null && <p className={[s.note, 'fig'].join(' ')}>{r.bodyDigest}</p>}
        </Line>
      ))}
    </Lines>
  );
}

function Result({ value, props, say }: { value: RemoteResult; props: PlaceRenderProps; say: Say }) {
  const books = props.view === 'books';
  return (
    <div className={s.stack}>
      <p className={s.p} role="status">{say('remote.sent')}</p>
      {books && <p className={[s.note, 'fig'].join(' ')}>{value.receiptId}</p>}
      <Lines label={say('remote.network')}>
        {value.network.map((n, i) => <Line key={i} title={say('remote.request', { method: n.method, site: n.site })}
          notes={[n.status === null ? say('remote.noStatus') : say('remote.status', { status: String(n.status) }), say('remote.bytes', { n: count(String(n.responseBytes)) })]} />)}
      </Lines>
      {value.responses.map((r, i) => r.withheld || r.body === null
        ? <p key={i} className={s.note}>{say('remote.withheld', { site: r.site })}</p>
        : <div key={i} className={s.stack}><h3 className={s.small}>{say('remote.answer', { site: r.site })}</h3><Quoted label={say('remote.outside')}>{r.body}</Quoted></div>)}
      {value.signal !== null && (
        <p className={s.note}>{say('remote.signal', { value: String(value.signal.value) })}{' '}
          {value.signal.receiptId !== null && <Button variant="link" onClick={() => props.openReceipt(value.signal!.receiptId as string)}>{say('remote.openReceipt')}</Button>}</p>
      )}
      {value.note !== null && <p className={s.note}>{value.note}</p>}
    </div>
  );
}

/** One prepared request: approve exactly this, then send it once. */
function Door({ prepared, props, w, say, onSent }: { prepared: RemotePreview; props: PlaceRenderProps; w: Words; say: Say; onSent: () => void }) {
  const books = props.view === 'books';
  const [preview, setPreview] = useState(prepared);
  const [approval, setApproval] = useState<RemoteApproval | null>(null);
  const [approving, setApproving] = useState<Sent<true>>({ kind: 'idle' });
  const [sending, setSending] = useState<Sent<RemoteResult>>({ kind: 'idle' });
  const pressed = useRef(false);
  const admin = isAdmin(props), mine = preview.createdBy === props.member.id;

  const approve = useCallback(async () => {
    if (approving.kind === 'sending') return;
    setApproving({ kind: 'sending' });
    try {
      const back = remotePreview(await props.rpc.request(REMOTE.preview, { previewId: prepared.previewId }), props.language);
      if (back.digest !== prepared.digest || !back.approvable) { setPreview(back); setApproving({ kind: 'refused', code: 'PREVIEW_CHANGED' }); return; }
      const ok = remoteApproval(await props.rpc.request(REMOTE.approve, { previewId: prepared.previewId, digest: prepared.digest }));
      if (ok.previewId !== prepared.previewId || ok.digest !== prepared.digest) { setApproving({ kind: 'refused', code: 'PREVIEW_CHANGED' }); return; }
      setApproval(ok); setApproving({ kind: 'done', value: true });
    } catch (error) { setApproving({ kind: 'refused', code: errorCode(error) }); }
  }, [approving.kind, prepared, props]);

  const send = useCallback(async () => {
    if (pressed.current || approval === null) return;
    pressed.current = true; setSending({ kind: 'sending' });
    try {
      const result = remoteResult(await props.rpc.request(REMOTE.call, { previewId: preview.previewId, approvalId: approval.approvalId }), props.language);
      setSending({ kind: 'done', value: result });
    } catch (error) { setSending({ kind: 'refused', code: errorCode(error) }); }
    // Read back what happened, whatever the reply was; a lost reply leaves the state to this read.
    try { setPreview(remotePreview(await props.rpc.request(REMOTE.preview, { previewId: preview.previewId }), props.language)); } catch { /* the reply above already says what is known */ }
    onSent();
  }, [approval, preview.previewId, props, onSent]);

  return (
    <Group title={say('remote.prepared', { tool: preview.tool })} note={preview.words}>
      <RequestLines preview={preview} say={say} books={books} />
      <p className={s.note}>{say(`remote.state.${preview.status}`)}</p>
      <p className={[s.note, 'fig'].join(' ')}>{say('remote.digest', { digest: preview.digest })}</p>
      <p className={s.note}>{say('remote.until', { date: day(preview.expiresAt, props.language) })}</p>
      {approval === null && preview.approvable && (admin
        ? <div className={s.buttons}><Button disabled={approving.kind === 'sending'} onClick={() => { void approve(); }}>{say('remote.approve')}</Button></div>
        : <p className={s.note}>{say('remote.adminApproves')}</p>)}
      <LaneSent sent={approving} done={say('remote.approved')} say={say} w={w} />
      {approval !== null && (mine
        ? <div className={s.buttons}><Button disabled={pressed.current || sending.kind !== 'idle'} onClick={() => { void send(); }}>{say('remote.send')}</Button><span className={s.note}>{say('remote.sendOnce')}</span></div>
        : <p className={s.note}>{say('remote.preparerSends')}</p>)}
      {sending.kind === 'done' ? <Result value={sending.value} props={props} say={say} /> : <LaneSent sent={sending} say={say} w={w} />}
    </Group>
  );
}

/** The tools of one plugin that go through the network door. */
function ToolChoice({ pluginId, tool, setTool, props, w, say }: { pluginId: string; tool: string; setTool: (t: string) => void; props: PlaceRenderProps; w: Words; say: Say }) {
  const tools = useEngine(props.rpc, REMOTE.get, { id: pluginId }, remoteTools, pluginId);
  return (
    <Part loaded={tools.state} w={w}>
      {(ts) => ts.length === 0 ? <p className={s.note}>{say('remote.noTools')}</p> : (
        <label className={s.field}><span className={s.label}>{say('remote.tool')}</span>
          <select className={s.select} value={tool} onChange={(e) => setTool(e.target.value)}>
            <option value="">{say('remote.choose')}</option>
            {ts.map((t) => <option key={t.name} value={t.name} disabled={!t.runnable}>{t.runnable ? t.name : say('remote.notRunnable', { name: t.name })}</option>)}
          </select>
        </label>
      )}
    </Part>
  );
}

function Prepare({ props, w, say, onPrepared }: { props: PlaceRenderProps; w: Words; say: Say; onPrepared: (p: RemotePreview) => void }) {
  const list = useEngine(props.rpc, REMOTE.list, {}, plugins);
  const [pluginId, setPluginId] = useState('');
  const [tool, setTool] = useState('');
  const [args, setArgs] = useState('{}');
  const [problem, setProblem] = useState<string | null>(null);
  const validate = useCallback((v: unknown) => remotePreview(v, props.language), [props.language]);
  const prepare = useSend(props.rpc, validate);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = plainObject(args);
    if (pluginId === '' || tool === '') { setProblem(say('remote.pick')); return; }
    if (parsed === null) { setProblem(say('remote.badArguments')); return; }
    setProblem(null);
    const done = await prepare.send(REMOTE.prepare, { id: pluginId, tool, arguments: parsed });
    if (done !== null && props.live(props.address)) onPrepared(done);
  };
  return (
    <Part loaded={list.state} w={w}>
      {(rows) => {
        const withTools = rows.filter((r) => r.tools > 0);
        if (withTools.length === 0) return <p className={s.note}>{say('remote.noPlugins')}</p>;
        return (
          <form className={s.form} onSubmit={(e) => void submit(e)} noValidate>
            <label className={s.field}><span className={s.label}>{say('remote.plugin')}</span>
              <select className={s.select} value={pluginId} onChange={(e) => { setPluginId(e.target.value); setTool(''); }}>
                <option value="">{say('remote.choose')}</option>
                {withTools.map((p) => <option key={p.id} value={p.id}>{say('remote.pluginName', { name: p.name, publisher: p.publisherId })}</option>)}
              </select>
            </label>
            {pluginId !== '' && <ToolChoice key={pluginId} pluginId={pluginId} tool={tool} setTool={setTool} props={props} w={w} say={say} />}
            <label className={s.field}><span className={s.label}>{say('remote.arguments')}</span>
              <textarea className={s.area} value={args} spellCheck={false} autoComplete="off" onChange={(e) => setArgs(e.target.value)} />
            </label>
            <p className={s.note}>{say('remote.argumentsNote')}</p>
            {problem !== null && <p className={s.note} role="alert">{problem}</p>}
            <div><Button submit disabled={prepare.sent.kind === 'sending'}>{say('remote.prepare')}</Button></div>
            {prepare.sent.kind !== 'done' && <LaneSent sent={prepare.sent} say={say} w={w} />}
          </form>
        );
      }}
    </Part>
  );
}

function Ledger({ props, w, say, round }: { props: PlaceRenderProps; w: Words; say: Say; round: number }) {
  const validate = useMemo(() => (v: unknown) => ledger(v, props.language), [props.language]);
  const { state } = useEngine(props.rpc, REMOTE.ledger, { limit: 50 }, validate, String(round));
  return (
    <Part loaded={state} w={w}>
      {(l) => (
        <div className={s.stack}>
          <p className={s.note}>{l.words}</p>
          {l.entries.length === 0 ? <p className={s.note}>{say('remote.ledgerEmpty')}</p> : (
            <Lines label={say('remote.ledger')}>
              {l.entries.map((e) => (
                <Line key={e.id} title={say('remote.request', { method: e.method, site: e.site })}
                  notes={[say('remote.ledgerWho', { plugin: e.plugin, tool: e.tool, date: day(e.at, props.language) }),
                    say(`remote.outcome.${e.outcome}`, { status: e.status === null ? '' : String(e.status) }),
                    say('remote.ledgerBytes', { sent: count(String(e.requestBytes)), back: count(String(e.responseBytes)) }),
                    e.credential ? say('remote.withKey') : null, props.view === 'books' ? e.code : null]} />
              ))}
            </Lines>
          )}
          {l.total > l.entries.length && <p className={s.note}>{say('remote.ledgerMore', { n: count(String(l.total)) })}</p>}
        </div>
      )}
    </Part>
  );
}

export function PluginRemotePlace(props: PlaceRenderProps) {
  const w = toolsWords(props.language), say = laneSay(props.language);
  const [prepared, setPrepared] = useState<RemotePreview | null>(null);
  const [round, setRound] = useState(0);
  return (
    <Screen where={w.where} title={say('remote.title')} loaded={{ kind: 'ready', value: null }}>
      {() => (
        <div className={s.stack}>
          <Note>{say('remote.rule')}</Note>
          {props.viewer ? <Note>{w.readOnly}</Note> : (
            <Group title={say('remote.prepareTitle')} note={say('remote.prepareNote')}>
              <Prepare props={props} w={w} say={say} onPrepared={setPrepared} />
            </Group>
          )}
          {prepared !== null && <Door key={prepared.previewId} prepared={prepared} props={props} w={w} say={say} onSent={() => setRound((n) => n + 1)} />}
          <Group title={say('remote.ledger')}><Ledger props={props} w={w} say={say} round={round} /></Group>
        </div>
      )}
    </Screen>
  );
}
