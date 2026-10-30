// Original owner-start microphone lease. No camera, subframe or general origin permission is granted.
'use strict';
/** Native caption status is rechecked before a one-use audio permission request is answered. */
function captionPermission({window,isTrustedDocument,verify,now=Date.now}) {
  let lease=null;
  const clear=()=>{lease=null;};
  const trusted=(contents,details,url)=>Boolean(window())&&contents===window().webContents&&isTrustedDocument(contents?.mainFrame?.url)&&details?.isMainFrame===true&&isTrustedDocument(url);
  const valid=()=>lease&&lease.expires>now();
  return {
    clear,
    observe(request,reply) {
      const p=request?.payload;
      if(request?.method==='venture.desk.act'&&p?.playbook==='translation-studio'&&p.kind==='caption') {
        if(p.action==='stop'){clear();return;}
        if(p.action==='start'&&reply?.playbook==='translation-studio'&&reply.kind==='caption'&&reply.id===p.id&&typeof reply.result?.id==='string')lease={orderId:p.id,sessionId:reply.result.id,expires:now()+30000,requested:false};
      }
    },
    // Electron checks first, then requests when denied. Never create a reusable microphone grant.
    check() { return false; },
    async request(contents,permission,details) {
      if(permission!=='media'||!trusted(contents,details,details?.requestingUrl)||!Array.isArray(details.mediaTypes)||details.mediaTypes.length!==1||details.mediaTypes[0]!=='audio'||!valid())return false;
      if(lease.requested){clear();return false;}
      const current=lease;current.requested=true;
      try { if(!await verify(current.orderId,current.sessionId)||lease!==current||!valid()){clear();return false;}return true; }
      catch {clear();return false;}
    },
  };
}
module.exports={captionPermission};
