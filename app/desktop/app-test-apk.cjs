'use strict';
// Original native APK picker. The page names an order, never a local path or file body.
const failure=(code,message)=>Object.assign(new Error(message),{code});
function inputOf(input){if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['orderId','fromClient','digest'].includes(k))||typeof input.orderId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(input.orderId)||input.fromClient!==true||input.digest!==undefined&&(typeof input.digest!=='string'||!input.digest||input.digest.length>200))throw failure('INVALID_REQUEST','Choose this client order and confirm the APK came from the client.');return {...input};}
async function orderOf(engine,id){const rows=await engine.request('venture.order.list',{});const order=Array.isArray(rows)?rows.find(row=>row.id===id):null;if(!order||order.status!=='open')throw failure('ORDER_NOT_FOUND','Choose an open client order.');return JSON.stringify(order);}
/** A cancelled picker has no effect. The original client/order is checked again before the engine reads a file. */
async function pickClientApk(event,input,deps){try{
 deps.assertTrustedSender(event,deps.window?.webContents);const request=inputOf(input),before=await orderOf(deps.engine,request.orderId);
 const picked=await deps.dialog.showOpenDialog(deps.window,{title:'Choose the client APK',properties:['openFile'],filters:[{name:'Android app',extensions:['apk']}]});if(picked?.canceled||!picked?.filePaths?.length)return{ok:true,result:null};
 deps.assertTrustedSender(event,deps.window?.webContents);if(picked.filePaths.length!==1||typeof picked.filePaths[0]!=='string')throw failure('INVALID_REQUEST','Choose one client APK.');if(await orderOf(deps.engine,request.orderId)!==before)throw failure('APPROVAL_STALE','The client order changed while choosing the APK. Choose it again.');
 const out=await deps.engine.request('venture.desk.act',{playbook:'app-testing',kind:'test',id:request.orderId,action:'import-apk',payload:{path:picked.filePaths[0],fromClient:true},...(request.digest?{digest:request.digest}:{})});if(out?.result?.job?.orderId!==request.orderId)throw failure('CLIENT_APK_REQUIRED','The selected client build was not imported.');return{ok:true,result:{imported:true,orderId:request.orderId}};
 }catch(error){return{ok:false,error:deps.publicError(error)};}}
module.exports=Object.freeze({pickClientApk});
