import type { Figure, PhoneHeadlineView, CAClientStatusView, RowView } from '../src/bridge/presentation.ts';
import type { DesktopEngineReadPort, EnterpriseStatusReader } from '../src/bridge/contract.ts';
import type { UIFigureProjection, UICountProjection, UIRowProjection, UIChartProjection, UIChartAvailability, UIStatProjection, UIDayEventProjection, UIScreenStateProjection, UITodayDataProjection } from '../src/bridge/project-ui.ts';
import type { FigureOrMissing, Count, RowItem, Chart, ChartAvailability, StatTile, DayEvent, ScreenState } from '../src/app/presentation.ts';
import type { TodayData } from '../src/screens/today/TodayData.ts';
import type { BrowserTodayReadPort, DesktopTodayReadPort, TodayHostUiProjection } from '../src/bridge/today-host.ts';

// These are compile-time negative boundary cases, checked by TypeScript 5.9 strict.
const exactMoney: Figure = { kind: 'money', currency: 'INR', paise: '900719925474099391', receiptId: 'receipt_exact', labels: [] };
void exactMoney;
// @ts-expect-error Business money may not become a floating JavaScript number.
const numericMoney: Figure = { kind: 'money', currency: 'INR', paise: 1.01, receiptId: 'receipt_exact', labels: [] };
void numericMoney;
// @ts-expect-error Missing is a categorical state, with no money or receipt masquerading as known.
const missingZero: Figure = { kind: 'missing', state: 'unknown', paise: '0', receiptId: 'receipt_exact' };
void missingZero;
// @ts-expect-error Every known figure has a receipt and qualification labels.
const unreceipted: Figure = { kind: 'count', count: '3' };
void unreceipted;
// @ts-expect-error Percent units are an exact string of basis points, not a money object.
const wrongPercent: Figure = { kind: 'percent', paise: '3140', currency: 'INR', receiptId: 'receipt_exact', labels: [] };
void wrongPercent;
// @ts-expect-error A guess is words and evidence, with no measured money including zero.
const guessedMoney: RowView = { id: 'possible_cause', mark: 'guess', title: 'Possible cause', note: '', figure: exactMoney };
void guessedMoney;
// @ts-expect-error Phone headlines cannot carry book names or amounts.
const leakedPhone: PhoneHeadlineView = { id: 'phone_fixture', template: 'review-waiting', linkId: 'link_fixture', approval: null, customerName: 'Private fixture', paise: '10' };
void leakedPhone;
// @ts-expect-error CA cross-client rows expose status metadata only.
const leakedCA: CAClientStatusView = { clientId: 'client_fixture', clientLabel: 'Client fixture', booksReadAt: null, closeState: 'unknown', awaitingFirm: null, nextDueDate: null, balance: exactMoney };
void leakedCA;
function onlyDeclaredMethods(port: DesktopEngineReadPort, enterprise: EnterpriseStatusReader): void {
  // @ts-expect-error This read port cannot execute an approval or arbitrary engine method.
  void port.request('actions.execute', { id: 'approval_fixture' });
  // @ts-expect-error Enterprise results are a separate API, not desktop receipt aliases.
  void enterprise.receipt('receipt_exact');
}
void onlyDeclaredMethods;

/** Compare to actual component DTOs without adding React dependencies or using casts.
 * The delivered bridge remains independent; this compile check catches DTO drift. */
function actualComponentCompatibility(
  figure: UIFigureProjection, count: UICountProjection, row: UIRowProjection,
  chart: UIChartProjection, chartState: UIChartAvailability, stat: UIStatProjection,
  event: UIDayEventProjection, state: UIScreenStateProjection, today: UITodayDataProjection,
): void {
  const actualFigure: FigureOrMissing = figure;
  const actualCount: Count = count;
  const actualRow: RowItem = row;
  const actualChart: Chart = chart;
  const actualChartState: ChartAvailability = chartState;
  const actualStat: StatTile = stat;
  const actualEvent: DayEvent = event;
  const actualState: ScreenState = state;
  const actualToday: TodayData = today;
  void [actualFigure, actualCount, actualRow, actualChart, actualChartState, actualStat, actualEvent, actualState, actualToday];
}
void actualComponentCompatibility;

function onlyActualTodayMethods(desktop: DesktopTodayReadPort, browser: BrowserTodayReadPort): void {
  // @ts-expect-error Dashboard forwards only an explicit period, not a branch filter.
  void desktop.request('dashboard.get', { branch: 'main' });
  // @ts-expect-error Today has no arbitrary mutation method or independent enterprise API alias.
  void desktop.request('actions.execute', { id: 'action_fixture' });
  // @ts-expect-error Browser's actual dashboard schema does not receive credentials or model routes.
  void browser.call({ method: 'dashboard.get', payload: { token: 'private', routeId: 'model_fixture' } });
}
void onlyActualTodayMethods;

function actualHostGapCompatibility(host: TodayHostUiProjection): void {
  const actual: TodayData = host.data;
  const activityGap: TodayData['earlierTodayMissing'] = host.data.earlierTodayMissing;
  void [actual, activityGap];
}
void actualHostGapCompatibility;
