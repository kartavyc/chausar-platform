import {fakeSocialInbox} from '../../src/engine/fake-social-inbox';
import type {W4DeskHost} from '../../src/engine/fake-w4';
export function inboxFixture(){let business='b1';const host={current:()=>business,now:()=> '2026-10-28T10:00:00Z',digest:JSON.stringify,emit:()=>{},ask:(method:string)=>method==='venture.order.list'?[{id:'o1',offerId:'offer',status:'open',clientId:'client'}]:{blueprint:{offers:[{id:'offer',playbookOffer:'reply-inbox'}]}}} as unknown as W4DeskHost;return {desk:fakeSocialInbox(host),changeBusiness:()=>{business='b2';}};}
