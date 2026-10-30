import {it,expect,vi} from 'vitest';
import {render,screen} from '@testing-library/react';
import {TextProvider} from '../../src/text';
import {SiteRelease} from '../../src/places/work/desks/SiteRelease';
import type {SiteView} from '../../src/places/work/desks/site-types';
it('every release status is owner language rather than an internal code in Hindi',()=>{const states=['prepared','previewing','preview','healthy','releasing','released','needs-inspection','rolling-back','rolled-back'];const item={id:'s',stale:false,connection:null,releases:states.map(state=>({id:state,state}))} as unknown as SiteView;render(<TextProvider language="hi"><SiteRelease item={item} digest="d" busy={false} act={vi.fn()}/></TextProvider>);for(const state of states)expect(screen.queryByText(state,{exact:true})).toBeNull();expect(screen.getByText('जाँच बाकी है')).toBeTruthy();});

import {SiteChecks} from '../../src/places/work/desks/SiteChecks';
import {applySiteAudit} from '../../../../platform/runtime/venture/playbooks/website-studio/requirements';
it('current observed audit has no enabled repeat review action',()=>{const row=applySiteAudit({id:'r',text:'Contact form',excerpt:'Contact form',origin:'explicit',severity:'major',briefDigest:'b',locked:false,audit:null},{verdict:'inconclusive',reason:'Source only',readPaths:['index.html']},{'index.html':'same'},'a'),item={id:'s',stale:false,requirements:[row],source:{headSha:'b',files:{'index.html':{digest:'same',text:'form'},'notes.txt':{digest:'new',text:'unrelated'}}},ship:{line:'Ship with warnings'},counts:{all:1,inconclusive:1}} as unknown as SiteView;render(<TextProvider language="en"><SiteChecks item={item} digest="d" busy={false} act={vi.fn()}/></TextProvider>);expect(screen.getByRole('button',{name:'Audit is current'}).getAttribute('aria-disabled')).toBe('true');});
