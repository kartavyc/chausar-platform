// The generated document never receives app origin, scripts, forms or navigation permissions.
import {useEffect,useState} from 'react';
import {sitePreviewDocument} from '../../../../../../platform/runtime/venture/playbooks/website-studio/preview';
import s from './WebsiteStudio.module.css';
export function SitePreviewFrame({tree,title,invalid}:{tree:unknown;title:string;invalid:string}){const [frame,setFrame]=useState<{tree:unknown;url:string}|null>(null),[failed,setFailed]=useState<unknown>(null);useEffect(()=>{let document='';try{const html=sitePreviewDocument(tree);document=URL.createObjectURL(new Blob([html],{type:'text/html'}));setFrame({tree,url:document});setFailed(null);}catch{setFrame(null);setFailed(tree);}return()=>{if(document)URL.revokeObjectURL(document);};},[tree]);return failed===tree?<p role="alert">{invalid}</p>:frame&&frame.tree===tree?<iframe className={s.frame} title={title} sandbox="" referrerPolicy="no-referrer" src={frame.url}/>:null;}
