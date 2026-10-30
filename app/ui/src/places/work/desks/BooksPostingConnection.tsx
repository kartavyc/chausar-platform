// Explicit owner mapping and a session-only secret. No browser storage or default credential.
import {useState} from 'react';
import {useT} from '../../../text';
import {Tile} from '../../../parts/Tile';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import s from './CollectionsDesk.module.css';
import p from './BooksPosting.module.css';
export function BooksPostingConnection({companyId,connected,busy,onSave,onDisconnect}:{companyId:string;connected:boolean;busy:boolean;onSave:(value:Record<string,unknown>)=>Promise<boolean>;onDisconnect:()=>Promise<boolean>}){
 const t=useT(),word=(key:string)=>t('pb-books-posting.'+key),[token,setToken]=useState(''),[dc,setDc]=useState('in'),[customer,setCustomer]=useState(''),[place,setPlace]=useState(''),[gst,setGst]=useState('consumer'),[gstNo,setGstNo]=useState(''),[tax,setTax]=useState('inter'),[lines,setLines]=useState([{itemId:'',taxId:'',taxKind:'tax'}]);
 const valid=token.length>0&&customer.length>0&&place.length>0&&(gst!=='business_gst'||gstNo.length>0)&&lines.every(row=>row.itemId&&row.taxId);
 async function save(){if(busy||!valid)return;const accessToken=token;setToken('');await onSave({dataCenter:dc,accessToken,customerId:customer,placeOfSupply:place,gstTreatment:gst,gstNo:gst==='business_gst'?gstNo:null,taxSpecification:tax,lineMode:'aggregate-non-inventory',lines:structuredClone(lines)});}
 return <Tile><form className={s.form} aria-label={word('connect')} onSubmit={e=>{e.preventDefault();void save();}}><h3>{word('connect')}</h3><p>{word('organisation')} <span data-content="">{companyId}</span></p><p role="status">{word(connected?'connected':'disconnected')}</p><p>{word('session')}</p>
  <label>{word('dataCenter')}<select className={s.select} value={dc} disabled={busy} onChange={e=>setDc(e.target.value)}>{['in','com','eu','com.au','jp','ca','com.cn','sa'].map(value=><option key={value} value={value}>{word('dc.'+value)}</option>)}</select></label>
  <Field type="password" autoComplete="off" spellCheck={false} label={word('token')} value={token} disabled={busy} onChange={e=>setToken(e.target.value)}/>
  <Field label={word('customer')} value={customer} disabled={busy} onChange={e=>setCustomer(e.target.value)}/><Field label={word('place')} value={place} disabled={busy} onChange={e=>setPlace(e.target.value)}/>
  <label>{word('gst')}<select className={s.select} value={gst} disabled={busy} onChange={e=>{setGst(e.target.value);setGstNo('');}}>{['consumer','business_none','business_gst'].map(value=><option key={value} value={value}>{word('gst.'+value)}</option>)}</select></label>
  {gst==='business_gst'&&<Field label={word('gstNo')} value={gstNo} disabled={busy} onChange={e=>setGstNo(e.target.value)}/>}
  <label>{word('tax')}<select className={s.select} value={tax} disabled={busy} onChange={e=>setTax(e.target.value)}><option value="inter">{word('inter')}</option><option value="intra">{word('intra')}</option></select></label>
  <p>{word('mappingHelp')}</p>{lines.map((row,index)=><fieldset className={p.mapping} key={index}><legend>{t('pb-books-posting.mapping',{count:index+1})}</legend><Field label={word('item')} value={row.itemId} disabled={busy} onChange={e=>setLines(values=>values.map((line,i)=>i===index?{...line,itemId:e.target.value}:line))}/><Field label={word('taxId')} value={row.taxId} disabled={busy} onChange={e=>setLines(values=>values.map((line,i)=>i===index?{...line,taxId:e.target.value}:line))}/><label>{word('taxKind')}<select className={s.select} value={row.taxKind} disabled={busy} onChange={e=>setLines(values=>values.map((line,i)=>i===index?{...line,taxKind:e.target.value}:line))}><option value="tax">{word('singleTax')}</option><option value="tax_group">{word('taxGroup')}</option></select></label><Button locked={busy||lines.length===1} onClick={()=>setLines(values=>values.filter((_,i)=>i!==index))}>{word('remove')}</Button></fieldset>)}
  <Button locked={busy||lines.length>=400} onClick={()=>setLines(values=>[...values,{itemId:'',taxId:'',taxKind:'tax'}])}>{word('add')}</Button><p>{word('supported')}</p>
  <Button variant="primary" type="submit" locked={busy||!valid}>{word('saveConnection')}</Button><Button locked={busy||!connected} onClick={()=>{setToken('');void onDisconnect();}}>{word('disconnect')}</Button>
 </form></Tile>;
}
