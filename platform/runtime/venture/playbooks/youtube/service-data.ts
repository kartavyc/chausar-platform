// Shared exact section contract for native and demonstration service drafts.
import type {YoutubeServiceId} from './offers2.ts';
export const YOUTUBE_SERVICE_SECTIONS:Record<YoutubeServiceId,string[]>={
 'channel-audit':['One fix','Three things to keep','Not yet','Coverage'],
 'weekly-plan':['Anchor','Cheap piece','Three Shorts','Time allowance','Drop first'],
 'packaging-per-video':['Title options','Opening description','Hook script','Thumbnail direction','Community posts'],
 'comment-triage':['Counts','Questions','Praise','Actionable feedback','Held bait','Replies','Pin'],
 'comment-insights':['Repeated questions','Idea suggestions','Source coverage'],
 'niche-report':['Coverage','Observed','Interpretation','Caveats'],
 'screencast-tutorial':['Long video','Three Shorts','Publishing texts','Board handoff'],
 'after-publish-review':['One directive','Source evidence','Thresholds','Coverage'],
};
