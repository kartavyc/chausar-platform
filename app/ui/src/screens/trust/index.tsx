import type { ReactNode } from 'react';
import type { Address } from '../../app/presentation.ts';
import { words, type PlaceModule, type PlaceRenderProps } from '../../places/types.ts';
import { Screen } from './kit/Screen';
import { KeepView } from './Keep';
import { ModelsScreen } from './Models';
import { NetworkScreen } from './Network';
import { PeopleScreen } from './People';
import { RecordScreen } from './Record';
import { RulesScreen } from './Rules';
import { SeeView } from './See';
import { SharingScreen } from './Sharing';
import { VaultScreen } from './Vault';
// TR-07/12/14 vault-hosted-keys
import { DevicesScreen } from './Devices';
import { HostedScreen } from './Hosted';
import { KeysScreen } from './Keys';
import { COMMON } from './words.ts';

function place(id: string, subs: readonly (string | undefined)[], draw: (props: PlaceRenderProps) => ReactNode): PlaceModule {
  return { id: `trust.${id}`, handles: (a: Address) => a.place === 'trust' && subs.includes(a.sub), render: draw };
}

/** Enterprise channels: authored as a sub-place, not built yet. */
function Channels(p: PlaceRenderProps) {
  const c = words(COMMON, p.language);
  return <Screen where={c.whereChannels} title={c.channels} loaded={{ kind: 'not-built' }}>{() => null}</Screen>;
}

/**
 * Trust: every sub-place drawn by this lane. A bare `trust` address draws Rules. The
 * enterprise sub-places draw the matching desktop screen: access is People, markings is
 * See, retention is Keep.
 */
export const trustPlaces: readonly PlaceModule[] = [
  place('rules', [undefined, 'rules'], (p) => <RulesScreen {...p} />),
  place('people', ['people', 'access'], (p) => <PeopleScreen {...p} />),
  place('models', ['models'], (p) => <ModelsScreen {...p} />),
  place('network', ['network'], (p) => <NetworkScreen {...p} />),
  place('record', ['record'], (p) => <RecordScreen {...p} />),
  place('sharing', ['sharing'], (p) => <SharingScreen {...p} />),
  place('vault', ['vault'], (p) => <VaultScreen {...p} />),
  place('markings', ['markings'], (p) => <SeeView p={p} mode="page" />),
  place('retention', ['retention'], (p) => <KeepView p={p} mode="page" />),
  place('channels', ['channels'], (p) => <Channels {...p} />),
  // TR-07/12/14 vault-hosted-keys
  place('keys', ['keys'], (p) => <KeysScreen {...p} />),
  place('devices', ['devices'], (p) => <DevicesScreen {...p} />),
  place('hosted', ['hosted'], (p) => <HostedScreen {...p} />),
  // end TR-07/12/14 vault-hosted-keys
];
