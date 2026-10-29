import {it,expect} from 'vitest';import {FakeEngine} from '../../src/engine/fake';
it('public demo account setup mirrors exact fields, stale revisions and session disconnection without retaining credentials',async()=>{const engine=new FakeEngine(),base={playbook:'social-agency',kind:'open-posting',id:'bluesky'},get=()=>engine.request('venture.desk.get',base) as Promise<any>,first=await get();expect(first.item.connected).toBe(false);const payload={setup:{platform:'bluesky',server:'https://bsky.social',account:'owner.bsky.social',channel:''},credential:'fixture-app-password'};const saved:any=await engine.request('venture.desk.act',{...base,action:'connect',digest:first.digest,payload});expect(saved.result.connected).toBe(true);expect(saved.result.account.label).toBe('owner.bsky.social');expect(JSON.stringify(await get())).not.toContain('fixture-app-password');await expect(engine.request('venture.desk.act',{...base,action:'connect',digest:first.digest,payload})).rejects.toMatchObject({code:'APPROVAL_STALE'});await expect(engine.request('venture.desk.act',{...base,action:'disconnect',digest:saved.result.digest,payload:{hidden:true}})).rejects.toMatchObject({code:'INVALID_VENTURE_REQUEST'});const removed:any=await engine.request('venture.desk.act',{...base,action:'disconnect',digest:saved.result.digest,payload:{}});expect(removed.result.connected).toBe(false);expect(removed.result.revision).toBe(2);expect(removed.line).toBe('Disconnected. Existing uncertain posts still need inspection.');});

it('connector summaries follow native selection before connection, after API setup and after disconnection', async () => {
  const engine = new FakeEngine();
  const cards = async () => await engine.request('venture.connectors.list', {}) as import('../../src/engine/types').ConnectorCardLite[];
  const initial = await cards();
  for (const id of ['bluesky', 'mastodon', 'telegram', 'discord']) {
    const card = initial.find(row => row.id === id)!;
    expect(card.posting).toEqual(card.postingOptions.find(option => option.mode === 'owner-browser-session'));
    expect(card.posting?.status).toBe('planned');
  }
  const base = {playbook:'social-agency',kind:'open-posting',id:'bluesky'};
  const first: any = await engine.request('venture.desk.get', base);
  const saved: any = await engine.request('venture.desk.act', {...base,action:'connect',digest:first.digest,payload:{setup:{platform:'bluesky',server:'https://bsky.social',account:'owner.bsky.social',channel:''},credential:'fixture-app-password'}});
  const connected = (await cards()).find(card => card.id === 'bluesky')!;
  expect(connected.posting).toEqual(connected.postingOptions.find(option => option.mode === 'api'));
  expect(connected.posting).toMatchObject({status:'available',qualification:'fixture-tested',reason:null});
  await engine.request('venture.desk.act', {...base,action:'disconnect',digest:saved.result.digest,payload:{}});
  expect((await cards()).find(card => card.id === 'bluesky')).toEqual(initial.find(card => card.id === 'bluesky'));
});
