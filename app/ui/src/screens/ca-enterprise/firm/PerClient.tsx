/**
 * The per-client lists of the CA console, each opened inside its client:
 *   CA-04 Month-end hand-over (reports/handover): the CA pack's schedules as a checklist.
 *   CA-05 To co-sign (work/cosign): proposals an accountant may co-sign, as counts.
 *   CA-10 Questions sent by clients (work/questions): how many, and since when.
 * Nothing here is a figure: states and counts only, as the engine sent them.
 */
import { useT } from '../../../app/text';
import { HANDOVER_ITEMS, validateCosign, validateHandover, validateQuestions, type Ready } from './contract.ts';
import { Page, dayText, monthText, nText, useRead, type P } from './kit';
import { OpenInside, OpenNotice, useOpenClient } from './open';
import s from './Firm.module.css';

export function HandoverScreen({ p }: { p: P }) {
  const t = useT();
  const { state } = useRead(p, 'firm.handover', {}, validateHandover);
  const opening = useOpenClient(p);
  return (
    <Page where={t('CAX-where.handover')} title={t('CAX-handover.title')} loaded={state} viewer={p.viewer}>
      {(reply) => (
        <>
          <p className={s.quiet}>{t('CAX-handover.lead', { month: monthText(reply.month, p.language) })}</p>
          <p className={s.quiet}>{t('CAX-handover.export')}</p>
          <OpenNotice p={p} state={opening.state} onClose={opening.clear} />
          {reply.rows.length === 0 ? <p className={s.text}>{t('CAX-clients.none')}</p> : (
            <ul className={s.list}>
              {reply.rows.map((row) => (
                <li key={row.clientId} className={s.item} data-client={row.clientId}>
                  <span className={s.itemHead}><span className={s.name}>{row.name}</span></span>
                  {row.handover === null ? <span className={s.quiet}>{t('CAX-handover.unknown')}</span> : (
                    <ul className={s.checklist} aria-label={t('CAX-handover.listOf', { name: row.name })}>
                      {HANDOVER_ITEMS.map((item) => (
                        <li key={item} className={s.check}>
                          <span className={[s.mark, s[readyClass(row.handover![item])]].join(' ')} aria-hidden="true" />
                          <span>{t('CAX-handover.item', { item: t(`CAX-handover.${item}`), state: t(`CAX-ready.${row.handover![item]}`) })}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  <span><OpenInside onOpen={() => opening.open(row.clientId, row.name)} /></span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </Page>
  );
}

function readyClass(r: Ready): 'ready' | 'notReady' | 'refusedMark' {
  return r === 'ready' ? 'ready' : r === 'not-ready' ? 'notReady' : 'refusedMark';
}

export function CosignScreen({ p }: { p: P }) {
  const t = useT();
  const { state } = useRead(p, 'firm.cosign', {}, validateCosign);
  const opening = useOpenClient(p);
  return (
    <Page where={t('CAX-where.cosign')} title={t('CAX-cosign.title')} loaded={state} viewer={p.viewer}>
      {(reply) => (
        <>
          <p className={s.quiet}>{t('CAX-cosign.lead')}</p>
          <OpenNotice p={p} state={opening.state} onClose={opening.clear} />
          {reply.rows.length === 0 ? <p className={s.text}>{t('CAX-cosign.none')}</p> : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">{t('CAX-col.client')}</th>
                  <th scope="col" className={s.num}>{t('CAX-cosign.meanings')}</th>
                  <th scope="col" className={s.num}>{t('CAX-cosign.recipes')}</th>
                  <th scope="col" className={s.num}>{t('CAX-cosign.classes')}</th>
                  <th scope="col"><span className="sr">{t('CAX-col.open')}</span></th>
                </tr>
              </thead>
              <tbody>
                {reply.rows.map((row) => (
                  <tr key={row.clientId} data-client={row.clientId}>
                    <th scope="row">{row.name}</th>
                    <td className={[s.num, 'fig'].join(' ')}>{nText(row.meanings, t)}</td>
                    <td className={[s.num, 'fig'].join(' ')}>{nText(row.recipes, t)}</td>
                    <td className={[s.num, 'fig'].join(' ')}>{nText(row.accountClasses, t)}</td>
                    <td><OpenInside onOpen={() => opening.open(row.clientId, row.name)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Page>
  );
}

export function QuestionsScreen({ p }: { p: P }) {
  const t = useT();
  const { state } = useRead(p, 'firm.questions', {}, validateQuestions);
  const opening = useOpenClient(p);
  return (
    <Page where={t('CAX-where.questions')} title={t('CAX-questions.title')} loaded={state} viewer={p.viewer}>
      {(reply) => (
        <>
          <p className={s.quiet}>{t('CAX-questions.lead')}</p>
          <OpenNotice p={p} state={opening.state} onClose={opening.clear} />
          {reply.rows.length === 0 ? <p className={s.text}>{t('CAX-questions.none')}</p> : (
            <table className={s.table}>
              <thead>
                <tr>
                  <th scope="col">{t('CAX-col.client')}</th>
                  <th scope="col" className={s.num}>{t('CAX-questions.count')}</th>
                  <th scope="col">{t('CAX-questions.oldest')}</th>
                  <th scope="col"><span className="sr">{t('CAX-col.open')}</span></th>
                </tr>
              </thead>
              <tbody>
                {reply.rows.map((row) => (
                  <tr key={row.clientId} data-client={row.clientId}>
                    <th scope="row">{row.name}</th>
                    <td className={[s.num, 'fig'].join(' ')}>{nText(row.count, t)}</td>
                    <td className="fig">{row.oldestAt === null ? t('CAX-notKnown') : dayText(row.oldestAt, p.language)}</td>
                    <td><OpenInside onOpen={() => opening.open(row.clientId, row.name)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Page>
  );
}
