/** Pure shell boundaries, shared by the rendered frame and executable checks. */
import type { Address, ScreenState } from './presentation.ts';
import { sameAddress } from './routes.ts';

export interface AddressBoundSheet<T> {
  readonly address: Address;
  readonly content: T;
}

/** A delayed host reply may only fill the exact place, sub-place and sheet it read. */
export function sheetAtAddress<T>(address: Address | null, sheet: AddressBoundSheet<T> | undefined): T | undefined {
  if (address === null || address.sheet === undefined || sheet === undefined) return undefined;
  return sameAddress(address, sheet.address) ? sheet.content : undefined;
}

export function workspaceLocked(state: ScreenState): boolean {
  return state.kind === 'locked' || (state.kind === 'boundary-state' && state.source.kind === 'locked');
}

export interface PrimaryIntent {
  readonly money?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  readonly onPress: () => void;
}

/** Cancel the native Enter default before deciding whether the shortcut may run. */
export function dispatchSheetPrimary(event: { preventDefault(): void }, primary: PrimaryIntent | null): void {
  if (primary === null) return;
  event.preventDefault();
  if (!primary.money && !primary.disabled) primary.onPress();
}
