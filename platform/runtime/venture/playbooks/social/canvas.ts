// Original Chausar canvas view. Pure data, shared by engine and fake; no money is computed in the UI.
import type { SocialChannel } from './channel-ids.ts';
import { socialFormat, type SocialFormat } from './formats.ts';
import { sourceInventory, type SourceInventory } from './inventory.ts';
import { actualSocialPosts } from './post-label.ts';
import { readPostPlan, postPlanLines, type PostPlan } from './post-plan.ts';
export type CanvasPost = {
    id: string;
    runId: string;
    text: string;
    channel: SocialChannel;
    plan: Omit<PostPlan, 'postId'> | null;
};
export type SocialCanvasView = {
    id: string;
    orderId: string;
    request: string;
    runId: string | null;
    inventory: SourceInventory | null;
    sourceProblem: string | null;
    cards: (SocialFormat & {
        posts: CanvasPost[];
    })[];
};
export function canvasPosts(runId: string, text: string): CanvasPost[] {
    const posts: CanvasPost[] = actualSocialPosts(text).map(post => ({ ...post, id: `${runId}.${post.id}`, runId, plan: null }));
    try {
        const plans = readPostPlan(postPlanLines(text), posts.map((_, index) => `post-${index + 1}`));
        for (const [index, post] of posts.entries()) {
            const { postId: _, ...plan } = plans[index]!;
            post.plan = plan;
        }
    } catch { /* Missing or invalid metadata stays unvalidated. */ }
    return posts;
}
export function socialCanvas(input: {
    orderId: string;
    request: string;
    runId: string | null;
    text: string;
    channels: SocialChannel[];
    source: string | null;
    sourceProblem?: string | null;
    images: boolean;
}): SocialCanvasView {
    const posts = input.runId ? canvasPosts(input.runId, input.text) : [];
    const channels = [...new Set([...input.channels, ...posts.map(post => post.channel)])];
    let inventory: SourceInventory | null = null, sourceProblem = input.sourceProblem ?? null;
    if (input.source !== null)
        try {
            inventory = sourceInventory(input.source);
        }
        catch (error) {
            sourceProblem = (error as Error).message;
        }
    return { id: input.orderId, orderId: input.orderId, request: input.request, runId: input.runId, inventory, sourceProblem, cards: channels.map(channel => ({ ...socialFormat(channel, { images: input.images, footage: false }), posts: posts.filter(post => post.channel === channel) })) };
}
