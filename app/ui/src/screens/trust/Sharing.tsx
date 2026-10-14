/**
 * TR-11 Sharing, with TR-14 (what the paid plan can see) and TR-15 (the privacy notice and
 * your agreements) as groups. The local cleaner runs on this computer: nothing is uploaded.
 */
import { useState, type FormEvent, useId } from 'react';
import { words } from '../../places/types.ts';
import { Button } from '../../parts/Button';
import { useEngine, useSend } from './kit/engine.ts';
import { Group, Note, Screen } from './kit/Screen';
import { AskTwice, Loads, Outcome, Pending, Tag, bytesText, countText, dayText, powers, type P } from './common';
import { validateAgreements, validateCleaned, validateHosted, validateSharing, type Agreements, type Cleaned, type Sharing } from './validate.ts';
import { COMMON, SHARING, fill } from './words.ts';
import s from './Trust.module.css';

export function SharingScreen(p: P) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  const { state, reload } = useEngine(p.rpc, 'trustx.sharing', {}, validateSharing);
  const hosted = useEngine(p.rpc, 'trustx.hosted', {}, validateHosted);
  const agreements = useEngine(p.rpc, 'trustx.agreements', {}, validateAgreements);
  return (
    <Screen where={c.whereSharing} title={c.sharing} loaded={state}>
      {(sh) => (
        <>
          <SharingBody p={p} sh={sh} reload={reload} />
          <Cleaner p={p} />
          <Loads title={w.hostedTitle} loaded={hosted.state}>
            {(h) => (
              <div className={s.stack}>
                <p className={s.text}>{h.blind}</p>
                <p className={s.text}>{h.notBlind}</p>
                <p className={s.quiet}>{w.planned}</p>
                <h3 className={s.label}>{w.jobsTitle}</h3>
                {h.jobs.length === 0 ? <p className={s.quiet}>{w.jobsNone}</p> : (
                  <ul className={s.list}>{h.jobs.map((j) => <li key={j.id} className={s.item}><span className={s.itemHead}><span>{j.name}</span><span className={s.quiet}>{c.off}</span><Tag>{w.planned}</Tag></span></li>)}</ul>
                )}
                <h3 className={s.label}>{w.keepsTitle}</h3>
                <p className={s.text}>{h.keeps}</p>
              </div>
            )}
          </Loads>
          <Loads title={w.agreementsTitle} loaded={agreements.state}>
            {(a) => <AgreementsBody p={p} a={a} reload={agreements.reload} />}
          </Loads>
        </>
      )}
    </Screen>
  );
}

function SharingBody({ p, sh, reload }: { p: P; sh: Sharing; reload: () => void }) {
  const c = words(COMMON, p.language), w = words(SHARING, p.language);
  const { owner } = powers(p);
  const { sent, send } = useSend(p.rpc, validateSharing);
  const withdraw = async () => { if (await send('trustx.withdrawSharing', {}) !== null && p.live(p.address)) reload(); };
  return (
    <>
      <Group title={c.sharing}>
        <p className={s.text}>{sh.on ? w.on : w.off}</p>
        <p className={s.text}>{w.notOpen}</p>
        {sh.withdrawnAt !== null && <p className={s.quiet}>{fill(w.withdrawn, { date: dayText(sh.withdrawnAt, p.language) })}</p>}
        {owner && sh.withdrawnAt === null && sh.on && (
          <span><AskTwice label={w.withdraw} ask={w.withdrawAsk} confirmLabel={w.withdrawConfirm} onConfirm={() => void withdraw()} language={p.language} disabled={sent.kind === 'sending'} /></span>
        )}
        {!owner && <Note>{c.ownerOnly}</Note>}
        <Outcome sent={sent} language={p.language} />
      </Group>
      <Pending p={p} what={['sharing']} round={0} onConfirmed={reload} />
      <Group title={w.previewTitle}>
        {sh.preview === null ? <p className={s.quiet}>{w.noPreview}</p>
          : <p className={s.text}>{fill(w.preview, { bytes: bytesText(sh.preview.bytes, p.language), events: countText(sh.preview.events) })}</p>}
        {sh.preview !== null && p.view === 'books' && <p className={s.mono}>{sh.preview.digest}</p>}
      </Group>
      <Group title={w.batchesTitle}>
        {sh.batches.length === 0 ? <p className={s.quiet}>{w.batchesNone}</p> : (
          <ul className={s.list}>
            {sh.batches.map((b) => (
              <li key={b.id} className={s.item}>
                <span className={s.itemHead}><span>{dayText(b.at, p.language)}</span><span className={s.quiet}>{bytesText(b.bytes, p.language)} · {fill(w.batch, { events: countText(b.events) })}</span></span>
              </li>
            ))}
          </ul>
        )}
        <p className={s.text} data-running="">{fill(w.running, { events: countText(sh.totals.events) })}</p>
      </Group>
    </>
  );
}

function Cleaner({ p }: { p: P }) {
  const w = words(SHARING, p.language);
  const id = useId();
  const [text, setText] = useState('');
  const [original, setOriginal] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const { sent, send } = useSend<Cleaned>(p.rpc, validateCleaned);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length === 0) { setProblem(w.emptySample); return; }
    setProblem(undefined);
    const sample = text;
    if (await send('trustx.cleanSample', { text: sample }) !== null) setOriginal(sample);
  };
  return (
    <Group title={w.cleanerTitle} note={w.nothingUploaded}>
      <form className={s.stack} onSubmit={(e) => void submit(e)}>
        <label htmlFor={id} className={s.label}>{w.sample}</label>
        <textarea id={id} className={s.textarea} value={text} onChange={(e) => setText(e.currentTarget.value)} spellCheck={false} />
        {problem !== undefined && <p className={s.problem}>{problem}</p>}
        <span><Button submit disabled={sent.kind === 'sending'}>{w.clean}</Button></span>
      </form>
      {sent.kind === 'refused' && <Outcome sent={sent} language={p.language} />}
      {sent.kind === 'done' && original !== null && (
        <div className={s.stack}>
          <div className={s.split}>
            <div className={s.stack}><span className={s.label}>{w.original}</span><pre className={s.pre} data-original="">{original}</pre></div>
            <div className={s.stack}><span className={s.label}>{w.cleaned}</span><pre className={s.pre} data-cleaned="">{sent.value.cleaned}</pre></div>
          </div>
          {sent.value.hits.length === 0 ? <p className={s.quiet}>{w.noHits}</p> : (
            <ul className={s.list} data-hits="">
              {sent.value.hits.map((h, i) => <li key={i} className={s.item}>{fill(w.hit, { line: countText(h.line), kind: h.kind })}</li>)}
            </ul>
          )}
          <p className={s.status}>{w.nothingUploaded}</p>
        </div>
      )}
    </Group>
  );
}

function AgreementsBody({ p, a, reload }: { p: P; a: Agreements; reload: () => void }) {
  const w = words(SHARING, p.language);
  const { admin } = powers(p);
  const { sent, send } = useSend(p.rpc, validateAgreements);
  const withdraw = async (id: string) => { if (await send('trustx.withdraw', { id }) !== null && p.live(p.address)) reload(); };
  return (
    <div className={s.stack}>
      <span className={s.label}>{fill(w.noticeVersion, { v: a.notice.version })}</span>
      <div className={s.prose} lang={p.language} data-notice="">{p.language === 'hi' ? a.notice.hi : a.notice.en}</div>
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
