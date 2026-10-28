// Browser-safe shapes for the per-post revision desk.
export type RevisionQuote = {
    round: number;
    amountMinor: string;
    currency: string;
    display: string;
    receiptId: string;
    digest: string;
};
export type SocialRevisionRow = {
    id: string;
    runId: string;
    postId: string;
    text: string;
    roundsUsed: number;
    clientDecision: 'approved' | 'changes' | null;
    quote: RevisionQuote | null;
    digest: string;
};
export type GhostwritingState = { rounds: Record<string,number>; decisions: Record<string,{digest:string;decision:'approved'|'changes'|null;comment:string|null;at:string;by:string;via?:'share-link'|'owner-recorded'}>; charges: {postId:string;round:number;amountMinor:string;currency:string;quoteDigest:string;receiptId:string;by:string;at:string}[] };
