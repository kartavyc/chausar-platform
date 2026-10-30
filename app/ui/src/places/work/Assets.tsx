/**
 * The order's delivered files on Work (Ink v2 wave 5, package 5A4; catalogue P8, P9). Simple first: each file the
 * order's runs delivered, where it came from, its licence and its cost, and, when Accept would refuse it, why, in the
 * engine's reason worded here. Run again (a generated file, asked for again with the same request) and Use on another
 * order (the same client's, at no new cost) are one step away. Below, the voices recorded with consent: each with where
 * it stands, Withdraw (the owner's approval inside the app) and, for an order with a recording, Record consent. Nothing
 * is worked out here; every word of state comes from the engine. Written for Chausar.
 */

import { useId, useState, type FormEvent } from 'react';
import { useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type AssetView, type OrderLite, type UploadLite, type VoiceConsentItem } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { Tile, TileHead } from '../../parts/Tile';
import a from './Assets.module.css';

/** The engine codes this tile words itself, in both languages. */
const WORDED = new Set([
  'ASSET_LICENCE_UNKNOWN', 'ASSET_NOT_MADE', 'ASSET_REFUSED', 'MEDIA_NOT_CLEAN', 'CONSENT_WITHDRAWN', 'DERIVED_STALE', 'CONSENT_REQUIRED',
  'CHAT_KEY_REFUSED', 'APP_APPROVAL_REQUIRED',
]);
function wordsOf(error: unknown, t: T): string {
  if (error instanceof EngineError && WORDED.has(error.code)) return t(`kit-media.error.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}

export function Assets({ order }: { order: OrderLite }) {
  const t = useT();
  const headingId = useId();
  const assets = useResource('venture.assets.list', { orderId: order.id });
  const consents = useResource('venture.voiceConsent.list', {});
  const orderList = useResource('venture.order.list', {});
  const fileList = useResource('venture.files.list', { orderId: order.id });
  const orders = orderList.data ?? [];
  const files = fileList.data ?? [];
  const recordings = files.filter((file) => file.format === 'audio' && file.scope.kind === 'media' && file.scope.orderId === order.id);
  const live = (assets.data?.assets ?? []).filter((asset) => asset.supersededBy === null);
  const voices = consents.data?.consents ?? [];
  if (!live.length && !voices.length && !recordings.length) return null;
  const others = orders.filter((item) => item.id !== order.id && item.clientId === order.clientId && item.status === 'open');
  const changed = () => { assets.reload(); consents.reload(); };

  return (
    <Tile as="section" labelledBy={headingId}>
      <TileHead id={headingId} title={t('kit-media.assets.heading')} />
      <div className={a.body} data-assets="">
        {live.length > 0 && (
          <ul className={a.list} aria-label={t('kit-media.assets.list')}>
            {live.map((asset) => <AssetRow key={asset.id} asset={asset} others={others} onChanged={changed} />)}
          </ul>
        )}
        {!live.length && <p className={a.line}>{t('kit-media.assets.none')}</p>}
        <Voices consents={voices} recordings={recordings} onChanged={changed} />
      </div>
    </Tile>
  );
}

function AssetRow({ asset, others, onChanged }: { asset: AssetView; others: readonly OrderLite[]; onChanged: () => void }) {
  const t = useT();
  const engine = useEngine();
  const pickId = useId();
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [reuse, setReuse] = useState(false);
  const [target, setTarget] = useState(others[0]?.id ?? '');
  const canRerun = asset.source.kind === 'generated' && asset.state === 'ready';

  async function act(run: () => Promise<unknown>) {
    setBusy(true);
    setProblem(null);
    try {
      await run();
      setReuse(false);
      onChanged();
    } catch (error) {
      setProblem(wordsOf(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className={a.row} data-asset-state={asset.blocked ? 'blocked' : 'ok'}>
      <span className={`${a.name} mono`}>{asset.name}</span>
      <span className={a.facts}>
        <span>{sourceWords(asset, t)}</span>
        <span>{asset.licence ?? t('kit-media.assets.noLicence')}</span>
        <span>{t(`kit-media.cost.${asset.cost.kind}`)}</span>
        {asset.hygiene.state === 'clean' && <span>{t('kit-media.assets.cleaned')}</span>}
      </span>
      {asset.blocked && <p className={a.blocked} role="status">{t(`kit-media.error.${asset.blocked.code}`)}</p>}
      <span className={a.actions}>
        {canRerun && <Button variant="quiet" disabled={busy} onClick={() => void act(() => engine.request('venture.assets.rerun', { id: asset.id }))}>{t('kit-media.assets.rerun')}</Button>}
        {!asset.blocked && others.length > 0 && !reuse && <Button variant="quiet" disabled={busy} onClick={() => setReuse(true)}>{t('kit-media.assets.reuse')}</Button>}
      </span>
      {reuse && (
        <span className={a.pick}>
          <label htmlFor={pickId} className={a.label}>{t('kit-media.assets.reuseOn')}</label>
          <select id={pickId} className={a.select} value={target} onChange={(event) => setTarget(event.currentTarget.value)}>
            {others.map((item) => <option key={item.id} value={item.id}>{item.request}</option>)}
          </select>
          <Button variant="quiet" disabled={busy} onClick={() => setReuse(false)}>{t('kit-media.kit.cancel')}</Button>
          <Button variant="secondary" disabled={busy || !target} onClick={() => void act(() => engine.request('venture.assets.reuse', { id: asset.id, orderId: target }))}>{t('kit-media.assets.reuseGo')}</Button>
        </span>
      )}
      {problem && <p className={a.problem} role="alert">{problem}</p>}
    </li>
  );
}

function sourceWords(asset: AssetView, t: T): string {
  const source = asset.source;
  switch (source.kind) {
    case 'client-file': return t(source.uploadId ? 'kit-media.source.clientFile' : 'kit-media.source.clientClip');
    case 'generated': return t('kit-media.source.generated', { model: source.model });
    case 'licensed-stock': return t('kit-media.source.stock', { provider: source.provider, licenceId: source.licenceId });
    default: return t('kit-media.source.unknown');
  }
}

function Voices({ consents, recordings, onChanged }: { consents: readonly VoiceConsentItem[]; recordings: readonly UploadLite[]; onChanged: () => void }) {
  const t = useT();
  const engine = useEngine();
  const headingId = useId();
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!consents.length && !recordings.length) return null;

  async function withdraw(consent: VoiceConsentItem) {
    setBusy(consent.id);
    setProblem(null);
    try {
      await engine.request('venture.voiceConsent.revoke', { id: consent.id });
      onChanged();
    } catch (error) {
      setProblem(wordsOf(error, t));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-labelledby={headingId} className={a.voices}>
      <h3 id={headingId} className={a.subhead}>{t('kit-media.voice.heading')}</h3>
      <p className={a.line}>{t('kit-media.voice.line')}</p>
      {consents.length > 0 && (
        <ul className={a.list} aria-labelledby={headingId}>
          {consents.filter((consent) => consent.state !== 'replaced').map((consent) => (
            <li key={consent.id} className={a.row} data-consent-state={consent.state}>
              <span className={a.name} data-content="">{consent.speaker}</span>
              <span className={a.facts}>
                <span>{t(`kit-media.voice.state.${consent.state}`)}</span>
                <span data-content="">{consent.scope}</span>
              </span>
              <span className={a.actions}>
                {consent.state === 'current' && (
                  <Button variant="quiet" disabled={busy !== null} aria-label={t('kit-media.voice.withdrawName', { name: consent.speaker })} onClick={() => void withdraw(consent)}>
                    {busy === consent.id ? t('kit-media.voice.withdrawing') : t('kit-media.voice.withdraw')}
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {recordings.length > 0 && !recording && (
        <span className={a.actions}><Button variant="secondary" onClick={() => setRecording(true)}>{t('kit-media.voice.record')}</Button></span>
      )}
      {recording && <ConsentForm recordings={recordings} onDone={() => { setRecording(false); onChanged(); }} onCancel={() => setRecording(false)} />}
      {problem && <p className={a.problem} role="alert">{problem}</p>}
    </section>
  );
}

function ConsentForm({ recordings, onDone, onCancel }: { recordings: readonly UploadLite[]; onDone: () => void; onCancel: () => void }) {
  const t = useT();
  const engine = useEngine();
  const fileId = useId();
  const [draft, setDraft] = useState({ speaker: '', recordingFileId: recordings[0]?.id ?? '', transcript: '', statement: '', scope: '', until: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof draft) => (event: { target: { value: string } }) => setDraft((d) => ({ ...d, [key]: event.target.value }));
  const ready = draft.speaker.trim() && draft.recordingFileId && draft.transcript.trim() && draft.statement.trim() && draft.scope.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy) return;
    setBusy(true);
    setProblem(null);
    try {
      await engine.request('venture.voiceConsent.record', {
        speaker: draft.speaker.trim(), recordingFileId: draft.recordingFileId, transcript: draft.transcript.trim(), statement: draft.statement.trim(),
        scope: draft.scope.trim(), until: draft.until.trim() || null,
      });
      onDone();
    } catch (error) {
      setProblem(wordsOf(error, t));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={a.form} onSubmit={submit} aria-label={t('kit-media.voice.form')}>
      <Field label={t('kit-media.voice.speaker')} value={draft.speaker} onChange={set('speaker')} />
      <span className={a.pick}>
        <label htmlFor={fileId} className={a.label}>{t('kit-media.voice.recording')}</label>
        <select id={fileId} className={a.select} value={draft.recordingFileId} onChange={(event) => setDraft((d) => ({ ...d, recordingFileId: event.currentTarget.value }))}>
          {recordings.map((file) => <option key={file.id} value={file.id}>{file.name}</option>)}
        </select>
      </span>
      <Field multiline label={t('kit-media.voice.transcript')} hint={t('kit-media.voice.transcriptHint')} value={draft.transcript} onChange={set('transcript')} />
      <Field multiline label={t('kit-media.voice.statement')} hint={t('kit-media.voice.statementHint')} value={draft.statement} onChange={set('statement')} />
      <Field label={t('kit-media.voice.scope')} value={draft.scope} onChange={set('scope')} />
      <Field label={t('kit-media.voice.until')} hint={t('kit-media.voice.untilHint')} type="date" value={draft.until} onChange={set('until')} />
      <span className={a.actions}>
        <Button type="button" variant="quiet" disabled={busy} onClick={onCancel}>{t('kit-media.kit.cancel')}</Button>
        <Button type="submit" variant="primary" locked={!ready} lockedReason={t('kit-media.voice.needs')} disabled={busy}>{busy ? t('kit-media.kit.saving') : t('kit-media.voice.save')}</Button>
      </span>
      {problem && <p className={a.problem} role="alert">{problem}</p>}
    </form>
  );
}
