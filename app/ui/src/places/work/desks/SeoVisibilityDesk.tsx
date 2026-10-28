/** SEO answer panels on Work. GEOHub (AGPL ideas only), no external source copied. */
import { useId, useState, type FormEvent } from 'react';
import { useEngine, useResource } from '../../../engine/context';
import { EngineError, type UploadLite } from '../../../engine/types';
import { useT } from '../../../text';
import { Tile, TileHead } from '../../../parts/Tile';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import type { PanelSpec, SeoPanelBody, SeoObservationBody } from '../../../../../../platform/runtime/venture/playbooks/seo-visibility/records';
import s from './SeoVisibilityDesk.module.css';
import { SeoWebsiteChecks } from './SeoWebsiteChecks';
import { SeoMonitors } from './SeoMonitors';
type PanelRow = {
    id: string;
    state: 'draft' | 'approved';
    questionCount: number;
    slots: number;
    filled: number;
    missing: number;
    live: boolean;
};
type PanelItem = {
    id: string;
    panel: SeoPanelBody;
    metrics: {
        mentions: {
            numerator: number;
            denominator: number;
            missing: number;
        };
        status: string;
        live: boolean;
    };
    observations: SeoObservationBody[];
};
const base = { playbook: 'seo-visibility' as const, kind: 'panel' };
/** A panel is editable before approval; afterwards every answer needs a checked slot and screenshot. */
export function SeoVisibilityDesk() {
    const t = useT(), engine = useEngine(), heading = useId();
    const panels = useResource('venture.desk.list', base, { refreshOn: event => event.type === 'desk.changed' });
    const orders = useResource('venture.order.list', {});
    const [orderId, setOrderId] = useState('');
    const [selected, setSelected] = useState(''), [adding, setAdding] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const detail = useResource('venture.desk.get', { ...base, id: selected }, { skip: !selected, refreshOn: event => event.type === 'desk.changed' });
    const files = useResource('venture.files.list', {}, { skip: !selected });
    const [questions, setQuestions] = useState(''), [engines, setEngines] = useState('chatgpt, claude'), [from, setFrom] = useState(() => new Date().toISOString().slice(0, 10)), [to, setTo] = useState(() => new Date(Date.now() + 86400000).toISOString().slice(0, 10)), [repeats, setRepeats] = useState('2');
    const [questionId, setQuestionId] = useState(''), [engineId, setEngineId] = useState(''), [windowId, setWindowId] = useState(''), [repeat, setRepeat] = useState('1'), [capturedAt, setCapturedAt] = useState(''), [screenshot, setScreenshot] = useState(''), [answer, setAnswer] = useState(''), [mentioned, setMentioned] = useState(false);
    const rows = (panels.data?.rows ?? []) as PanelRow[];
    const item = detail.data?.item as PanelItem | undefined;
    const photos = (files.data ?? []).filter(file => file.format === 'image');
    const errorText = (cause: unknown) => { const code = cause instanceof EngineError ? cause.code : 'REQUEST_FAILED'; const key = 'pb-seo-visibility.error.' + code; const translated = t(key); return translated === key ? t('pb-seo-visibility.error.REQUEST_FAILED') : translated; };
    async function act(action: string, payload: unknown, id = selected) {
        setBusy(true);
        setError('');
        try {
            const response = await engine.request('venture.desk.act', { ...base, id, action, payload, ...(id === 'new' ? {} : { digest: detail.data?.digest }) });
            setSelected(response.id);
            setAdding(false);
            panels.reload();
            detail.reload();
            return true;
        }
        catch (cause) {
            setError(errorText(cause));
            return false;
        }
        finally {
            setBusy(false);
        }
    }
    function create(event: FormEvent) { event.preventDefault(); const spec: PanelSpec = { questions: questions.split('\n').map(text => text.trim()).filter(Boolean).map((text, index) => ({ id: 'q' + (index + 1), text })), engines: engines.split(',').map(value => value.trim().toLowerCase()).filter(Boolean), timepoints: [{ id: 'capture', from: from + 'T00:00:00.000Z', to: to + 'T23:59:59.999Z' }], repeats: Number(repeats), minimumFilled: 4 }; void act('create', { spec, orderId: orderId || null }, 'new'); }
    async function capture(event: FormEvent) { event.preventDefault(); if (!item)
        return; const result = await act('observe', { questionId: questionId || item.panel.spec.questions[0]?.id, engine: engineId || item.panel.spec.engines[0], timepointId: windowId || item.panel.spec.timepoints[0]?.id, repeat: Number(repeat), capturedAt: capturedAt ? new Date(capturedAt + 'Z').toISOString() : new Date().toISOString(), method: 'owner-capture', screenshotFileId: screenshot, answer, mentioned, fixture: false }); if (result) {
        setAnswer('');
        setMentioned(false);
    } }
    const listError = panels.error ? errorText(panels.error) : '';
    return <div className={s.stack}>
    <Tile as="section" labelledBy={heading}>
      <TileHead id={heading} title={t('pb-seo-visibility.heading')} end={<Button variant="quiet" onClick={() => setAdding(value => !value)}>{t('pb-seo-visibility.new')}</Button>}/>
      <p className={s.line}>{t('pb-seo-visibility.boundary')}</p>
      {(error || listError) && <p role="alert" className={s.error}>{error || listError}</p>}
      {!rows.length && !adding && <p className={s.line}>{t('pb-seo-visibility.empty')}</p>}
      {rows.length > 0 && <ul className={s.list}>{rows.map(row => <li key={row.id}><Button variant="quiet" onClick={() => { setSelected(row.id); setAdding(false); }}>{t('pb-seo-visibility.panelRow', { questions: row.questionCount, filled: row.filled, slots: row.slots })}</Button><span>{t('pb-seo-visibility.state.' + row.state)}</span></li>)}</ul>}
      {adding && <form className={s.form} aria-label={t('pb-seo-visibility.new')} onSubmit={create}>
        <label className={s.label}>{t('pb-seo-visibility.order')}<select value={orderId} onChange={event=>setOrderId(event.target.value)}><option value="">{t('pb-seo-visibility.noOrder')}</option>{(orders.data??[]).map(order=><option key={order.id} value={order.id}>{order.request}</option>)}</select></label>
        <Field multiline label={t('pb-seo-visibility.questions')} hint={t('pb-seo-visibility.questionsHint')} value={questions} onChange={event => setQuestions(event.target.value)} required/>
        <Field label={t('pb-seo-visibility.engines')} value={engines} onChange={event => setEngines(event.target.value)} required/>
        <div className={s.pair}><Field label={t('pb-seo-visibility.from')} type="date" value={from} onChange={event => setFrom(event.target.value)} required/><Field label={t('pb-seo-visibility.to')} type="date" value={to} onChange={event => setTo(event.target.value)} required/></div>
        <Field label={t('pb-seo-visibility.repeats')} type="number" min="1" max="10" value={repeats} onChange={event => setRepeats(event.target.value)} required/>
        <Button type="submit" variant="primary" disabled={busy}>{t('pb-seo-visibility.save')}</Button>
      </form>}
    </Tile>
    {item && <Tile as="section" label={t('pb-seo-visibility.preview')} card>
      <TileHead title={t('pb-seo-visibility.preview')} level={3}/>
      <p className={s.line}>{t('pb-seo-visibility.state.' + item.panel.state)}</p>
      <details><summary>{t('pb-seo-visibility.design')}</summary><ul className={s.list} data-content>{item.panel.spec.questions.map(question => <li key={question.id}>{question.text}</li>)}</ul><p data-content>{item.panel.spec.engines.join(', ')}</p>{item.panel.spec.timepoints.map(window => <p key={window.id} className={s.line}>{window.from} / {window.to}</p>)}</details>
      {item.panel.state === 'draft' ? <Button variant="primary" disabled={busy} onClick={() => void act('approve', {})}>{t('pb-seo-visibility.approve')}</Button> : <>
        <p className={s.line}>{t('pb-seo-visibility.missing', { missing: item.metrics.mentions.missing, denominator: item.metrics.mentions.denominator })}</p>
        {!item.observations.length && <p className={s.line}>{t('pb-seo-visibility.noAnswers')}</p>}
        <p className={s.line}>{t(item.metrics.status === 'not-enough-data' ? 'pb-seo-visibility.insufficient' : 'pb-seo-visibility.measured')}</p>
        {!item.metrics.live && <p className={s.line}>{t('pb-seo-visibility.notLive')}</p>}
        <details><summary>{t('pb-seo-visibility.capture')}</summary>
          <form className={s.form} aria-label={t('pb-seo-visibility.capture')} onSubmit={capture}>
            <label className={s.label}>{t('pb-seo-visibility.question')}<select value={questionId || item.panel.spec.questions[0]?.id} onChange={event => setQuestionId(event.target.value)}>{item.panel.spec.questions.map(question => <option key={question.id} value={question.id}>{question.text}</option>)}</select></label>
            <label className={s.label}>{t('pb-seo-visibility.engine')}<select value={engineId || item.panel.spec.engines[0]} onChange={event => setEngineId(event.target.value)}>{item.panel.spec.engines.map(id => <option key={id}>{id}</option>)}</select></label>
            <label className={s.label}>{t('pb-seo-visibility.window')}<select value={windowId || item.panel.spec.timepoints[0]?.id} onChange={event => setWindowId(event.target.value)}>{item.panel.spec.timepoints.map(window => <option key={window.id}>{window.id}</option>)}</select></label>
            <Field label={t('pb-seo-visibility.repeat')} type="number" min="1" max={item.panel.spec.repeats} value={repeat} onChange={event => setRepeat(event.target.value)} required/>
            <Field label={t('pb-seo-visibility.capturedAt')} hint={t('pb-seo-visibility.utc')} type="datetime-local" value={capturedAt} onChange={event => setCapturedAt(event.target.value)} required/>
            <label className={s.label}>{t('pb-seo-visibility.screenshot')}<select value={screenshot} onChange={event => setScreenshot(event.target.value)} required><option value="">{t('pb-seo-visibility.chooseScreenshot')}</option>{photos.map((file: UploadLite) => <option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
            <p className={s.line}>{t('pb-seo-visibility.screenshotHint')}</p>
            <Field multiline label={t('pb-seo-visibility.answer')} value={answer} onChange={event => setAnswer(event.target.value)} required/>
            <label className={s.check}><input type="checkbox" checked={mentioned} onChange={event => setMentioned(event.target.checked)}/>{t('pb-seo-visibility.mentioned')}</label>
            <Button variant="primary" type="submit" disabled={busy}>{t('pb-seo-visibility.saveAnswer')}</Button>
          </form>
        </details>
        {item.observations.length > 0 && <ul className={s.list}>{item.observations.map(observation => <li key={observation.slot} data-content><span>{observation.engine}</span><span>{observation.answer}</span></li>)}</ul>}
      </>}
    </Tile>}
    <SeoWebsiteChecks />
    <SeoMonitors />
  </div>;
}
SeoVisibilityDesk.ready = true;
