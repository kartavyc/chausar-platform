// Original Chausar channel labels, shared by engine parsing and browser previews.
import type { SocialChannel } from './channel-ids.ts';
const channels: Record<string, SocialChannel> = { instagram: 'instagram', facebook: 'facebook', 'facebook page': 'facebook', linkedin: 'linkedin', x: 'x', threads: 'threads', tiktok: 'tiktok', 'youtube-shorts': 'youtube-shorts', 'youtube shorts': 'youtube-shorts' };
export function postOfLine(line: string): {
    channel: SocialChannel;
    text: string;
} | null {
    const match = /^\s*([A-Za-z][A-Za-z -]{0,20}?)\s*:\s*(.+)$/.exec(line);
    const channel = match ? channels[match[1]!.trim().toLowerCase()] : undefined;
    return channel ? { channel, text: match![2]!.trim() } : null;
}

export type ActualSocialPost={id:string;section:string;channel:SocialChannel;text:string};
/** Number only actual posts. Companion sections never become postable text, regardless of section order. */
export function actualSocialPostLocations(text:string):(ActualSocialPost&{lineIndex:number})[]{
 let section='';let hasDrafts=false;const stack:{depth:number;name:string}[]=[];const rows:(Omit<ActualSocialPost,'id'>&{lineIndex:number})[]=[];
 for(const [lineIndex,line] of text.split(/\r?\n/).entries()){
  const heading=/^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
  if(heading){
   const depth=heading[1]!.length,name=heading[2]!.trim();
   while(stack.length&&stack[stack.length-1]!.depth>=depth)stack.pop();
   stack.push({depth,name});
   section=[...stack].reverse().find(item=>['drafts','alt text','hashtags','post plan'].includes(item.name.toLowerCase()))?.name??name;
   hasDrafts ||= name.toLowerCase()==='drafts';continue;
  }
  const post=postOfLine(line);if(post)rows.push({...post,section,lineIndex});
 }
 return rows.filter(row=>hasDrafts?row.section.toLowerCase()==='drafts':!['alt text','hashtags','post plan'].includes(row.section.toLowerCase())).map((row,index)=>({...row,id:'post-'+(index+1)}));
}

export function actualSocialPosts(text:string):ActualSocialPost[]{return actualSocialPostLocations(text).map(({lineIndex,...post})=>post);}
