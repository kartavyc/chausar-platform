'use strict';
const {app,BrowserWindow,WebContentsView,session}=require('electron');
const {readFileSync,writeFileSync}=require('node:fs');
const {createOwnerBrowser}=require('../../app/desktop/owner-browser.cjs');
const config=JSON.parse(readFileSync(process.argv[2],'utf8'));let browser,parent;const events=[];
app.setPath('userData',config.profile);
app.whenReady().then(async()=>{
 try{
  parent=new BrowserWindow({show:false,paintWhenInitiallyHidden:true,width:900,height:800,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
  await parent.loadURL('data:text/html,<html><body>Local form qualification</body></html>');
  class FixtureView extends WebContentsView {constructor(options){super({...options,webPreferences:{...options.webPreferences,offscreen:true}});}}
  class FixtureWindow extends BrowserWindow {show(){}}
  browser=createOwnerBrowser({BrowserWindow:FixtureWindow,WebContentsView:FixtureView,session:{fromPartition:name=>{const chosen=session.fromPartition(name);for(const name of ['onBeforeRequest','onBeforeSendHeaders','onHeadersReceived']){const original=chosen.webRequest[name].bind(chosen.webRequest);chosen.webRequest[name]=fn=>original((detail,callback)=>fn(detail,result=>{events.push({hook:name,id:detail.id,url:detail.url,method:detail.method,resourceType:detail.resourceType,webContentsId:detail.webContentsId,statusCode:detail.statusCode,type:detail.requestHeaders?.['Content-Type'],upload:detail.uploadData?.map(row=>({keys:Object.keys(row),constructor:row.bytes?.constructor?.name,length:row.bytes?.length,hash:row.bytes?require('node:crypto').createHash('sha256').update(row.bytes).digest('hex'):null})),cancel:result.cancel});callback(result);}));}chosen.setCertificateVerifyProc((request,callback)=>callback(request.hostname==='records.example.com'&&request.certificate.data.trim()===config.cert.trim()?0:-2));return chosen;}},window:()=>parent,current:()=>true,beforeSubmit:async()=>{events.push({physicalVerification:true});}});
  await browser.open({runId:'fixture_run',origin:'https://records.example.com',url:'https://records.example.com/entry',proxy:config.proxy});
  await new Promise(resolve=>setTimeout(resolve,300));const first=await browser.capture();const customer=first.targets.find(row=>row.name==='customer'),note=first.targets.find(row=>row.name==='note');
  if(!customer||!note)throw new Error('Native fields missing');
  await browser.fill({pageHash:first.pageHash,values:[{targetId:customer.id,fingerprint:customer.fingerprint,value:'0007'},{targetId:note.id,fingerprint:note.fingerprint,value:'client\nrecord'}]});
  const filled=await browser.capture(),button=filled.targets.find(row=>row.kind==='submit');
  const prepared=await browser.prepare({pageHash:filled.pageHash,targetId:button.id,fingerprint:button.fingerprint});
  const submitted=await browser.submit({handle:prepared.handle,digest:prepared.digest});
  const readback=await browser.readSaved();
  writeFileSync(config.output,JSON.stringify({pass:submitted.status==='response-received'&&readback.targets.some(row=>row.name==='customer'&&row.value==='0008'),submitted,readback,review:prepared.review,events}));
 }catch(error){writeFileSync(config.output,JSON.stringify({pass:false,error:String(error),stack:error.stack,events}));process.exitCode=1;}
 finally{await browser?.close();parent?.destroy();app.quit();}
});
