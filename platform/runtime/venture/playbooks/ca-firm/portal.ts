// AI-native CA firm: the final diff before filing. After the CA or the client prepares the return on the portal, the
// portal's own file (the ITR JSON, the GSTR summary) comes back as structured figures and is compared, field by
// field and by BigInt, with the figures on Chausar's receipts. Nothing is ready to file until the CA has accepted or
// explained every difference. Chausar never files; this only says whether the papers agree.
// Idea taken, code written here: NidheeshJain/itr-prep-skill (MIT), which diffs the portal's generated JSON against
// its data pack schedule by schedule before anyone files.
import { invalid, signedPaise } from './money.ts';

export type OurFigure = { key: string; label: string; minor: string; receiptId: string };
export type PortalFigure = { key: string; minor: string };
export type PortalRowState = 'same' | 'differs' | 'missing-on-portal' | 'only-on-portal';
export type PortalDiffRow = { key: string; label: string; state: PortalRowState; oursMinor: string | null; portalMinor: string | null; deltaMinor: string; receiptId: string | null };
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
    return { key, label: mine?.label ?? key, state, oursMinor: mine?.minor ?? null, portalMinor: theirs?.minor ?? null, deltaMinor: String(delta), receiptId: mine?.receiptId ?? null };
  });
  const differences = rows.filter(row => row.state !== 'same').length;
  return { rows, clean: differences === 0, differences };
}

/** Ready to file only when every row that is not the same carries the CA's explanation. */
export function portalDiffReady(diff: PortalDiff, explanations: Readonly<Record<string, string>>): { ready: boolean; unexplained: string[] } {
  const unexplained = diff.rows.filter(row => row.state !== 'same' && !(typeof explanations[row.key] === 'string' && explanations[row.key].trim())).map(row => row.key);
  return { ready: unexplained.length === 0, unexplained };
}
