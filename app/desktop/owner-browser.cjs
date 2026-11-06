'use strict';
// Original desktop-only native-form browser. Credentials and prepared bodies remain in main memory only.
const {randomUUID,randomBytes,createHash,createHmac}=require('node:crypto');
const {pageOperation}=require('./owner-browser-dom.cjs');
const {createRequestGate}=require('./owner-browser-gate.cjs');
const hash=value=>createHash('sha256').update(value).digest('hex');
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const exact=(v,keys)=>object(v)&&Object.keys(v).sort().join(',')===keys.split(',').sort().join(',');
const failure=(code,message)=>Object.assign(new Error(message),{code});
function createOwnerBrowser(deps){
 let view=null,chosen=null,parent=null,config=null,gate=null,captured=null,prepared=null,phase='closed',generation=0;
 let complete=null,deadline=null,sendingProof=null;const salt=randomBytes(32);
 const live=()=>phase!=='closed'&&config&&deps.current(config.runId)===true&&view&&!view.webContents.isDestroyed();
 const assertLive=()=>{if(!live())throw failure('FORM_BROWSER_CLOSED','Open the current approved client browser again.');};
 const invalidate=()=>{generation++;captured=null;prepared=null;};
 const sameOrigin=value=>{try{const u=new URL(value);return config&&u.protocol==='https:'&&u.origin===config.origin&&!u.username&&!u.password&&!u.hash;}catch{return false;}};
 const resize=()=>{if(view&&parent){const bounds=parent.getContentBounds();view.setBounds({x:0,y:0,width:Math.max(1,bounds.width),height:Math.max(1,bounds.height)});}};
 const evaluate=async command=>{assertLive();return view.webContents.executeJavaScriptInIsolatedWorld(991,[{code:`(${pageOperation.toString()})(${JSON.stringify(command)})`}]);};
 const inspect=async()=>{
  const result=await evaluate({op:'inspect'});assertLive();
  if(!object(result)||!result.complete||!sameOrigin(result.url)||typeof result.signature!=='string'||result.signature.length>500000||typeof result.text!=='string'||result.text.length>100000||!Array.isArray(result.fields)||result.fields.length>100)throw failure('FORM_CAPTURE_INCOMPLETE','This page cannot be captured completely. Use the manual path.');
  return result;
 };
 const targetOf=input=>{assertLive();if(!exact(input,'pageHash,targetId,fingerprint')||!captured||input.pageHash!==captured.pageHash)throw failure('FORM_TARGET_CHANGED','Capture and review the current form again.');const target=captured.targets.find(row=>row.id===input.targetId&&row.fingerprint===input.fingerprint);if(!target)throw failure('FORM_TARGET_CHANGED','That form field changed. Capture it again.');return target;};
 const settle=()=>{if(complete){const done=complete;complete=null;if(deadline)clearTimeout(deadline);deadline=null;done();}};
 async function close(){
  phase='closed';sendingProof=null;invalidate();settle();gate?.close();
  if(parent)parent.removeListener('resize',resize);
  if(view){try{parent?.contentView.removeChildView(view);}catch{}try{view.webContents.close();}catch{}}
  if(chosen){chosen.webRequest.onBeforeRequest((_d,callback)=>callback({cancel:true}));try{await chosen.closeAllConnections();if(!config?.savedSignInId)await chosen.clearStorageData();}catch{}}
  const closedWindow=parent;view=null;chosen=null;parent=null;config=null;gate=null;
  if(closedWindow&&!closedWindow.isDestroyed())closedWindow.destroy();
 }
 return {
  async open(input){
   await close();
   if(!object(input)||Object.keys(input).some(key=>!['runId','origin','url','proxy','savedSignInId'].includes(key))||typeof input.runId!=='string'||!/^[A-Za-z0-9_-]{1,100}$/.test(input.runId)||typeof input.origin!=='string'||typeof input.url!=='string'||!object(input.proxy))throw failure('SITE_NOT_ALLOWED','Choose the approved client site.');
   const u=new URL(input.url),p=input.proxy;
   if(u.protocol!=='https:'||u.origin!==input.origin||u.username||u.password||u.hash||!Number.isInteger(p.port)||p.port<1||p.port>65535||p.proxyUrl!==`http://127.0.0.1:${p.port}`||p.username!=='chausar'||typeof p.password!=='string'||!/^[a-f0-9]{64}$/.test(p.password)||typeof p.realm!=='string'||!/^[a-f0-9]{32}$/.test(p.realm)||input.savedSignInId!==undefined&&!/^[a-f0-9-]{36}$/.test(input.savedSignInId))throw failure('SITE_NOT_ALLOWED','Use the approved local browser connection.');
   config={...input,proxy:{...p}};phase='opening';const ownerWindow=deps.window();
   if(!ownerWindow||deps.current(input.runId)!==true){await close();throw failure('FORM_BROWSER_CLOSED','The client browser approval is no longer current.');}
   try{
    parent=new deps.BrowserWindow({parent:ownerWindow,show:false,width:900,height:760,minWidth:390,minHeight:400,title:'Chausar',webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,javascript:false,devTools:false}});
    parent.setMenuBarVisibility(false);parent.on('closed',()=>{if(phase!=='closed'){deps.onClosed?.();void close();}});
    const partition=input.savedSignInId?`persist:chausar-forms-${input.savedSignInId}`:`chausar-forms-${randomUUID()}`;
    chosen=deps.session.fromPartition(partition);
    chosen.setPermissionRequestHandler((_wc,_permission,callback)=>callback(false));chosen.setPermissionCheckHandler(()=>false);chosen.setDevicePermissionHandler(()=>false);
    // A selected sign-in retains cookies, never previous service workers or cached application code.
    await chosen.clearStorageData({storages:['serviceworkers','cachestorage']});
    await chosen.setProxy({mode:'fixed_servers',proxyRules:p.proxyUrl,proxyBypassRules:'<-loopback>'});await chosen.closeAllConnections();
    view=new deps.WebContentsView({webPreferences:{session:chosen,javascript:false,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,webgl:false,spellcheck:false,devTools:false,plugins:false,navigateOnDragDrop:false}});
    const wc=view.webContents;gate=createRequestGate({origin:input.origin,webContentsId:wc.id,current:live,proxyRealm:p.realm});
    chosen.webRequest.onBeforeRequest((d,callback)=>callback(gate?.beforeRequest(d)??{cancel:true}));
    chosen.webRequest.onBeforeSendHeaders((d,callback)=>{
     if(d.method!=='POST'){callback(gate?.beforeSendHeaders(d)??{cancel:true});return;}
     const proof=sendingProof;
     void (async()=>{try{
      assertLive();if(phase!=='sending'||!proof||typeof deps.beforeSubmit!=='function')throw failure('FORM_ACTION_HELD','This submit has no current owner verification.');
      await deps.beforeSubmit({runId:config.runId,handle:proof.handle,digest:proof.digest});
      assertLive();if(sendingProof!==proof||phase!=='sending')throw failure('APPROVAL_STALE','This form submission changed.');
      callback(gate?.beforeSendHeaders(d)??{cancel:true});
     }catch{callback({cancel:true});}})();
    });
    chosen.webRequest.onHeadersReceived((d,callback)=>callback(gate?.headersReceived(d)??{cancel:true}));
    chosen.webRequest.onCompleted(d=>{gate?.completed(d);if(gate?.outcome().savedResponse)settle();});
    chosen.webRequest.onErrorOccurred(d=>{gate?.failed(d);if(phase==='sending')settle();});
    chosen.on('will-download',(event,item)=>{event.preventDefault();item?.cancel();});
    wc.setWindowOpenHandler(()=>({action:'deny'}));
    wc.on('will-frame-navigate',event=>{if(!event.isMainFrame||!sameOrigin(event.url))event.preventDefault();});
    wc.on('will-redirect',event=>event.preventDefault());
    wc.on('did-start-navigation',event=>{if(event.isMainFrame)invalidate();});
    wc.on('did-navigate-in-page',()=>invalidate());
    wc.on('render-process-gone',()=>{void close();});
    wc.on('login',(event,_details,info,callback)=>{event.preventDefault();if(live()&&info?.isProxy===true&&info.host==='127.0.0.1'&&info.port===p.port&&info.realm===p.realm&&info.scheme==='basic')callback(p.username,p.password);else callback();});
    parent.contentView.addChildView(view);parent.on('resize',resize);resize();
    gate.armNavigation(input.url);await wc.loadURL(input.url);assertLive();phase='open';parent.show();
    return {opened:true,profile:'native-html-form',savedSignIn:!!input.savedSignInId};
   }catch(error){await close();throw error;}
  },
  async navigate(input){
   assertLive();if(phase!=='saved')throw failure('FORM_ACTION_HELD','Wait for the approved credential submission response before continuing.');
   if(!exact(input,'url')||!sameOrigin(input.url))throw failure('SITE_NOT_ALLOWED','Choose a page on this same approved client origin.');
   invalidate();phase='opening';gate.close();gate=createRequestGate({origin:config.origin,webContentsId:view.webContents.id,current:live,proxyRealm:config.proxy.realm});gate.armNavigation(input.url);
   try{await view.webContents.loadURL(input.url);assertLive();phase='open';return {opened:true};}catch(error){await close();throw error;}
  },
  async capture(){
   assertLive();if(phase==='sending')throw failure('FORM_ACTION_HELD','Wait for this submission to settle.');
   const version=generation,page=await inspect();
   // Visible credential forms are reviewed as redacted fields; no screenshot of an OTP or secret is retained.
   const secretPage=page.fields.some(field=>field.redacted===true||field.kind==='password'||/password|passcode|\botp\b|\bcvv\b/i.test(field.name));
   const png=secretPage?null:(await view.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG();
   const after=await inspect();assertLive();if(generation!==version||after.signature!==page.signature)throw failure('FORM_TARGET_CHANGED','The page changed during capture. Capture it again.');
   if(png&&png.length>6000000)throw failure('FORM_CAPTURE_INCOMPLETE','This screenshot is too large. Use a smaller browser view.');
   const pageHash=hash(page.signature),targets=page.fields.map(field=>({id:randomUUID(),fingerprint:hash(pageHash+field.descriptor),pageHash,name:field.name,kind:field.kind,disabled:field.disabled,inForm:field.inForm,index:field.index}));
   prepared=null;captured={pageHash,targets,signature:page.signature};
   const pages=[];for(let offset=0;offset<page.text.length||offset===0;offset+=4000)pages.push({index:pages.length,pageHash,text:page.text.slice(offset,offset+4000)});
   return {pageHash,url:page.url,title:page.title,complete:true,pages,targets:targets.map(({index,...target})=>target),screenshot:png?{mime:'image/png',base64:png.toString('base64')}:null,responseEvidence:gate.outcome().savedResponse};
  },
  async fill(input){
   assertLive();if(!exact(input,'pageHash,values')||!captured||input.pageHash!==captured.pageHash||!Array.isArray(input.values)||!input.values.length||input.values.length>100)throw failure('FORM_MAPPING_INVALID','Choose the approved current field mapping.');
   const values=input.values.map(value=>{if(!exact(value,'targetId,fingerprint,value')||typeof value.value!=='string')throw failure('FORM_MAPPING_INVALID','Use exact source strings.');const target=targetOf({pageHash:input.pageHash,targetId:value.targetId,fingerprint:value.fingerprint});return {index:target.index,value:value.value};});
   await evaluate({op:'fill',signature:captured.signature,values});assertLive();invalidate();return {filled:true};
  },
  async prepare(input){
   const target=targetOf(input);const signature=captured.signature;
   const request=await evaluate({op:'prepare',signature,index:target.index});assertLive();
   if(!captured||captured.signature!==signature||request.signature!==signature||!sameOrigin(request.url)||request.method!=='POST'||request.contentType!=='application/x-www-form-urlencoded'||typeof request.body!=='string'||request.body.length>100000)throw failure('FORM_TARGET_CHANGED','The form changed before review.');
   const handle=randomUUID(),digest=createHmac('sha256',salt).update(handle+request.url+request.body).digest('hex');
   prepared={handle,digest,request,signature,expires:Date.now()+60000};
   return {handle,digest,url:request.url,method:'POST',review:request.review,sensitive:request.sensitive,credential:request.credential===true,expiresAt:new Date(prepared.expires).toISOString()};
  },
  async submit(input){
   assertLive();if(!exact(input,'handle,digest')||!prepared||input.handle!==prepared.handle||input.digest!==prepared.digest||prepared.expires<=Date.now())throw failure('APPROVAL_STALE','Review this exact submit again.');
   const chosenRequest=prepared,page=await inspect();assertLive();
   if(prepared!==chosenRequest||page.signature!==chosenRequest.signature)throw failure('FORM_TARGET_CHANGED','The form changed after review.');
   prepared=null;phase='sending';sendingProof={handle:chosenRequest.handle,digest:chosenRequest.digest};
   const request=chosenRequest.request;gate.armSubmit({url:request.url,body:request.body,contentType:request.contentType});
   const finished=new Promise(resolve=>{complete=resolve;deadline=setTimeout(settle,15000);});
   try{await evaluate({op:'submit',signature:chosenRequest.signature,index:request.index,body:request.body});await finished;assertLive();const outcome=gate.outcome();phase=outcome.savedResponse?'saved':'held';invalidate();return {status:outcome.savedResponse?'response-received':outcome.sent?'outcome-unknown':'not-sent',responseEvidence:outcome.savedResponse};}
   catch(error){settle();if(phase!=='closed')phase='held';throw error;}finally{sendingProof=null;}
  },
  async readSaved(){
   assertLive();const evidence=gate.outcome().savedResponse,version=generation;
   if(phase!=='saved'||!evidence)throw failure('FORM_READBACK_UNAVAILABLE','No completed saved response is available. Check the record manually.');
   const page=await inspect();if(page.url!==evidence.url)throw failure('FORM_READBACK_UNAVAILABLE','The browser left the saved response. Check this record manually.');
   const response=await evaluate({op:'read-saved'});assertLive();const after=await inspect();
   if(generation!==version||phase!=='saved'||!response?.complete||response.url!==evidence.url||after.signature!==page.signature||!Array.isArray(response.readings)||response.readings.length>200||typeof response.signature!=='string'||response.signature.length>1000000)throw failure('FORM_READBACK_UNAVAILABLE','The saved page changed before comparison. Check the record manually.');
   const digest=hash(JSON.stringify(evidence)+response.signature);
   return {digest,responseEvidence:evidence,targets:response.readings.map(reading=>({id:randomUUID(),fingerprint:hash(digest+reading.descriptor),name:reading.name,kind:reading.kind,value:reading.value}))};
  },
  async eraseSignIns(ids){
   if(!Array.isArray(ids)||ids.length>1000||ids.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))||new Set(ids).size!==ids.length)throw failure('FORM_ACTION_HELD','Choose only the forgotten client sign-in partitions.');
   await close();for(const id of ids){const partition=deps.session.fromPartition('persist:chausar-forms-'+id);await partition.closeAllConnections();await partition.clearStorageData();await partition.clearCache?.();}
   return {erased:[...ids]};
  },
  close,
 };
}
module.exports=Object.freeze({createOwnerBrowser});
