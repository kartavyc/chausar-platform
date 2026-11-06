// Current local availability, never a claim that fixtures qualified this owner's device.
import type {VentureDeps} from '../contracts.ts';
import {currentVenture,listRecords,findRecord,digest} from '../records.ts';
import {locateApp} from './local-apps.ts';
import {SandboxDesktop} from './sandbox-desktop.ts';
import {APP_TESTING_CLIENT_RULE} from '../playbooks/app-testing/rules.ts';
import {appOrderDigest} from '../playbooks/app-testing/order-digest.ts';
export async function appTestingModes(deps:VentureDeps):Promise<ReadonlySet<string>>{
 const found=new Set<string>();if(deps.host==='hosted-web'||!APP_TESTING_CLIENT_RULE.confirmedBy||deps.closing?.signal.aborted)return found;
 const locate=deps.android?.locate??locateApp;if(locate('adb')&&locate('aapt2'))found.add('android-local');
 const state=deps.store.read(),venture=currentVenture(state);if(!venture)return found;
 const row=listRecords(state,'venture-demo-project',venture.id).find(r=>{const order=findRecord(state,'venture-order',r.orderId);return order&&['open','invoiced'].includes(order.status)&&order.clientId===r.clientId&&appOrderDigest(order)===r.orderDigest&&(r.session?.imageId||r.pending?.operation==='start');});
 const image=row?.session?.imageId??(row?.pending?.operation==='start'?row.pending.imageId:null);
 if(row&&image)try{await new SandboxDesktop(deps.sandboxDesktop).prepare('capability-check',image);const live=deps.store.read(),current=findRecord(live,'venture-demo-project',row.id),order=findRecord(live,'venture-order',row.orderId);if(currentVenture(live)?.id===venture.id&&current&&digest(current)===digest(row)&&order&&['open','invoiced'].includes(order.status)&&order.clientId===row.clientId&&appOrderDigest(order)===row.orderDigest)found.add('docker-local');}catch{/* Missing or changed local image stays planned. No download or startup. */}
 if(!APP_TESTING_CLIENT_RULE.confirmedBy||deps.closing?.signal.aborted)return new Set();
 return found;
}
