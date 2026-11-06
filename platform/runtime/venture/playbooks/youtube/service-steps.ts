// Original B3 writing contracts. Every output remains a draft for its exact owner-added service.
import type {YoutubeStep} from './playbook.ts';
import {DRAFT_CHECKS} from '../../delivery/check-lists.ts';
import {YOUTUBE_OFFERS2,type YoutubeServiceId} from './offers2.ts';
import {YOUTUBE_SERVICE_SECTIONS} from './service-data.ts';
export {YOUTUBE_SERVICE_SECTIONS} from './service-data.ts';
export const YOUTUBE_SERVICE_GUIDANCE:Record<YoutubeServiceId,string[]>={
 'channel-audit':['Name exactly one fix this week, three things to keep, and one thing not to do yet. Base each on the client channel sources.'],
 'weekly-plan':['Plan exactly one anchor, one cheap piece and three Shorts. Put each piece on its own line as Name: 90 minutes with the actual estimated minutes.','Label model estimates, fit the owner allowance, and put the exact one piece name under Drop first.'],
 'packaging-per-video':['Keep chapters inside the source recording: start at 0:00, at least three chapters, each at least ten seconds.','All three owner target searches must appear in the title and first two description lines.','Under Thumbnail direction write Direction: followed by the visual direction, then separate Words: lines for each variation. Unsupported thumbnail words fail.'],
 'comment-triage':['Show source counts before four piles. Never answer bait. Each reply is thirty words or fewer. Write each reply on its own line as commentId: reply.','Put exactly one non-bait comment ID under Pin; posting remains manual.'],
 'comment-insights':['Only repeated questions with at least three source comments become proposed ideas. Keep the source comment IDs; the owner adds an idea explicitly.'],
 'niche-report':['Read exact source figures through the YouTube computation receipt. Put a caveat beside every figure and separate observed facts from interpretation. Missing counts remain missing.'],
 'screencast-tutorial':['Use the current approved board export: one long-video handoff and three measured independent Shorts. Scripted recordings need the approved source script and complete speech coverage.','Write one Long video line and three Three Shorts lines. Under Publishing texts write exactly Long:, Short 1:, Short 2: and Short 3: lines.','For each flagged intake use, every publishing text must include Uses an AI voice., Uses an AI presenter., or Contains paid promotion.','When applicable, Board handoff must instruct: At upload, turn on the AI use setting and paid promotion setting.','Board handoff must say editor instructions only. The owner renders and publishes manually; do not claim these videos were already rendered or posted.'],
 'after-publish-review':['Use exactly the source-backed directive sentence: Improve the title and thumbnail.; Improve the opening.; Make more clips for the measured search intent.; Repeat this packaging approach.', 'The remaining directive is: Collect the missing evidence first. Quote its receipt and show owner or house thresholds. Missing evidence means collect evidence, never invent analytics.'],
};
export const YOUTUBE_SERVICE_STEPS:readonly YoutubeStep[]=YOUTUBE_OFFERS2.map(offer=>({
 id:offer.id,kind:'write',title:offer.name,role:{kind:'agent',name:['comment-triage','comment-insights'].includes(offer.id)?'Community helper':['packaging-per-video','screencast-tutorial'].includes(offer.id)?'Packager':'Analyst',job:offer.description},
 tier:'actor',model:'main',tools:[],checks:DRAFT_CHECKS,youtubeChecks:[],requiredSections:YOUTUBE_SERVICE_SECTIONS[offer.id],clipping:false,gate:null,floor:null,
}));
