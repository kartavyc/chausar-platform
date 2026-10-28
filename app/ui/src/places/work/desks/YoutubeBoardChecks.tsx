// Chausar 5B2 owner checks. Original Ink controls; b-roll-finder (MIT) and FilmCraft (MIT/Apache) ideas only.
import { useState } from 'react';
import { useResource } from '../../../engine/context';
import { useT } from '../../../text';
import { Field } from '../../../parts/Field';
import { Button } from '../../../parts/Button';
import { Count } from '../../../parts/Figure';
import { Tile } from '../../../parts/Tile';
import type { YoutubeBoardBody } from '../../../../../../platform/runtime/venture/playbooks/youtube/board-core';
import type { BrollBeat } from '../../../../../../platform/runtime/venture/playbooks/youtube/broll';
import type { ClipPick } from '../../../../../../platform/runtime/venture/playbooks/youtube/clip-rules';
import type { BoardAct } from './YoutubeBoard';
import { YoutubeFinishing, YoutubeStyle } from './YoutubeMeasurements';
import s from './YoutubeDesk.module.css';

type Props = { editId: string; board: YoutubeBoardBody; act: BoardAct; busy: boolean; onFinishingDirty(value: boolean): void };
type Word = { id: string; text: string };
/** Optional local checks stay one step away from reviewing the output files. */
export function YoutubeBoardChecks(props: Props) {
  const t = useT();
  const edit = useResource('venture.desk.get', { playbook: 'youtube', kind: 'edit', id: props.editId });
  const item = edit.data?.item as { orderId: string; document: { words: Word[] } } | undefined;
  return <Tile as="section" label={t('pb-youtube-board.checks')}><details><summary>{t('pb-youtube-board.checks')}</summary>
    <Beats {...props} />
    {item && <><Clips {...props} words={item.document.words} /><Broll {...props} words={item.document.words} orderId={item.orderId} /></>}
    <YoutubeFinishing {...props} />
    <YoutubeStyle editId={props.editId} />
    <Helpers {...props} />
    <Editor {...props} />
  </details></Tile>;
}
function Beats({ board, act, busy }: Props) {
  const t = useT(), [lines, setLines] = useState(''), [rate, setRate] = useState('180'), [bucket, setBucket] = useState('4'), [loop, setLoop] = useState('');
  return <details><summary>{t('pb-youtube-board.beats')}</summary>
    <Field multiline label={t('pb-youtube-board.beatLines')} value={lines} onChange={e => setLines(e.target.value)} maxLength={100000} />
    <Field label={t('pb-youtube-board.speakingRate')} value={rate} onChange={e => setRate(e.target.value)} inputMode="numeric" />
    <label className={s.label}>{t('pb-youtube-board.bucket')}<select className={s.select} value={bucket} onChange={e => setBucket(e.target.value)}>{['4', '6', '8'].map(value => <option key={value}>{value}</option>)}</select></label>
    <Field label={t('pb-youtube-board.loop')} value={loop} onChange={e => setLoop(e.target.value)} maxLength={1000} />
    <Button disabled={busy} locked={!lines.trim() || !loop.trim()} onClick={() => void act('beats', { lines: lines.split(/\r?\n/).filter(line => line.trim()), wordsPerMinute: Number(rate), bucket: Number(bucket), loopBack: loop })}>{t('pb-youtube-board.checkBeats')}</Button>
    {board.beats && <><p>{t(board.beats.passed ? 'pb-youtube-board.beatsPass' : 'pb-youtube-board.fixFindings')}</p><ul>{board.beats.findings.map((finding, index) => <li key={index}>{t(`pb-youtube-board.finding.${finding.code}`)}</li>)}</ul><ol>{board.beats.beats.map((beat, index) => <li key={index}><span data-content="">{beat.line}</span> <Count value={beat.startMs} /> / <Count value={beat.endMs} /> {t('pb-youtube-board.milliseconds')}</li>)}</ol></>}
  </details>;
}
function WordSelect({ words, value, onChange, label }: { words: Word[]; value: string; onChange(value: string): void; label: string }) {
  const t = useT();
  return <label className={s.label}>{label}<select className={s.select} value={value} onChange={e => onChange(e.target.value)}><option value="">{t('pb-youtube-board.chooseWord')}</option>{words.map(word => <option key={word.id} value={word.id} data-content="">{word.id}: {word.text}</option>)}</select></label>;
}
function Clips({ words, board, act, busy }: Props & { words: Word[] }) {
  const t = useT(), [from, setFrom] = useState(''), [to, setTo] = useState(''), [hook, setHook] = useState(''), [first, setFirst] = useState(''), [format, setFormat] = useState('shorts'), [picks, setPicks] = useState<ClipPick[]>([]);
  return <details><summary>{t('pb-youtube-board.clips')}</summary>
    <label className={s.label}>{t('pb-youtube-board.clipFormat')}<select className={s.select} value={format} onChange={e => setFormat(e.target.value)}><option value="shorts">{t('pb-youtube-board.shorts')}</option><option value="clip">{t('pb-youtube-board.regularClip')}</option></select></label>
    <WordSelect words={words} value={from} onChange={setFrom} label={t('pb-youtube-board.firstWord')} /><WordSelect words={words} value={to} onChange={setTo} label={t('pb-youtube-board.lastWord')} />
    <Field label={t('pb-youtube-board.hook')} value={hook} onChange={e => setHook(e.target.value)} maxLength={200} /><Field label={t('pb-youtube-board.firstLine')} value={first} onChange={e => setFirst(e.target.value)} maxLength={500} />
    <p className={s.line}>{t('pb-youtube-board.clipHelp')}</p>
    <Button disabled={busy} locked={!from || !to || !hook.trim() || !first.trim() || picks.length >= 3} onClick={() => setPicks(rows => [...rows, { from, to, hook, firstLine: first, overlayMs: 2000, loopTo: from }])}>{t('pb-youtube-board.addClip')}</Button>
    <ol>{picks.map((pick, index) => <li key={index}><span data-content="">{pick.hook}</span> <Button onClick={() => setPicks(rows => rows.filter((_, i) => i !== index))}>{t('pb-youtube-board.remove')}</Button></li>)}</ol>
    <Button disabled={busy} locked={!picks.length} onClick={() => void act('clips', { picks, format })}>{t('pb-youtube-board.checkClips')}</Button>
    {board.clips && <><p>{t(board.clips.passed ? 'pb-youtube-board.clipsPass' : 'pb-youtube-board.fixFindings')}</p><ul>{board.clips.rows.flatMap(row => row.problems.map(problem => <li key={`${row.index}-${problem}`}><Count value={row.index + 1} /> {t(`pb-youtube-board.finding.${problem}`)}</li>))}</ul></>}
  </details>;
}
function Broll({ board, act, busy, words, orderId }: Props & { words: Word[]; orderId: string }) {
  const t = useT(), assets = useResource('venture.assets.list', { orderId });
  const [word, setWord] = useState(''), [asset, setAsset] = useState(''), [kind, setKind] = useState<BrollBeat['kind']>('concept');
  const [delay, setDelay] = useState('0.2'), [duration, setDuration] = useState('1.2'), [beats, setBeats] = useState<BrollBeat[]>(board.broll?.beats ?? []);
  return <details><summary>{t('pb-youtube-board.broll')}</summary>
    <WordSelect words={words} value={word} onChange={setWord} label={t('pb-youtube-board.anchorWord')} />
    <label className={s.label}>{t('pb-youtube-board.beatKind')}<select className={s.select} value={kind} onChange={e => setKind(e.target.value as BrollBeat['kind'])}>{(['concept', 'receipt', 'entity', 'meme'] as const).map(kind => <option key={kind} value={kind}>{t(`pb-youtube-board.kind.${kind}`)}</option>)}</select></label>
    {kind !== 'concept' && <label className={s.label}>{t('pb-youtube-board.asset')}<select className={s.select} value={asset} onChange={e => setAsset(e.target.value)}><option value="">{t('pb-youtube-board.chooseAsset')}</option>{assets.data?.assets.filter(asset => asset.orderId === orderId).map(asset => <option key={asset.id} value={asset.id} data-content="">{asset.name}</option>)}</select></label>}
    <Field label={t('pb-youtube-board.delay')} value={delay} inputMode="decimal" onChange={e => setDelay(e.target.value)} /><Field label={t('pb-youtube-board.duration')} value={duration} inputMode="decimal" onChange={e => setDuration(e.target.value)} />
    <Button disabled={busy} locked={!word || kind !== 'concept' && !asset} onClick={() => setBeats(rows => [...rows, { id: `beat_${crypto.randomUUID()}`, wordId: word, kind, assetId: kind === 'concept' ? null : asset, delayMs: Number(delay) * 1000, durationMs: Number(duration) * 1000 }])}>{t('pb-youtube-board.addBeat')}</Button>
    <ol>{beats.map(beat => <li key={beat.id}><span data-content="">{beat.wordId}</span> {t(`pb-youtube-board.kind.${beat.kind}`)} <Button onClick={() => setBeats(rows => rows.filter(row => row.id !== beat.id))}>{t('pb-youtube-board.remove')}</Button></li>)}</ol>
    <Button disabled={busy} locked={!beats.length} onClick={() => void act('broll-plan', { beats })}>{t('pb-youtube-board.prepareBroll')}</Button>
    {board.broll && <>
      <p>{t('pb-youtube-board.brollHelp')}</p>
      <ul>{board.broll.windows.map((window, index) => <li key={index}><span data-content="">{window.ids.join(', ')}</span> <Count value={window.startMs} /> / <Count value={window.endMs} /> {t('pb-youtube-board.milliseconds')}</li>)}</ul>
      <Button disabled={busy} locked={board.broll.approvedDigest === board.broll.digest} onClick={() => void act('broll-approve', { planDigest: board.broll!.digest })}>{t('pb-youtube-board.approveBroll')}</Button>
      <ul>{board.broll.beats.map(beat => <li key={beat.id}><span data-content="">{beat.id}</span> <Button disabled={busy} onClick={() => { setBeats(rows => rows.filter(row => row.id !== beat.id)); void act('broll-remove', { beatId: beat.id }); }}>{t('pb-youtube-board.removePermanently')}</Button></li>)}</ul>
      {board.broll.assetBindings.map(asset => <FrameGrid key={`${asset.id}:${board.grids?.[asset.id]?.digest ?? ''}`} assetId={asset.id} board={board} act={act} busy={busy} />)}
    </>}
  </details>;
}
function FrameGrid({ assetId, board, act, busy }: { assetId: string; board: YoutubeBoardBody; act: BoardAct; busy: boolean }) {
  const t = useT(), [file, setFile] = useState(''), [answers, setAnswers] = useState<Record<string, string>>({});
  const grid = board.grids?.[assetId];
  return <div className={s.notice}>
    <p data-content="">{assetId}</p><Field label={t('pb-youtube-board.gridFile')} value={file} onChange={e => setFile(e.target.value)} />
    <Button disabled={busy} locked={!file.trim() || board.broll?.approvedDigest !== board.broll?.digest} onClick={() => void act('grid', { assetId, file })}>{t('pb-youtube-board.makeGrid')}</Button>
    {grid && <><img className={s.gridImage} src={`data:image/png;base64,${grid.contentBase64}`} alt={t('pb-youtube-board.gridAlt')} /><p>{t('pb-youtube-board.noDetector')}</p>
      {['burnedCaptions', 'lowerThirds', 'watermarks'].map(key => <label key={key} className={s.label}>{t(`pb-youtube-board.question.${key}`)}<select className={s.select} value={answers[key] ?? ''} onChange={e => setAnswers(previous => ({ ...previous, [key]: e.target.value }))}><option value="">{t('pb-youtube-board.chooseAnswer')}</option><option value="yes">{t('pb-youtube-board.yes')}</option><option value="no">{t('pb-youtube-board.no')}</option></select></label>)}
      <Button disabled={busy} locked={['burnedCaptions', 'lowerThirds', 'watermarks'].some(key => !answers[key])} onClick={() => void act('grid-review', { assetId, gridDigest: grid.digest, answers: Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, value === 'yes'])) })}>{t('pb-youtube-board.confirmGrid')}</Button>
      {board.reviews?.[assetId] && <p>{t(board.reviews[assetId]!.passed ? 'pb-youtube-board.gridPass' : 'pb-youtube-board.fixFindings')}</p>}
    </>}
  </div>;
}
function Editor({ board, act, busy }: Props) {
  const t = useT(), [app, setApp] = useState('filmcraft'), [args, setArgs] = useState(''), [xml, setXml] = useState(''), [comparison, setComparison] = useState<{ index: number; before: unknown; after: unknown }[] | null>(null);
  return <><details><summary>{t('pb-youtube-board.editor')}</summary><p className={s.line}>{t('pb-youtube-board.editorHelp')}</p>
    <label className={s.label}>{t('pb-youtube-board.editorName')}<select className={s.select} value={app} onChange={e => setApp(e.target.value)}><option value="filmcraft">FilmCraft</option><option value="baocut">BaoCut</option><option value="kimo">Kimo</option></select></label>
    <Field multiline label={t('pb-youtube-board.args')} value={args} onChange={e => setArgs(e.target.value)} maxLength={4000} />
    <Button disabled={busy} onClick={() => void act('editor-command', { app, args: args.split(/\r?\n/).filter(Boolean) })}>{t('pb-youtube-board.reviewCommand')}</Button>
    {board.editorCommand && <><pre className={s.preview} data-content="">{board.editorCommand.line}</pre><Button disabled={busy} onClick={() => void act('editor-run', {})}>{t('pb-youtube-board.runCommand')}</Button></>}
  </details><details><summary>{t('pb-youtube-board.returnedXml')}</summary><p>{t('pb-youtube-board.returnedHelp')}</p>
    <Field multiline label={t('pb-youtube-board.xml')} value={xml} onChange={e => setXml(e.target.value)} maxLength={2000000} />
    <Button disabled={busy} locked={!xml.trim()} onClick={() => void act('returned-xml', { xml }).then(value => { if (value && typeof value === 'object' && 'comparison' in value) setComparison(value.comparison as typeof comparison); })}>{t('pb-youtube-board.compare')}</Button>
    {comparison && <><p><Count value={comparison.length} /> {t('pb-youtube-board.changedRanges')}</p><pre className={s.preview} data-content="">{JSON.stringify(comparison, null, 2)}</pre></>}
  </details></>;
}

function Helpers({act,busy}:Props){
  const t=useT(),[page,setPage]=useState({name:'',description:'',contentUrl:'',thumbnailUrl:'',uploadDate:''});
  const [clipIndex,setClipIndex]=useState('1');
  const [file,setFile]=useState(''),[url,setUrl]=useState(''),[audio,setAudio]=useState<{contentBase64:string;name:string}|null>(null);
  const [font,setFont]=useState('30'),[width,setWidth]=useState('1080'),[helpers,setHelpers]=useState<{counters:{wordId:string;text:string;atMs:number}[];legibility:{outcome:string;targetPx:number}}|null>(null);
  return <><details><summary>{t('pb-youtube-board.clipPage')}</summary><p>{t('pb-youtube-board.clipPageHelp')}</p>
    <label className={s.label}>{t('pb-youtube-board.clipNumber')}<select className={s.select} value={clipIndex} onChange={e=>setClipIndex(e.target.value)}>{['1','2','3'].map(value=><option key={value}>{value}</option>)}</select></label>
    {(['name','description','contentUrl','thumbnailUrl','uploadDate'] as const).map(key=><Field key={key} label={t(`pb-youtube-board.page.${key}`)} value={page[key]} onChange={e=>setPage(previous=>({...previous,[key]:e.target.value}))} maxLength={5000}/>)}
    <Button disabled={busy} locked={!page.name.trim()} onClick={()=>void act('clip-page',{clipIndex:Number(clipIndex),fields:page})}>{t('pb-youtube-board.preparePage')}</Button>
  </details><details><summary>{t('pb-youtube-board.audio')}</summary><p>{t('pb-youtube-board.audioHelp')}</p>
    <Field label={t('pb-youtube-board.audioFile')} value={file} onChange={e=>setFile(e.target.value)}/><Field label={t('pb-youtube-board.audioUrl')} value={url} onChange={e=>setUrl(e.target.value)}/>
    <Button disabled={busy} locked={!!file===!!url} onClick={()=>{setAudio(null);void act('audio',{...(file?{file}:{url})}).then(value=>{if(value&&typeof value==='object'&&'contentBase64'in value)setAudio(value as typeof audio);});}}>{t('pb-youtube-board.extractAudio')}</Button>
    {audio&&<a href={`data:audio/wav;base64,${audio.contentBase64}`} download={audio.name}>{t('pb-youtube-board.downloadAudio')}</a>}
  </details><details><summary>{t('pb-youtube-board.helpers')}</summary>
    <Field label={t('pb-youtube-board.fontPx')} value={font} inputMode="decimal" onChange={e=>setFont(e.target.value)}/><Field label={t('pb-youtube-board.frameWidth')} value={width} inputMode="numeric" onChange={e=>setWidth(e.target.value)}/>
    <Button disabled={busy} onClick={()=>void act('helpers',{fontPx:Number(font),width:Number(width)}).then(value=>{if(value&&typeof value==='object'&&'counters'in value)setHelpers(value as typeof helpers);})}>{t('pb-youtube-board.checkHelpers')}</Button>
    {helpers&&<><p>{t(`pb-youtube-board.legibility.${helpers.legibility.outcome}`)} <Count value={helpers.legibility.targetPx}/></p><p>{t('pb-youtube-board.counterHelp')}</p><ul>{helpers.counters.map(counter=><li key={counter.wordId}><span data-content="">{counter.text}</span> <Count value={counter.atMs}/> {t('pb-youtube-board.milliseconds')}</li>)}</ul></>}
  </details></>;
}
