import {type ChangeEvent,type ReactNode} from 'react';
import {useT} from '../../../text';
import {Field} from '../../../parts/Field';
import s from './SocialCanvas.module.css';
export type InfluencerAct=(action:string,payload:Record<string,unknown>)=>Promise<void>;
export function InfluencerInput({name,value,set,multiline=false}:{name:string;value:string;set(value:string):void;multiline?:boolean}){const t=useT();return <Field label={t('pb-influencer.'+name)} value={value} multiline={multiline} onChange={(e:ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>set(e.currentTarget.value)}/>;}
export function InfluencerSelect({name,value,set,children}:{name:string;value:string;set(value:string):void;children:ReactNode}){const t=useT();return <label>{t('pb-influencer.'+name)}<select className={s.select} value={value} onChange={e=>set(e.currentTarget.value)}>{children}</select></label>;}
