import {it,expect}from'vitest';import{render,screen,fireEvent,waitFor}from'@testing-library/react';import{YoutubeCommentIdeas}from'../../src/places/work/desks/YoutubeCommentIdeas';import{EngineProvider}from'../../src/engine/context';import{createFakeClient,FakeEngine}from'../../src/engine/fake';import{TextProvider}from'../../src/text';
import {YoutubeResearchResult} from '../../src/places/work/desks/YoutubeResearchResult';
import type {YoutubeResearchView} from '../../src/places/work/desks/YoutubeResearch';
it.each([['en','Reply drafts'],['hi','जवाब के ड्राफ़्ट']] as const)('separates exact reply drafts from held comments in %s', (language,heading)=>{
 const view:YoutubeResearchView={id:'order-one',digest:'review-one',approved:false,mode:'comments',source:{id:'comments-one',name:'Owner export.csv',digest:'source-one'},orderDigest:'order-source',mapping:{id:'id',text:'text'},options:{},sourceConsent:true,receiptId:'receipt-one',approval:null,result:{piles:{bait:[{id:'held-one',text:'An abusive comment.'}]},replies:[{id:'reply-one',reply:'The owner-approved answer.'}],ideas:[]}};
 const client=createFakeClient(new FakeEngine());
 render(<TextProvider language={language}><EngineProvider client={client}><YoutubeResearchResult view={view}/></EngineProvider></TextProvider>);
 const section=screen.getByRole('heading',{name:heading}).closest('section');
 expect(section).not.toBeNull();
 expect(section!.textContent).toContain('reply-one');
 expect(section!.textContent).toContain('The owner-approved answer.');
 expect(section!.textContent).not.toContain('held-one');
 expect(section!.textContent).not.toContain('An abusive comment.');
 expect(screen.getByText('An abusive comment.').closest('section')).not.toBe(section);
 expect(section!.querySelector('blockquote[data-content]')).not.toBeNull();
});
it('adds only a repeated question with the exact reviewed source digest after owner click',async()=>{const client=createFakeClient(new FakeEngine()),calls:any[]=[];client.request=(async(method:string,p:any)=>{calls.push({method,p});return {result:{idea:{id:'idea1'}}};})as typeof client.request;render(<TextProvider language="en"><EngineProvider client={client}><YoutubeCommentIdeas view={{id:'o1',digest:'exact-comments',approved:true,result:{ideas:[{question:'How to count stock?',count:3,commentIds:['a','b','c']},{question:'One comment?',count:1,commentIds:['d']}]}}as any} canAct/></EngineProvider></TextProvider>);expect(calls).toHaveLength(0);expect(screen.getAllByRole('button',{name:'Add this question to Ideas'})).toHaveLength(1);fireEvent.click(screen.getByRole('button',{name:'Add this question to Ideas'}));await waitFor(()=>expect(calls[0]).toEqual({method:'venture.desk.act',p:{playbook:'youtube',kind:'research',id:'o1',action:'add-idea',payload:{index:0},digest:'exact-comments'}}));await screen.findByText('Added to your Ideas Inbox.');});
