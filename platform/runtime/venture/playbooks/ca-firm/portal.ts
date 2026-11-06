// AI-native CA firm: the final diff before filing. After the CA or the client prepares the return on the portal, the
// portal's own file (the ITR JSON, the GSTR summary) comes back as structured figures and is compared, field by
// field and by BigInt, with the figures on Chausar's receipts. Nothing is ready to file until the CA has accepted or
// explained every difference. Chausar never files; this only says whether the papers agree.
// Idea taken, code written here: NidheeshJain/itr-prep-skill (MIT), which diffs the portal's generated JSON against
// its data pack schedule by schedule before anyone files.
import { invalid, signedPaise } from './money.ts';
import { ReceiptBuilder, type CaReceipt } from './receipt.ts';

export type OurFigure = { key: string; label: string; minor: string; receiptId: string; rule?: string };
export type PortalFigure = { key: string; minor: string };
export type PortalRowState = 'same' | 'differs' | 'missing-on-portal' | 'only-on-portal';
export type PortalDiffRow = { key: string; label: string; state: PortalRowState; oursMinor: string | null; portalMinor: string | null; deltaMinor: string; receiptId: string | null; rule?: string };
export type PortalDiff = { rows: PortalDiffRow[]; clean: boolean; differences: number };

const KEY = /^[a-z0-9][a-z0-9.-]{0,79}$/;

/** Every key on either side, in key order. deltaMinor is the portal's figure less ours. */
export function diffAgainstPortal(input: { ours: OurFigure[]; portal: PortalFigure[] }): PortalDiff {
  if (!input || !Array.isArray(input.ours) || !Array.isArray(input.portal)) invalid('Send our figures and the portal figures as lists.');
  const ours = new Map<string, OurFigure>();
  for (const item of input.ours) {
    if (!item || !KEY.test(item.key) || ours.has(item.key)) invalid('Each of our figures needs a short key of its own.');
    signedPaise(item.minor, `Our ${item.key}`);
    if (typeof item.receiptId !== 'string' || !item.receiptId) invalid(`Our ${item.key} needs the receipt it came from.`);
    ours.set(item.key, item);
  }
  const portal = new Map<string, PortalFigure>();
  for (const item of input.portal) {
    if (!item || !KEY.test(item.key) || portal.has(item.key)) invalid('Each portal figure needs a short key of its own.');
    signedPaise(item.minor, `The portal's ${item.key}`);
    portal.set(item.key, item);
  }
  const keys = [...new Set([...ours.keys(), ...portal.keys()])].sort();
  const rows: PortalDiffRow[] = keys.map(key => {
    const mine = ours.get(key), theirs = portal.get(key);
    const state: PortalRowState = !theirs ? 'missing-on-portal' : !mine ? 'only-on-portal' : BigInt(mine.minor) === BigInt(theirs.minor) ? 'same' : 'differs';
    const delta = (theirs ? BigInt(theirs.minor) : 0n) - (mine ? BigInt(mine.minor) : 0n);
    return { key, label: mine?.label ?? key, state, oursMinor: mine?.minor ?? null, portalMinor: theirs?.minor ?? null, deltaMinor: String(delta), receiptId: mine?.receiptId ?? null, ...(mine?.rule ? { rule: mine.rule } : {}) };
  });
  const differences = rows.filter(row => row.state !== 'same').length;
  return { rows, clean: differences === 0, differences };
}

const STATE_WORDS: Readonly<Record<PortalRowState, string>> = {
  same: 'the portal agrees', differs: 'the portal less ours', 'missing-on-portal': 'not on the portal', 'only-on-portal': 'only on the portal',
};

/**
 * The diff as a CA receipt (Ink v2 2A2): one figure per key, the portal's figure less ours, so a stored diff can be
 * worked again from its inputs and quoted by reference. The same inputs always give the same receipt.
 */
export function portalDiffReceipt(input: { ours: OurFigure[]; portal: PortalFigure[]; includeBothSides?: boolean }): CaReceipt<PortalDiff> {
  const diff = diffAgainstPortal(input);
  if (!diff.rows.length) invalid('There is nothing to compare: name our figures and the portal figures.');
  const builder = new ReceiptBuilder('portal-diff');
  for (const row of diff.rows) {
    if (input.includeBothSides) {
      if (row.oursMinor !== null) builder.step('ours.' + row.key, row.label + ': fresh computation', BigInt(row.oursMinor));
      if (row.portalMinor !== null) builder.step('return.' + row.key, row.label + ': supplied return', BigInt(row.portalMinor));
    }
    builder.step(row.key, row.label + ': ' + STATE_WORDS[row.state], BigInt(row.deltaMinor));
  }
  builder.assume('Figures are compared by key, to the paisa. A key only one side has is a difference too.');
  const open = diff.rows.filter(row => row.state !== 'same').map(row => row.key);
  return builder.build(input, diff, open.length
    ? `The portal's figures against the receipts: ${open.length} ${open.length === 1 ? 'difference' : 'differences'} (${open.join(', ')}) for the CA to accept or explain.`
    : "The portal's figures agree with the receipts on every key.");
}

/** Ready to file only when every row that is not the same carries the CA's explanation. */
export function portalDiffReady(diff: PortalDiff, explanations: Readonly<Record<string, string>>): { ready: boolean; unexplained: string[] } {
  const unexplained = diff.rows.filter(row => row.state !== 'same' && !(typeof explanations[row.key] === 'string' && explanations[row.key].trim())).map(row => row.key);
  return { ready: unexplained.length === 0, unexplained };
}
