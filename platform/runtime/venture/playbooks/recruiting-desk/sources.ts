// Original recruiting source resolution. Existing uploads and screened imported mail only, never profile fetches.
import {check} from '../../../contracts.ts';
import type {VentureTx} from '../../records.ts';
import {digest} from '../../records.ts';
import {sourceResume} from './source-core.ts';
import {threadIdOf,mailThreadsOf} from '../../build/mail-in.ts';
export function importResume(tx:VentureTx,orderId:string,kind:unknown,id:unknown){check((kind==='file'||kind==='mail')&&typeof id==='string','RECRUIT_SOURCE_REQUIRED','Choose an order file or imported conversation.');let text:string;
 if(kind==='file'){const file=tx.find('venture-upload',id);check(file&&file.scope.kind==='order'&&file.scope.orderId===orderId&&file.format==='csv'&&file.contentBase64,'RECRUIT_SOURCE_REQUIRED','Choose a readable resume export attached to this order.');text=Buffer.from(file.contentBase64,'base64').toString('utf8');}
 else {const order=tx.find('venture-order',orderId),thread=mailThreadsOf(tx.state,tx.venture!).find(t=>t.id===id);check(order&&thread&&thread.clientId===order.clientId&&!thread.held,'RECRUIT_SOURCE_REQUIRED','Choose screened mail from this order client.');const messages=tx.list('venture-inbound').filter(m=>threadIdOf(tx.state,tx.venture!,m.id)===id);check(messages.length>0&&messages.every(m=>m.source==='file-import'&&typeof m.text==='string'),'RECRUIT_SOURCE_REQUIRED','Import and screen the complete candidate mail first.');text=messages.map(m=>m.text).join('\n');}
 const resume=sourceResume(text);return {resume,kind:kind as 'file'|'mail',id,digest:digest(resume)};
}
