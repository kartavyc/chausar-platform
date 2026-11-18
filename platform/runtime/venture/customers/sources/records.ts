// Chausar lead sources, shared by every business: where one lead or person came from, kept beside it for as long as
// it is kept (venture-lead-source). url and licence are the source's own; sourceId is its stable id there and domain
// the business's own site, both used to tell a lead the business already has. searchId: the search that found it
// (customers/find-run.ts); server: the connected tool's name, for source 'connected'. community is the lead generation
// playbook's owner-pasted evidence (playbooks/lead-generation), explicitly owner-approved and erasable.
import type { CommunityInput } from '../../playbooks/lead-generation/community-core.ts';
export type LeadSourceKind = 'osm' | 'walk-in' | 'referral' | 'happenstance' | 'community' | 'connected';
export type LeadSourceBody = {
  source: LeadSourceKind; url: string | null; licence: string; fetchedAt: string; leadId: string | null; personId: string | null; importId: string | null;
  sourceId: string | null; domain: string | null; community?: CommunityInput; searchId?: string; server?: string;
};
