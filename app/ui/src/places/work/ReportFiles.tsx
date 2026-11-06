/**
 * The client report (Ink v2 wave 5, package 5A5; catalogue P11), on the order. It reads the order's reports and every
 * link to them from the engine (venture.report.list), so a live link can be found, rotated or turned off whenever the
 * order is open, and its views seen. For each draft the owner accepted or edited, "Make the report" asks the engine
 * for the files (venture.report.render): the web page always, the PDF on the desktop, Word and Excel. The engine keeps
 * no bytes: a file saved later is made again. On the desktop "Save all files" has the desktop make the report and
 * write every file into a folder the owner picks, atomically (saveReport); on the web each file downloads exactly as
 * the engine sent it. A PDF the engine did not make says why, worded here in English and Hindi. One step away, "Share
 * with your client" makes a read-only link for the dates and channels picked (venture.report.share); its address
 * shows once, with Copy; New link and Turn off change it (.shareRotate, .shareDisable). Written for Chausar.
 */

import { useId, useMemo, useState, type ReactNode } from 'react';
import { useLanguage, useT, type T } from '../../text';
import { useEngine, useResource } from '../../engine/context';
import { EngineError, type DeliveryLite, type ReportFileView, type ReportListItem, type ReportShareView, type ReportView } from '../../engine/types';
import { Button } from '../../parts/Button';
import { Field } from '../../parts/Field';
import { ModelEstimate } from '../../parts/ModelEstimate';
import { Tile, TileHead } from '../../parts/Tile';
import r from './ReportFiles.module.css';

const LOCALE = { en: 'en-IN', hi: 'hi-IN' } as const;
const FORMATS = ['html', 'pdf', 'docx', 'xlsx'] as const;
/** The engine codes this screen words itself, in both languages. */
const WORDED = new Set([
  'REPORT_BLOCK_UNSOURCED', 'REPORT_NOT_READY', 'REPORT_STALE', 'REPORT_TOO_LARGE', 'DELIVERY_NOT_READY', 'PRACTICE_DRAFT', 'REPORT_SHARE_DISABLED',
  'APP_APPROVAL_REQUIRED', 'TRIAL_LIMIT', 'CA_SIGNOFF_REQUIRED', 'REPORT_NOT_FOUND', 'REPORT_SHARE_NOT_FOUND', 'EXPORT_EXISTS', 'EXPORT_NOT_SAVED',
]);
/** The engine's own lines this screen words itself: why no PDF, and why a link shows no address. */
const LINES: Readonly<Record<string, string>> = Object.freeze({
  'A PDF needs the desktop app.': 'kit-report.note.hosted',
  'The PDF could not draw Hindi on this computer, so the report is the HTML file.': 'kit-report.note.hindi',
  'The PDF could not be made on this computer, so the report is the HTML file.': 'kit-report.note.failed',
  'Report links open only on the hosted Chausar with a public address. Send your client the report file yourself.': 'kit-report.reason.notServed',
  'The link was shown once, when it was made.': 'kit-report.reason.shownOnce',
  'You turned this link off. It no longer opens.': 'kit-report.reason.disabled',
  'This link has ended. Rotate it to share the report again.': 'kit-report.reason.ended',
});
const TYPES = { html: 'text/html', pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } as const;

function wordsOf(error: unknown, t: T): string {
  if (error instanceof EngineError && error.code === 'INVALID_VENTURE_REQUEST' && error.message.startsWith('This report has nothing from')) return t('kit-report.error.channel');
  if (error instanceof EngineError && WORDED.has(error.code)) return t(`kit-report.error.${error.code}`);
  return error instanceof Error ? error.message : String(error);
}
const lineOf = (line: string, t: T) => (LINES[line] ? t(LINES[line]) : line);
/** Today in India, as 2026-10-27: the default day of a share link's dates. */
const indiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

/** Saves bytes the engine sent as a file, without keeping them anywhere: a temporary address, clicked once, let go. */
function saveFile(name: string, contentBase64: string, type: string): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const binary = atob(contentBase64);
  const bytes = new Uint8Array(binary.length);
  for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at);
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.rel = 'noopener';
  document.body.append(link);
  try { link.click(); } finally {
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }
  return true;
}

/** A day like '14 Nov' on this computer's calendar. */
function useDay(): (iso: string) => string {
  const language = useLanguage();
  return useMemo(() => {
    const format = new Intl.DateTimeFormat(LOCALE[language], { day: 'numeric', month: 'short' });
    return (iso) => { const at = new Date(iso); return Number.isNaN(at.getTime()) ? iso : format.format(at); };
  }, [language]);
}

/**
 * One tile per draft of the order that has a report, or that the owner accepted or edited (so a report can be made).
 * A draft no longer accepted keeps its tile while its reports have links, so they can still be turned off.
 */
export function ReportFiles({ orderId, drafts }: { orderId: string; drafts: DeliveryLite[] }) {
  const listed = useResource('venture.report.list', { orderId });
  const reports = listed.data?.reports ?? [];
  const done = drafts.filter((draft) => !draft.practice && (draft.status === 'accepted' || draft.status === 'edited'));
  const runIds = [...new Set([...done.map((draft) => draft.id), ...reports.map((report) => report.runId)])];
  return (
    <>
      {runIds.map((runId) => (
        <DraftReport
          key={runId} runId={runId} draft={drafts.find((draft) => draft.id === runId) ?? null} canMake={done.some((draft) => draft.id === runId)}
          reports={reports.filter((report) => report.runId === runId)} reload={listed.reload}
        />
      ))}
    </>
  );
}

function DraftReport({ runId, draft, canMake, reports, reload }: { runId: string; draft: DeliveryLite | null; canMake: boolean; reports: ReportListItem[]; reload: () => void }) {
  const t = useT();
  const engine = useEngine();
  const headingId = useId();
  const [made, setMade] = useState<ReportView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [said, setSaid] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const latest = reports[0] ?? null;
  const shown = made && (!latest || made.id === latest.id) ? made : latest;
  const title = draft?.deliverable?.title ?? latest?.title ?? t('work.focus.draft');

  async function work(key: string, task: () => Promise<void>) {
    setBusy(key);
    setProblem(null);
    setSaid(null);
    try { await task(); } catch (error) {
      setProblem(t('kit-report.failed', { message: wordsOf(error, t) }));
    } finally {
      setBusy(null);
    }
  }

  const make = () => work('make', async () => {
    setMade(await engine.request('venture.report.render', { runId, formats: [...FORMATS] }));
    reload();
  });

  /** One file: the bytes from this page's own render, else the report is made again (the engine keeps no bytes). */
  const save = (name: string, format: keyof typeof TYPES | 'json') => work(name, async () => {
    let view = made && shown && made.id === shown.id ? made : null;
    if (!view) { view = await engine.request('venture.report.render', { runId, formats: [...FORMATS] }); setMade(view); reload(); }
    const file: Pick<ReportFileView, 'name' | 'contentBase64'> | undefined = format === 'json' ? view.manifest : view.files.find((item) => item.format === format);
    if (!file) return;
    if (!saveFile(file.name, file.contentBase64, format === 'json' ? 'application/json' : TYPES[format])) setProblem(t('kit-report.cantSave'));
  });

  /** Desktop: the desktop makes the report and writes every file into a folder the owner picks, atomically. */
  const saveAll = () => work('all', async () => {
    const saved = await engine.saveReport!(runId);
    if (saved) setSaid(t('kit-report.saved', { folder: saved.folder }));
    reload();
  });

  const again = canMake ? <Button variant="quiet" disabled={busy !== null} onClick={() => void make()}>{busy === 'make' ? t('kit-report.making') : t('kit-report.again')}</Button> : null;
  const links = reports.flatMap((report) => report.links);

  return (
    <Tile as="section" labelledBy={headingId}>
      <TileHead id={headingId} title={t('kit-report.heading')} />
      <div className={r.body}>
        <p className={r.line}>{t('kit-report.line')}</p>
        {shown && (
          <>
            <ul className={r.files} aria-label={t('kit-report.files', { title })}>
              {shown.files.map((file) => (
                <li key={file.name} className={r.file} data-report-file={file.format}>
                  <span className={`${r.name} mono`}>{file.name}</span>
                  {!engine.saveReport && (
                    <span className={r.act}>
                      <Button variant="quiet" disabled={busy !== null} aria-label={t('kit-report.saveName', { name: file.name })} onClick={() => void save(file.name, file.format)}>{t('kit-report.save')}</Button>
                    </span>
                  )}
                </li>
              ))}
              {!engine.saveReport && (
                <li className={r.file}>
                  <span className={r.quiet}>{t('kit-report.manifest')}</span>
                  <span className={r.act}>
                    <Button variant="quiet" disabled={busy !== null} aria-label={t('kit-report.saveName', { name: shown.manifest.name })} onClick={() => void save(shown.manifest.name, 'json')}>{t('kit-report.save')}</Button>
                  </span>
                </li>
              )}
            </ul>
            {shown.notes.map((note) => <p key={note} className={r.line} role="status">{lineOf(note, t)}</p>)}
            {shown.estimates > 0 && <p className={r.line} data-report-estimates="">{t('kit-report.estimates')} <ModelEstimate /></p>}
          </>
        )}
        {said && <p className={r.line} role="status">{said}</p>}
        {problem && <p className={r.problem} role="alert">{problem}</p>}
        {shown ? (
          <ShareReport
            key={shown.id} report={shown} links={links} reload={reload}
            again={<>{engine.saveReport && <Button variant="quiet" disabled={busy !== null} onClick={() => void saveAll()}>{busy === 'all' ? t('kit-report.saving') : t('kit-report.saveAll')}</Button>}{again}</>}
          />
        ) : canMake ? (
          <span className={r.act}>
            <Button variant="primary" disabled={busy !== null} onClick={() => void make()}>{busy === 'make' ? t('kit-report.making') : t('kit-report.make')}</Button>
          </span>
        ) : null}
      </div>
    </Tile>
  );
}

function ShareReport({ report, links, reload, again }: { report: Pick<ReportListItem, 'id' | 'channels' | 'period'>; links: ReportShareView[]; reload: () => void; again: ReactNode }) {
  const t = useT();
  const engine = useEngine();
  const day = useDay();
  const formId = useId();
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(report.period?.from ?? indiaToday());
  const [to, setTo] = useState(report.period?.to ?? indiaToday());
  const [channels, setChannels] = useState<string[]>(report.channels);
  /** An address shown once: the engine sends it only in the answer that made or rotated the link. */
  const [fresh, setFresh] = useState<ReportShareView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  async function act(key: string, work: () => Promise<ReportShareView>) {
    setBusy(key);
    setProblem(null);
    try {
      const view = await work();
      setFresh(view.url ? view : null);
      setOpen(false);
      reload();
    } catch (error) {
      setProblem(t('kit-report.share.failed', { message: wordsOf(error, t) }));
    } finally {
      setBusy(null);
    }
  }

  function copy(link: ReportShareView) {
    if (!link.url) return;
    try { void navigator.clipboard?.writeText(link.url).then(() => setCopied(link.id), () => setCopied(null)); } catch { setCopied(null); }
  }

  const views = (link: ReportShareView) => (link.views === 0 ? t('kit-report.share.viewsNone') : link.views === 1 ? t('kit-report.share.viewsOne') : t('kit-report.share.viewsMany', { count: String(link.views) }));
  // The list's links, the one just made or rotated with its address; a just-made link the list has not read yet comes first.
  const shown = [...(fresh && !links.some((link) => link.id === fresh.id) ? [fresh] : []), ...links.map((link) => (fresh && link.id === fresh.id ? { ...link, url: fresh.url } : link))];

  return (
    <>
      {open ? (
        <form
          className={r.form} aria-label={t('kit-report.share.form')} id={formId}
          onSubmit={(event) => {
            event.preventDefault();
            void act('new', () => engine.request('venture.report.share', { reportId: report.id, from, to, ...(report.channels.length ? { channels } : {}) }));
          }}
        >
          <Field label={t('kit-report.share.from')} type="date" value={from} required disabled={busy !== null} onChange={(event) => setFrom(event.currentTarget.value)} />
          <Field label={t('kit-report.share.to')} type="date" value={to} required disabled={busy !== null} onChange={(event) => setTo(event.currentTarget.value)} />
          {report.channels.length > 0 && (
            <fieldset className={r.checks}>
              <legend>{t('kit-report.share.channels')}</legend>
              {report.channels.map((channel) => (
                <label key={channel} className={r.check}>
                  <input
                    type="checkbox" checked={channels.includes(channel)} disabled={busy !== null}
                    onChange={(event) => { const on = event.currentTarget.checked; setChannels((now) => (on ? [...now, channel] : now.filter((item) => item !== channel))); }}
                  />
                  <span data-content="">{channel}</span>
                </label>
              ))}
            </fieldset>
          )}
          <span className={r.formAct}>
            <Button variant="quiet" type="button" disabled={busy !== null} onClick={() => setOpen(false)}>{t('kit-report.share.close')}</Button>
            <Button variant="quiet" type="submit" disabled={busy !== null || (report.channels.length > 0 && channels.length === 0)}>{busy === 'new' ? t('kit-report.share.making') : t('kit-report.share.make')}</Button>
          </span>
        </form>
      ) : (
        <span className={r.act}>
          {again}
          <Button variant="quiet" onClick={() => setOpen(true)}>{t('kit-report.share.open')}</Button>
        </span>
      )}
      {shown.length > 0 && (
        <ul className={r.links} aria-label={t('kit-report.share.links')}>
          {shown.map((link) => (
            <li key={link.id} className={r.link} data-report-link={link.state}>
              {link.url ? <span className={`${r.name} mono`}>{link.url}</span> : <span className={r.quiet}>{lineOf(link.reason ?? '', t)}</span>}
              {link.state === 'open' && LINES[link.reason ?? ''] !== 'kit-report.reason.notServed' && <span className={r.quiet}>{t('kit-report.share.until', { day: day(link.expiresAt) })}</span>}
              <span className={r.quiet}>{views(link)}</span>
              {link.state !== 'disabled' && (
                <span className={r.act}>
                  {link.url && <Button variant="quiet" onClick={() => copy(link)}>{copied === link.id ? t('kit-report.share.copied') : t('kit-report.share.copy')}</Button>}
                  <Button variant="quiet" disabled={busy !== null} onClick={() => void act(link.id, () => engine.request('venture.report.shareRotate', { shareId: link.id }))}>{t('kit-report.share.rotate')}</Button>
                  <Button variant="quiet" disabled={busy !== null} onClick={() => void act(link.id, () => engine.request('venture.report.shareDisable', { shareId: link.id }))}>{t('kit-report.share.off')}</Button>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {problem && <p className={r.problem} role="alert">{problem}</p>}
    </>
  );
}
