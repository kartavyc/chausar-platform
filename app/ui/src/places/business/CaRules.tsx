import { useState, type FormEvent } from 'react';
import { useT } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import type { CaCitationsView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { TileSection, messageOf } from './shared';
import s from './Business.module.css';
/** The CA sees the dated table and sources before confirming its exact version. */
export function CaRules({ rules, onConfirmed }: {
    rules: CaCitationsView;
    onConfirmed: () => void;
}) {
    const t = useT(), client = useEngine();
    const [number, setNumber] = useState(''), [busy, setBusy] = useState(false), [problem, setProblem] = useState<string | null>(null);
    async function submit(event: FormEvent) { event.preventDefault(); setBusy(true); setProblem(null); try {
        const fresh = await client.request('venture.ca.get', {});
        if (fresh.citations?.tableHash !== rules.tableHash) {
            setProblem(t('pb-ca-firm.changed'));
            onConfirmed();
            return;
        }
        await client.request('venture.ca.confirmCitations', { version: rules.version, membershipNo: number.trim() });
        onConfirmed();
    }
    catch (error) {
        setProblem(messageOf(error));
    }
    finally {
        setBusy(false);
    } }
    return <TileSection title={t('pb-ca-firm.rules')}><p className={s.note}>{rules.confirmedBy ? t('pb-ca-firm.confirmed', { name: rules.confirmedBy.name }) : t('pb-ca-firm.hold')}</p><details><summary>{t('pb-ca-firm.review')}</summary><ul className={s.steps}>{rules.rows.map(row => <li key={row.id} className={s.step}><span data-content=""><strong>{row.section}</strong> {t('pb-ca-firm.act', { act: row.act })}: {row.title}</span><span className={s.stepWho}>{row.validFrom} / {row.validTo}{row.replacedBy ? ' → ' + row.replacedBy : ''}</span><a href={row.source} target="_blank" rel="noreferrer">{t('pb-ca-firm.source')}</a></li>)}{rules.rules.map(row => <li key={row.id} className={s.step}><strong>{row.assessmentYear}</strong><span data-content="">{row.title}: {row.verification}</span><a href={row.source} target="_blank" rel="noreferrer">{t('pb-ca-firm.source')}</a></li>)}</ul>{!rules.confirmedBy && <form onSubmit={event => void submit(event)} className={s.form}><Field label={t('business.ca.caNumber')} value={number} inputMode="numeric" maxLength={12} onChange={event => setNumber(event.currentTarget.value)}/>{problem && <p role="alert" className={s.problem}>{problem}</p>}<Button type="submit" disabled={busy}>{t('pb-ca-firm.confirm')}</Button></form>}</details></TileSection>;
}
/** Re-check the stored signature rather than displaying an unchecked historic badge. */
export function StoredCaSignoff({ id }: {
    id: string;
}) { const t = useT(); const result = useResource('venture.ca.signoff.get', { id }); return <details><summary>{t('pb-ca-firm.signature')}</summary>{result.error ? <p role="alert" className={s.problem}>{result.error.message}</p> : result.data ? <><p>{result.data.ca.name} / {result.data.ca.membershipNumber}</p><p>{result.data.at}</p><p>{result.data.rederived === 'same' ? t('pb-ca-firm.same') : t('pb-ca-firm.differs', { line: result.data.differs?.line ?? '' })}</p></> : <p>{t('business.loading')}</p>}</details>; }
