/**
 * TL-06 A tool from outside: wrap (tools/wrap). Paste an Agent Skills `SKILL.md` or an MCP
 * `tools/list` result; `smallapps.pluginWrap` turns it into an unsigned plugin file and reviews it.
 * What was pasted is outside data: it is sent as typed, shown back only as quoted text, and never
 * followed. The preview comes before anything is installed: the description the tool sent beside
 * what Chausar checked (each part, each door, each refusal, in Chausar's own words). Install sends
 * back exactly the reviewed document (`smallapps.pluginInstall`); an unsigned file needs an owner
 * to accept an unverified publisher, and any code stays off until enabled by its exact digest.
 */
import { useCallback, useState, type FormEvent } from 'react';
import type { PlaceRenderProps } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { Choice, YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { useSend } from '../trust/kit/engine.ts';
import { Group, Note, Screen } from '../trust/kit/Screen';
import { REMOTE, installed, wrapPreview, type WrapPreview } from './adapters/remote.ts';
import { LaneSent, laneSay, type Say } from './lane';
import { Line, Lines, Names, Quoted, Warn, toolsWords, type Words } from './shared';
import s from './Lane.module.css';

type Kind = 'agentSkill' | 'mcpServer';
const PUBLISHER = /^[a-z0-9][a-z0-9.-]{0,99}$/;
const PASTE_MAX = 1024 * 1024, SHOWN_MAX = 4000;

function Preview({ value, pasted, props, w, say }: { value: WrapPreview; pasted: string; props: PlaceRenderProps; w: Words; say: Say }) {
  const install = useSend(props.rpc, installed);
  const [accept, setAccept] = useState(false);
  const owner = !props.viewer && props.member.role === 'owner';
  const unverified = value.signature !== 'verified';
  const books = props.view === 'books';
  return (
    <Group title={say('wrap.preview')} note={say('wrap.previewNote')}>
      <p className={s.p}>{say('wrap.names', { name: value.name, version: value.version, publisher: value.publisher })}</p>
      <p className={s.note}>{value.signatureWords}</p>
      {value.support === 'experimental' && <p className={s.note}>{say('wrap.experimental', { reasons: value.experimentalReasons.join(', ') })}</p>}
      {books && <p className={[s.note, 'fig'].join(' ')}>{value.digest}</p>}
      <div className={s.side}>
        <div className={s.stack}>
          <h3 className={s.small}>{say('wrap.ours')}</h3>
          <Lines label={say('wrap.ours')}>
            {value.items.map((i, n) => <Line key={`i${n}`} title={say('wrap.item', { kind: i.kind, name: i.name })} notes={[i.words]} />)}
            {value.doors.map((d, n) => <Line key={`d${n}`} title={say(`wrap.door.${d.status === 'never' ? 'never' : d.status === 'refused' ? 'refused' : 'after'}`, { door: d.door })} notes={[d.words]}>
              {d.subject !== null && <Quoted label={say('wrap.outside')}>{d.subject}</Quoted>}
            </Line>)}
          </Lines>
        </div>
        <div className={s.stack}>
          <h3 className={s.small}>{say('wrap.theirs')}</h3>
          {value.description === '' ? <p className={s.note}>{w.none}</p> : <Quoted label={say('wrap.outside')}>{value.description}</Quoted>}
          <p className={s.note}>{say('wrap.theirsNote')}</p>
        </div>
      </div>
      {(value.refusals.length > 0 || value.refused.length > 0) && (
        <>
          <h3 className={s.small}>{say('wrap.refusals')}</h3>
          <Lines label={say('wrap.refusals')}>
            {value.refusals.map((f, n) => <Line key={`f${n}`} title={f.words} notes={[books ? f.code : null]}>{f.subject !== null && <Quoted label={say('wrap.outside')}>{f.subject}</Quoted>}</Line>)}
            {value.refused.map((f, n) => <Line key={`r${n}`} title={f.words} notes={[books ? f.code : null]}>{f.path !== '' && <Quoted label={say('wrap.outside')}>{f.path}</Quoted>}</Line>)}
          </Lines>
        </>
      )}
      {value.ignoredFields.length > 0 && <><h3 className={s.small}>{say('wrap.ignored')}</h3><Names names={value.ignoredFields} w={w} /></>}
      <h3 className={s.small}>{say('wrap.pasted')}</h3>
      <Quoted label={say('wrap.outside')}>{pasted.length > SHOWN_MAX ? pasted.slice(0, SHOWN_MAX) : pasted}</Quoted>
      {pasted.length > SHOWN_MAX && <p className={s.note}>{say('wrap.pastedCut')}</p>}
      {!value.installable ? <Warn>{say('wrap.notInstallable')}</Warn> : !owner ? <Note>{say('wrap.ownerInstalls')}</Note> : (
        <div className={s.form}>
          {unverified && <YesNo label={say('wrap.acceptUnverified')} value={accept} onChange={setAccept} disabled={install.sent.kind === 'sending'} />}
          {unverified && <p className={s.note}>{say('wrap.acceptUnverifiedNote')}</p>}
          <div><Button disabled={install.sent.kind === 'sending' || install.sent.kind === 'done' || (unverified && !accept)}
            onClick={() => { void install.send(REMOTE.install, unverified ? { document: value.document, acceptUnverifiedPublisher: true } : { document: value.document }); }}>{say('wrap.install')}</Button></div>
          <LaneSent sent={install.sent} done={say('wrap.installed')} say={say} w={w} />
        </div>
      )}
    </Group>
  );
}

function WrapBody({ props, w, say }: { props: PlaceRenderProps; w: Words; say: Say }) {
  const [kind, setKind] = useState<Kind>('agentSkill');
  const [publisher, setPublisher] = useState('');
  const [name, setName] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [pasted, setPasted] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sentText, setSentText] = useState('');
  const validate = useCallback((v: unknown) => wrapPreview(v, props.language), [props.language]);
  const wrap = useSend(props.rpc, validate);
  if (props.viewer) return <Note>{w.readOnly}</Note>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!PUBLISHER.test(publisher.trim())) { setProblem(say('wrap.badPublisher')); return; }
    if (version.trim() === '' || version.length > 100) { setProblem(say('wrap.badVersion')); return; }
    if (kind === 'mcpServer' && name.trim() === '') { setProblem(say('wrap.badName')); return; }
    if (pasted.trim() === '' || pasted.length > PASTE_MAX) { setProblem(say('wrap.badPaste')); return; }
    setProblem(null); setSentText(pasted);
    const payload: Record<string, unknown> = kind === 'agentSkill'
      ? { kind, publisherId: publisher.trim(), version: version.trim(), skillMd: pasted, ...(name.trim() === '' ? {} : { name: name.trim() }) }
      : { kind, publisherId: publisher.trim(), name: name.trim(), version: version.trim(), toolsList: pasted };
    void wrap.send(REMOTE.wrap, payload);
  };
  return (
    <>
      <Group title={say('wrap.paste')} note={say('wrap.pasteNote')}>
        <form className={s.form} onSubmit={submit} noValidate>
          <Choice<Kind> label={say('wrap.kind')} value={kind} onChange={setKind}
            options={[{ value: 'agentSkill', label: say('wrap.kind.skill') }, { value: 'mcpServer', label: say('wrap.kind.mcp') }]} />
          <Field label={say('wrap.publisher')} value={publisher} maxLength={100} autoComplete="off" spellCheck={false} onChange={(e) => setPublisher(e.target.value)} />
          <Field label={kind === 'mcpServer' ? say('wrap.name') : say('wrap.nameOptional')} value={name} maxLength={100} autoComplete="off" onChange={(e) => setName(e.target.value)} />
          <Field label={say('wrap.version')} value={version} maxLength={100} autoComplete="off" onChange={(e) => setVersion(e.target.value)} />
          <label className={s.field}>
            <span className={s.label}>{kind === 'mcpServer' ? say('wrap.pasteMcp') : say('wrap.pasteSkill')}</span>
            <textarea className={s.area} value={pasted} spellCheck={false} autoComplete="off" onChange={(e) => setPasted(e.target.value)} />
          </label>
          {problem !== null && <p className={s.note} role="alert">{problem}</p>}
          <div><Button submit disabled={wrap.sent.kind === 'sending'}>{say('wrap.go')}</Button></div>
          {wrap.sent.kind !== 'done' && <LaneSent sent={wrap.sent} say={say} w={w} />}
        </form>
      </Group>
      {wrap.sent.kind === 'done' && <Preview key={wrap.sent.value.digest} value={wrap.sent.value} pasted={sentText} props={props} w={w} say={say} />}
    </>
  );
}

export function WrapPlace(props: PlaceRenderProps) {
  const w = toolsWords(props.language), say = laneSay(props.language);
  return (
    <Screen where={w.where} title={say('wrap.title')} loaded={{ kind: 'ready', value: null }}>
      {() => <WrapBody props={props} w={w} say={say} />}
    </Screen>
  );
}
