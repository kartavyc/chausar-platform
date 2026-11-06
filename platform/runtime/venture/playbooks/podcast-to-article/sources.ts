// Original transcript upload binding. Existing YouTube transcript files may be reused only for the same client.
import {check} from '../../../contracts.ts';
import {digest,type VentureTx} from '../../records.ts';
import {articleIntake} from './intake-core.ts';
import {fingerprint} from '../kit/fingerprint.ts';
import type {ArticleLedgerBody} from './records.ts';
import type {ArticleLanguage} from './style.ts';
export type ArticleSourceRead=Pick<VentureTx,'find'|'now'>;
/** Read actual bytes and current rights, never trust a caller-supplied transcript or fingerprint. */
export function loadArticleSource(tx:ArticleSourceRead,orderId:string,fileId:string){const order=tx.find('venture-order',orderId);check(order&&order.status!=='cancelled','ORDER_NOT_FOUND','Choose a current client order.');const intake=articleIntake(order.intake,tx.now.slice(0,10)),fields=intake.fields;const file=tx.find('venture-upload',fileId);check(file&&file.scope.kind==='order'&&/\.(srt|vtt|txt)$/i.test(file.name)&&['transcript','csv'].includes(file.format),'ARTICLE_SOURCE_REQUIRED','Choose an SRT, VTT or TXT transcript attached to this client order.');const sourceOrder=tx.find('venture-order',file.scope.orderId);check(sourceOrder&&sourceOrder.status!=='cancelled'&&sourceOrder.clientId===order.clientId,'ARTICLE_SOURCE_REQUIRED','Reuse only a transcript from the same client.');const bytes=Buffer.from(file.contentBase64,'base64');check(bytes.length>0&&bytes.length<=1500000,'ARTICLE_SOURCE_REQUIRED','The transcript file is empty or too large.');return {order,file,text:bytes.toString('utf8'),sourceOrderId:sourceOrder.id,fingerprint:fingerprint(bytes),intakeDigest:digest({clientId:order.clientId,rights:order.intake?.rights,fields}),language:intake.language,speakers:intake.speakers};}
/** Replacing bytes or changing client/rights/intake invalidates the derived article even if the upload digest was left unchanged. */
export function requireCurrentArticle(tx:ArticleSourceRead,record:ArticleLedgerBody){const source=loadArticleSource(tx,record.orderId,record.source.fileId);check(source.fingerprint===record.source.fingerprint&&source.intakeDigest===record.intakeDigest&&source.order.clientId===record.clientId&&source.sourceOrderId===record.source.orderId,'DERIVED_STALE','The source or permissions changed after this article was prepared. Prepare it again.');return source;}
