import type { ReactNode } from 'react';
import type { PlaceModule } from '../../places/types.ts';
import { isCxSub, type CxProps, type CxSub } from './shared.tsx';
import { Scheduled } from './Scheduled.tsx';
import { Database } from './Database.tsx';
import { TallyExport } from './TallyExport.tsx';

const SCREENS: Readonly<Record<CxSub, (props: CxProps) => ReactNode>> = { scheduled: Scheduled, database: Database, 'tally-export': TallyExport };

/** The Books sub-places this lane draws: scheduled reads, the database road, Tally on another computer. */
export const connectorsBooksPlace: PlaceModule = {
  id: 'connectors-ext.books',
  handles: address => address.place === 'books' && isCxSub(address.sub),
  render: props => {
    if (!isCxSub(props.address.sub)) return null;
    const Screen = SCREENS[props.address.sub];
    return <Screen key={`${props.address.sub}:${props.language}`} {...props} />;
  },
};
