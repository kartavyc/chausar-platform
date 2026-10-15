import type { MethodSpec } from '../modules/types.ts';
import * as e from './enterprise.ts';
import { overview } from './company.ts';

/** Enterprise methods: caent.shell, enterprise.*, company.*. Every enterprise.* method but setup refuses ENTERPRISE_NOT_ON outside the enterprise shell. */
export const enterpriseMethods: Readonly<Record<string, MethodSpec>> = {
  'caent.shell': { permission: 'read', handler: e.shell },
  'enterprise.setup': { permission: 'admin', handler: e.setup },
  'enterprise.lens.get': { permission: 'read', handler: e.lensGet },
  'enterprise.lens.set': { permission: 'read', handler: e.lensSet },
  'enterprise.companies': { permission: 'read', handler: e.companies },
  'enterprise.company.set': { permission: 'read', handler: e.companySet },
  'enterprise.group.set': { permission: 'admin', handler: e.groupSet },
  'enterprise.whose.get': { permission: 'read', handler: e.whoseGet },
  'enterprise.whose.set': { permission: 'read', handler: e.whoseSet },
  'enterprise.whose.members': { permission: 'read', handler: e.whoseMembers },
  'enterprise.teams.list': { permission: 'read', handler: e.teamsList },
  'enterprise.teams.set': { permission: 'admin', handler: e.teamsSet },
  'enterprise.access.list': { permission: 'admin', handler: e.accessList },
  'enterprise.access.set': { permission: 'admin', handler: e.accessSet },
  'enterprise.access.review.start': { permission: 'admin', handler: e.reviewStart },
  'enterprise.access.review.decide': { permission: 'admin', handler: e.reviewDecide },
  'enterprise.access.reviews': { permission: 'admin', handler: e.reviews },
  'enterprise.channels.get': { permission: 'read', handler: e.channelsGet },
  'enterprise.channels.set': { permission: 'admin', handler: e.channelsSet },
  'enterprise.holds.list': { permission: 'admin', handler: e.holdsList },
  'enterprise.holds.place': { permission: 'admin', handler: e.holdsPlace },
  'company.overview': { permission: 'admin', handler: overview },
};
