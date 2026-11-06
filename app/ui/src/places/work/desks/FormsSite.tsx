// Owner-only origin permission and sign-in choice. No secret is collected by this form.
import {useState} from 'react';import {useResource} from '../../../engine/context';import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';import {Button} from '../../../parts/Button';import {Field} from '../../../parts/Field';
import type {FormsRow,FormsAct} from './FormsRecord';import s from './FormsDesk.module.css';
export function FormsSite({row,locked,act,continuation=false}:{row:FormsRow;locked:boolean;act:FormsAct;continuation?:boolean}){
 const t=useT(),w=(key:string)=>t('pb-forms.'+key),files=useResource('venture.files.list',{orderId:row.orderId}),[url,setUrl]=useState(row.site?.url??''),[permission,setPermission]=useState(''),[allowed,setAllowed]=useState(false),[staff,setStaff]=useState(false),[signIn,setSignIn]=useState('fresh');
 const ready=!locked&&!!url&&(continuation||!files.loading&&!files.error&&files.data?.some(file=>file.id===permission)&&allowed&&staff);
 return <Tile card><form className={s.form} aria-label={w(continuation?'continue':'site')} onSubmit={event=>{event.preventDefault();if(ready)void act(continuation?'continue':'open',continuation?{url}:{url,permissionFileId:permission,allowed,revocableStaffLogin:staff,savedSignInId:signIn==='fresh'?null:signIn});}}><h4>{w(continuation?'continue':'site')}</h4><Field label={w('url')} value={url} disabled={locked} onChange={e=>setUrl(e.target.value)}/>{!continuation&&<>
 <label className={s.label}>{w('permission')}<select className={s.select} disabled={locked} value={permission} onChange={e=>setPermission(e.target.value)}><option value="">{w('choose')}</option>{(files.data??[]).filter(file=>/\.txt$/i.test(file.name)).map(file=><option key={file.id} value={file.id}>{file.name}</option>)}</select></label>
 <label><input type="checkbox" checked={allowed} disabled={locked} onChange={e=>setAllowed(e.target.checked)}/>{w('allowed')}</label><label><input type="checkbox" checked={staff} disabled={locked} onChange={e=>setStaff(e.target.checked)}/>{w('staff')}</label>
 <label className={s.label}>{w('signIn')}<select className={s.select} value={signIn} disabled={locked} onChange={e=>setSignIn(e.target.value)}><option value="fresh">{w('fresh')}</option><option value="new">{w('remember')}</option>{(row.signIns??[]).map(value=><option key={value.id} value={value.id}>{w('saved')} {value.origin}</option>)}</select></label><p>{w('signInHelp')}</p></>}
 <Button type="submit" variant="primary" locked={!ready}>{w(continuation?'continue':'open')}</Button></form></Tile>;
}
