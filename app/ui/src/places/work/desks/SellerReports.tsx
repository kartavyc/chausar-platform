// Chausar owner reports. Original UI from commerce MIT/Apache research ideas.
import {useState,useRef} from 'react';
import {useT} from '../../../text';
import {Field} from '../../../parts/Field';
import {Button} from '../../../parts/Button';
import {SellerSelect,SellerFigures,sellerUpload,sellerDownload,type SellerAct,type SellerJson} from './SellerOperations';
import {SELLER_OPERATION_HEADERS,type SellerOperationMode} from '../../../../../../platform/runtime/venture/playbooks/online-seller/operations-analysis';
import type {sellerMultiStore} from '../../../../../../platform/runtime/venture/playbooks/online-seller/multi-store';
import s from './OnlineSellerDesk.module.css';
type Report={data:unknown;figures:{key:string;display:string;receiptId:string}[];receipt:{inputs:unknown;steps:unknown;explanation:string};file:{name:string;contentBase64:string}|null};
/** Every report starts with the owner's original export. No web research or paid call occurs here. */
export function SellerReports({act,busy}:{act:SellerAct;busy:boolean}) {
 const t=useT(),[mode,setMode]=useState<SellerOperationMode>('alerts'),[file,setFile]=useState<File|null>(null),[settings,setSettings]=useState<File|null>(null),[month,setMonth]=useState(''),[trademarks,setTrademarks]=useState(''),[profile,setProfile]=useState('beginner'),[stores,setStores]=useState(''),[channel,setChannel]=useState('meesho'),[checkedOn,setCheckedOn]=useState(''),[source,setSource]=useState(''),[was,setWas]=useState(''),[report,setReport]=useState<Report|null>(null);
 const version=useRef(0);
 const lines=(value:string)=>value.split('\n').map(v=>v.trim()).filter(Boolean);
 async function analyse(){if(!file)return;const requested=version.current;let options:Record<string,SellerJson>={};
  if(mode==='alerts'&&settings)options={thresholdFile:await sellerUpload(settings)};
  if(mode==='research')options={month:Number(month),trademarks:lines(trademarks),profile};
  if(mode==='multi-store')options={stores:lines(stores)};
  if(mode==='catalogue'){if(!settings)return;options={mapFile:await sellerUpload(settings),channel,checkedOn,source};}
  if(mode==='price-history')options={wasRupees:was};
  const result=await act('analyse',{mode,...await sellerUpload(file),options}) as Report|null;if(result&&requested===version.current)setReport(result);
 }
 return <div className={s.body} onChangeCapture={()=>{version.current++;setReport(null);}}><SellerSelect label={t('pb-seller-ops.report')} value={mode} onChange={value=>{setMode(value as SellerOperationMode);setReport(null);setSettings(null);}}>{Object.keys(SELLER_OPERATION_HEADERS).map(value=><option key={value} value={value}>{t('pb-seller-ops.mode.'+value)}</option>)}</SellerSelect>
 <Field type="file" accept=".csv,text/csv" label={t('pb-seller-ops.source')} onChange={e=>{setFile(e.currentTarget.files?.[0]??null);setReport(null);}}/>
 <Button variant="quiet" onClick={()=>sellerDownload('seller-'+mode+'-blank.csv',SELLER_OPERATION_HEADERS[mode]+'\n')}>{t('pb-online-seller.template')}</Button>
 {(mode==='alerts'||mode==='catalogue')&&<><Field type="file" accept=".csv,text/csv" label={t(mode==='alerts'?'pb-seller-ops.thresholdFile':'pb-seller-ops.mapFile')} hint={t(mode==='alerts'?'pb-seller-ops.thresholdHint':'pb-seller-ops.mapHint')} onChange={e=>{setSettings(e.currentTarget.files?.[0]??null);setReport(null);}}/><Button variant="quiet" onClick={()=>sellerDownload('seller-settings.csv',(mode==='alerts'?'scope,id,key,value':'header,field')+'\n')}>{t('pb-seller-ops.settingsTemplate')}</Button></>}
 {mode==='research'&&<><Field label={t('pb-seller-ops.month')} type="number" min="1" max="12" value={month} onChange={e=>{setMonth(e.currentTarget.value);setReport(null);}}/><SellerSelect label={t('pb-seller-ops.profile')} value={profile} onChange={value=>{setProfile(value);setReport(null);}}>{['beginner','grower','pro','factory','brand'].map(value=><option key={value} value={value}>{t('pb-seller-ops.profile.'+value)}</option>)}</SellerSelect><Field multiline label={t('pb-seller-ops.trademarks')} value={trademarks} onChange={e=>{setTrademarks(e.currentTarget.value);setReport(null);}}/><p className={s.line}>{t('pb-seller-ops.researchManual')}</p></>}
 {mode==='multi-store'&&<Field multiline label={t('pb-seller-ops.stores')} value={stores} onChange={e=>{setStores(e.currentTarget.value);setReport(null);}}/>}
 {mode==='catalogue'&&<><SellerSelect label={t('pb-seller-ops.channel')} value={channel} onChange={value=>{setChannel(value);setReport(null);}}><option value="meesho">{t('pb-seller-ops.meesho')}</option><option value="flipkart">{t('pb-seller-ops.flipkart')}</option></SellerSelect><Field type="date" label={t('pb-seller-ops.checkedOn')} value={checkedOn} onChange={e=>{setCheckedOn(e.currentTarget.value);setReport(null);}}/><Field label={t('pb-seller-ops.mappingSource')} value={source} onChange={e=>{setSource(e.currentTarget.value);setReport(null);}}/></>}
 {mode==='price-history'&&<Field label={t('pb-seller-ops.was')} value={was} onChange={e=>{setWas(e.currentTarget.value);setReport(null);}}/>}
 <Button variant="primary" disabled={busy} locked={!file||mode==='catalogue'&&!settings} lockedReason={t('pb-seller-ops.sourceFirst')} onClick={()=>void analyse()}>{t('pb-seller-ops.analyse')}</Button>
 {report&&<><SellerReportWords mode={mode} data={report.data}/><SellerFigures result={report}/>{report.file&&<Button variant="quiet" onClick={()=>sellerDownload(report.file!.name,report.file!.contentBase64,true)}>{t('pb-seller-ops.downloadSheet')}</Button>}</>}
 </div>;
}
/** The engine supplies figures and decisions; the screen only labels and arranges them. */
function SellerReportWords({mode,data}:{mode:SellerOperationMode;data:unknown}) {
 const t=useT();
 if(mode==='research')return <ul className={s.list}>{(data as {id:string;title:string;verdict:string;badges:string[];evidence:string[]}[]).map(row=><li key={row.id} className={s.body}><h3 className={s.heading} data-content="">{row.title}</h3><p>{t('pb-seller-ops.verdict.'+row.verdict)}</p><ul>{row.badges.map(badge=><li key={badge}>{t('pb-seller-ops.badge.'+badge)}</li>)}</ul><p data-content="">{row.evidence[0]}</p></li>)}</ul>;
 if(mode==='alerts')return <ul className={s.list}>{(data as {briefing:{sku:string;kind:string;threshold:string;source:string;metric:string;options:string[]}[]}).briefing.map((row,i)=><li key={i} className={s.body}><h3 className={s.heading}><span data-content="">{row.sku}</span> {t('pb-seller-ops.alert.'+row.kind)}</h3><p>{t('pb-seller-ops.threshold')}: <span data-content="">{row.threshold}</span></p><p data-content="">{row.source}</p>{row.metric==='cannot read'&&<p>{t('pb-seller-ops.unknown')}</p>}<ul>{row.options.map(option=><li key={option}>{t('pb-seller-ops.option.'+option)}</li>)}</ul></li>)}</ul>;
 if(mode==='stock')return <ul className={s.list}>{(data as {sku:string;authority:string;oversold:boolean}[]).map(row=><li key={row.sku}><p data-content="">{row.sku}: {row.authority}</p>{row.oversold&&<p>{t('pb-seller-ops.oversold')}</p>}</li>)}</ul>;
 if(mode==='catalogue'){const row=data as {channel:string;checkedOn:string;source:string};return <><p>{t('pb-seller-ops.checkedOn')}: <span data-content="">{row.checkedOn}</span></p><p data-content="">{row.source}</p></>;}
 if(mode==='multi-store'){const result=data as ReturnType<typeof sellerMultiStore>;return <div className={s.body}><p>{t('pb-seller-ops.currencies')}: <span data-content="">{result.currencies.join(', ')}</span></p>{(['gaps','duplicates','transfers','unfulfilled','priceDifferences'] as const).map(key=><div key={key}><h3 className={s.heading}>{t('pb-seller-ops.compare.'+key)}</h3><ul>{result[key].map((row,i)=><li key={i} data-content="">{[row.sku,'store'in row?row.store:'','from'in row?row.from:'','to'in row?row.to:'','id'in row?row.id:'','prices'in row?row.prices.map(p=>p.store).join(', '):''].filter(Boolean).join(' / ')}</li>)}</ul></div>)}</div>;}
 return null;
}
