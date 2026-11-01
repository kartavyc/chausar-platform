// Original owner-start microphone lease. No camera, subframe or general origin permission is granted.
// W6 6I1 (D45): a push-to-talk session the engine just started (venture.talk.start) takes the same one-use lease, checked
// again with the engine (verifyTalk) before the operating system microphone opens.
'use strict';
/** Native caption status is rechecked before a one-use audio permission request is answered. */
function captionPermission({window,isTrustedDocument,verify,verifyTalk=async()=>false,now=Date.now}) {
  let lease=null;
  const clear=()=>{lease=null;};
  const trusted=(contents,details,url)=>Boolean(window())&&contents===window().webContents&&isTrustedDocument(contents?.mainFrame?.url)&&details?.isMainFrame===true&&isTrustedDocument(url);
  const valid=()=>lease&&lease.expires>now();
  return {
    clear,
    observe(request,reply) {
      const p=request?.payload;
      if(request?.method==='venture.talk.hear'||(request?.method==='venture.talk.consent'&&p?.withdraw===true)){clear();return;}
      if(request?.method==='venture.talk.start'){clear();if(typeof reply?.sessionId==='string')lease={talk:true,sessionId:reply.sessionId,expires:now()+30000,requested:false};return;}
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
      try { if(!await (current.talk?verifyTalk(current.sessionId):verify(current.orderId,current.sessionId))||lease!==current||!valid()){clear();return false;}return true; }
      catch {clear();return false;}
    },
  };
}
module.exports={captionPermission};
