/**
 * Worth a look (TD-01): from a validated `todayx.worthALook` reply to the rows Today draws.
 *
 * Pure. The reply was checked with `isWorthReply` before it reached here. The words of a
 * row come from its `kind`; the subject is text from the books or a name, shown as
 * written beside them and never translated. A figure is formatted by the format module
 * from its exact digits and opens its own receipt. A figure that moved carries "lead, not
 * tested" until a cause was measured: it never offers a cause as fact. A reply that is
 * not loaded yet gives the missing words, never an empty list that reads as "nothing".
 */

import type { Address, FigureOrMissing, Language, Mark, Missing, RowItem, View } from '../../app/presentation.ts';
import type { WorthKind, WorthReply, WorthRow } from '../../bridge/todayx-contract.ts';
import { parseAddress } from '../../app/routes.ts';
import { money, moneyShort } from '../../format/money.ts';
import { count, percent } from '../../format/counts.ts';
import { date } from '../../format/dates.ts';
import { catalogueText } from '../../format/sentences.ts';

/** Worth-a-look row ids are kept apart from review row ids. */
export const WORTH_ROW_PREFIX = 'worth:';
/** At most five rows arrive; at rest the screen shows fewer when review rows take room. */
export const WORTH_MAX = 5;

export interface WorthProjection {
  readonly rows: ReadonlyArray<RowItem>;
  /** Set when the reply is not loaded yet: the section shows these words. */
  readonly missing?: Missing;
  /** Where each row opens, by row id. A row absent here opens nothing. */
  readonly opens: ReadonlyArray<{ readonly rowId: string; readonly address: Address }>;
}

const MARK: Readonly<Record<WorthKind, Mark>> = {
  moved: 'cha',
  'due-soon': 'you',
  'decision-due': 'you',
  'file-refused': 'unsure',
  'brief-late': 'unsure',
  'missed-while-asleep': 'unsure',
  'approval-expired': 'unsure',
  'update-ready': 'cha',
  setup: 'you',
};

/** A worth-a-look figure, formatted for the view. Simple spells the short form out. */
function figureOf(row: WorthRow, view: View, language: Language): FigureOrMissing | undefined {
  const f = row.figure;
  if (f === undefined) return undefined;
  try {
    if (f.unit === 'paise') {
      const display = view === 'simple'
        ? moneyShort(f.exact, { lakh: catalogueText(language, 'TD-01.worth.lakh'), crore: catalogueText(language, 'TD-01.worth.crore') })
        : money(f.exact);
      return { kind: 'money', exact: f.exact, display, receiptId: f.receiptId, labels: [] };
    }
    if (f.unit === 'count') return { kind: 'count', exact: f.exact, display: count(f.exact), receiptId: f.receiptId, labels: [] };
    return { kind: 'percent', exact: f.exact, display: percent(f.exact), receiptId: f.receiptId, labels: [] };
  } catch {
    // A value the format module cannot show exactly is shown as words, never guessed.
    return { kind: 'missing', missing: 'unknown' };
  }
}

function noteOf(row: WorthRow, language: Language): string | undefined {
  if (row.kind === 'moved') return catalogueText(language, `TD-01.worth.finding.${row.finding ?? 'lead-not-tested'}`);
  if (row.at === null) return undefined;
  const day = date(row.at.slice(0, 10), 'short', language);
  return catalogueText(language, row.kind === 'due-soon' ? 'TD-01.worth.due' : 'TD-01.worth.at', { date: day });
}

/** The hash an engine row names, as a checked address. A hash for an unknown place is dropped. */
function addressOf(opens: string | null): Address | null {
  if (opens === null) return null;
  const address = parseAddress(opens);
  return opens.startsWith(`#/${address.place}`) ? address : null;
}

export function projectWorth(reply: WorthReply, context: { readonly language: Language; readonly view: View }): WorthProjection {
  if (reply.state === 'not-loaded-yet') return { rows: [], missing: 'not-loaded-yet', opens: [] };
  const rows: RowItem[] = [];
  const opens: { rowId: string; address: Address }[] = [];
  for (const row of reply.rows.slice(0, WORTH_MAX)) {
    const id = `${WORTH_ROW_PREFIX}${row.id}`;
    const address = addressOf(row.opens);
    const figure = figureOf(row, context.view, context.language);
    const note = noteOf(row, context.language);
    rows.push({
      id,
      mark: MARK[row.kind],
      what: catalogueText(context.language, `TD-01.worth.kind.${row.kind}`),
      ...(note !== undefined ? { note } : {}),
      ...(row.subject !== null ? { asWritten: row.subject } : {}),
      ...(figure !== undefined ? { figure } : {}),
      can: address !== null ? ['open'] : [],
    });
    if (address !== null) opens.push({ rowId: id, address });
  }
  return { rows, opens };
}

/** The address a projected row opens, or null. */
export function worthAddress(projection: WorthProjection, rowId: string): Address | null {
  return projection.opens.find((o) => o.rowId === rowId)?.address ?? null;
}
