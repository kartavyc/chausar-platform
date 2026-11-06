'use strict';
// Exact one-use request authorization for a JS-disabled, single-origin owner browser partition.
// This module does not approve anything. Its caller must first claim the durable owner decision.
function createRequestGate({origin,webContentsId,current,proxyRealm}) {
 const nope=()=>({cancel:true}),yes=()=>({cancel:false});
 const validUrl=value=>{try{const u=new URL(value);return u.protocol==='https:'&&u.origin===origin&&!u.username&&!u.password&&!u.hash&&u.href===value;}catch{return false;}};
 let permit=null,closed=false,loaded=false,sent=false,savedResponse=null;
 const admitted=new Map();
 const live=()=>{try{return !closed&&current()===true;}catch{return false;}};
 const fail=()=>{throw Object.assign(new Error('Review the current native form before sending.'),{code:'FORM_ACTION_HELD'});};
 const basic=d=>live()&&d&&Number.isSafeInteger(d.id)&&d.webContentsId===webContentsId&&validUrl(d.url);
 const bytesOf=d=>{
  if(!Array.isArray(d.uploadData)||d.uploadData.length<1||d.uploadData.length>10)return null;
  if(d.uploadData.some(item=>!item||Object.keys(item).some(k=>!['bytes','type'].includes(k))||item.type!==undefined&&item.type!=='rawData'||!Buffer.isBuffer(item.bytes)))return null;
  const size=d.uploadData.reduce((sum,item)=>sum+item.bytes.length,0);return size<=100000?Buffer.concat(d.uploadData.map(item=>item.bytes)):null;
 };
 const requestMatches=(row,d)=>row.url===d.url&&row.method===d.method&&row.resourceType===d.resourceType;
 return {
  armNavigation(url){if(!live()||permit||!validUrl(url)||sent)fail();permit={kind:'navigation',url,method:'GET'};savedResponse=null;},
  armSubmit(request){
   if(!live()||permit||sent||!request||Object.keys(request).sort().join(',')!=='body,contentType,url'||!validUrl(request.url)||typeof request.body!=='string'||Buffer.byteLength(request.body)>100000||request.contentType!=='application/x-www-form-urlencoded')fail();
   permit={kind:'submit',url:request.url,method:'POST',body:Buffer.from(request.body),contentType:request.contentType};savedResponse=null;
  },
  beforeRequest(d){
   if(!basic(d))return nope();
   if(admitted.has(d.id))return nope();
   const p=permit;
   if(p&&d.resourceType==='mainFrame'&&d.url===p.url&&d.method===p.method){
    permit=null;
    if(p.kind==='submit'){const bytes=bytesOf(d);if(!bytes||!bytes.equals(p.body))return nope();}
    else if(d.uploadData?.length)return nope();
    admitted.set(d.id,{...p,resourceType:d.resourceType,headers:false,response:false});return yes();
   }
   // Passive same-origin resources needed to display the explicitly opened native page.
   // Scripts, fetch/XHR, workers, websocket, ping, subframes and all other navigations stay held.
   if(loaded&&d.method==='GET'&&!d.uploadData?.length&&['image','stylesheet','font'].includes(d.resourceType)){
    admitted.set(d.id,{kind:'resource',url:d.url,method:'GET',resourceType:d.resourceType,headers:false,response:false});return yes();
   }
   return nope();
  },
  beforeSendHeaders(d){
   const row=admitted.get(d?.id);if(!basic(d)||!row||row.headers||!requestMatches(row,d))return nope();
   if(row.kind==='submit'){
    const headers=d.requestHeaders;if(!headers||typeof headers!=='object')return nope();
    const types=Object.entries(headers).filter(([key])=>key.toLowerCase()==='content-type');
    if(types.length!==1||typeof types[0][1]!=='string'||!/^application\/x-www-form-urlencoded(?:;\s*charset=UTF-8)?$/i.test(types[0][1]))return nope();
    const bytes=bytesOf(d);if(bytes&&!bytes.equals(row.body))return nope();
    sent=true;
   }
   row.headers=true;return yes();
  },
  headersReceived(d){
   const row=admitted.get(d?.id);if(!basic(d)||!row||!row.headers||!requestMatches(row,d)||!Number.isInteger(d.statusCode))return nope();
   // Chromium exposes the local CONNECT authentication challenge as response headers.
   // Only this tunnel's random realm may be answered once; it is not a provider response or write retry.
   if(d.statusCode===407&&typeof proxyRealm==='string'&&/^[a-f0-9]{32}$/.test(proxyRealm)&&!row.proxyChallenge){
    const challenges=Object.entries(d.responseHeaders??{}).filter(([key])=>key.toLowerCase()==='proxy-authenticate');
    if(challenges.length===1&&Array.isArray(challenges[0][1])&&challenges[0][1].length===1&&challenges[0][1][0]===`Basic realm="${proxyRealm}"`){row.proxyChallenge=true;row.headers=false;return yes();}
   }
   if(d.statusCode<200||d.statusCode>=300)return nope();
   row.response=true;row.statusCode=d.statusCode;if(row.kind==='navigation')loaded=true;return yes();
  },
  completed(d){
   const row=admitted.get(d?.id);if(basic(d)&&row?.headers&&row.response&&requestMatches(row,d)&&d.statusCode===row.statusCode&&row.kind==='submit')savedResponse={requestId:d.id,url:d.url,statusCode:d.statusCode};
   admitted.delete(d?.id);
  },
  failed(d){admitted.delete(d?.id);},
  outcome(){return {sent,savedResponse:savedResponse?{...savedResponse}:null};},
  close(){closed=true;permit=null;admitted.clear();savedResponse=null;},
 };
}
module.exports=Object.freeze({createRequestGate});
