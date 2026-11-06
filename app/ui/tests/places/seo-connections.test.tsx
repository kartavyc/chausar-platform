import {it,expect} from 'vitest';
import {render,screen,fireEvent} from '@testing-library/react';
import {SeoConnections} from '../../src/places/connections/SeoConnections';
import {EngineProvider} from '../../src/engine/context';
import {TextProvider} from '../../src/text';
import {FakeEngine,createFakeClient} from '../../src/engine/fake';
import {assertInkRules} from '../helpers/ink-rules';
it('owner configures a WordPress connection without exposing the password or claiming publication',async()=>{
 const engine=new FakeEngine();render(<TextProvider language="en"><EngineProvider client={createFakeClient(engine)}><SeoConnections/></EngineProvider></TextProvider>);
 fireEvent.click(screen.getByText('Search publishing connections'));
 fireEvent.change(screen.getByLabelText('WordPress site'),{target:{value:'https://clinic.example'}});
 fireEvent.change(screen.getByLabelText('WordPress username'),{target:{value:'owner'}});
 fireEvent.change(screen.getByLabelText('Application password'),{target:{value:'sample password'}});
 fireEvent.click(screen.getByRole('button',{name:'Connect WordPress'}));
 expect(await screen.findByText('Connected for this session. Each change still asks.')).toBeTruthy();
 expect((screen.getByLabelText('Application password') as HTMLInputElement).value).toBe('');assertInkRules();
 const view=await engine.request('venture.desk.get',{playbook:'seo-visibility',kind:'publishing',id:'connection'});expect(JSON.stringify(view)).not.toContain('sample password');
 await expect(engine.request('venture.desk.get',{playbook:'seo-visibility',kind:'publishing',id:'missing'})).rejects.toMatchObject({code:'DELIVERY_NOT_FOUND'});
});
it('strategy demo rejects invented receipt fields using the real desk contract',async()=>{
 const engine=new FakeEngine();expect((await engine.request('venture.desk.list',{playbook:'seo-visibility',kind:'strategy'}) as {rows:unknown[]}).rows).toEqual([]);
 await expect(engine.request('venture.desk.act',{playbook:'seo-visibility',kind:'strategy',id:'new',action:'create',payload:{workId:'fiction',panelId:'fiction',receipt:'invented'}})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});
});
it('publishing demo matches connection validation codes and ordering for unsafe addresses',async()=>{
 const engine=new FakeEngine(),base={playbook:'seo-visibility',kind:'publishing',id:'connection',action:'configure'};
 for(const [url,code] of [['not a url','NET_URL_REFUSED'],['https://127.1/','NET_ADDRESS_REFUSED'],['https://10.0.0.1/','NET_ADDRESS_REFUSED'],['https://[::ffff:127.0.0.1]/','NET_ADDRESS_REFUSED'],['http://clinic.example/','WORDPRESS_SITE_INVALID']])await expect(engine.request('venture.desk.act',{...base,payload:{url,username:'owner',password:'sample'}})).rejects.toMatchObject({code});
 await expect(engine.request('venture.desk.act',{...base,payload:{url:'bad',username:'',password:'sample'}})).rejects.toMatchObject({code:'WORDPRESS_CREDENTIALS_REQUIRED'});
 await expect(engine.request('venture.desk.act',{...base,kind:'edge',payload:{siteUrl:'bad',accountId:'invalid',namespaceId:'invalid',token:'sample'}})).rejects.toMatchObject({code:'NET_URL_REFUSED'});
});
