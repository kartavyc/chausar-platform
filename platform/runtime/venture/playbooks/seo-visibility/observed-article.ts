// Parse observed HTML without executing it. The article proof is exact text in an active body element.
import {parse,type DefaultTreeAdapterTypes as Tree} from 'parse5';
const flat=(text:string)=>text.replace(/\s+/g,' ').trim();
function excluded(node:Tree.Node):boolean {
 if(!('tagName'in node))return false;
 const attrs=new Map(node.attrs.map(a=>[a.name,a.value]));
 return ['script','style','template','noscript'].includes(node.tagName)||attrs.has('hidden')||attrs.get('aria-hidden')?.trim().toLowerCase()==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.get('style')??'');
}
/** Use the same active-node boundary while collecting descendants as when finding elements. */
const textOf=(node:Tree.Node):string=>excluded(node)?'':'value'in node?node.value:'childNodes'in node?node.childNodes.map(textOf).join(''):'';
/** This proves observed HTML, not external styles, client-side rendering, indexing or ranking. */
export function observedArticle(html:string){
 const titles:string[]=[],headings:string[]=[],articles:string[]=[];
 function visit(node:Tree.Node,hidden=false,inBody=false){
  if(!('childNodes'in node))return;
  if('tagName'in node){
   const attrs=new Map(node.attrs.map(a=>[a.name,a.value]));
   hidden=hidden||excluded(node);
   inBody=inBody||node.tagName==='body';if(hidden)return;
   if(node.tagName==='title')titles.push(flat(textOf(node)));
   if(inBody&&node.tagName==='h1')headings.push(flat(textOf(node)));
   if(inBody&&node.tagName==='pre'&&attrs.get('data-chausar-article')==='true')articles.push(textOf(node).replace(/\r\n/g,'\n'));
  }
  for(const child of node.childNodes)visit(child,hidden,inBody);
 }
 visit(parse(html));return {titles,headings,articles};
}
