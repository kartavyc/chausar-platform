// A basic account connection is enough for setup; no fictional customer or item IDs are requested.
import {useState} from 'react';
import {useT} from '../../../text';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import s from './CollectionsDesk.module.css';
export function BooksSetupConnection({busy,connected,onConnect,onDisconnect}:{busy:boolean;connected:boolean;onConnect:(input:{dataCenter:string;accessToken:string})=>void;onDisconnect:()=>void}){
 const t=useT(),w=(key:string)=>t('pb-books-setup.'+key),[region,setRegion]=useState(''),[token,setToken]=useState('');
 return <form className={s.form} aria-label={w('connect')} onSubmit={e=>{e.preventDefault();if(!busy&&region&&token){const input={dataCenter:region,accessToken:token};setToken('');onConnect(input);}}}><p>{w('session')}</p><p role="status">{w(connected?'connected':'disconnected')}</p><label>{w('region')}<select className={s.select} value={region} disabled={busy} onChange={e=>setRegion(e.target.value)}><option value="">{w('choose')}</option>{['in','com','eu','com.au','jp','ca','com.cn','sa'].map(value=><option key={value} value={value}>{t('pb-books-posting.dc.'+value)}</option>)}</select></label><Field type="password" autoComplete="off" label={w('token')} value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/><Button type="submit" variant="primary" locked={busy||!region||!token}>{w('connect')}</Button>{connected&&<Button locked={busy} onClick={onDisconnect}>{w('disconnect')}</Button>}</form>;
}
