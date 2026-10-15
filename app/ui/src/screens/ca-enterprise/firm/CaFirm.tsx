/**
 * The client's own "Your CA firm" (Trust, desktop): link a firm with the code from its guide,
 * agree (or withdraw) to share status, make a status card and see exactly what will cross,
 * unlink. Only status crosses: dates, counts and states, never a figure, a customer's name or
 * a document. A separate small section turns this workspace into a CA firm's console.
 */
import { useState, type FormEvent } from 'react';
import { useT } from '../../../app/text';
import { Button } from '../../../parts/Button';
import { Field } from '../../../parts/Field';
import {
  CLOSE_ITEMS, HANDOVER_ITEMS, normaliseLinkCode, validateCaStatus, validateConsent, validateFirmSet, validateLinked, validateStatusCard, validateUnlinked,
  type CaStatus, type StatusCard,
} from './contract.ts';
import { AskTwice, Group, Outcome, Page, dayText, dueText, monthText, nText, powers, saveFile, seatText, useRead, useSend, type P } from './kit';
import s from './Firm.module.css';

export function CaFirmScreen({ p }: { p: P }) {
  const t = useT();
  const { state, reload } = useRead(p, 'castatus.get', {}, validateCaStatus);
  return (
    <Page where={t('CAX-where.cafirm')} title={t('CAX-cafirm.title')} loaded={state} viewer={p.viewer}>
      {(status) => (
        <>
          <p className={s.quiet}>{t('CAX-cafirm.lead')}</p>
          <LinkPart p={p} status={status} onChange={reload} />
          {status.link !== null && <ConsentPart p={p} status={status} onChange={reload} />}
          {status.link !== null && <CardPart p={p} status={status} onMade={reload} />}
          <SetupPart p={p} />
        </>
      )}
    </Page>
  );
}

function LinkPart({ p, status, onChange }: { p: P; status: CaStatus; onChange: () => void }) {
  const t = useT();
  const { admin } = powers(p);
  const [firmName, setFirmName] = useState('');
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<{ name?: string; code?: string }>({});
  const linked = useSend(p, validateLinked);
  const unlinked = useSend(p, validateUnlinked);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = firmName.trim(), typed = normaliseLinkCode(code);
    const next: { name?: string; code?: string } = {};
    if (name.length === 0 || name.length > 120) next.name = t('CAX-cafirm.needFirm');
    if (typed === null) next.code = t('CAX-cafirm.needCode');
    setProblem(next);
    if (next.name !== undefined || typed === null) return;
    if ((await linked.send('castatus.link', { firmName: name, code: typed })) !== null) { setFirmName(''); setCode(''); onChange(); }
  };
  const unlink = async () => { if ((await unlinked.send('castatus.unlink', {})) !== null) onChange(); };
  return (
    <Group title={t('CAX-cafirm.link')}>
      {status.link === null ? (
        <>
          <p className={s.text}>{t('CAX-cafirm.notLinked')}</p>
          {admin ? (
            <form className={s.stack} onSubmit={(e) => void submit(e)}>
              <Field label={t('CAX-cafirm.firmName')} value={firmName} onChange={(e) => setFirmName(e.currentTarget.value)} problem={problem.name} autoComplete="off" />
              <Field label={t('CAX-cafirm.code')} value={code} onChange={(e) => setCode(e.currentTarget.value)} problem={problem.code} autoComplete="off" spellCheck={false} />
              <span><Button submit disabled={linked.sent.kind === 'sending'}>{t('CAX-cafirm.linkButton')}</Button></span>
            </form>
          ) : <p className={s.quiet}>{t('CAX-adminOnly')}</p>}
          <Outcome sent={linked.sent} />
        </>
      ) : (
        <>
          <p className={s.text} data-linked="">{t('CAX-cafirm.linked', { firm: status.link.firmName, date: dayText(status.link.linkedAt, p.language) })}</p>
          {admin && <AskTwice label={t('CAX-cafirm.unlink')} ask={t('CAX-cafirm.unlinkAsk', { firm: status.link.firmName })} confirm={t('CAX-cafirm.unlinkYes')}
            onConfirm={() => void unlink()} disabled={unlinked.sent.kind === 'sending'} />}
          <Outcome sent={unlinked.sent} />
        </>
      )}
    </Group>
  );
}

function ConsentPart({ p, status, onChange }: { p: P; status: CaStatus; onChange: () => void }) {
  const t = useT();
  const { admin } = powers(p);
  const consent = useSend(p, validateConsent);
  const { wording } = status;
  const decide = async (agree: boolean) => {
    if ((await consent.send('castatus.consent', { agree, version: agree ? wording.version : status.consent?.version ?? wording.version })) !== null) onChange();
  };
  return (
    <Group title={t('CAX-cafirm.consent')}>
      {!wording.approved && (
        <p className={s.text} data-wording-pending="">
          {t('CAX-cafirm.wordingPending')}{wording.text !== null && <> {t('CAX-cafirm.wordingDraft')}</>}
        </p>
      )}
      {wording.text !== null && (
        <blockquote className={s.wording} data-wording={wording.version}>
          <p className={s.prose}>{wording.text}</p>
          <footer className={s.quiet}>{t('CAX-cafirm.version', { version: wording.version })}</footer>
        </blockquote>
      )}
      {status.consent === null
        ? <p className={s.text}>{t('CAX-cafirm.notAgreed')}</p>
        : <p className={s.text} data-agreed="">{t('CAX-cafirm.agreed', { version: status.consent.version, date: dayText(status.consent.at, p.language) })}</p>}
      {status.consent !== null && status.consent.version !== wording.version && <p className={s.quiet}>{t('CAX-cafirm.newWording')}</p>}
      {admin && (
        <span className={s.actions}>
          {(status.consent === null || status.consent.version !== wording.version) && wording.text !== null && (
            <Button onClick={() => void decide(true)} disabled={consent.sent.kind === 'sending'}>{t('CAX-cafirm.agree')}</Button>
          )}
          {status.consent !== null && (
            <AskTwice label={t('CAX-cafirm.withdraw')} ask={t('CAX-cafirm.withdrawAsk')} confirm={t('CAX-cafirm.withdrawYes')} onConfirm={() => void decide(false)}
              disabled={consent.sent.kind === 'sending'} />
          )}
        </span>
      )}
      {!admin && <p className={s.quiet}>{t('CAX-adminOnly')}</p>}
      <Outcome sent={consent.sent} />
    </Group>
  );
}

function CardPart({ p, status, onMade }: { p: P; status: CaStatus; onMade: () => void }) {
  const t = useT();
  const { change } = powers(p);
  const made = useSend(p, validateStatusCard);
  const make = async () => { if ((await made.send('castatus.card', {})) !== null) onMade(); };
  return (
    <Group title={t('CAX-cafirm.card')} note={t('CAX-cafirm.cardNote')}>
      <p className={s.quiet}>{status.lastCardAt === null ? t('CAX-cafirm.noCardYet') : t('CAX-cafirm.lastCard', { date: dayText(status.lastCardAt, p.language) })}</p>
      {change && <span><Button onClick={() => void make()} disabled={made.sent.kind === 'sending'}>{t('CAX-cafirm.make')}</Button></span>}
      <Outcome sent={made.sent} />
      {made.sent.kind === 'done' && <CardPreview p={p} card={made.sent.value} />}
    </Group>
  );
}

/** Every field of the card, in words: what crosses to the firm, and nothing else. */
export function CardPreview({ p, card }: { p: P; card: StatusCard }) {
  const t = useT();
  const fileName = `chausar-status-${card.month}.json`;
  const time = (iso: string | null) => (iso === null ? t('CAX-notKnown') : dayText(iso, p.language));
  const lines: { key: string; label: string; value: string }[] = [
    { key: 'month', label: t('CAX-cardf.month'), value: monthText(card.month, p.language) },
    { key: 'issuedAt', label: t('CAX-cardf.issuedAt'), value: time(card.issuedAt) },
    { key: 'booksReadAt', label: t('CAX-cardf.booksReadAt'), value: time(card.booksReadAt) },
    ...CLOSE_ITEMS.map((item) => ({ key: `close.${item}`, label: t('CAX-cardf.close', { step: t(`CAX-close.${item}`) }), value: t(`CAX-step.${card.close[item]}`) })),
    { key: 'cosign.meanings', label: t('CAX-cardf.meanings'), value: nText(card.cosign.meanings, t) },
    { key: 'cosign.recipes', label: t('CAX-cardf.recipes'), value: nText(card.cosign.recipes, t) },
    { key: 'cosign.accountClasses', label: t('CAX-cardf.classes'), value: nText(card.cosign.accountClasses, t) },
    { key: 'questions.count', label: t('CAX-cardf.questions'), value: nText(card.questions.count, t) },
    { key: 'questions.oldestAt', label: t('CAX-cardf.oldest'), value: time(card.questions.oldestAt) },
    ...HANDOVER_ITEMS.map((item) => ({ key: `handover.${item}`, label: t('CAX-cardf.handover', { item: t(`CAX-handover.${item}`) }), value: t(`CAX-ready.${card.handover[item]}`) })),
    { key: 'dueNext', label: t('CAX-cardf.dueNext'), value: card.dueNext === null ? t('CAX-cardf.nothingDue') : t('CAX-cardf.due', { what: dueText(card.dueNext.code, t), date: dayText(card.dueNext.date, p.language) }) },
    { key: 'seats', label: t('CAX-cardf.seats'), value: card.seats.length === 0 ? t('CAX-cardf.noSeats') : card.seats.map((x) => seatText(x, p.language, t)).join('; ') },
    { key: 'consent', label: t('CAX-cardf.consent'), value: card.consent },
    { key: 'workspaceId', label: t('CAX-cardf.workspace'), value: card.workspaceId },
    { key: 'link', label: t('CAX-cardf.link'), value: card.link },
    { key: 'mac', label: t('CAX-cardf.mac'), value: card.mac },
  ];
  return (
    <div className={s.stack} data-card-preview="">
      <p className={s.text}>{t('CAX-cafirm.crosses')}</p>
      <dl className={s.facts}>
        {lines.map((line) => (
          <div key={line.key} className={s.fact} data-field={line.key}>
            <dt>{line.label}</dt>
            <dd className={line.key === 'workspaceId' || line.key === 'link' || line.key === 'mac' ? s.mono : undefined}>{line.value}</dd>
          </div>
        ))}
      </dl>
      <p className={s.quiet}>{t('CAX-cafirm.noFigures')}</p>
      <span><Button onClick={() => saveFile(fileName, `${JSON.stringify(card, null, 2)}\n`, 'application/json')}>{t('CAX-cafirm.download')}</Button></span>
      <p className={s.quiet}>{t('CAX-cafirm.fileName', { name: fileName })}</p>
    </div>
  );
}

function SetupPart({ p }: { p: P }) {
  const t = useT();
  const { admin } = powers(p);
  const [name, setName] = useState('');
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const setup = useSend(p, validateFirmSet);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const typed = name.trim();
    if (typed.length === 0 || typed.length > 120) { setProblem(t('CAX-cafirm.needFirm')); return; }
    setProblem(undefined);
    await setup.send('firm.setup', { name: typed });
  };
  if (!admin) return null;
  return (
    <Group title={t('CAX-setup.title')} note={t('CAX-setup.note')}>
      {setup.sent.kind === 'done' ? (
        <p className={s.text} role="status" data-setup-done="">{t('CAX-setup.done', { firm: setup.sent.value.firm.name })}</p>
      ) : (
        <form className={s.form} onSubmit={(e) => void submit(e)}>
          <Field label={t('CAX-cafirm.firmName')} value={name} onChange={(e) => setName(e.currentTarget.value)} problem={problem} autoComplete="off" />
          <span><Button submit disabled={setup.sent.kind === 'sending'}>{t('CAX-setup.button')}</Button></span>
        </form>
      )}
      <Outcome sent={setup.sent} />
    </Group>
  );
}
