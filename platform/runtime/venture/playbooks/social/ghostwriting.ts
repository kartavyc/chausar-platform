// A single-post revision lands only its selected post. Other words are immutable.
import { check } from '../../../contracts.ts';
import type { Deliverable, DeliveryRunRecord } from '../../contracts.ts';
import { socialDraftPosts } from './draft-posts.ts';
import { actualSocialPostLocations } from './post-label.ts';
export function preserveOtherPosts(run: DeliveryRunRecord, candidate: Deliverable): Deliverable {
    const pin = run.revision?.socialPost;
    if (!pin)
        return candidate;
    check(run.deliverable, 'SOCIAL_REVISION_SHAPE', 'The original post pack is missing.');
    if(run.editedText){
      const surrounding=(text:string)=>{const postLines=new Set(actualSocialPostLocations(text).map(post=>post.lineIndex));return text.split(/\r?\n/).filter((_,index)=>!postLines.has(index)).join('\n');};
      check(surrounding(run.editedText)===surrounding(run.renderedText??''),'SOCIAL_REVISION_SHAPE','This pack has edits outside its posts. Keep those edits in the structured draft before refining one post.');
    }
    const originalPosts = socialDraftPosts(run.deliverable);
    check(originalPosts.length === pin.posts.length && originalPosts.every((p,i)=>p.channel===pin.posts[i]?.channel), 'SOCIAL_REVISION_SHAPE', 'The edited pack changed its post count or channels. Restore its structure before refining one post.');
    const posts = socialDraftPosts(candidate);
    check(posts.length === pin.posts.length && posts.every((p, i) => p.channel === pin.posts[i]?.channel), 'SOCIAL_REVISION_SHAPE', 'A revision must return the same posts and channels.');
    const lines:string[]=[],mapping:({section:number;part:number;line:number}|null)[]=[];
    run.deliverable.sections.forEach((section,sectionIndex)=>{
      lines.push('## '+section.heading);mapping.push(null);
      section.parts.forEach((part,partIndex)=>{if(part.kind==='text')part.text.split(/\r?\n/).forEach((line,lineIndex)=>{lines.push(line);mapping.push({section:sectionIndex,part:partIndex,line:lineIndex});});});
    });
    const result=structuredClone(run.deliverable);
    actualSocialPostLocations(lines.join('\n')).forEach((post,index)=>{
      const location=mapping[post.lineIndex];const kept=index===pin.n-1?posts[index]:pin.posts[index];
      check(location&&kept,'SOCIAL_REVISION_SHAPE','The selected post is missing.');
      const part=result.sections[location.section].parts[location.part];check(part.kind==='text','SOCIAL_REVISION_SHAPE','The selected post is not text.');
      if(post.text===kept.text)return;
      const pieces=part.text.split(/(\r\n|\n)/);const line=pieces[location.line*2];const prefix=/^(\s*[^:]+:\s*)/.exec(line)?.[1];
      check(prefix,'SOCIAL_REVISION_SHAPE','The selected post label is missing.');
      const trailing=/\s*$/.exec(line)?.[0]??'';pieces[location.line*2]=prefix+kept.text+trailing;part.text=pieces.join('');
    });
    return result;
}
export function ghostwritingOffer(state: import('../../../contracts.ts').State, run: DeliveryRunRecord): boolean {
    const order = findRecord(state, 'venture-order', run.orderId);
    if (!order)
        return false;
    const venture = findRecord(state, 'venture-record', run.ventureId);
    const blueprint = venture?.acceptedBlueprintId ? findRecord(state, 'venture-blueprint', venture.acceptedBlueprintId) : null;
    return blueprint?.offers.some(o => o.id === order.offerId && o.playbookOffer === 'linkedin-ghostwriting') ?? false;
}
export function socialRevisionOffer(state: import('../../../contracts.ts').State, run: DeliveryRunRecord): boolean { return findRecord(state, 'venture-playbook', run.playbookId)?.flagship === 'social-agency'; }

import { findRecord } from '../../records.ts';
