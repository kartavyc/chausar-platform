/**
 * The hosted-link lane's screens, through the place-module seam. Both are Tools sub-places next
 * to Phone (TL-09, drawn by reports-tools-trust): tools/phonedocs (PH-05) and tools/phonelog.
 */
import type { Address } from '../../app/presentation.ts';
import type { PlaceModule } from '../../places/types.ts';
import { LostMessagesPlace } from './LostMessages';
import { PhoneDocumentsPlace } from './PhoneDocuments';

export const SUB_PLACES = ['phonedocs', 'phonelog'] as const;

const at = (sub: (typeof SUB_PLACES)[number]) => (address: Address) => address.place === 'tools' && address.sub === sub;

export const hostedLinkScreens: readonly PlaceModule[] = [
  { id: 'hosted-link.phonedocs', handles: at('phonedocs'), render: (props) => <PhoneDocumentsPlace key={props.address.sub} {...props} /> },
  { id: 'hosted-link.phonelog', handles: at('phonelog'), render: (props) => <LostMessagesPlace key={props.address.sub} {...props} /> },
];
