/**
 * Enterprise screens (enterprise shell). One module, looked up before every other lane's: it
 * draws only addresses the desktop shell never has (Company and its nine sub-places, Trust
 * Channels, Books Companies) and this lane's own sub-places (Trust Reviews, Teams, Holds,
 * Edition). See routing.ts.
 *
 * Cross-lane offer: `WhoseControl` (with `useWhose` and `useWhoseMembers`) draws Mine, My team,
 * Everyone above any list and keeps the choice per list id through `enterprise.whose.*`.
 */
import type { PlaceModule, PlaceRenderProps } from '../../../places/types.ts';
import { ChannelsScreen } from './Channels';
import { CompaniesScreen } from './Companies';
import { CompanyScreen } from './Company';
import { EditionScreen } from './Edition';
import { HoldsScreen } from './Holds';
import { ReviewsScreen } from './Reviews';
import { TeamsScreen } from './Teams';
import { enterpriseRoute, handlesEnterprise } from './routing.ts';

export { WhoseControl, useWhose, useWhoseMembers } from './WhoseControl';

function render(p: PlaceRenderProps) {
  const route = enterpriseRoute(p.address);
  if (route === null) return null;
  const key = `${p.address.place}/${p.address.sub ?? ''}`;
  switch (route.screen) {
    case 'company': return <CompanyScreen key={key} p={p} sub={route.sub} />;
    case 'channels': return <ChannelsScreen key={key} p={p} />;
    case 'reviews': return <ReviewsScreen key={key} p={p} />;
    case 'teams': return <TeamsScreen key={key} p={p} />;
    case 'holds': return <HoldsScreen key={key} p={p} />;
    case 'edition': return <EditionScreen key={key} p={p} />;
    case 'companies': return <CompaniesScreen key={key} p={p} />;
  }
}

export const enterprisePlaces: readonly PlaceModule[] = [
  { id: 'ca-enterprise.enterprise', handles: handlesEnterprise, render },
];
