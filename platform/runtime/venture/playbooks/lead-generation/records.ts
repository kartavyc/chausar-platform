// Chausar lead sources. Contacts stay in W4; community evidence is explicitly owner-approved and erasable.
import type { CommunityInput } from './community-core.ts';
export type LeadSourceBody = { source: 'osm' | 'walk-in' | 'referral' | 'happenstance' | 'community'; url: string | null; licence: string; fetchedAt: string; leadId: string | null; personId: string | null; importId: string | null; sourceId: string | null; domain: string | null; community?: CommunityInput };
export type LeadDeskRow = { id: string; type: 'lead' | 'followup' | 'community'; name: string; email: string | null; sourceUrl: string | null; licence: string; status: string; due: string | null; draft: string | null };
