/**
 * TR-11 Sharing, with TR-14 (what the paid plan can see) and TR-15 (the privacy notice and
 * your agreements) as groups. Sharing is drawn over learning-ext through adapters/learning.ts:
 * whether sharing is open and on, the boxes, the exact file that would be sent (agree and
 * share it once), what I shared with Open and Delete per batch, the running line, credits
 * under a public name or none, the learning log, and the local cleaner with its outbox.
 * `trustx.sharing` is read only for the date sharing was withdrawn, which learning-ext does
 * not keep. Nothing here is uploaded unless the owner agrees to an exact file.
 */
import { useState, useId, type ChangeEvent, type FormEvent } from 'react';
import { withSheet } from '../../app/routes.ts';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { YesNo } from '../../parts/Choice';
import { Field } from '../../parts/Field';
import { Sheet } from '../../parts/Sheet';
import { State } from '../../patterns/States';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen, screenState } from './kit/Screen';
import { AskTwice, Loads, Outcome, Pending, Refusal, Tag, bytesText, countText, dayText, powers, useClose, type P } from './common';
import {
  LEARNING, PUBLIC_NAME, SAMPLE_LIMIT, batches, oneBatch, cleaned, consent, credited, intakeStatus, logPage, outbox, preview, switched, withdrawn,
  type Batch, type Batches, type IntakeStatus, type Sample, type SharePreview,
} from './adapters/learning.ts';
import { validateAgreements, validateHosted, validateSharing, type Agreements, type Hosted } from './validate.ts';
import { COMMON, SHARING, codeWord, fill } from './words.ts';
import s from './Trust.module.css';

type W = Readonly<Record<keyof typeof SHARING.en, string>>;

export function SharingScreen(p: P) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  const { state, reload } = useEngine(p.rpc, LEARNING.status, {}, intakeStatus);
  const hosted = useEngine(p.rpc, 'trustx.hosted', {}, validateHosted);
  const agreements = useEngine(p.rpc, 'trustx.agreements', {}, validateAgreements);
  const { admin } = powers(p);
  return (
    <>
      <Screen where={c.whereSharing} title={c.sharing} loaded={state}>
        {(st) => (
          <>
            <SwitchGroup p={p} st={st} reload={reload} />
            <Boxes p={p} st={st} />
            {admin ? <Shared p={p} /> : <Group title={w.batchesTitle}><p className={s.quiet}>{w.sharedAdmin}</p></Group>}
            <Log p={p} />
            <Cleaner p={p} />
            <Loads title={w.hostedTitle} loaded={hosted.state}>{(h) => <HostedBody p={p} h={h} />}</Loads>
            <Loads title={w.agreementsTitle} loaded={agreements.state}>{(a) => <AgreementsBody p={p} a={a} reload={agreements.reload} />}</Loads>
          </>
        )}
      </Screen>
      {p.address.sheet !== undefined && admin && <BatchSheet p={p} batchId={p.address.sheet} />}
    </>
  );
}

/** Open or closed, on or off; the owner turns it on, or withdraws it after asking twice. */
function SwitchGroup({ p, st, reload }: { p: P; st: IntakeStatus; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  const { owner } = powers(p);
  // Only for the withdrawn date: learning-ext keeps no date of its own.
  const old = useEngine(p.rpc, 'trustx.sharing', {}, validateSharing);
  const on = useSend(p.rpc, switched);
  const off = useSend(p.rpc, withdrawn);
  const turnOn = async () => { if (await on.send(LEARNING.switch, { enabled: true }) !== null && p.live(p.address)) reload(); };
  const withdraw = async () => { if (await off.send(LEARNING.withdraw, {}) !== null && p.live(p.address)) reload(); };
  const withdrawnAt = old.state.kind === 'ready' ? old.state.value.withdrawnAt : null;
  const busy = on.sent.kind === 'sending' || off.sent.kind === 'sending';
  return (
    <>
      <Group title={c.sharing}>
        <p className={s.text}>{st.on ? w.on : w.off}</p>
        <p className={s.text} data-intake={st.mode}>{st.mode === 'closed' ? w.notOpen : st.mode === 'test-inbox' ? w.testInbox : w.intakeOpen}</p>
        {withdrawnAt !== null && !st.on && <p className={s.quiet}>{fill(w.withdrawn, { date: dayText(withdrawnAt, p.language) })}</p>}
        {owner && !st.on && <span><Button variant="quiet" onClick={() => void turnOn()} disabled={busy}>{w.turnOn}</Button></span>}
        {owner && !st.on && <p className={s.quiet}>{w.turnOnAsk}</p>}
        {owner && st.on && (
          <span><AskTwice label={w.withdraw} ask={w.withdrawAsk} confirmLabel={w.withdrawConfirm} onConfirm={() => void withdraw()} language={p.language} disabled={busy} /></span>
        )}
        {!owner && <Note>{c.ownerOnly}</Note>}
        <Outcome sent={on.sent} language={p.language} />
        {off.sent.kind === 'done' ? <p className={s.status} role="status">{fill(w.withdrawDone, { n: countText(off.sent.value.withdrawnConsents) })}</p> : <Outcome sent={off.sent} language={p.language} />}
      </Group>
      <Pending p={p} what={['sharing']} round={0} onConfirmed={reload} />
    </>
  );
}

/** The boxes with their state; an admin ticks the open ones, sees the exact file, and agrees to share it once. */
function Boxes({ p, st }: { p: P; st: IntakeStatus }) {
  const w = words(SHARING, p.language);
  const { admin } = powers(p);
  const shown = st.boxes.filter((b) => b.shown);
  const [chosen, setChosen] = useState<readonly string[]>(() => st.boxes.filter((b) => b.open).map((b) => b.box));
  const [problem, setProblem] = useState(false);
  const look = useSend(p.rpc, preview);
  const show = async () => {
    const boxes = chosen.filter((x) => st.boxes.some((b) => b.open && b.box === x));
    if (boxes.length === 0) { setProblem(true); return; }
    setProblem(false);
    await look.send(LEARNING.preview, { boxes });
  };
  const name = (box: string) => codeWord(w, 'box', box);
  return (
    <Group title={w.boxesTitle}>
      <ul className={s.list}>
        {shown.map((b) => (
          <li key={b.box} className={s.item} data-box={b.box}>
            <span className={s.itemHead}>
              <span className={s.name}>{name(b.box)}</span>
              {admin && b.open && <YesNo label={fill(w.boxLabel, { box: name(b.box) })} value={chosen.includes(b.box)}
                onChange={(yes) => setChosen((now) => (yes ? [...now.filter((x) => x !== b.box), b.box] : now.filter((x) => x !== b.box)))} />}
            </span>
            <span className={s.quiet}>{b.open ? w.boxOpen : w.boxClosed}</span>
          </li>
        ))}
      </ul>
      {!admin && <p className={s.quiet}>{w.previewAdmin}</p>}
      {admin && <span><Button variant="quiet" onClick={() => void show()} disabled={look.sent.kind === 'sending'}>{w.showFile}</Button></span>}
      {problem && <p className={s.problem}>{w.noBox}</p>}
      {look.sent.kind === 'refused' && <Refusal code={look.sent.code} language={p.language} />}
      {look.sent.kind === 'done' && <File p={p} st={st} file={look.sent.value} />}
    </Group>
  );
}

/** The exact file, its blocked lines, and Agree: consent to its digest, then send it once. */
function File({ p, st, file }: { p: P; st: IntakeStatus; file: SharePreview }) {
  const w = words(SHARING, p.language);
  const agree = useSend(p.rpc, consent);
  const share = useSend(p.rpc, oneBatch);
  const go = async () => {
    const agreed = await agree.send(LEARNING.consent, { previewId: file.id, digest: file.digest });
    if (agreed !== null && p.live(p.address)) await share.send(LEARNING.submit, { consentId: agreed.id });
  };
  const busy = agree.sent.kind === 'sending' || share.sent.kind === 'sending';
  return (
    <div className={s.stack} data-share-file="">
      <h3 className={s.label}>{w.previewTitle}</h3>
      <p className={s.text}>{fill(w.fileLine, { bytes: bytesText(file.size, p.language), events: countText(file.count), names: countText(file.names), amounts: countText(file.amounts) })}</p>
      {p.view === 'books' && <p className={s.mono}>{file.digest}</p>}
      <p className={s.quiet}>{w.fileNote}</p>
      <pre className={s.pre} data-share-bytes="">{file.bytes}</pre>
      {file.blocked.length > 0 ? (
        <>
          <p className={s.problem} role="status" data-blocked="">{w.blocked}</p>
          <ul className={s.list}>{file.blocked.map((b, i) => <li key={i} className={s.item}>{fill(w.blockedLine, { line: countText(b.line), kind: codeWord(w, 'value', b.code, b.code) })}</li>)}</ul>
        </>
      ) : !st.open ? <p className={s.text}>{w.notOpen}</p> : !st.on ? <p className={s.text}>{w.needOn}</p> : share.sent.kind !== 'done' && (
        <>
          <p className={s.quiet}>{w.agreeNote}</p>
          <span><Button onClick={() => void go()} disabled={busy}>{w.agree}</Button></span>
        </>
      )}
      {agree.sent.kind === 'refused' && <Refusal code={agree.sent.code} language={p.language} />}
      {share.sent.kind === 'refused' && <Refusal code={share.sent.code} language={p.language} />}
      {share.sent.kind === 'done' && <p className={s.status} role="status">{fill(w.sharedAs, { status: w[`status.${share.sent.value.status}`] })}</p>}
    </div>
  );
}

/** What I shared: each batch with Open and Delete, the running line, and credits. */
function Shared({ p }: { p: P }) {
  const w = words(SHARING, p.language);
  const { state, reload } = useEngine(p.rpc, LEARNING.batches, {}, batches);
  return (
    <>
      <Loads title={w.batchesTitle} loaded={state}>{(b) => <BatchList p={p} b={b} reload={reload} />}</Loads>
      {state.kind === 'ready' && <Credits p={p} b={state.value} reload={reload} />}
    </>
  );
}

function BatchList({ p, b, reload }: { p: P; b: Batches; reload: () => void }) {
  const w = words(SHARING, p.language);
  const del = useSend(p.rpc, oneBatch);
  const settle = useSend(p.rpc, oneBatch);
  const act = async (which: typeof del, method: string, batchId: string) => { if (await which.send(method, { batchId }) !== null && p.live(p.address)) reload(); };
  return (
    <div className={s.stack}>
      {b.items.length === 0 ? <p className={s.quiet}>{w.batchesNone}</p> : (
        <ul className={s.list}>
          {b.items.map((x) => (
            <li key={x.id} className={s.item} data-batch={x.id}>
              <span className={s.itemHead}>
                <span>{dayText(x.at, p.language)}</span>
                <span className={s.quiet}>{fill(w.batchLine, { size: bytesText(x.size, p.language), events: countText(x.count) })}</span>
                <span>{w[`status.${x.status}`]}</span>
                {x.mode === 'test-inbox' && <Tag>{w.testInboxTag}</Tag>}
              </span>
              {p.view === 'books' && <span className={s.mono}>{x.id} · {x.digest}{x.refusal !== null ? ` · ${x.refusal}` : ''}</span>}
              <span className={s.line}>
                <Button variant="link" onClick={() => p.navigate(withSheet(p.address, x.id))}>{w.open}</Button>
                {x.status === 'unknown' && <Button variant="quiet" onClick={() => void act(settle, LEARNING.settle, x.id)} disabled={settle.sent.kind === 'sending'}>{w.settle}</Button>}
                {(x.status === 'sent' || x.status === 'unknown') && (
                  <AskTwice label={w.deleteBatch} ask={w.deleteAsk} confirmLabel={w.deleteBatch} onConfirm={() => void act(del, LEARNING.deleteBatch, x.id)} language={p.language} disabled={del.sent.kind === 'sending'} />
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className={s.text} data-running="">{fill(w.running, { events: countText(b.shared.events), names: countText(b.shared.names), amounts: countText(b.shared.amounts) })}</p>
      <Outcome sent={del.sent} language={p.language} />
      <Outcome sent={settle.sent} language={p.language} />
    </div>
  );
}

/** Credits go under a public name, or under none. */
function Credits({ p, b, reload }: { p: P; b: Batches; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  const [typed, setTyped] = useState(b.credits.publicName ?? '');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend(p.rpc, credited);
  const save = async (publicName: string | null) => { if (await send(LEARNING.creditName, { publicName }) !== null && p.live(p.address)) reload(); };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const name = typed.trim();
    if (!PUBLIC_NAME.test(name)) { setProblem(w.badName); return; }
    setProblem(undefined); void save(name);
  };
  return (
    <Group title={w.creditsTitle}>
      <p className={s.text}>{b.credits.publicName === null ? w.creditsNone : fill(w.creditsAs, { name: b.credits.publicName })}</p>
      {b.credits.latest !== null && <p className={s.quiet}>{fill(w.creditsLatest, { n: countText(b.credits.latest) })}</p>}
      <form className={s.form} onSubmit={submit}>
        <Field label={w.publicName} value={typed} onChange={(e) => setTyped(e.currentTarget.value)} maxLength={40} autoComplete="off" problem={problem} />
        <Button submit disabled={sent.kind === 'sending'}>{c.save}</Button>
        {b.credits.publicName !== null && <Button variant="link" onClick={() => { setTyped(''); void save(null); }}>{w.clearName}</Button>}
      </form>
      <Outcome sent={sent} language={p.language} />
    </Group>
  );
}

/** One batch: the exact file that was sent, as text. */
function BatchSheet({ p, batchId }: { p: P; batchId: string }) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  const close = useClose(p);
  const { state } = useEngine(p.rpc, LEARNING.batch, { batchId }, oneBatch, batchId);
  return (
    <Sheet kind={c.sheetDetail} title={w.batchTitle} onClose={close} origin={null}>
      {state.kind !== 'ready' ? <State state={screenState(state)} /> : <BatchBody p={p} x={state.value} w={w} />}
    </Sheet>
  );
}
function BatchBody({ p, x, w }: { p: P; x: Batch; w: W }) {
  return (
    <div className={s.stack}>
      <p className={s.text}>{dayText(x.at, p.language)} · {fill(w.batchLine, { size: bytesText(x.size, p.language), events: countText(x.count) })} · {w[`status.${x.status}`]}</p>
      {p.view === 'books' && <p className={s.mono}>{x.digest}</p>}
      <span className={s.label}>{w.batchBytes}</span>
      {x.bytes === null || x.bytes.length === 0 ? <p className={s.quiet}>{w.batchGone}</p> : <pre className={s.pre} data-batch-bytes="">{x.bytes}</pre>}
    </div>
  );
}

/** The learning log: each decision as its kind and choice, never a name or a value. */
function Log({ p }: { p: P }) {
  const w = words(SHARING, p.language);
  const { state } = useEngine(p.rpc, LEARNING.log, { limit: 20 }, logPage);
  return (
    <Loads title={w.logTitle} note={w.logNote} loaded={state}>
      {(log) => log.items.length === 0 ? <p className={s.quiet}>{w.logNone}</p> : (
        <>
          <ul className={s.list} data-log="">
            {log.items.map((d) => (
              <li key={d.id} className={s.item}>
                <span className={s.itemHead}>
                  <span>{fill(w.logLine, { kind: codeWord(w, 'kind', d.kind), choice: codeWord(w, 'choice', d.choice) })}</span>
                  <span className={s.quiet}>{dayText(d.at, p.language)}</span>
                </span>
                {p.view === 'books' && <span className={s.mono}>{d.id}{d.reason !== null ? ` · ${d.reason}` : ''}</span>}
              </li>
            ))}
          </ul>
          <p className={s.quiet}>{fill(w.logTotal, { shown: countText(log.items.length), total: countText(log.total) })}</p>
        </>
      )}
    </Loads>
  );
}

/** The local cleaner over learning-ext: paste or choose a CSV sample; the cleaned copy stays in the outbox. */
function Cleaner({ p }: { p: P }) {
  const w = words(SHARING, p.language);
  const id = useId();
  const [text, setText] = useState('');
  const [label, setLabel] = useState<string | undefined>(undefined);
  const [original, setOriginal] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend<Sample>(p.rpc, cleaned);
  const box = useEngine(p.rpc, LEARNING.outbox, {}, outbox, String(sent.kind === 'done' ? sent.value.id : ''));
  if (p.viewer) return <Group title={w.cleanerTitle}><p className={s.quiet}>{w.cleanerViewer}</p></Group>;
  const pick = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    if (file === undefined) return;
    if (file.size > SAMPLE_LIMIT) { setProblem(w.tooLarge); return; }
    setProblem(undefined); setText(await file.text()); setLabel(file.name.slice(0, 120));
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length === 0) { setProblem(w.emptySample); return; }
    if (text.length > SAMPLE_LIMIT) { setProblem(w.tooLarge); return; }
    setProblem(undefined);
    const sample = text;
    if (await send(LEARNING.clean, label === undefined ? { content: sample } : { content: sample, label }) !== null) setOriginal(sample);
  };
  return (
    <Group title={w.cleanerTitle} note={w.nothingUploaded}>
      <form className={s.stack} onSubmit={(e) => void submit(e)}>
        <label htmlFor={id} className={s.label}>{w.sample}</label>
        <textarea id={id} className={s.textarea} value={text} onChange={(e) => { setText(e.currentTarget.value); setLabel(undefined); }} spellCheck={false} />
        <label className={s.label}>{w.pickSample} <input type="file" accept=".csv,text/csv,text/plain" onChange={(e) => void pick(e)} /></label>
        {problem !== undefined && <p className={s.problem}>{problem}</p>}
        <span><Button submit disabled={sent.kind === 'sending'}>{w.clean}</Button></span>
      </form>
      {sent.kind === 'refused' && <Refusal code={sent.code} language={p.language} />}
      {sent.kind === 'done' && original !== null && (
        <div className={s.stack}>
          {sent.value.status === 'blocked' && <p className={s.problem} role="status">{w.sampleBlocked}</p>}
          <div className={s.split}>
            <div className={s.stack}><span className={s.label}>{w.original}</span><pre className={s.pre} data-original="">{original}</pre></div>
            <div className={s.stack}><span className={s.label}>{w.cleaned}</span><pre className={s.pre} data-cleaned="">{sent.value.cleaned}</pre></div>
          </div>
          {sent.value.hits.length === 0 ? <p className={s.quiet}>{w.noHits}</p> : (
            <ul className={s.list} data-hits="">
              {sent.value.hits.map((h, i) => <li key={i} className={s.item}>{fill(w.hit, { line: countText(h.line), column: h.column, kind: codeWord(w, 'value', h.code, h.code) })}</li>)}
            </ul>
          )}
          <p className={s.status}>{w.nothingUploaded}</p>
        </div>
      )}
      <h3 className={s.label}>{w.outboxTitle}</h3>
      {box.state.kind !== 'ready' ? <State state={screenState(box.state)} /> : box.state.value.length === 0 ? <p className={s.quiet}>{w.outboxNone}</p> : (
        <ul className={s.list} data-outbox="">
          {box.state.value.map((x) => (
            <li key={x.id} className={s.item}><span className={s.itemHead}><span>{x.label}</span><span className={s.quiet}>{dayText(x.at, p.language)}</span><span>{w[`sample.${x.status}`]}</span></span></li>
          ))}
        </ul>
      )}
    </Group>
  );
}

/** TR-14: the plan's promises; when the plan ended, that comes first. */
function HostedBody({ p, h }: { p: P; h: Hosted }) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  return (
    <div className={s.stack}>
      {h.ended && <p className={s.status} role="status" data-plan-ended="">{w.planEnded}</p>}
      <p className={s.text}>{h.blind}</p>
      <p className={s.text}>{h.notBlind}</p>
      {!h.ended && <p className={s.quiet}>{w.planned}</p>}
      <h3 className={s.label}>{w.jobsTitle}</h3>
      {h.jobs.length === 0 ? <p className={s.quiet}>{w.jobsNone}</p> : (
        <ul className={s.list}>{h.jobs.map((j) => <li key={j.id} className={s.item}><span className={s.itemHead}><span>{j.name}</span><span className={s.quiet}>{c.off}</span>{!h.ended && <Tag>{w.planned}</Tag>}</span></li>)}</ul>
      )}
      <h3 className={s.label}>{w.keepsTitle}</h3>
      <p className={s.text}>{h.keeps}</p>
    </div>
  );
}

/** TR-15: the notice in both languages, the screen's language first; each agreement with Withdraw (admin, asks twice). */
function AgreementsBody({ p, a, reload }: { p: P; a: Agreements; reload: () => void }) {
  const w = words(SHARING, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateAgreements);
  const withdraw = async (id: string) => { if (await send('trustx.withdraw', { id }) !== null && p.live(p.address)) reload(); };
  const notices = [{ lang: 'en' as const, label: w.noticeEn, text: a.notice.en }, { lang: 'hi' as const, label: w.noticeHi, text: a.notice.hi }];
  if (p.language === 'hi') notices.reverse();
  return (
    <div className={s.stack}>
      <span className={s.label}>{fill(w.noticeVersion, { v: a.notice.version })}</span>
      {notices.map((n) => (
        <div key={n.lang} className={s.stack}>
          <span className={s.label}>{n.label}</span>
          <div className={s.prose} lang={n.lang} data-notice={n.lang}>{n.text}</div>
        </div>
      ))}
      {a.items.length === 0 ? <p className={s.quiet}>{w.agreementsNone}</p> : (
        <ul className={s.list}>
          {a.items.map((x) => (
            <li key={x.id} className={s.item}>
              <span className={s.itemHead}><span className={s.name}>{x.person}</span><span>{x.purpose}</span></span>
              <span className={s.quiet}>
                {fill(w.agreed, { date: dayText(x.at, p.language) })}{x.withdrawnAt !== null && ` ${fill(w.withdrawnOn, { date: dayText(x.withdrawnAt, p.language) })}`}
              </span>
              {admin && x.withdrawnAt === null && (
                <span><AskTwice label={w.withdrawAgreement} ask={w.withdrawAgreementAsk} confirmLabel={w.withdrawAgreement} onConfirm={() => void withdraw(x.id)} language={p.language} disabled={sent.kind === 'sending'} /></span>
              )}
            </li>
          ))}
        </ul>
      )}
      <Outcome sent={sent} language={p.language} />
    </div>
  );
}
