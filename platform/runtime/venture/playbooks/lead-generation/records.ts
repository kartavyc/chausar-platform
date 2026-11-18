// Chausar lead generation desk rows. The source record itself is shared by every business (customers/sources/records.ts).
export type LeadDeskRow = { id: string; type: 'lead' | 'followup' | 'community'; name: string; email: string | null; sourceUrl: string | null; licence: string; status: string; due: string | null; draft: string | null };
