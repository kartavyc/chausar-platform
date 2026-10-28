// Original Chausar client approval: only the existing hosted token decision can unlock export.
import {useState} from 'react';
import {useT} from '../../../text';
import {Button} from '../../../parts/Button';
import {Field} from '../../../parts/Field';
import {Tile,TileHead} from '../../../parts/Tile';
import type {TranslationAct} from './TranslationSheet';
import {TRANSLATION_RIGHTS_RULE} from '../../../../../../platform/runtime/venture/playbooks/translation-studio/rules';
import s from './TranslationStudio.module.css';
export function TranslationClient({locked,act}:{locked:boolean;act:TranslationAct}){const t=useT(),planned=!TRANSLATION_RIGHTS_RULE.confirmedBy,[shareId,setShareId]=useState(''),[url,setUrl]=useState('');return <Tile as="section" label={t('pb-translation.clientReview')}><TileHead title={t('pb-translation.clientReview')}/><p className={s.line}>{t('pb-translation.clientLinkHelp')}</p>{planned&&<p role="status" className={s.line}>{t('pb-translation.deliveryPlanned')}</p>}<Button variant="primary" locked={locked||planned} onClick={()=>{if(!locked&&!planned)void act('share',{}).then(out=>{const result=(out as {result?:{id:string;url:string}}|null)?.result;if(result){setShareId(result.id);setUrl(result.url);}});}}>{t('pb-translation.makeClientLink')}</Button>{url&&<p data-content className={s.quote}><a href={url} target="_blank" rel="noreferrer">{url}</a></p>}<details open={Boolean(shareId)}><summary>{t('pb-translation.checkClient')}</summary><Field label={t('pb-translation.shareId')} value={shareId} onChange={e=>setShareId(e.target.value)}/><Button locked={locked||!shareId.trim()} onClick={()=>{if(!locked&&shareId.trim())void act('approve-client',{shareId});}}>{t('pb-translation.checkClient')}</Button></details></Tile>;}
