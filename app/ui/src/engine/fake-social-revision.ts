import {actualSocialPosts,actualSocialPostLocations} from '../../../../platform/runtime/venture/playbooks/social/post-label';
// Fake per-post revisions mirror the engine quote, count and exact-word approval boundaries.
import { EngineError, type DeliveryLite, type OrderLite, type ReceiptLite } from './types';
import type { W4DeskHost } from './fake-w4';
import type { FakeDeskKind, FakeForgottenPerson } from './fake-playbooks';
import type { GhostwritingState } from '../../../../platform/runtime/venture/playbooks/social/revision-types';
import type { SocialRevisionRow } from '../../../../platform/runtime/venture/playbooks/social/revision-types';
const fail = (code: string, line: string): never => { throw new EngineError(code, line); };
const empty = (): GhostwritingState => ({ rounds: {}, decisions: {}, charges: [] });
const fields = (value: unknown, allowed: string[], required: string[]) => { if (!value || typeof value !== 'object' || Array.isArray(value))
    fail('INVALID_VENTURE_REQUEST', 'Send an object.'); const b = value as Record<string, unknown>; if (Object.keys(b).some(k => !allowed.includes(k)) || required.some(k => !(k in b)))
    fail('INVALID_VENTURE_REQUEST', 'Use only the fields for this action.'); return b; };
const posts=(run:DeliveryLite)=>actualSocialPosts(run.editedText??run.renderedText??'');
export function fakeSocialRevision(host: W4DeskHost): FakeDeskKind & {receipt(id:string):ReceiptLite|undefined;forgetPeople(people:readonly FakeForgottenPerson[],erase:boolean):void} {
    const currencyOf=()=>{const view=host.ask('venture.get',{}) as {venture?:{country?:{currency?:string}}};return view?.venture?.country?.currency??'INR';};
    const display=(amount:string,currency:string)=>{const digits=new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;const scale=10n**BigInt(digits),value=BigInt(amount);return currency+' '+String(value/scale).replace(/\B(?=(\d{3})+(?!\d))/g,',')+(digits?'.'+String(value%scale).padStart(digits,'0'):'');};
    const states = new Map<string, GhostwritingState>();
    const stateKey = (orderId: string) => host.current() + ':' + orderId;
    const getContext = (runId: unknown, postId: unknown) => {
        const run = (host.ask('venture.delivery.list', {}) as DeliveryLite[]).find(r => r.id === runId);
        if (!run)
            fail('DELIVERY_NOT_FOUND', 'Choose a social draft.');
        const order = (host.ask('venture.order.list', {}) as OrderLite[]).find(o => o.id === run!.orderId);
        if (!order)
            fail('DELIVERY_NOT_FOUND', 'Choose a social draft.');
        const plan = host.ask('venture.blueprint.get', {}) as {
            blueprint?: {
                offers?: {
                    id: string;
                    playbookOffer?: string;
                }[];
            };
        } | null;
        const offer = plan?.blueprint?.offers?.find(o => o.id === order!.offerId);
        const all = posts(run!);
        const m = typeof postId === 'string' && new RegExp('^' + run!.id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\.post-([1-9][0-9]{0,2})$').exec(postId);
        const n = m ? Number(m[1]) : 0;
        const post = all[n - 1];
        if (!post)
            fail('INVALID_VENTURE_REQUEST', 'Choose a post from this draft.');
        return { run: run!, order: order!, post: post!, n, all, ghost: offer?.playbookOffer === 'linkedin-ghostwriting' };
    };
    const effective=(run:DeliveryLite,postId:string,post:{channel:string;text:string},own:GhostwritingState)=>{
      const local=own.decisions['post-'+postId.split('.post-').at(-1)],shared=host.socialClientAnswer?.(run.id);
      const useLocal=local&&(!shared||local.at>shared.answer.at||local.at===shared.answer.at&&(local.decision!=='approved'||shared.answer.decision==='approved'));
      const exact=host.digest({postId,channel:post.channel,text:post.text});
      if(useLocal)return {...local,decision:local.digest===exact?local.decision:null};
      if(shared){const same=shared.packDigest===host.digest(run.editedText??run.renderedText??'');return {digest:same?exact:'',decision:same?shared.answer.decision:null,comment:shared.answer.comment,at:shared.answer.at,via:shared.answer.via,by:shared.answer.via==='share-link'?'client':'owner'};}
      return null;
    };
    const row = (runId: string, postId: string, words = ''): SocialRevisionRow => { const { run, order, post, n, ghost } = getContext(runId, postId); const state = states.get(stateKey(order.id)) ?? empty(); const used = state.rounds['post-' + n] ?? 0; const raw = order.intake?.fields?.extraRoundPrice; const amount = typeof raw === 'string' && /^\d{1,30}$/.test(raw) ? raw : null; const currency = currencyOf(); const exact = host.digest({ runId, postId, text: post.text, pack: run.editedText ?? run.renderedText, used, price: amount, currency, status: run.status }); const receiptId=['fig','revision',order.id,'post-'+n,used+1,amount,currency].join(':'); const quote = !ghost || used < 2 || amount === null ? null : { round: used + 1, amountMinor: amount, currency, display: display(amount,currency), receiptId, digest: host.digest({ item: exact, words, amount, currency, round: used + 1, receiptId }) }; const answer = effective(run,postId,post,state); return { id: postId, runId, postId, text: post.text, roundsUsed: used, clientDecision: answer?.decision??null, quote, digest: exact }; };
    return {
        forgetPeople(people) {
          const clientIds=new Set(people.flatMap(person=>person.clientId?[person.clientId]:[]));
          const tokens=people.flatMap(person=>[...person.names.flatMap(name=>[name,...name.split(/[\s,.]+/).filter(word=>[...word].length>=3)]),...person.emails,...person.phones]).map(value=>value.toLowerCase()).filter(Boolean);
          const orders=host.ask('venture.order.list',{}) as OrderLite[];
          for(const [id,own] of states){if(!id.startsWith(host.current()+':'))continue;const order=orders.find(item=>stateKey(item.id)===id);const decisions=Object.fromEntries(Object.entries(own.decisions).filter(([,answer])=>!clientIds.has(order?.clientId??'')&&!tokens.some(token=>(answer.comment??'').toLowerCase().includes(token))));states.set(id,{...own,decisions});}
        },
        receipt(id) {
          if(!id.startsWith('fig:revision:'))return undefined;
          const parts=id.split(':');const [,kind,orderId,key,round,amount,currency]=parts;
          if(parts.length!==7||!/^post-[1-9][0-9]{0,2}$/.test(key!)||!/^\d{1,30}$/.test(amount!))return undefined;
          const order=(host.ask('venture.order.list',{}) as OrderLite[]).find(item=>item.id===orderId);if(!order)return undefined;
          const own=states.get(stateKey(order.id))??empty();const charge=own.charges.find(item=>item.receiptId===id),used=own.rounds[key!]??0;
          if(!charge&&!(used>=2&&used+1===Number(round)&&order.intake?.fields?.extraRoundPrice===amount&&currencyOf()===currency))return undefined;
          return {id,at:charge?.at??order.at,figures:[{key:'extra-round',label:'One extra revision round',display:display(String(BigInt(amount!)*1n),currency!)}],explanation:'Owner-set extra-round price multiplied by one revision round. This is a quote approval, not a payment.',stale:false};
        },
        list(p) { const filter = fields(p.filter ?? {}, ['runId'], []); const rows = (host.ask('venture.delivery.list', {}) as DeliveryLite[]).filter(r => !filter.runId || r.id === filter.runId).flatMap(r => posts(r).map((_, n) => row(r.id, r.id + '.post-' + (n + 1)))); return { playbook: 'social-agency', kind: 'revision', rows, line: 'Choose one post to refine. Extra rounds show their exact quote.' }; },
        get(p) { const parsed = typeof p.id === 'string' ? /^(.+)\.post-[1-9][0-9]{0,2}$/.exec(p.id) : null; if (!parsed)
            fail('INVALID_VENTURE_REQUEST', 'Choose a post.'); const item = row(parsed![1]!, p.id as string); return { playbook: 'social-agency', kind: 'revision', item, digest: item.digest }; },
        act(p) {
            const client = p.action === 'client-answer';
            const b = fields(p.payload, client ? ['runId', 'postId', 'decision', 'comment'] : ['runId', 'postId', 'words', ...(p.action === 'revise' ? ['quoteDigest'] : [])], client ? ['runId', 'postId', 'decision'] : ['runId', 'postId', 'words']);
            if (typeof b.runId !== 'string' || typeof b.postId !== 'string' || p.id !== b.postId)
                fail('INVALID_VENTURE_REQUEST', 'Choose this post.');
            const runId = b.runId as string, postId = b.postId as string;
            const words = client ? '' : b.words;
            if (typeof words !== 'string' || !client && (!words.trim() || words.length > 300))
                fail('INVALID_VENTURE_REQUEST', 'Describe the revision in at most 300 characters.');
            const shown = row(runId, postId, words as string);
            if (p.digest !== shown.digest)
                fail('APPROVAL_STALE', 'This post or its price changed. Read it again.');
            const answer = (result: unknown, line: string) => ({ playbook: 'social-agency', kind: 'revision', id: postId, result, line });
            if (p.action === 'quote')
                return answer(shown.quote, shown.quote ? 'Approve the exact extra-round quote before revising.' : 'This round is included.');
            const { run, order, n, ghost } = getContext(runId, postId);
            const prior = states.get(stateKey(order.id)) ?? empty();
            const key = 'post-' + n;
            if (client) {
                if (!['approved', 'changes'].includes(String(b.decision)) || b.comment !== undefined && (typeof b.comment !== 'string' || b.comment.length > 1000))
                    fail('INVALID_VENTURE_REQUEST', 'Record the client answer.');
                if (!['accepted', 'edited'].includes(run.status))
                    fail('OWNER_APPROVAL_FIRST', 'Approve the draft before recording the client answer.');
                states.set(stateKey(order.id), { ...prior, decisions: { ...prior.decisions, [key]: { digest: host.digest({ postId, channel: getContext(runId,postId).post.channel, text: shown.text }), decision: b.decision as 'approved' | 'changes', comment: typeof b.comment === 'string' ? b.comment : null, at: host.now(), by: 'owner' } } });
                return answer({ postId }, 'Client answer recorded for this exact post.');
            }
            if (p.action !== 'revise')
                fail('INVALID_VENTURE_REQUEST', 'Choose a revision action.');
            if (ghost && shown.roundsUsed >= 2 && (!shown.quote || b.quoteDigest !== shown.quote.digest))
                fail('OFFER_EXTRA_ROUND', shown.quote ? 'This extra round costs ' + shown.quote.display + '. Approve its exact quote first.' : 'Set your extra-round price before a third revision.');
            if (!['ready-for-review', 'accepted', 'edited'].includes(run.status))
                fail('DELIVERY_NOT_READY', 'This draft is not waiting for your review.');
            if(run.editedText){const surrounding=(text:string)=>{const indexes=new Set(actualSocialPostLocations(text).map(post=>post.lineIndex));return text.split(/\r?\n/).filter((_,index)=>!indexes.has(index)).join('\n');};if(surrounding(run.editedText)!==surrounding(run.renderedText??''))fail('SOCIAL_REVISION_SHAPE','This pack has edits outside its posts. Keep those edits in the structured draft before refining one post.');}
            const revise = (host as W4DeskHost & {
                reviseDelivery?: (id: string, change: (r: DeliveryLite) => DeliveryLite) => DeliveryLite;
            }).reviseDelivery;
            if (!revise)
                fail('NOT_BUILT_YET', 'This model preview is not connected.');
            const previewInput={stageId:'drafts',request:words,socialRevision:{postId,n,originalText:run.editedText??run.renderedText??''}};
            revise!(runId, r => ({ ...r, status: 'waiting-for-you', awaitingYou: true,preview:{digest:host.digest(previewInput).padStart(64,'0'),input:previewInput} } as DeliveryLite));
            const decisions = { ...prior.decisions };
            for(const [index,post] of posts(run).entries()){const answer=effective(run,run.id+'.post-'+(index+1),post,prior);if(answer?.decision==='approved')decisions['post-'+(index+1)]=answer;}
            decisions[key] = { digest: '', decision: null, comment: null, at: host.now(), by: 'owner' };
            states.set(stateKey(order.id), { ...prior, rounds: { ...prior.rounds, [key]: shown.roundsUsed + 1 }, decisions, charges: shown.quote ? [...prior.charges, { postId, round: shown.quote.round, amountMinor: shown.quote.amountMinor, currency: shown.quote.currency, quoteDigest: shown.quote.digest, receiptId: shown.quote.receiptId, by: 'owner', at: host.now() }] : prior.charges });
            host.emit({ event: 'desk.changed', playbook: 'social-agency', kind: 'revision', id: postId } as any);
            return answer({ runId }, 'This post revision waits for your approval before the model runs.');
        }
    };
}
