/**
 * Reporting a fault (SH-11). The whole report is shown as text before it goes anywhere:
 * app version, operating system, kinds of events, route health, error codes. The fixed top
 * line says what is never in it. Save as a file is always offered (the person sends it
 * themselves). After a crash, Send report and Don't send are offered too. Nothing is sent
 * unless the person presses Send report: there is no default, no timer and no telemetry.
 *
 * A sheet body: the host places it in a Sheet. It takes a report already validated with
 * isFaultReport; every action is a callback intent.
 */

import type { FaultReport as FaultReportData } from '../bridge/todayx-contract.ts';
import { useT } from './text';
import { Button } from '../parts/Button';
import s from './ShellSheets.module.css';

export interface FaultReportProps {
  report: FaultReportData;
  /** `todayx.faultReport` save: write the same text to a file the person chooses. */
  onSave: () => void;
  /** Present only after a crash. Both or neither. */
  crash?: { onSend: () => void; onDontSend: () => void } | undefined;
}

/** The report's fields as plain text, in a fixed order. */
export function faultReportBody(r: FaultReportData): string {
  const lines = [
    `app ${r.appVersion}`,
    `os ${r.os}`,
    `created ${r.createdAt}`,
    `events ${r.eventKinds.length > 0 ? r.eventKinds.join(', ') : '-'}`,
    `routes ${r.routeHealth.length > 0 ? r.routeHealth.map((x) => `${x.kind} ${x.state}`).join(', ') : '-'}`,
    `codes ${r.errorCodes.length > 0 ? r.errorCodes.join(', ') : '-'}`,
  ];
  return lines.join('\n');
}

/** The report exactly as it would be saved or sent: the fixed top line, then the fields. */
export function faultReportText(r: FaultReportData, header: string): string {
  return `${header}\n\n${faultReportBody(r)}`;
}

export function FaultReport({ report, onSave, crash }: FaultReportProps) {
  const t = useT();
  const header = t('SH-11.header');
  return (
    <div className={s.stack}>
      <p className={s.p} data-fault-header="">
        {header}
      </p>
      <pre className={s.code} aria-label={t('SH-11.label')}>
        {faultReportBody(report)}
      </pre>
      <p className={s.note}>{crash ? t('SH-11.crash') : t('SH-11.nothing')}</p>
      <div className={s.actions}>
        {crash && (
          <Button variant="filled" onClick={crash.onSend}>
            {t('SH-11.send')}
          </Button>
        )}
        {crash && <Button onClick={crash.onDontSend}>{t('SH-11.dontSend')}</Button>}
        <Button variant={crash ? 'link' : 'quiet'} onClick={onSave}>
          {t('SH-11.save')}
        </Button>
      </div>
    </div>
  );
}
