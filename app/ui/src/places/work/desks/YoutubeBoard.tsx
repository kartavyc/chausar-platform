// Chausar 5B2 review board. Tomada (AGPL) interaction idea only; original Ink implementation.
import { useEffect, useId, useState } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError } from '../../../engine/types';
import { useT } from '../../../text';
import { Button } from '../../../parts/Button';
import { Count } from '../../../parts/Figure';
import { Field } from '../../../parts/Field';
import { Tile, TileHead } from '../../../parts/Tile';
import type { BoardOutput, YoutubeBoardBody } from '../../../../../../platform/runtime/venture/playbooks/youtube/board-core';
import s from './YoutubeDesk.module.css';
import { YoutubeBoardChecks } from './YoutubeBoardChecks';

type BoardView = { id: string; orderId: string; digest: string; board: YoutubeBoardBody | null };
export type BoardAct = (action: string, payload: Record<string, unknown>) => Promise<unknown>;
const platforms = ['youtube', 'instagram', 'tiktok'] as const;
/** Engine refusals are translated here; technical tool output stays in an explicit quoted detail. */
export function boardError(error: unknown, t: ReturnType<typeof useT>) {
  const code = error instanceof EngineError ? error.code : 'REQUEST_FAILED';
  const key = `pb-youtube-board.error.${code}`;
  const words = t(key);
  return words === key ? t('pb-youtube-board.error.REQUEST_FAILED') : words;
}
/** Review generated files and their exact publishing words before the desktop writes anything. */
export function YoutubeBoard({ editId }: { editId: string }) {
  const t = useT(), client = useEngine(), id = useId();
  const resource = useResource('venture.desk.get', { playbook: 'youtube', kind: 'board', id: editId });
  const [current, setCurrent] = useState<BoardView | null>(null), [rate, setRate] = useState('25');
  const [publishing, setPublishing] = useState({ youtube: '', instagram: '', tiktok: '' });
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [finishingDirty, setFinishingDirty] = useState(false);
  const [dirty, setDirty] = useState<Record<string, boolean>>({});
  const [saved, setSaved] = useState<{ savedId: string; folder: string } | null>(null);
  const item = current ?? resource.data?.item as BoardView | undefined;
  const board = item?.board;
  const outputDecision = !!board && board.outputs.every(output => output.decision !== 'pending') && board.outputs.some(output => output.decision === 'approved');
  const canSave = outputDecision && !finishingDirty && !Object.values(dirty).some(Boolean);
  const act: BoardAct = async (action, payload) => {
    if (!item || busy) return;
    setBusy(true); setError(null); setSaved(null);
    try {
      const answer = await client.request('venture.desk.act', { playbook: 'youtube', kind: 'board', id: editId, action, payload, digest: item.digest });
      if (answer.result && typeof answer.result === 'object' && 'board' in answer.result) setCurrent(answer.result as BoardView);
      else { setCurrent(null); resource.reload(); }
      return answer.result;
    } catch (error) { setError(boardError(error, t)); if (error instanceof EngineError && ['APPROVAL_STALE', 'LOCAL_APP_NOT_FOUND', 'TIER_UNAVAILABLE'].includes(error.code)) { setCurrent(null); resource.reload(); } }
    finally { setBusy(false); }
  };
  async function save() {
    if (!item || !canSave || busy || !client.saveYoutubeProject) return;
    setBusy(true); setError(null);
    try { setSaved(await client.saveYoutubeProject(editId, item.digest)); }
    catch (error) { setError(boardError(error, t)); }
    finally { setBusy(false); }
  }
  if (!item) return <p role="status">{resource.error ? boardError(resource.error, t) : t('pb-youtube.loading')}</p>;
  return <div className={s.body}>
    <Tile as="section" label={t('pb-youtube-board.title')}>
      <TileHead title={t('pb-youtube-board.title')} />
      <p className={s.line}>{t('pb-youtube-board.handoff')}</p>
      <details open={!board}><summary>{t('pb-youtube-board.prepare')}</summary>
        <label className={s.label} htmlFor={`${id}-rate`}>{t('pb-youtube-board.rate')}</label>
        <select id={`${id}-rate`} className={s.select} value={rate} onChange={event => setRate(event.target.value)}><option value="25">25</option><option value="30">30</option><option value="29.97df">29.97 DF</option></select>
        {platforms.map(platform => <Field key={platform} multiline label={t(`pb-youtube-board.publish.${platform}`)} value={publishing[platform]} onChange={event => setPublishing(words => ({ ...words, [platform]: event.target.value }))} maxLength={50000} />)}
        <p className={s.line}>{t('pb-youtube-board.optionalPlatforms')}</p>
        <Button variant="primary" disabled={busy} locked={!Object.values(publishing).some(text => text.trim())} onClick={() => { setDirty({}); void act('prepare', { rate: rate === '29.97df' ? rate : Number(rate), publishing: platforms.filter(platform => publishing[platform].trim()).map(platform => ({ platform, text: publishing[platform] })) }); }}>{t('pb-youtube-board.prepare')}</Button>
      </details>
      {!client.saveYoutubeProject && <p>{t('pb-youtube-board.desktop')}</p>}
      {error && <p role="alert">{error}</p>}
    </Tile>
    {board?.outputs.map(output => <OutputCard key={output.id} output={output} busy={busy} act={act} onDirty={value => setDirty(previous => previous[output.id] === value ? previous : { ...previous, [output.id]: value })} />)}
    {board && <YoutubeBoardChecks editId={editId} board={board} act={act} busy={busy} onFinishingDirty={setFinishingDirty} />}
    {board && <Tile as="section" label={t('pb-youtube-board.save')}>
      <p className={s.line}>{t('pb-youtube-board.saveHelp')}</p>
      <Button variant="primary" disabled={busy} locked={!canSave || !client.saveYoutubeProject} onClick={() => void save()}>{t('pb-youtube-board.save')}</Button>
      {saved && <><p data-content="">{saved.folder}</p><Button disabled={busy} onClick={() => { setBusy(true); void client.openYoutubeProject?.(saved.savedId).catch(error => setError(boardError(error, t))).finally(() => setBusy(false)); }}>{t('pb-youtube-board.open')}</Button></>}
    </Tile>}
  </div>;
}

function OutputCard({ output, busy, act, onDirty }: { output: BoardOutput; busy: boolean; act: BoardAct; onDirty(value: boolean): void }) {
  const t = useT(), [text, setText] = useState(output.text), [request, setRequest] = useState('');
  useEffect(() => { setText(output.text); onDirty(false); }, [output.text]);
  const changed = text !== output.text;
  return <Tile as="section" label={output.path}>
    <div data-content=""><TileHead title={output.path} /></div>
    <p>{t(`pb-youtube-board.state.${output.decision}`)}</p>
    {output.publishing ? <>
      <Field multiline label={t('pb-youtube-board.publishing')} value={text} onChange={event => { setText(event.target.value); onDirty(event.target.value !== output.text); }} maxLength={50000} />
      <p><Count value={output.publishing.count} /> / <Count value={output.publishing.limit} /> {t(`pb-youtube-board.unit.${output.publishing.unit}`)}</p>
      <p className={s.line}>{t('pb-youtube-board.countHelp')}</p>
      <Button disabled={busy} locked={!changed} onClick={() => void act('publishing', { outputId: output.id, text })}>{t('pb-youtube-board.saveText')}</Button>
    </> : <details><summary>{t('pb-youtube-board.preview')}</summary><pre className={s.preview} data-content="">{output.text}</pre></details>}
    <div className={s.actions}><Button variant="primary" disabled={busy} locked={changed || output.decision === 'approved' || output.publishing?.passed === false} onClick={() => void act('decide', { outputId: output.id, decision: 'approved' })}>{t('pb-youtube-board.approve')}</Button><Button disabled={busy} locked={changed || output.decision === 'discarded'} onClick={() => void act('decide', { outputId: output.id, decision: 'discarded' })}>{t('pb-youtube-board.discard')}</Button></div>
    <details><summary>{t('pb-youtube-board.change')}</summary><Field multiline label={t('pb-youtube-board.describe')} value={request} onChange={event => setRequest(event.target.value)} maxLength={1000} /><p className={s.line}>{t('pb-youtube-board.requestHelp')}</p><Button disabled={busy} locked={!request.trim() || changed} onClick={() => void act('request', { outputId: output.id, words: request })}>{t('pb-youtube-board.keepRequest')}</Button></details>
    {output.request && <p data-content="">{output.request}</p>}
  </Tile>;
}
