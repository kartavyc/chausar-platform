// Original Chausar post plan: plain owner-review metadata, bound to actual post ordinals by code.
export const HOOK_FORMULAS = ['Question','Contrast','Lesson','Story','How to','Mistake','Myth','Checklist','Before and after','Observation','Behind the scenes','Example','Challenge','Quick tip','Comparison','Problem and solution'] as const;
export type PostPlan = {postId:string;kind:'value'|'sell';goals:string[];actions:string[];hookFormula:string};
export const POST_PLAN_GUIDANCE = 'For every actual channel post, add one line under Post plan: Post 1 | Value | Goal: Teach one useful idea | Reader action: Try it | Hook: Question. Number only actual posts in their text order. Use Value or Sell honestly, one goal and one reader action; separate multiple goals or actions with semicolons so code can flag them. Choose a plain hook name from: '+HOOK_FORMULAS.join(', ')+'. Never repeat a hook within seven code-dated calendar days; later reuse is allowed. An undated pack shares one window. Do not invent post ids, dates or history. Code binds each row to the exact post text and checks the owner selling cap and approved client history.';
const invalid=():never=>{throw Object.assign(new Error('Give every actual post one Post plan row with its kind, goal, reader action and hook.'),{code:'SOCIAL_POST_PLAN_INVALID'});};
/** Parse all declared rows; duplicates, absent posts and extras refuse instead of being guessed. */
export function readPostPlan(lines:readonly string[],postIds:readonly string[]):PostPlan[]{
 if(!postIds.length||postIds.length>155||lines.length!==postIds.length)return invalid();
 const seen=new Set<string>();
 const rows=lines.map(line=>{
  const cells=line.split('|').map(value=>value.trim());
  const ordinal=/^Post ([1-9][0-9]{0,2})$/i.exec(cells[0]??'');
  if(cells.length!==5||!ordinal||!/^Value$|^Sell$/i.test(cells[1]??''))return invalid();
  const postId='post-'+ordinal[1];if(!postIds.includes(postId)||seen.has(postId))return invalid();seen.add(postId);
  const value=(cell:string,prefix:string,max:number)=>{if(!cell.toLowerCase().startsWith(prefix.toLowerCase()))return invalid();const value=cell.slice(prefix.length).trim();if(!value||value.length>max||/[\r\n]/.test(value))return invalid();return value;};
  const goal=value(cells[2]!,'Goal:',400),action=value(cells[3]!,'Reader action:',400),hook=value(cells[4]!,'Hook:',80);
  const hookFormula=HOOK_FORMULAS.find(name=>name.toLowerCase()===hook.toLowerCase());if(!hookFormula)return invalid();
  return {postId,kind:cells[1]!.toLowerCase() as 'value'|'sell',goals:goal.split(';').map(s=>s.trim()),actions:action.split(';').map(s=>s.trim()),hookFormula};
 });
 return postIds.map(id=>rows.find(row=>row.postId===id)!);
}
/** Only metadata rows are selected from owner-edited rendered text; every such row is validated. */
export function postPlanLines(text:string):string[]{
 const rows:string[]=[];let inPlan=false;
 for(const line of text.split(/\r?\n/)){
  const heading=/^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line.trim());
  if(heading){inPlan=heading[1]!.trim().toLowerCase()==='post plan';continue;}
  if(inPlan&&line.trim())rows.push(line.trim());
 }
 return rows;
}
