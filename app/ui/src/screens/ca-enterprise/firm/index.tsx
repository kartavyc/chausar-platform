import type { ReactNode } from 'react';
import type { PlaceModule, PlaceRenderProps } from '../../../places/types.ts';
import { CaFirmScreen } from './CaFirm';
import { ClientsScreen } from './Clients';
import { ClientAccessScreen, FirmNameScreen, InviteScreen } from './Firm';
import { LibraryScreen } from './Library';
import { ManyScreen } from './Many';
import { CosignScreen, HandoverScreen, QuestionsScreen } from './PerClient';
import { FirmTodayScreen } from './Today';
import { firmScreenFor, type FirmScreen } from './routing.ts';

const DRAW: Readonly<Record<FirmScreen, (p: PlaceRenderProps) => ReactNode>> = {
  today: (p) => <FirmTodayScreen p={p} />,
  clients: (p) => <ClientsScreen p={p} />,
  cosign: (p) => <CosignScreen p={p} />,
  many: (p) => <ManyScreen p={p} />,
  questions: (p) => <QuestionsScreen p={p} />,
  handover: (p) => <HandoverScreen p={p} />,
  library: (p) => <LibraryScreen p={p} />,
  invite: (p) => <InviteScreen p={p} />,
  firmname: (p) => <FirmNameScreen p={p} />,
  clientaccess: (p) => <ClientAccessScreen p={p} />,
  cafirm: (p) => <CaFirmScreen p={p} />,
};

/** CA console screens (ca-firm shell, CA-01..CA-11 except CA-03) and the client's "Your CA firm".
 *  Each module claims only its own address (routing.ts); every one is keyed by the address so a
 *  new address starts from a clean page. */
export const firmPlaces: readonly PlaceModule[] = (Object.keys(DRAW) as FirmScreen[]).map((screen) => ({
  id: `ca-firm-${screen}`,
  handles: (address) => firmScreenFor(address) === screen,
  render: (p) => <FirmPage key={`${p.address.place}/${p.address.sub ?? ''}`} screen={screen} p={p} />,
}));

function FirmPage({ screen, p }: { screen: FirmScreen; p: PlaceRenderProps }) {
  return <>{DRAW[screen](p)}</>;
}
