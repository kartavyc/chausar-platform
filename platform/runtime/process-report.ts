// A2: Node's process report (process.report, used when a report is written on a fault) looks up the machine's network
// interfaces and host names unless told not to, and on some Windows set-ups that lookup can hold the event loop for
// seconds in the middle of an AI run. The engine worker imports this file first, so the setting holds before any other
// module loads. (Node 24 has the setting; the pinned @types/node predates it, so it is named here.)
export const REPORT_EXCLUDES_NETWORK = true;
export type ReportSettings = NodeJS.ProcessReport & { excludeNetwork: boolean };
(process.report as ReportSettings).excludeNetwork = REPORT_EXCLUDES_NETWORK;
