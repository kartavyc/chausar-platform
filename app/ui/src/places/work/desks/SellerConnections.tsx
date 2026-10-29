// Exact owner store approvals. Rehearsal never invents a remote connection.
import {useState} from 'react';
import {useEngine,useResource} from '../../../engine/context';
import {EngineError} from '../../../engine/types';
import {useT} from '../../../text';
import {Tile,TileHead} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import {SellerSelect,type SellerJson} from './SellerOperations';
import type {SellerShopifyBody} from '../../../../../../platform/runtime/venture/playbooks/online-seller/shopify-records';
import type {SellerStorefrontBody,StorefrontOwnerPending} from '../../../../../../platform/runtime/venture/playbooks/online-seller/storefront-records';
import s from './OnlineSellerDesk.module.css';
import {SellerCheck} from './SellerCheck';
import {SellerShopify} from './SellerShopify';
import {SellerStorefront} from './SellerStorefront';
export type SellerConnectionView={orderId:string;remote?:SellerShopifyBody|null;connected?:boolean;config?:SellerStorefrontBody|null;pending?:StorefrontOwnerPending[];legalConfirmed?:boolean;hosted?:boolean;rehearsal:boolean};
export type ConnectionAct=(action:string,payload:SellerJson)=>Promise<unknown>;
function ShopifySetup({act,locked}:{act:ConnectionAct;locked:boolean}){
 const t=useT(),w=(k:string)=>t('pb-seller-connectors.'+k),[domain,setDomain]=useState(''),[clientId,setClientId]=useState(''),[secret,setSecret]=useState(''),[price,setPrice]=useState(''),[promotion,setPromotion]=useState(''),[own,setOwn]=useState(false);
 async function connect(){if(locked||!own)return;try{await act('connect',{domain,clientId,clientSecret:secret,ownStore:own,caps:{priceChangePercent:price,promotionPercent:promotion}});}finally{setSecret('');}}
 return <div className={s.form}><p>{w('shopifyHelp')}</p><Field label={w('domain')} value={domain} onChange={e=>setDomain(e.currentTarget.value)}/><Field label={w('clientId')} value={clientId} onChange={e=>setClientId(e.currentTarget.value)}/><Field type="password" autoComplete="off" label={w('secret')} value={secret} onChange={e=>setSecret(e.currentTarget.value)}/><Field inputMode="decimal" label={w('priceCap')} value={price} onChange={e=>setPrice(e.currentTarget.value)}/><Field inputMode="decimal" label={w('promotionCap')} value={promotion} onChange={e=>setPromotion(e.currentTarget.value)}/><SellerCheck label={w('ownStore')} checked={own} onChange={e=>setOwn(e.currentTarget.checked)}/><Button variant="primary" locked={locked||!own||!domain||!clientId||!secret||!price||!promotion} lockedReason={w('complete')} onClick={()=>void connect()}>{w('connect')}</Button></div>;
}
/** Keep editable forms through benign refresh; hide and remove them once the order is actually gone. */
export function SellerConnections({orderId}:{orderId:string}){
 const t=useT(),w=(k:string)=>t('pb-seller-connectors.'+k),engine=useEngine(),[kind,setKind]=useState('shopify'),[busy,setBusy]=useState(false),[problem,setProblem]=useState('');
 const orders=useResource('venture.order.list',{}),detail=useResource('venture.desk.get',{playbook:'online-seller',kind,id:orderId},{skip:!orderId});
 const current=orders.data?.find(o=>o.id===orderId&&o.status==='open'),raw=detail.data?.item as SellerConnectionView|undefined,view=raw?.orderId===orderId?raw:undefined;
 const locked=busy||orders.loading||!!orders.error||!current||detail.loading||!!detail.error||!view||detail.data?.kind!==kind;
 const act:ConnectionAct=async(action,payload)=>{if(locked||!detail.data)return null;setBusy(true);setProblem('');try{const result=await engine.request('venture.desk.act',{playbook:'online-seller',kind,id:orderId,action,payload,digest:detail.data.digest});detail.reload();return result.result;}catch(error){const code=error instanceof EngineError?error.code:'generic',words=w('error.'+code);setProblem(words.startsWith('pb-seller-connectors.')?w('error.generic'):words);return null;}finally{setBusy(false);}};
 const gone=!orders.loading&&!orders.error&&orders.data&&!current;
 return <Tile as="section" label={w('title')}><TileHead title={w('title')}/><div className={s.body}><SellerSelect label={w('connection')} value={kind} onChange={value=>{setKind(value);setProblem('');}}><option value="shopify">{w('shopify')}</option><option value="storefront">{w('storefront')}</option></SellerSelect>{gone?<p role="status">{w('missing')}</p>:<><p className={s.line}>{w('approval')}</p>{view?.rehearsal&&<p className={s.line}>{w('rehearsal')}</p>}{kind==='shopify'?(view?.remote&&view.connected?<SellerShopify key={orderId} remote={view.remote} act={act} locked={locked}/>:<ShopifySetup key={orderId} act={act} locked={locked}/>):<SellerStorefront key={orderId} view={view??{orderId,rehearsal:false}} act={act} locked={locked} onExpire={detail.reload}/>}</>}{(problem||orders.error||detail.error)&&<p role="alert">{problem||w('error.generic')}</p>}</div></Tile>;
}
