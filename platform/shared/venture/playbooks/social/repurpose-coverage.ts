// Original Chausar checks for catalogue S2; MIT source ideas only, no copied code.
import { actualSocialPosts } from './post-label.ts';
import { socialFormats } from './formats.ts';
import type { SocialChannel } from './channel-ids.ts';

/** The promised pack has one draft per selected channel and a separate newsletter blurb. */
export function repurposeCoverage(text: string, channels: unknown): { check: string; outcome: 'pass' | 'fail'; detail: string } {
    const detail = 'Include one draft for each selected channel and a nonempty Newsletter blurb section.';
    try {
        const formats = socialFormats({ channels: channels as SocialChannel[], footage: false, images: false });
        const posts = actualSocialPosts(text);
        let inBlurb = false;
        let blurbDepth = 0;
        const blurb: string[] = [];
        for (const line of text.split(/\r?\n/)) {
            const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line.trim());
            if (heading) {
                const depth = heading[1]!.length;
                if (inBlurb && depth <= blurbDepth) inBlurb = false;
                if (heading[2]!.trim().toLowerCase() === 'newsletter blurb') { inBlurb = true; blurbDepth = depth; }
            } else if (inBlurb) blurb.push(line);
        }
        const complete = posts.length === formats.length && formats.every(format => posts.filter(post => post.channel === format.channel).length === 1) && blurb.join('\n').trim().length > 0;
        return { check: 'repurpose-coverage', outcome: complete ? 'pass' : 'fail', detail };
    } catch { return { check: 'repurpose-coverage', outcome: 'fail', detail }; }
}

export const REPURPOSE_GUIDANCE = 'Write exactly one source-grounded draft for each selected channel, then a separate Newsletter blurb section. Keep every claim in the supplied source. A missing image or video remains a clearly labelled creative brief, never a finished asset.';
